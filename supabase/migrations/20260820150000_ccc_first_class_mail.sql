begin;

alter table public.letters
  add column if not exists mail_service text,
  add column if not exists expected_delivery_date date;

alter table public.letters
  drop constraint if exists letters_mail_service_check;

alter table public.letters
  add constraint letters_mail_service_check
  check (
    mail_service is null
    or mail_service in ('usps_first_class', 'usps_first_class_certified_return_receipt')
  );

comment on column public.letters.mail_service is
  'Explicit Lob/USPS service used for this immutable mailpiece. Null preserves historical rows whose service was not recorded.';
comment on column public.letters.expected_delivery_date is
  'Lob estimated delivery date. For untracked CCC First Class mail it supports an operational review target, not proof of delivery.';

drop function if exists public.list_in_flight_letters(integer, date, text);

create function public.list_in_flight_letters(
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
  mail_service text,
  expected_delivery_date date,
  schedule_basis text,
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
      l.mail_service,
      l.expected_delivery_date,
      case
        when l.delivered_at is not null then 'delivered'
        when l.phase ilike 'CCC Dispute —%'
          and l.mail_service = 'usps_first_class'
          and l.expected_delivery_date is not null then 'expected_delivery'
        else null
      end as schedule_basis,
      coalesce(l.bureau_review_status, 'not_reviewed') as bureau_review_status,
      case
        when l.phase ilike 'CCC Dispute —%'
          and l.mail_service = 'usps_first_class'
          then coalesce(l.delivered_at::date, l.expected_delivery_date) + 30
        when l.delivered_at is null then null
        when l.phase ilike 'Phase 3%' then l.delivered_at::date + 45
        else l.delivered_at::date + 30
      end as deadline,
      coalesce(
        case
          when l.phase ilike 'CCC Dispute —%'
            and l.mail_service = 'usps_first_class'
            then coalesce(l.delivered_at::date, l.expected_delivery_date) + 30
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
    mail_service,
    expected_delivery_date,
    schedule_basis,
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

commit;
