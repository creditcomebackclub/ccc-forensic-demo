-- Bind every concierge request to the same canonical, active portal identity
-- used by the client-safe snapshot. This is an additive replacement of the
-- existing service-only limiter; event history is preserved unchanged.
--
-- Rollback: restore the 20260820370000 implementation of
-- public.ccc_begin_portal_concierge_request(uuid, uuid, text). No data
-- rollback is required because this migration changes authorization only.

begin;

create or replace function public.ccc_begin_portal_concierge_request(
  p_portal_user_id uuid,
  p_client_id uuid,
  p_handoff_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_identity jsonb;
  v_canonical_client_id uuid;
  v_minute_count integer;
  v_hour_count integer;
  v_event_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required';
  end if;
  if p_portal_user_id is null or p_client_id is null then
    raise exception using errcode = '22023', message = 'Portal identity is required';
  end if;
  if p_handoff_reason is not null
     and p_handoff_reason not in ('human_requested', 'legal_or_security') then
    raise exception using errcode = '22023', message = 'Unsupported handoff reason';
  end if;

  v_identity := public.ccc_resolve_canonical_portal_identity(
    p_portal_user_id,
    'active'
  );
  begin
    v_canonical_client_id := (v_identity ->> 'clientId')::uuid;
  exception when others then
    raise exception using errcode = '42501', message = 'Canonical portal identity is invalid';
  end;
  if v_canonical_client_id is distinct from p_client_id then
    raise exception using errcode = '42501', message = 'Client identity does not match the active portal mapping';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_portal_user_id::text, 0)
  );

  select
    count(*) filter (where event.created_at >= current_timestamp - interval '1 minute')::integer,
    count(*) filter (where event.created_at >= current_timestamp - interval '1 hour')::integer
  into v_minute_count, v_hour_count
  from public.portal_concierge_events event
  where event.portal_user_id = p_portal_user_id
    and event.client_id = v_canonical_client_id
    and event.created_at >= current_timestamp - interval '1 hour';

  if v_minute_count >= 8 then
    return jsonb_build_object('allowed', false, 'retry_after_seconds', 60);
  end if;
  if v_hour_count >= 40 then
    return jsonb_build_object('allowed', false, 'retry_after_seconds', 3600);
  end if;

  insert into public.portal_concierge_events (
    portal_user_id,
    client_id,
    event_type,
    handoff_reason
  ) values (
    p_portal_user_id,
    v_canonical_client_id,
    case when p_handoff_reason is null then 'request' else 'handoff' end,
    p_handoff_reason
  ) returning id into v_event_id;

  return jsonb_build_object(
    'allowed', true,
    'retry_after_seconds', 0,
    'handoff_recorded', p_handoff_reason is not null,
    'event_id', v_event_id
  );
end;
$$;

revoke all on function public.ccc_begin_portal_concierge_request(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.ccc_begin_portal_concierge_request(uuid, uuid, text)
  to service_role;

comment on function public.ccc_begin_portal_concierge_request(uuid, uuid, text) is
  'Service-only concierge limiter/handoff gate. Re-resolves canonical active portal identity, stores no message content, and rate-limits 8/minute plus 40/hour.';

commit;
