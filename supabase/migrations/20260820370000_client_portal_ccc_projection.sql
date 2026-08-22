-- Exact-auth, client-safe CCC portal projection plus privacy-safe concierge
-- request throttling/handoff records. No prompt text, notes, legal strategy,
-- classification snapshots, source audits, or account identifiers are stored
-- in the concierge event table or exposed by the projection.
--
-- Rollback: drop ccc_begin_portal_concierge_request(uuid,uuid,text),
-- get_my_ccc_portal_projection(), then portal_concierge_events. The browser
-- keeps a migration-safe deletion-only fallback and never falls back to raw
-- audit/track reads.

begin;

create table if not exists public.portal_concierge_events (
  id uuid primary key default gen_random_uuid(),
  portal_user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  event_type text not null check (event_type in ('request', 'handoff')),
  handoff_reason text check (
    handoff_reason is null
    or handoff_reason in ('human_requested', 'legal_or_security')
  ),
  created_at timestamptz not null default now(),
  check (
    (event_type = 'request' and handoff_reason is null)
    or (event_type = 'handoff' and handoff_reason is not null)
  )
);

create index if not exists portal_concierge_events_rate_idx
  on public.portal_concierge_events (portal_user_id, created_at desc);
create index if not exists portal_concierge_events_staff_handoff_idx
  on public.portal_concierge_events (client_id, created_at desc)
  where event_type = 'handoff';

comment on table public.portal_concierge_events is
  'Privacy-safe concierge request/handoff audit. Stores no message body, model prompt, notes, or client PII.';

alter table public.portal_concierge_events enable row level security;

drop policy if exists portal_concierge_events_staff_read on public.portal_concierge_events;
create policy portal_concierge_events_staff_read
on public.portal_concierge_events for select to authenticated
using (
  exists (
    select 1
    from public.profiles profile
    join public.clients client on client.id = portal_concierge_events.client_id
    where profile.id = auth.uid()
      and profile.role in ('admin', 'auditor')
      and (profile.role = 'admin' or client.user_id = auth.uid())
  )
);

revoke all on table public.portal_concierge_events from public, anon, authenticated;
grant select on table public.portal_concierge_events to authenticated;
grant all on table public.portal_concierge_events to service_role;

create or replace function public.get_my_ccc_portal_projection()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_client_id uuid;
  v_profile_count integer;
  v_client_profile_count integer;
  v_tracks jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_deletions jsonb := '[]'::jsonb;
  v_latest_audit jsonb;
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select count(*)::integer, max(profile.client_id::text)::uuid
  into v_profile_count, v_client_id
  from public.client_profiles profile
  where profile.user_id = v_caller;

  if v_profile_count <> 1 or v_client_id is null then
    raise exception using errcode = '42501', message = 'An exact client portal profile is required';
  end if;

  select count(*)::integer into v_client_profile_count
  from public.client_profiles profile
  where profile.client_id = v_client_id;

  if v_client_profile_count <> 1 or not exists (
    select 1 from public.clients client where client.id = v_client_id
  ) then
    raise exception using errcode = '42501', message = 'The client portal mapping is ambiguous';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'track_id', track.id,
        'account_label', coalesce(account.display_furnisher, 'Account'),
        'masked_account', case
          when nullif(btrim(coalesce(account.account_last4, '')), '') is null then null
          else 'ending ' || right(btrim(account.account_last4), 4)
        end,
        'bureau_code', track.bureau_code,
        'channel', case when track.track_scope = 'direct' then 'direct_account' else 'credit_bureau' end,
        'case_step', track.current_round,
        'status', case track.status
          when 'active' then 'active'
          when 'review_required' then 'staff_review'
          when 'deleted' then 'removed'
          when 'resolved' then 'complete'
          else 'not_started'
        end,
        'updated_at', track.updated_at
      )
      order by track.updated_at desc, track.id
    ),
    '[]'::jsonb
  ) into v_tracks
  from public.ccc_account_tracks track
  join public.client_accounts account
    on account.id = track.client_account_id
   and account.client_id = track.client_id
   and account.user_id = track.user_id
  where track.client_id = v_client_id
    and (track.track_scope = 'cra' or track.status <> 'pending');

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'result_id', result.id,
        'track_id', result.track_id,
        'bureau_code', result.bureau_code,
        'result_date', result.result_date,
        'outcome_label', case result.achieved_target
          when 'account_deletion' then 'Account removed'
          when 'late_payment_removal' then 'Late payment removed'
          when 'factual_correction' then 'Information corrected'
          when 'consumer_statement_full_match' then 'Statement updated'
          else case result.response_status
            when 'verified' then 'Verified — team review continuing'
            when 'no_response' then 'No response recorded — staff review pending'
            when 'updated' then 'Update recorded — staff review continuing'
            else 'Result under staff review'
          end
        end,
        'recorded_at', result.created_at
      )
      order by result.created_at desc, result.id
    ),
    '[]'::jsonb
  ) into v_results
  from public.dispute_letter_results result
  join public.ccc_account_tracks track
    on track.id = result.track_id
   and track.client_id = result.client_id
  where result.client_id = v_client_id
    and result.batch_id is not null;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'deletion_id', deletion.id,
        'furnisher', deletion.furnisher,
        'account_type', deletion.account_type,
        'bureau_code', deletion.bureau_code,
        'confirmed_at', deletion.deletion_confirmed_at,
        'source_letter_id', deletion.source_letter_id
      )
      order by deletion.deletion_confirmed_at desc, deletion.id
    ),
    '[]'::jsonb
  ) into v_deletions
  from public.deletions deletion
  where deletion.client_id = v_client_id
    and deletion.deletion_confirmed_at is not null
    and deletion.bureau_code is not null;

  select jsonb_build_object(
    'saved_at', audit_row.saved_at,
    'scores', case
      when jsonb_typeof(audit_row.audit->'scores') = 'object' then audit_row.audit->'scores'
      when jsonb_typeof(audit_row.audit->'client'->'scores') = 'object' then audit_row.audit->'client'->'scores'
      else '{}'::jsonb
    end
  ) into v_latest_audit
  from public.audits audit_row
  where audit_row.client_id = v_client_id
  order by audit_row.saved_at desc, audit_row.id desc
  limit 1;

  return jsonb_build_object(
    'tracks', v_tracks,
    'results', v_results,
    'deletions', v_deletions,
    'latest_audit', v_latest_audit
  );
