-- Public intake hardening is additive and retry-safe. Browser callers still
-- reach a Netlify function; only the service role can consume either RPC.
-- Existing lead rows and referral attribution are preserved.

revoke all on table public.public_intake_attempts from public, anon, authenticated;
grant all on table public.public_intake_attempts to service_role;

create index if not exists clients_open_lead_owner_email_idx
  on public.clients (user_id, (lower(btrim(email))), lead_created_at desc)
  where status = 'lead' and email is not null;

create or replace function public.consume_public_intake_rate_limit(
  p_rate_key text,
  p_window_seconds integer,
  p_max_attempts integer,
  p_retention_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  if p_rate_key is null
     or p_rate_key !~ '^intake:[0-9a-f]{64}$'
     or p_window_seconds not between 60 and 3600
     or p_max_attempts not between 1 and 100
     or p_retention_seconds not between p_window_seconds and 604800 then
    raise exception 'Invalid rate limit request' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public-intake-rate:' || p_rate_key, 0)
  );

  -- Retention work is bounded per request so a stale table cannot turn one
  -- public submission into an unbounded delete. Repeated requests converge.
  with expired as (
    select attempt.id
    from public.public_intake_attempts attempt
    where attempt.created_at < pg_catalog.now() - pg_catalog.make_interval(secs => p_retention_seconds)
    order by attempt.created_at
    limit 500
  )
  delete from public.public_intake_attempts attempt
  using expired
  where attempt.id = expired.id;

  insert into public.public_intake_attempts (ip) values (p_rate_key);

  select count(*)::integer into v_count
  from public.public_intake_attempts attempt
  where attempt.ip = p_rate_key
    and attempt.created_at >= pg_catalog.now() - pg_catalog.make_interval(secs => p_window_seconds);

  return pg_catalog.jsonb_build_object(
    'allowed', v_count <= p_max_attempts,
    'attempts', v_count
  );
end;
$$;

