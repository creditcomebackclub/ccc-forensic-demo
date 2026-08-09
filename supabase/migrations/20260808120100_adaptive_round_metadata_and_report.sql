-- Structured legacy metadata is safe to backfill independently of account
-- reconciliation. This keeps mailing targets and already-visible deadlines
-- stable before any historical rows are grouped into rounds.

update public.letters
set
  letter_kind = 'dispute',
  target_type = 'furnisher',
  target_bureau = null,
  legacy_reconciliation_status = case when client_account_id is null then 'pending' else 'linked' end
where lower(coalesce(phase, '')) like 'phase 1%';

update public.letters
set
  letter_kind = 'dispute',
  target_type = 'bureau',
  target_bureau = case
    when lower(phase) like '%equifax%' then 'equifax'
    when lower(phase) like '%experian%' then 'experian'
    when lower(phase) like '%transunion%' or lower(phase) like '%trans union%' then 'transunion'
    else null
  end,
  legacy_reconciliation_status = case when client_account_id is null then 'pending' else 'linked' end
where lower(coalesce(phase, '')) like 'phase 3%'
  and (
    lower(phase) like '%equifax%'
    or lower(phase) like '%experian%'
    or lower(phase) like '%transunion%'
    or lower(phase) like '%trans union%'
  );

update public.letters
set
  letter_kind = 'file_update',
  target_type = case
    when lower(coalesce(furnisher, '')) like '%equifax%'
      or lower(coalesce(furnisher, '')) like '%experian%'
      or lower(coalesce(furnisher, '')) like '%transunion%'
      or lower(coalesce(furnisher, '')) like '%trans union%'
    then 'bureau' else null end,
  target_bureau = case
    when lower(coalesce(furnisher, '')) like '%equifax%' then 'equifax'
    when lower(coalesce(furnisher, '')) like '%experian%' then 'experian'
    when lower(coalesce(furnisher, '')) like '%transunion%' or lower(coalesce(furnisher, '')) like '%trans union%' then 'transunion'
    else null
  end
where phase in ('Personal Info & Inquiries', 'Personal Info Cleanup', 'Inquiry Removal');

update public.letters
set letter_kind = 'legacy_escalation', legacy_reconciliation_status = 'pending'
where lower(coalesce(phase, '')) like 'round%escalation%';

-- Freeze the response dates users already saw: the historic application
-- displayed 45 days for CRA rows and 30 days for furnisher rows.
update public.letters
set response_due_at = delivered_at + case
  when target_type = 'bureau' then interval '45 days'
  else interval '30 days'
end
where delivered_at is not null
  and response_due_at is null
  and target_type is not null;

-- Existing bureau decisions become the structured per-letter review gate.
update public.letters
set
  round_review_status = coalesce(bureau_review_status, 'not_reviewed'),
  round_next_action = case bureau_next_action
    when 'close' then 'resolved'
    when 'bureau_follow_up' then 'next_round'
    when 'request_documents' then 'needs_documents'
    when 'escalation' then 'escalate'
    else null
  end,
  round_reviewed_at = bureau_reviewed_at
where letter_kind = 'dispute' and target_type = 'bureau';

create or replace view public.adaptive_round_backfill_report
with (security_invoker = true) as
select
  count(*)::integer as total_letters,
  count(*) filter (where letter_kind = 'dispute')::integer as dispute_letters,
  count(*) filter (where letter_kind = 'dispute' and client_account_id is not null)::integer as round_eligible_letters,
  count(*) filter (where letter_kind = 'dispute' and client_account_id is null)::integer as reconciliation_required_letters,
  count(*) filter (where letter_kind = 'file_update')::integer as file_update_letters,
  count(*) filter (where letter_kind is null)::integer as unclassified_letters,
  count(*) filter (where target_type = 'bureau' and target_bureau is null)::integer as bureau_recipient_errors,
  count(*) filter (where delivered_at is not null and target_type is not null and response_due_at is null)::integer as missing_frozen_deadlines
from public.letters;

grant select on public.adaptive_round_backfill_report to authenticated;
