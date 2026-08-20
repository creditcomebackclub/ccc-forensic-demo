-- Group only letters with a stable client_account_id. Rows reported as
-- reconciliation-required remain structured but intentionally unnumbered.

create temporary table adaptive_round_letter_map on commit drop as
with candidates as (
  select
    l.user_id,
    coalesce(l.client_id, account.client_id) as client_id,
    l.client_account_id,
    l.id as letter_id,
    l.target_type,
    l.saved_at,
    l.mailed_date,
    l.round_review_status,
    l.source_phase3_letter_id,
    case
      when l.source_phase3_letter_id is not null then 'followup:' || l.id
      else to_char(date_trunc('minute', coalesce(l.saved_at, now())), 'YYYYMMDDHH24MI') || ':' || l.target_type
    end as batch_key
  from public.letters l
  join public.client_accounts account on account.id = l.client_account_id and account.user_id = l.user_id
  where l.letter_kind = 'dispute'
    and l.client_account_id is not null
    and l.target_type in ('furnisher', 'bureau')
), grouped as (
  select
    user_id,
    client_id,
    client_account_id,
    target_type,
    batch_key,
    min(saved_at) as opened_at,
    bool_and(mailed_date is not null) as all_mailed,
    bool_and(coalesce(round_review_status, 'not_reviewed') <> 'not_reviewed') as all_reviewed,
    bool_or(round_review_status = 'escalated') as any_escalated,
    array_agg(letter_id order by letter_id) as letter_ids
  from candidates
  group by user_id, client_id, client_account_id, target_type, batch_key
), numbered as (
  select
    g.*,
    dense_rank() over (
      partition by user_id, client_id, client_account_id
      order by opened_at, batch_key
    )::integer as round_number,
    count(*) over (partition by user_id, client_id, client_account_id)::integer as round_count
  from grouped g
), inserted as (
  insert into public.dispute_rounds (
    id, user_id, client_id, client_account_id, round_number, target_type,
    status, final_disposition, opened_at, closed_at, created_at, updated_at
  )
  select
    gen_random_uuid(), n.user_id, n.client_id, n.client_account_id,
    n.round_number, n.target_type,
    case
      when n.round_number < n.round_count then 'closed'
      when n.all_mailed and n.all_reviewed then 'closed'
      else 'open'
    end,
    case
      when n.round_number < n.round_count then 'next_round'
      when n.all_mailed and n.all_reviewed and n.any_escalated then 'escalate'
      when n.all_mailed and n.all_reviewed then 'resolved'
      else null
    end,
    coalesce(n.opened_at, now()),
    case
      when n.round_number < n.round_count or (n.all_mailed and n.all_reviewed) then coalesce(n.opened_at, now())
      else null
    end,
    coalesce(n.opened_at, now()), now()
  from numbered n
  on conflict (user_id, client_account_id, round_number) do update set
    target_type = excluded.target_type,
    updated_at = now()
  returning id, user_id, client_account_id, round_number
)
select
  i.id as round_id,
  i.user_id,
  i.client_account_id,
  i.round_number,
  unnest(n.letter_ids) as letter_id
from inserted i
join numbered n
  on n.user_id = i.user_id
 and n.client_account_id = i.client_account_id
 and n.round_number = i.round_number;

update public.letters l
set round_id = m.round_id,
    round_number = m.round_number,
    legacy_reconciliation_status = 'linked',
    legacy_reconciled_at = coalesce(l.legacy_reconciled_at, now())
from adaptive_round_letter_map m
where l.user_id = m.user_id and l.id = m.letter_id;

-- Preserve exact bureau-follow-up provenance in the generalized source table.
insert into public.letter_source_links (
  user_id, letter_id, source_letter_id, response_evidence_id,
  source_order, created_by, created_at
)
select
  l.user_id, l.id, l.source_phase3_letter_id,
  l.source_bureau_response_evidence_id, 0, l.created_by, coalesce(l.saved_at, now())
from public.letters l
where l.round_id is not null
  and l.source_phase3_letter_id is not null
  and l.source_bureau_response_evidence_id is not null
on conflict (user_id, letter_id, source_letter_id, response_evidence_id) do nothing;

alter table public.letters validate constraint letters_target_bureau_pairing_check;
alter table public.letters validate constraint letters_round_pairing_check;