revoke all on function public.consume_public_intake_rate_limit(text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_public_intake_rate_limit(text, integer, integer, integer)
  to service_role;

create or replace function public.create_or_reuse_public_intake_lead(
  p_owner_user_id uuid,
  p_name text,
  p_email text,
  p_phone text,
  p_tier text,
  p_ref text,
  p_intent text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_tier text := nullif(btrim(coalesce(p_tier, '')), '');
  v_ref text := lower(nullif(btrim(coalesce(p_ref, '')), ''));
  v_intent text := lower(btrim(coalesce(p_intent, '')));
  v_affiliate public.affiliates%rowtype;
  v_lead public.clients%rowtype;
  v_affiliate_matches integer := 0;
  v_affiliate_label text;
  v_source text;
  v_note text;
  v_created boolean := false;
  v_attribution_added boolean := false;
begin
  if p_owner_user_id is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = p_owner_user_id and profile.role = 'admin'
  ) then
    raise exception 'Configured owner is not an administrator' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 120
     or length(v_email) not between 3 and 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or (v_phone is not null and length(v_phone) > 40)
     or (v_tier is not null and v_tier not in ('Standard', 'VIP', 'Paid In Full'))
     or v_intent not in ('consultation', 'guide_download')
     or (v_ref is not null and v_ref !~ '^[0-9a-f]{6,36}$') then
    raise exception 'Invalid intake fields' using errcode = '22023';
  end if;

  -- Serialize every writer using the supported RPC for this owner/email pair.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public-intake-lead:' || p_owner_user_id::text || ':' || v_email, 0)
  );

  if v_ref is not null then
    select count(*)::integer into v_affiliate_matches
    from public.affiliates affiliate
    where lower(affiliate.id::text) like v_ref || '%'
      and affiliate.owner_user_id = p_owner_user_id
      and affiliate.program_status in ('legacy_active', 'active');

    if v_affiliate_matches = 1 then
      select affiliate.* into v_affiliate
      from public.affiliates affiliate
      where lower(affiliate.id::text) like v_ref || '%'
        and affiliate.owner_user_id = p_owner_user_id
        and affiliate.program_status in ('legacy_active', 'active')
      limit 1;
      v_affiliate_label := coalesce(nullif(btrim(v_affiliate.company), ''), v_affiliate.name);
    end if;
  end if;

  v_source := case
    when v_affiliate.id is not null then 'Affiliate: ' || v_affiliate_label
    when v_intent = 'guide_download' then 'Free Guide'
    else 'Website Intake'
  end;
  v_note := case
    when v_intent = 'guide_download' then 'Requested the free credit report accuracy guide'
    when v_tier is not null then 'Selected Tier: ' || v_tier
    else null
  end;

  select client.* into v_lead
  from public.clients client
  where client.user_id = p_owner_user_id
    and client.status = 'lead'
    and lower(btrim(client.email)) = v_email
  order by coalesce(client.lead_created_at, client.created_at) desc, client.id
  limit 1
  for update;

  if not found then
    insert into public.clients (
      user_id, name, email, lead_phone, status, lead_source, lead_notes,
      consultation_status, tags, lead_created_at, referred_by, referral_fee
    ) values (
      p_owner_user_id,
      v_name,
      v_email,
      v_phone,
      'lead',
      v_source,
      v_note,
      case when v_intent = 'consultation' then 'requested' else null end,
      case when v_intent = 'guide_download' then array['source:freeguide']::text[] else null end,
      pg_catalog.now(),
      v_affiliate.id,
      null
    )
    returning * into v_lead;
    v_created := true;
    v_attribution_added := v_affiliate.id is not null;
  else
    -- A retry may refresh missing contact/intent data, but it may never move
    -- an existing lead into (or between) an affiliate's book of business.
    v_attribution_added := false;
    v_affiliate := null;

    update public.clients client
    set name = case
          when nullif(btrim(client.name), '') is null then v_name
          else client.name
        end,
        email = v_email,
        lead_phone = coalesce(nullif(btrim(client.lead_phone), ''), v_phone),
        lead_notes = case
          when v_note is null then client.lead_notes
          when nullif(btrim(client.lead_notes), '') is null
            or client.lead_notes = 'Requested the free credit report accuracy guide'
            or client.lead_notes ~ '^Selected Tier: (Standard|VIP|Paid In Full)$'
            then v_note
          else client.lead_notes
        end,
        consultation_status = case
          when v_intent = 'consultation' and client.consultation_status is null then 'requested'
          else client.consultation_status
        end,
        tags = case
          when v_intent = 'guide_download'
               and not ('source:freeguide' = any(coalesce(client.tags, '{}'::text[])))
            then coalesce(client.tags, '{}'::text[]) || array['source:freeguide']::text[]
          else client.tags
        end
    where client.id = v_lead.id
    returning * into v_lead;
  end if;

  return pg_catalog.jsonb_build_object(
    'lead', pg_catalog.jsonb_build_object(
      'id', v_lead.id,
      'name', v_lead.name,
      'email', v_lead.email,
      'lead_phone', v_lead.lead_phone,
      'referred_by', v_lead.referred_by
    ),
    'created', v_created,
    'attribution_added', v_attribution_added,
    'affiliate', case
      when v_affiliate.id is null then null
      else pg_catalog.jsonb_build_object(
        'id', v_affiliate.id,
        'name', v_affiliate.name,
        'company', v_affiliate.company
      )
    end
  );
end;
$$;

revoke all on function public.create_or_reuse_public_intake_lead(
  uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_or_reuse_public_intake_lead(
  uuid, text, text, text, text, text, text
) to service_role;

comment on function public.create_or_reuse_public_intake_lead(
  uuid, text, text, text, text, text, text
) is
  'Service-role-only atomic public intake writer. Reuses the exact owner/email open lead, preserves prior referral attribution, and records tier as lead intent rather than billing_tier.';

-- Rollback: revoke both service-role grants and drop the two functions. The
-- lookup index may be dropped independently. No client or attribution data
-- needs to be rewritten or deleted.