end
$$;

revoke all on function public.get_my_ccc_portal_projection() from public, anon;
grant execute on function public.get_my_ccc_portal_projection() to authenticated;

comment on function public.get_my_ccc_portal_projection() is
  'Exact-profile CCC client projection. Excludes flow/law selection, staff notes, source audits, classification snapshots, raw evidence, account UUIDs, and firm metrics.';

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
  if (
    select count(*)
    from public.client_profiles profile
    where profile.user_id = p_portal_user_id
      and profile.client_id = p_client_id
  ) <> 1 or (
    select count(*)
    from public.client_profiles profile
    where profile.client_id = p_client_id
  ) <> 1 then
    raise exception using errcode = '42501', message = 'Exact client portal mapping required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_portal_user_id::text, 0)
  );

  select
    count(*) filter (where event.created_at >= now() - interval '1 minute')::integer,
    count(*) filter (where event.created_at >= now() - interval '1 hour')::integer
  into v_minute_count, v_hour_count
  from public.portal_concierge_events event
  where event.portal_user_id = p_portal_user_id
    and event.created_at >= now() - interval '1 hour';

  if v_minute_count >= 8 then
    return jsonb_build_object('allowed', false, 'retry_after_seconds', 60);
  end if;
  if v_hour_count >= 40 then
    return jsonb_build_object('allowed', false, 'retry_after_seconds', 3600);
  end if;

  insert into public.portal_concierge_events (
    portal_user_id, client_id, event_type, handoff_reason
  ) values (
    p_portal_user_id,
    p_client_id,
    case when p_handoff_reason is null then 'request' else 'handoff' end,
    p_handoff_reason
  ) returning id into v_event_id;

  return jsonb_build_object(
    'allowed', true,
    'retry_after_seconds', 0,
    'handoff_recorded', p_handoff_reason is not null,
    'event_id', v_event_id
  );
end
$$;

revoke all on function public.ccc_begin_portal_concierge_request(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.ccc_begin_portal_concierge_request(uuid, uuid, text)
  to service_role;

comment on function public.ccc_begin_portal_concierge_request(uuid, uuid, text) is
  'Service-only atomic 8/minute, 40/hour concierge gate plus privacy-safe staff handoff record. Stores no message content.';

commit;
