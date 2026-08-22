-- Capture the authored Consumer Statement from the exact durable HTML that
-- the server hands to Lob. These nullable, additive fields preserve mixed-
-- version rollout: historical submissions remain valid without a backfill.

alter table public.mail_submissions
  add column if not exists consumer_statement_text text,
  add column if not exists consumer_statement_sha256 text,
  add column if not exists consumer_statement_captured_at timestamptz;

alter table public.mail_submissions
  drop constraint if exists mail_submissions_consumer_statement_snapshot_complete,
  add constraint mail_submissions_consumer_statement_snapshot_complete
  check (
    (
      consumer_statement_text is null
      and consumer_statement_sha256 is null
      and consumer_statement_captured_at is null
    )
    or (
      consumer_statement_text is null
      and consumer_statement_sha256 is null
      and consumer_statement_captured_at is not null
    )
    or (
      consumer_statement_text is not null
      and consumer_statement_sha256 is not null
      and length(btrim(consumer_statement_text)) between 1 and 32768
      and consumer_statement_sha256 ~ '^[0-9a-f]{64}$'
      and consumer_statement_captured_at is not null
    )
  );

comment on column public.mail_submissions.consumer_statement_text is
  'Canonical visible body of the authored Consumer Statement extracted server-side from the exact HTML submitted to Lob; excludes the fixed heading.';
comment on column public.mail_submissions.consumer_statement_sha256 is
  'SHA-256 of consumer_statement_text after deterministic visible-text normalization.';
comment on column public.mail_submissions.consumer_statement_captured_at is
  'Server timestamp when the CCC mailpiece Consumer Statement contract was first claimed for this idempotent submission; direct letters retain null text/hash.';

-- Once a CCC letter has physical-mail evidence, its printable content and
-- every template/account/exhibit snapshot must remain the record of what was
-- sent. The condition also considers NEW mail evidence, so an initial Lob
-- reconciliation may set mailed_date/lob_id only when the snapshots in that
-- same UPDATE are unchanged.
create or replace function public.prevent_mailed_ccc_letter_snapshot_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    coalesce(old.phase, '') like 'CCC Dispute —%'
    or coalesce(new.phase, '') like 'CCC Dispute —%'
  )
  and (
    old.mailed_date is not null
    or old.lob_id is not null
    or new.mailed_date is not null
    or new.lob_id is not null
  )
  and (
    old.phase,
    old.client_id,
    old.client_name,
    old.client_account_id,
    old.account_id,
    old.furnisher,
    old.target_type,
    old.target_bureau,
    old.covered_furnishers,
    old.html,
    old.dispute_template_id,
    old.dispute_template_name,
    old.dispute_template_version_label,
    old.dispute_template_family_key,
    old.dispute_flow_code,
    old.dispute_round_number,
    old.dispute_bureau_code,
    old.dispute_template_snapshot,
    old.dispute_editable_sections,
    old.dispute_account_snapshot,
    old.dispute_screenshot_manifest
  ) is distinct from (
    new.phase,
    new.client_id,
    new.client_name,
    new.client_account_id,
    new.account_id,
    new.furnisher,
    new.target_type,
    new.target_bureau,
    new.covered_furnishers,
    new.html,
    new.dispute_template_id,
    new.dispute_template_name,
    new.dispute_template_version_label,
    new.dispute_template_family_key,
    new.dispute_flow_code,
    new.dispute_round_number,
    new.dispute_bureau_code,
    new.dispute_template_snapshot,
    new.dispute_editable_sections,
    new.dispute_account_snapshot,
    new.dispute_screenshot_manifest
  ) then
    raise exception 'A mailed CCC letter and its reviewed snapshots are immutable. Create a new letter revision.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_mailed_ccc_letter_snapshots on public.letters;
create trigger protect_mailed_ccc_letter_snapshots
before update on public.letters
for each row execute function public.prevent_mailed_ccc_letter_snapshot_rewrite();

-- Rollback path: deploy the prior function/UI while leaving the nullable
-- evidence columns and immutable sent-letter protection in place. Dropping
-- either would discard or weaken legal-mail evidence and is intentionally not
-- automated.
