-- Priority 1 security fix: documents.js keyed ID/address document storage
-- paths (and this table's own upsert conflict target) purely off
-- slug(clientName). Two real clients sharing the exact same name would
-- silently overwrite each other's government ID / proof-of-address files —
-- both the storage object AND this table's row, since the old upsert
-- target was (user_id, client_name, doc_type). client_id fixes the actual
-- collision; client_name stays for display only, per the "client_id for
-- new relationships, client_name never" project guidance.
alter table public.documents
  add column if not exists client_id uuid references public.clients(id) on delete cascade;

-- Backfill: resolve existing rows to their real client only when
-- unambiguous (exactly one clients row with that name under that user).
-- A name shared by two clients under one user is exactly the ambiguity
-- this migration exists to stop guessing about — those rows are left
-- client_id = null rather than resolved by assumption; they keep working
-- via the pre-existing client_name path until re-uploaded.
update public.documents d
set client_id = c.id
from public.clients c
where d.client_id is null
  and d.user_id = c.user_id
  and d.client_name = c.name
  and (
    select count(*) from public.clients c2
    where c2.user_id = d.user_id and c2.name = d.client_name
  ) = 1;

-- Plain (non-partial) unique index: Postgres treats multiple NULLs as
-- distinct for uniqueness purposes, so legacy rows left null by the
-- backfill above don't conflict with each other or block new rows — and
-- a plain index (unlike a partial one) works directly as a Supabase
-- upsert onConflict target with no WHERE-clause matching required.
create unique index if not exists documents_user_client_doctype_idx
  on public.documents (user_id, client_id, doc_type);
