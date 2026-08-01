-- Live NMI billing: payment_transactions ledger, vault metadata, recurring flag.
-- Vault IDs are written only via service-role Netlify functions.

-- ---------------------------------------------------------------------------
-- clients.recurring_active — monthly auto-charge only after first successful sale
-- ---------------------------------------------------------------------------
alter table public.clients
  add column if not exists recurring_active boolean not null default false;

comment on column public.clients.recurring_active is
  'True after first approved billable NMI sale for Automated Recurring tiers. Cron must not monthly-charge until set.';

-- ---------------------------------------------------------------------------
-- client_profiles vault metadata extensions
-- ---------------------------------------------------------------------------
alter table public.client_profiles
  add column if not exists nmi_initial_transaction_id text,
  add column if not exists card_vaulted_at timestamptz;

comment on column public.client_profiles.nmi_vault_id is
  'NMI Customer Vault id. Server-only write; never expose to browser clients.';
comment on column public.client_profiles.nmi_initial_transaction_id is
  'Initial CIT/auth transaction id for subsequent MIT stored-credential sales.';

-- Block non-staff from reading or writing vault secrets on client_profiles.
create or replace function public.protect_client_profile_card_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    return new;
  elsif exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
  ) then
    return new;
  else
    -- Clients may update last4/type/expiry display fields only via service role
    -- in practice; pin vault secrets to OLD so browser UPDATEs cannot set them.
    new.nmi_vault_id := old.nmi_vault_id;
    new.nmi_initial_transaction_id := old.nmi_initial_transaction_id;
    new.card_vaulted_at := old.card_vaulted_at;
    -- Also prevent clients from inventing card meta without a vault board.
    if old.nmi_vault_id is null then
      new.card_last4 := old.card_last4;
      new.card_type := old.card_type;
      new.card_expiry := old.card_expiry;
    end if;
    return new;
  end if;
end;
$$;

drop trigger if exists trg_protect_client_profile_card_columns on public.client_profiles;
create trigger trg_protect_client_profile_card_columns
  before update on public.client_profiles
  for each row
  execute function public.protect_client_profile_card_columns();

-- Hide nmi_vault_id from client SELECT via column privilege revoke is not
-- practical on a shared table; app never selects it from the browser.
-- Staff/service use service role for vault operations.

-- ---------------------------------------------------------------------------
-- payment_transactions — gateway source of truth
-- ---------------------------------------------------------------------------
create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  amount numeric(12,2) not null default 0,
  currency text not null default 'USD',
  kind text not null check (kind in ('auth', 'sale', 'void', 'refund')),
  status text not null check (status in ('pending', 'approved', 'declined', 'error')),
  nmi_transaction_id text,
  nmi_vault_id text,
  idempotency_key text not null,
  ledger_invoice_ids jsonb not null default '[]'::jsonb,
  attempt_number int not null default 1,
  next_retry_at timestamptz,
  decline_type text check (decline_type is null or decline_type in ('soft', 'hard')),
  initiated_by text not null check (initiated_by in (
    'onboarding', 'client', 'staff', 'cron', 'audit_delivery', 'webhook'
  )),
  raw_response jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create unique index if not exists payment_transactions_idempotency_key_uidx
  on public.payment_transactions (idempotency_key);

create unique index if not exists payment_transactions_nmi_txn_uidx
  on public.payment_transactions (nmi_transaction_id)
  where nmi_transaction_id is not null;

create index if not exists payment_transactions_client_id_idx
  on public.payment_transactions (client_id, created_at desc);

create index if not exists payment_transactions_next_retry_idx
  on public.payment_transactions (next_retry_at)
  where next_retry_at is not null and status = 'declined';

alter table public.payment_transactions enable row level security;

-- Staff can read; only service role writes (Netlify functions).
drop policy if exists payment_transactions_staff_select on public.payment_transactions;
create policy payment_transactions_staff_select
  on public.payment_transactions
  for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'auditor')
    )
  );

-- Clients may see their own non-secret payment history (no raw_response).
-- Use a restricted view for portal if needed later; for V1 staff-only SELECT
-- plus service role is enough. Portal reads ledger on clients row.

revoke insert, update, delete on public.payment_transactions from anon, authenticated;
grant select on public.payment_transactions to authenticated;
grant all on public.payment_transactions to service_role;

-- ---------------------------------------------------------------------------
-- protect_client_columns: recurring_active is staff/service only (already
-- true — not in client allowed_cols). No change required.
-- ---------------------------------------------------------------------------

-- Expose recurring_active on list_client_summaries without rewriting the
-- entire RPC body: wrap via a thin view is not available, so staff detail
-- loads clients.recurring_active from CLIENT_DETAIL_COLUMNS. List badges
-- can be added in a follow-up RPC migration if needed.
