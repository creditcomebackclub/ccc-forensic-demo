-- Phase 4 of the client_id migration. This is where the real "Cameron
-- Michael May" incident lived (see audit-run-background.mjs's
-- saveAuditAs): clients.name has no unique constraint, and audits.id was
-- generated as slug(clientName)+'__'+reportDate — two same-named clients
-- auditing on the same date would collide on the literal primary key, one
-- silently overwriting the other's audit. client_accounts is the
-- persistent tradeline-identity anchor Phase 3 bureau-gating trusts, so it
-- needs the same fix — keying its own lookup by name undermines the one
-- thing it exists to guarantee (a STABLE identity).
--
-- Same pattern as 20260725_documents_client_id.sql: additive nullable
-- column, backfill only where exactly one clients row matches (ambiguous
-- rows left null rather than guessed), supporting index.

alter table public.audits
  add column if not exists client_id uuid references public.clients(id) on delete cascade;

update public.audits a
set client_id = c.id
from public.clients c
where a.client_id is null
  and a.user_id = c.user_id
  and a.client_name = c.name
  and (select count(*) from public.clients c2 where c2.user_id = a.user_id and c2.name = a.client_name) = 1;

create index if not exists audits_user_client_idx
  on public.audits (user_id, client_id);

alter table public.client_accounts
  add column if not exists client_id uuid references public.clients(id) on delete cascade;

update public.client_accounts ca
set client_id = c.id
from public.clients c
where ca.client_id is null
  and ca.user_id = c.user_id
  and ca.client_name = c.name
  and (select count(*) from public.clients c2 where c2.user_id = ca.user_id and c2.name = ca.client_name) = 1;

-- Replaces client_accounts_client_idx (user_id, client_name) — that index
-- is exactly the fragile lookup key this migration retires. Not dropped
-- outright: application code is cut over in the same change, but leaving
-- the old index costs nothing and any code path still on the old pattern
-- keeps working during rollout.
create index if not exists client_accounts_client_id_idx
  on public.client_accounts (user_id, client_id);

-- RLS: transitional OR alongside the existing client_name check, same as
-- documents in the prior phase — additive to who gets access, nothing that
-- worked before stops working. Drop the client_name half once a
-- verification query confirms audits.client_id has no remaining nulls.
drop policy if exists "client_read_own_audits" on public.audits;
create policy "client_read_own_audits" on public.audits for select using (
  exists (
    select 1 from public.client_profiles cp
    where cp.user_id = auth.uid()
      and (
        (cp.client_id is not null and cp.client_id = audits.client_id)
        or cp.full_name = audits.client_name
      )
  )
);
