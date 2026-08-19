-- Expose clients.referred_by on the Leads/CRM summary payload so the Lead
-- Kanban card can show and edit the affiliate that referred the lead.
--
-- Before this migration the summary RPC omitted referred_by entirely, so
-- a lead brought in via an affiliate's /join?ref=<code> link had no
-- affiliate signal on the Lead card — it only appeared on the affiliate's
-- profile page, which filters clients by referred_by directly.
--
-- The RETURNS TABLE signature changes, so we drop-and-recreate rather than
-- CREATE OR REPLACE.

drop function if exists public.list_client_summaries(integer, timestamptz, uuid, text);

create function public.list_client_summaries(
  p_limit integer default 51,
  p_cursor_activity timestamptz default null,
  p_cursor_id uuid default null,
  p_search text default null
)
returns table (
  id uuid,
  user_id uuid,
  name text,
  is_vip boolean,
  email text,
  address text,
  lpoa_signed boolean,
  status text,
  lead_source text,
  lead_phone text,
  lead_notes text,
  lead_created_at timestamptz,
  lead_viewed_at timestamptz,
  tags jsonb,
  billing_status text,
  billing_type text,
  billing_start_date date,
  billing_tier text,
  exit_reason text,
  status_changed_at timestamptz,
  referred_by uuid,
  portal_onboarded boolean,
  agreement_signed boolean,
  last_activity timestamptz,
  audits jsonb,
  letters jsonb,
  audit_count bigint,
  letter_count bigint,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with candidates as (
    select
      c.*,
      not exists (
        select 1
        from public.clients same_named_client
        where same_named_client.user_id = c.user_id
          and same_named_client.name = c.name
          and same_named_client.id <> c.id
      ) as legacy_name_safe
    from public.clients c
    where nullif(btrim(p_search), '') is null
      or c.name ilike '%' || btrim(p_search) || '%'
      or coalesce(c.email, '') ilike '%' || btrim(p_search) || '%'
      or coalesce(c.lead_source, '') ilike '%' || btrim(p_search) || '%'
      or exists (
        select 1
        from public.letters search_letter
        where search_letter.user_id = c.user_id
          and (
            search_letter.client_id = c.id
            or (
              search_letter.client_id is null
              and search_letter.client_name = c.name
              and not exists (
                select 1
                from public.clients same_named_client
                where same_named_client.user_id = c.user_id
                  and same_named_client.name = c.name
                  and same_named_client.id <> c.id
              )
            )
          )
          and coalesce(search_letter.furnisher, '') ilike '%' || btrim(p_search) || '%'
      )
  ), client_activity as (
    select
      c.*,
      greatest(
        c.created_at,
        coalesce(audit_activity.latest_saved_at, c.created_at),
        coalesce(letter_activity.latest_saved_at, c.created_at),
        coalesce(c.lead_created_at, c.created_at),
        coalesce(c.status_changed_at, c.created_at)
      ) as last_activity
    from candidates c
    left join lateral (
      select max(a.saved_at) as latest_saved_at
      from public.audits a
      where a.user_id = c.user_id
        and (
          a.client_id = c.id
          or (c.legacy_name_safe and a.client_id is null and a.client_name = c.name)
        )
    ) audit_activity on true
    left join lateral (
      select max(l.saved_at) as latest_saved_at
      from public.letters l
      where l.user_id = c.user_id
        and (
          l.client_id = c.id
          or (c.legacy_name_safe and l.client_id is null and l.client_name = c.name)
        )
    ) letter_activity on true
  ), ranked as (
    select client_activity.*, count(*) over () as total_count
    from client_activity
  ), paged as (
    select *
    from ranked
    where p_cursor_activity is null
      or last_activity < p_cursor_activity
      or (last_activity = p_cursor_activity and id < p_cursor_id)
    order by last_activity desc nulls last, id desc
    limit least(greatest(coalesce(p_limit, 51), 1), 101)
  )
  select
    p.id,
    p.user_id,
    p.name,
    p.is_vip,
    p.email,
    p.address,
    p.lpoa_signed,
    p.status,
    p.lead_source,
    p.lead_phone,
    p.lead_notes,
    p.lead_created_at,
    p.lead_viewed_at,
    to_jsonb(p.tags) as tags,
    p.billing_status,
    p.billing_type,
    p.billing_start_date,
    p.billing_tier,
    p.exit_reason,
    p.status_changed_at,
    p.referred_by,
    coalesce(portal.portal_onboarded, false) as portal_onboarded,
    coalesce(portal.agreement_signed, false) as agreement_signed,
    p.last_activity,
    coalesce(audit_rollup.audits, '[]'::jsonb) as audits,
    coalesce(letter_rollup.letters, '[]'::jsonb) as letters,
    coalesce(audit_rollup.audit_count, 0)::bigint as audit_count,
    coalesce(letter_rollup.letter_count, 0)::bigint as letter_count,
    p.total_count
  from paged p
  left join lateral (
    select
      count(*) as audit_count,
      jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'client_id', a.client_id,
          'client_name', a.client_name,
          'client_address', a.client_address,
          'report_date', a.report_date,
          'saved_at', a.saved_at,
          'created_by', a.created_by,
          'auditor_name', coalesce(profile.full_name, profile.email),
          'audit', case when a.row_number = 1 then jsonb_build_object(
            'accountsTargeted', case
              when coalesce(a.audit ->> 'accountsTargeted', '') ~ '^[0-9]+$'
                then (a.audit ->> 'accountsTargeted')::integer
              else jsonb_array_length(coalesce(a.audit -> 'accounts', '[]'::jsonb))
            end,
            'totalViolations', case
              when coalesce(a.audit ->> 'totalViolations', '') ~ '^[0-9]+$'
                then (a.audit ->> 'totalViolations')::integer
              else 0
            end,
            'accounts', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', account ->> 'id',
                'furnisher', account ->> 'furnisher',
                'addressStatus', account ->> 'addressStatus'
              ))
              from jsonb_array_elements(coalesce(a.audit -> 'accounts', '[]'::jsonb)) account
              where account ->> 'addressStatus' in ('PENDING', 'CONFIRM')
            ), '[]'::jsonb)
          ) else null end
        )
        order by a.saved_at desc nulls last, a.id desc
      ) as audits
    from (
      select
        a.*,
        row_number() over (order by a.saved_at desc nulls last, a.id desc) as row_number
      from public.audits a
      where a.user_id = p.user_id
        and (
          a.client_id = p.id
          or (p.legacy_name_safe and a.client_id is null and a.client_name = p.name)
        )
    ) a
    left join public.profiles profile on profile.id = a.created_by
  ) audit_rollup on true
  left join lateral (
    select
      count(*) as letter_count,
      jsonb_agg(
        jsonb_build_object(
          'id', l.id,
          'client_id', l.client_id,
          'client_name', l.client_name,
          'furnisher', l.furnisher,
          'account_id', l.account_id,
          'phase', l.phase,
          'type', l.type,
          'saved_at', l.saved_at,
          'created_by', l.created_by,
          'date', l.date,
          'covered_furnishers', l.covered_furnishers,
          'mailed_date', l.mailed_date,
          'response_outcome', l.response_outcome,
          'response_date', l.response_date,
          'bureau_review_status', l.bureau_review_status,
          'tracking_status', l.tracking_status,
          'delivered_at', l.delivered_at,
          'has_response_file', l.response_file_url is not null,
          'auditor_name', coalesce(profile.full_name, profile.email)
        )
        order by l.saved_at desc nulls last, l.id desc
      ) as letters
    from public.letters l
    left join public.profiles profile on profile.id = l.created_by
    where l.user_id = p.user_id
      and (
        l.client_id = p.id
        or (p.legacy_name_safe and l.client_id is null and l.client_name = p.name)
      )
  ) letter_rollup on true
  left join lateral (
    select
      bool_or(coalesce(cp.onboarding_complete, false)) as portal_onboarded,
      bool_or(cp.agreement_signed_at is not null) as agreement_signed
    from public.client_profiles cp
    where cp.client_id = p.id
  ) portal on true
  order by p.last_activity desc nulls last, p.id desc;
$$;

revoke all on function public.list_client_summaries(integer, timestamptz, uuid, text) from public;
grant execute on function public.list_client_summaries(integer, timestamptz, uuid, text) to authenticated;
