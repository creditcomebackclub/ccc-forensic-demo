-- Retention Build 6 — paused client winback sweep. Idempotency guard on
-- (client, step) lives in this new column; a daily job will re-fire without
-- one. Entries are keyed 'step1@<pausedDateISO>' / 'step2@<pausedDateISO>'
-- (not just 'step1'/'step2') so a client who un-pauses and later pauses
-- again — a new status_changed_at — starts the winback sequence fresh
-- instead of being silently skipped by a marker from a prior episode.
alter table public.clients add column if not exists winback_notifications_sent jsonb not null default '[]'::jsonb;

-- Extends protect_client_billing_columns() again (20260722_billing_schema_and_rls.sql,
-- 20260723_lifecycle_status.sql): a client must not be able to reset their
-- own winback markers to make the sweep re-fire, or fake completion to
-- suppress it.
create or replace function public.protect_client_billing_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    null;
  elsif exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
  ) then
    null;
  else
    new.billing_status             := old.billing_status;
    new.billing_type               := old.billing_type;
    new.billing_start_date         := old.billing_start_date;
    new.billing_tier               := old.billing_tier;
    new.ledger                     := old.ledger;
    new.referred_by                := old.referred_by;
    new.referral_fee               := old.referral_fee;
    new.commission_paid            := old.commission_paid;
    new.commission_paid_at         := old.commission_paid_at;
    new.is_vip                     := old.is_vip;
    new.exit_reason                := old.exit_reason;
    new.winback_notifications_sent := old.winback_notifications_sent;
  end if;

  if new.billing_status is distinct from old.billing_status then
    new.status_changed_at := now();
  else
    new.status_changed_at := old.status_changed_at;
  end if;

  return new;
end;
$$;
