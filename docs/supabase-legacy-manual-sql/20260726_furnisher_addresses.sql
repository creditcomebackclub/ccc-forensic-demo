-- Replaces "confirm a furnisher's mailing address, then throw the answer
-- away" with a compounding, staff-editable reference table. Previously the
-- only two sources were (a) a hardcoded list embedded in masterPrompt.js
-- that the audit-generation LLM matches against, and (b) a second,
-- independently-maintained hardcoded map in ClientsPage.jsx used only to
-- pre-fill LobMailer's send-to address — neither ever learns from a real
-- staff confirmation, both require a code deploy to extend, and they can
-- drift out of sync with each other since nothing keeps them aligned.
create table if not exists public.furnisher_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Normalized via src/utils/diffEngine.js's normalizeFurnisher() at write
  -- time — same corp-suffix-stripping/casing collapse already used to match
  -- furnishers across audits, so "Capital One Bank, N.A." and "CAPITAL ONE
  -- BANK NA" resolve to the same row instead of creating duplicates.
  furnisher_key text not null,
  display_name text not null,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state text not null,
  zip text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, furnisher_key)
);

create index if not exists furnisher_addresses_key_idx on public.furnisher_addresses (user_id, furnisher_key);

alter table public.furnisher_addresses enable row level security;

drop policy if exists furnisher_addresses_staff_all on public.furnisher_addresses;
create policy furnisher_addresses_staff_all on public.furnisher_addresses
  for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor'))
  );
