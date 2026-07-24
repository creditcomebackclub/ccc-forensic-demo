-- Persistent account identity. One stable UUID per real-world tradeline per
-- client, independent of any single audit run. Audit ingest
-- (audit-run-background.mjs) matches incoming tradelines to these rows via a
-- confidence-tiered composite key (last-4 anchor + furnisher name + original
-- creditor; see src/utils/accountIdentity.js) and injects the UUID onto each
-- account in the stored audit JSON. Phase 1 letters store it
-- (letters.client_account_id) and Phase 3 bureau gating resolves through it,
-- so nothing keys on the positional acct_N id, which is reassigned every
-- audit run and silently pointed letters at the wrong account.
create table if not exists public.client_accounts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  client_name       text not null,
  norm_furnisher    text,
  display_furnisher text,
  original_creditor text,
  account_last4     text,
  -- Set when ingest cannot confidently resolve a tradeline (ambiguous match
  -- or an intra-audit collision). The account is left unlinked and Phase 3
  -- blocks on it rather than guessing — never auto-resolved.
  needs_review      boolean not null default false,
  review_reason     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists client_accounts_client_idx
  on public.client_accounts (user_id, client_name);

alter table public.client_accounts enable row level security;

drop policy if exists "staff_all_client_accounts" on public.client_accounts;
create policy "staff_all_client_accounts" on public.client_accounts for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor'))
);

-- Link letters to the persistent identity. Nullable: legacy letters predate
-- identities and are linked by the backfill; where they can't be linked,
-- Phase 3 resolution falls back to furnisher matching and blocks on failure.
alter table public.letters add column if not exists client_account_id uuid;
