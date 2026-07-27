-- Explicit client selection for new audits (Task: eliminate audit-to-client
-- attribution guessing). Staff now picks an existing client or explicitly
-- chooses "new lead" on the upload screen BEFORE the audit runs, instead of
-- audit-run-background.mjs inferring attribution from the extracted report
-- name after the fact. selected_client_id is authoritative when present:
-- the background function looks up that client's exact stored name and uses
-- it directly, skipping the case-insensitive name-matching heuristic.
alter table public.audit_jobs
  add column if not exists selected_client_id uuid references public.clients(id) on delete set null,
  add column if not exists selected_client_is_new boolean not null default false;
