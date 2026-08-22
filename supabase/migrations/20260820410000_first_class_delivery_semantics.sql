begin;

-- Plain USPS First-Class mail is intentionally untracked. Lob may still emit
-- processing/delivery-shaped events, but those events are mailpiece scans,
-- not proof that the recipient received the letter. Preserve the webhook
-- ledger while removing delivery-proof semantics from operational rows.
update public.letters
set
  delivered_at = null,
  response_due_at = null,
  response_window_extension_days = 0,
  tracking_status = case
    when tracking_status in ('Returned to Sender', 'Failed', 'Cancelled') then tracking_status
    when mailed_date is null then null
    when tracking_status is null or tracking_status = 'Mailed' then 'Mailed'
    else 'Mailpiece Scan Received'
  end
where mail_service = 'usps_first_class'
  and (
    delivered_at is not null
    or response_due_at is not null
    or coalesce(response_window_extension_days, 0) <> 0
    or tracking_status in ('Delivered', 'In Transit', 'Out for Delivery', 'Available for Pickup')
  );

alter table public.letter_account_coverage
  drop constraint if exists letter_account_coverage_mail_status_check;

alter table public.letter_account_coverage
  add constraint letter_account_coverage_mail_status_check check (mail_status in (
    'not_sent', 'queued', 'processing', 'mailed', 'in_transit',
    'delivered', 'returned', 'failed', 'cancelled'
  ));

update public.letter_account_coverage coverage
set
  mail_status = case
    when letter.tracking_status = 'Returned to Sender' then 'returned'
    when letter.tracking_status = 'Failed' then 'failed'
    when letter.tracking_status = 'Cancelled' then 'cancelled'
    when coverage.mail_status in ('returned', 'failed', 'cancelled') then coverage.mail_status
    when letter.mailed_date is not null then 'mailed'
    else 'not_sent'
  end,
  tracking_status = letter.tracking_status,
  delivered_at = null,
  updated_at = now()
from public.letters letter
where letter.id = coverage.letter_id
  and letter.user_id = coverage.user_id
  and letter.mail_service = 'usps_first_class';

comment on column public.letter_account_coverage.mail_status is
  'Mailpiece lifecycle only. For usps_first_class, mailed is the furthest nonterminal success state; scans never establish delivered.';

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
      case
        when l.mail_service = 'usps_first_class_certified_return_receipt' then l.delivered_at
        else null
      end as delivered_at,
      l.mail_service,
      l.expected_delivery_date,
      case
        when l.mail_service = 'usps_first_class'
          and l.expected_delivery_date is not null
          then 'expected_delivery'
        when l.mail_service = 'usps_first_class_certified_return_receipt'
          and l.delivered_at is not null
          then 'delivered'
        else null
      end as schedule_basis,
      coalesce(l.bureau_review_status, 'not_reviewed') as bureau_review_status,
      case
        when l.mail_service = 'usps_first_class'
          then l.expected_delivery_date + 30
        when l.mail_service = 'usps_first_class_certified_return_receipt'
          and l.delivered_at is not null
          and l.phase ilike 'Phase 3%' then l.delivered_at::date + 45
        when l.mail_service = 'usps_first_class_certified_return_receipt'
          and l.delivered_at is not null then l.delivered_at::date + 30
        else null
      end as deadline,
      coalesce(
        case
          when l.mail_service = 'usps_first_class'
            then l.expected_delivery_date + 30
          when l.mail_service = 'usps_first_class_certified_return_receipt'
            and l.delivered_at is not null
            and l.phase ilike 'Phase 3%' then l.delivered_at::date + 45
          when l.mail_service = 'usps_first_class_certified_return_receipt'
            and l.delivered_at is not null then l.delivered_at::date + 30
          else null
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
      and coalesce(l.tracking_status, '') not in ('Failed', 'Cancelled', 'Returned to Sender')
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
