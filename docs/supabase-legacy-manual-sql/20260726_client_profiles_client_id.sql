-- RLS foundation for the client_id migration (see project memory
-- ccc-demo-guardrails / the client_id migration plan). Every client-portal
-- RLS policy in 20260714_security_audit_rls.sql resolves identity via
-- "client_profiles cp where cp.user_id = auth.uid() and cp.full_name =
-- <table>.client_name" — a string match. Before any of those policies can
-- be rewritten to use client_id, client_profiles itself needs a reliable
-- client_id.
--
-- Note this can't reuse the (user_id, name) backfill pattern from
-- 20260725_documents_client_id.sql directly: client_profiles.user_id is
-- the CLIENT's own auth id (matches auth.uid()), not the same namespace as
-- clients.user_id (the staff/firm owner) — joining those two columns would
-- never match. Instead this backfills in two ambiguity-guarded passes:
--   1. email match (clients.email = client_profiles.email) — most
--      reliable when populated, but clients.email can be null (see
--      20260725_clients_sign_token.sql: "clients with no portal
--      account/email").
--   2. for anything still unresolved, full_name match (clients.name =
--      client_profiles.full_name) — the same string-match relationship
--      every existing RLS policy already relies on today, so this pass
--      introduces no risk beyond current behavior.
-- Either pass only resolves a row when exactly one clients row matches;
-- genuine ambiguity (e.g. two same-named or same-emailed clients) is left
-- client_id = null rather than guessed. on delete set null (not cascade,
-- unlike documents/audits/etc.) — client_profiles is a live auth-linked
-- login record, not a business record that should disappear because the
-- CRM-side clients row it was matched to got deleted.
alter table public.client_profiles
  add column if not exists client_id uuid references public.clients(id) on delete set null;

update public.client_profiles cp
set client_id = c.id
from public.clients c
where cp.client_id is null
  and cp.email is not null
  and c.email = cp.email
  and (select count(*) from public.clients c2 where c2.email = cp.email) = 1;

update public.client_profiles cp
set client_id = c.id
from public.clients c
where cp.client_id is null
  and c.name = cp.full_name
  and (select count(*) from public.clients c2 where c2.name = cp.full_name) = 1;

create index if not exists client_profiles_client_id_idx
  on public.client_profiles (client_id);
