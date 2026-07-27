-- Scale-safe CRM and operating-queue data.
--
-- The previous summary RPC built complete audit/letter JSON aggregates for
-- every matching client and only then applied its cursor LIMIT. That still
-- did the expensive part of the work for the entire CRM on every page load.
-- This version computes only cheap activity timestamps for all eligible
-- clients, selects one cursor page, then builds the detail JSON for that
-- page alone. Full audit JSON / letter HTML remain selected-client data.
--
-- SECURITY INVOKER is intentional: callers keep the existing RLS boundary.
-- Do not convert either function in this file to SECURITY DEFINER without a
-- separate authorization review.

create or replace function public.list_client_summaries(
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
          -- List views need only the newest audit's small operational facts:
          -- count targeted accounts plus address-confirmation items. The full
          -- report stays on the selected-client detail path.
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

-- The list_client_summaries activity CTE does timestamp lookups for every
-- eligible client. These indexes make those lookups index-only-ish and keep
-- the legacy bridge bounded to rows that have not yet been backfilled.
create index if not exists audits_user_client_saved_idx
  on public.audits (user_id, client_id, saved_at desc);
create index if not exists letters_user_client_saved_idx
  on public.letters (user_id, client_id, saved_at desc);
create index if not exists audits_legacy_user_name_saved_idx
  on public.audits (user_id, client_name, saved_at desc)
  where client_id is null;
create index if not exists letters_legacy_user_name_saved_idx
  on public.letters (user_id, client_name, saved_at desc)
  where client_id is null;

-- Letter Tracker is an operational queue, not a CRM export. Return only
-- unresolved mailed items, ordered by the real delivery-based deadline and
-- cursor-paginated so a busy firm never loads every historical letter.
create or replace function public.list_in_flight_letters(
  p_limit integer default 201,
  p_cursor_deadline date default null,
  p_cursor_id text default null
)
returns table (
  letter_id text,
  client_id uuid,
  client_name text,
  furnisher text,
  account_id text,
  client_account_id uuid,
  account_last4 text,
  phase text,
  mailed_date text,
  delivered_at timestamptz,
  bureau_review_status text,
  deadline date,
  sort_deadline date,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with matching as (
    select
      l.id as letter_id,
      c.id as client_id,
      c.name as client_name,
      l.furnisher,
      l.account_id,
      l.client_account_id,
      account.account_last4,
      l.phase,
      l.mailed_date,
      l.delivered_at,
      coalesce(l.bureau_review_status, 'not_reviewed') as bureau_review_status,
      case
        when l.delivered_at is null then null
        when l.phase ilike 'Phase 3%' then l.delivered_at::date + 45
        else l.delivered_at::date + 30
      end as deadline,
      coalesce(
        case
          when l.phase ilike 'Phase 3%' then l.delivered_at::date + 45
          else l.delivered_at::date + 30
        end,
        date '9999-12-31'
      ) as sort_deadline
    from public.letters l
    join public.clients c
      on c.user_id = l.user_id
      and (
        l.client_id = c.id
        or (
          l.client_id is null
          and l.client_name = c.name
          and not exists (
            select 1
            from public.clients same_named_client
            where same_named_client.user_id = c.user_id
              and same_named_client.name = c.name
              and same_named_client.id <> c.id
          )
        )
      )
    left join public.client_accounts account on account.id = l.client_account_id
    where l.mailed_date is not null
      and l.response_outcome is null
      and (
        l.phase not ilike 'Phase 3%'
        or coalesce(l.bureau_review_status, 'not_reviewed') = 'not_reviewed'
      )
  ), ranked as (
    select matching.*, count(*) over () as total_count
    from matching
  )
  select
    letter_id,
    client_id,
    client_name,
    furnisher,
    account_id,
    client_account_id,
    account_last4,
    phase,
    mailed_date,
    delivered_at,
    bureau_review_status,
    deadline,
    sort_deadline,
    total_count
  from ranked
  where p_cursor_deadline is null
    or sort_deadline > p_cursor_deadline
    or (sort_deadline = p_cursor_deadline and letter_id > p_cursor_id)
  order by sort_deadline asc, letter_id asc
  limit least(greatest(coalesce(p_limit, 201), 1), 501);
$$;

revoke all on function public.list_in_flight_letters(integer, date, text) from public;
grant execute on function public.list_in_flight_letters(integer, date, text) to authenticated;

create index if not exists letters_in_flight_queue_idx
  on public.letters (id)
  include (user_id, client_id, client_name, furnisher, account_id, client_account_id, phase, mailed_date, delivered_at, bureau_review_status)
  where mailed_date is not null and response_outcome is null;
