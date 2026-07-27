-- Retention Build 3 — lifecycle status. Extends the existing billing_status
-- column (already 'Active' | 'Paused' | 'Inactive', set from
-- ClientBillingPanel.jsx and daily-cron.cjs's auto-pause) with a fourth value
-- 'Graduated', an exit_reason required on every non-Active value, and a
-- status_changed_at timestamp the Build 6 winback sweep depends on.
--
-- Casing note: the app already uses Title Case ('Active'/'Paused'/'Inactive')
-- throughout BillingDashboardPage.jsx, ClientBillingPanel.jsx and
-- daily-cron.cjs — 'Graduated' matches that existing convention rather than
-- the spec's lowercase table, to avoid a casing mismatch against every
-- existing comparison.

alter table public.clients add column if not exists exit_reason text;
alter table public.clients add column if not exists status_changed_at timestamptz;

-- Existing non-Active rows predate exit_reason; backfill 'other' as an
-- honest placeholder (we don't actually know why) so the NOT NULL-ish check
-- constraint below doesn't fail validation against real data.
update public.clients
  set exit_reason = 'other'
  where billing_status in ('Paused', 'Inactive') and exit_reason is null;

-- Give already-Paused/Inactive clients a starting clock rather than leaving
-- status_changed_at null forever — Build 6's sweep reads days-since this
-- timestamp, so it needs a value to compare against.
update public.clients
  set status_changed_at = now()
  where billing_status is not null and status_changed_at is null;

alter table public.clients drop constraint if exists clients_exit_reason_enum;
alter table public.clients add constraint clients_exit_reason_enum
  check (exit_reason is null or exit_reason in (
    'graduated', 'non_payment', 'dissatisfied', 'went_dark', 'client_paused', 'price', 'other'
  ));

alter table public.clients drop constraint if exists clients_billing_status_enum;
alter table public.clients add constraint clients_billing_status_enum
  check (billing_status is null or billing_status in ('Active', 'Paused', 'Graduated', 'Inactive'));

alter table public.clients drop constraint if exists clients_exit_reason_required;
alter table public.clients add constraint clients_exit_reason_required
  check (billing_status is null or billing_status = 'Active' or exit_reason is not null);

-- Extends protect_client_billing_columns() (20260722_billing_schema_and_rls.sql):
-- adds exit_reason to the columns reverted for a client acting on their own
-- row, and auto-stamps status_changed_at whenever billing_status actually
-- changes — regardless of which code path changes it (admin UI, daily-cron
-- auto-pause, a future winback job) — so the timestamp is a guaranteed
-- invariant, not something every call site has to remember to set. Runs
-- after the client-tamper reversion below, so a blocked client write never
-- bumps this stamp.
create or replace function public.protect_client_billing_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    -- Service role (cron / Netlify background functions) — allow.
    null;
  elsif exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
  ) then
    -- Staff — allow.
    null;
  else
    -- A client acting on their own row — preserve every protected column.
    new.billing_status     := old.billing_status;
    new.billing_type       := old.billing_type;
    new.billing_start_date := old.billing_start_date;
    new.billing_tier       := old.billing_tier;
    new.ledger             := old.ledger;
    new.referred_by        := old.referred_by;
    new.referral_fee       := old.referral_fee;
    new.commission_paid    := old.commission_paid;
    new.commission_paid_at := old.commission_paid_at;
    new.is_vip             := old.is_vip;
    new.exit_reason        := old.exit_reason;
  end if;

  if new.billing_status is distinct from old.billing_status then
    new.status_changed_at := now();
  else
    new.status_changed_at := old.status_changed_at;
  end if;

  return new;
end;
$$;
