-- Billing schema + protection for the clients table.
--
-- Context: the billing/affiliate feature (built 2026-07-21..07-22) added
-- columns to public.clients directly through the Supabase Studio dashboard,
-- so the schema was never captured in git. This migration formalizes those
-- columns (idempotent ADD COLUMN IF NOT EXISTS — safe to run against the
-- live DB that already has them) and closes a real privilege hole.
--
-- The hole: 20260714_security_audit_rls.sql grants clients UPDATE on their
-- OWN clients row (policy "client_update_own_meta") so they can set
-- lpoa_signed from the portal. Postgres RLS is row-level, not column-level,
-- so that same policy lets a client PATCH ledger, billing_tier,
-- billing_status, referral_fee, etc. via PostgREST — e.g. zero out their
-- balance or set billing_tier='Paid In Full'. Column-level GRANTs can't fix
-- this cleanly because staff edit these columns through their own user JWT
-- (the "authenticated" role), not the service role, so a GRANT restriction
-- would also block admins.
--
-- Fix: a BEFORE UPDATE trigger. Service role (cron / Netlify functions,
-- where auth.uid() is null) and staff (profiles.role in admin/auditor) pass
-- through untouched. For everyone else (i.e. a signed-in client — including
-- one who has a profiles row with role='client', which handle_new_user()
-- creates), the trigger forces the protected billing/financial/admin columns
-- back to their OLD values, so a malicious PATCH is silently ignored while
-- legitimate client writes (lpoa_signed, etc.) still succeed.

-- 1. Formalize the billing columns.
alter table public.clients add column if not exists billing_status     text;
alter table public.clients add column if not exists billing_type       text;
alter table public.clients add column if not exists billing_start_date date;
alter table public.clients add column if not exists billing_tier       text;
alter table public.clients add column if not exists ledger             jsonb not null default '[]'::jsonb;
alter table public.clients add column if not exists referred_by        uuid;
alter table public.clients add column if not exists referral_fee       numeric(12,2);
alter table public.clients add column if not exists commission_paid    boolean not null default false;
alter table public.clients add column if not exists commission_paid_at timestamptz;
alter table public.clients add column if not exists is_vip             boolean not null default false;

-- 2. Guard the protected columns against client-side tampering.
create or replace function public.protect_client_billing_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service role (cron, Netlify background functions) has no auth.uid(); allow.
  if auth.uid() is null then
    return new;
  end if;

  -- Staff (admin/auditor) may edit billing freely. NOTE: the check must be on
  -- role, not mere existence of a profiles row — handle_new_user() gives every
  -- matched client a profiles row with role='client', so "has a profiles row"
  -- would wrongly treat clients as staff and defeat this trigger. This matches
  -- the role in ('admin','auditor') convention set in
  -- 20260714_fix_handle_new_user_trigger.sql.
  if exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
  ) then
    return new;
  end if;

  -- Otherwise the caller is a client acting on their own row. Preserve every
  -- protected column so only their permitted fields (e.g. lpoa_signed) change.
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
  return new;
end;
$$;

drop trigger if exists trg_protect_client_billing on public.clients;
create trigger trg_protect_client_billing
  before update on public.clients
  for each row
  execute function public.protect_client_billing_columns();
