-- Phase 3 of the client_id migration: documents already got a client_id
-- column in 20260725_documents_client_id.sql, but its RLS policies were
-- never updated off the original client_name string match — closing that
-- gap here now that client_profiles.client_id exists too (20260726
-- client_profiles_client_id.sql).
--
-- Transitional: OR the new client_id check in alongside the existing
-- full_name/client_name check rather than replacing it outright. This is
-- purely additive to who gets access — nothing that worked before stops
-- working — and it also happens to fix a pre-existing bug where a
-- case/whitespace mismatch between client_profiles.full_name and
-- documents.client_name silently denied portal access even though the
-- client_id-backed match resolves correctly. Drop the full_name half once
-- a verification query confirms documents.client_id is populated for every
-- row (see the client_id migration plan's Phase 3 verification step).
drop policy if exists "client_read_own_documents" on public.documents;
create policy "client_read_own_documents" on public.documents for select using (
  exists (
    select 1 from public.client_profiles cp
    where cp.user_id = auth.uid()
      and (
        (cp.client_id is not null and cp.client_id = documents.client_id)
        or cp.full_name = documents.client_name
      )
  )
);

drop policy if exists "client_insert_own_documents" on public.documents;
create policy "client_insert_own_documents" on public.documents for insert with check (
  exists (
    select 1 from public.client_profiles cp
    where cp.user_id = auth.uid()
      and (
        (cp.client_id is not null and cp.client_id = documents.client_id)
        or cp.full_name = documents.client_name
      )
  )
);
