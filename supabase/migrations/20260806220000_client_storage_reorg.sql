-- Client storage reorg: LPOA private-path metadata + responses RLS tighten +
-- client-docs firm-assets-only posture.
--
-- Path contract (see src/utils/storagePaths.js):
--   documents/{firm}/{clientId}/identity|lpoa/…
--   responses/{firm}/{clientId}/response-evidence/{id}/…
--   client-docs/admin|firm/… only (no client PII)

-- ---------------------------------------------------------------------------
-- 1. client_profiles: durable LPOA storage coordinates
-- ---------------------------------------------------------------------------
alter table public.client_profiles
  add column if not exists lpoa_storage_bucket text,
  add column if not exists lpoa_storage_path text;

comment on column public.client_profiles.lpoa_storage_bucket is
  'Private bucket holding the signed LPOA HTML (documents after reorg).';
comment on column public.client_profiles.lpoa_storage_path is
  'Storage object path for signed LPOA; prefer over lpoa_url (legacy public).';

-- Backfill paths from clients.lpoa_signature_data JSON when already migrated
-- by the app writers (signaturePath / lpoaPath keys).
update public.client_profiles cp
set
  lpoa_storage_bucket = coalesce(
    cp.lpoa_storage_bucket,
    nullif(c.lpoa_signature_data->>'storageBucket', ''),
    'documents'
  ),
  lpoa_storage_path = coalesce(
    cp.lpoa_storage_path,
    nullif(c.lpoa_signature_data->>'lpoaPath', '')
  )
from public.clients c
where c.id = cp.client_id
  and cp.lpoa_storage_path is null
  and nullif(c.lpoa_signature_data->>'lpoaPath', '') is not null;

-- ---------------------------------------------------------------------------
-- 2. responses storage RLS — drop legacy {clientAuthUid}/{letterId} branch
--    after reorg; require firm folder root for auditors.
-- ---------------------------------------------------------------------------
drop policy if exists "staff_read_responses" on storage.objects;
drop policy if exists "staff_insert_responses" on storage.objects;
drop policy if exists "staff_update_responses" on storage.objects;
drop policy if exists "staff_delete_responses" on storage.objects;

-- Canonical: {firmUserId}/{clientId}/response-evidence/{evidenceId}/…
-- Dual-read transitional: {firmUserId}/response-evidence/{evidenceId}/…
create policy "staff_read_responses"
on storage.objects for select to authenticated
using (
  bucket_id = 'responses'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'auditor')
      and (
        p.role = 'admin'
        or (storage.foldername(name))[1] = auth.uid()::text
      )
  )
);

create policy "staff_insert_responses"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'responses'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'auditor')
      and (
        p.role = 'admin'
        or (storage.foldername(name))[1] = auth.uid()::text
      )
  )
  and (
    (storage.foldername(name))[2] = 'response-evidence'
    or (storage.foldername(name))[3] = 'response-evidence'
  )
);

create policy "staff_update_responses"
on storage.objects for update to authenticated
using (
  bucket_id = 'responses'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'auditor')
      and (
        p.role = 'admin'
        or (storage.foldername(name))[1] = auth.uid()::text
      )
  )
)
with check (
  bucket_id = 'responses'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'auditor')
      and (
        p.role = 'admin'
        or (storage.foldername(name))[1] = auth.uid()::text
      )
  )
);

create policy "staff_delete_responses"
on storage.objects for delete to authenticated
using (
  bucket_id = 'responses'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'auditor')
      and (
        p.role = 'admin'
        or (storage.foldername(name))[1] = auth.uid()::text
      )
  )
);

-- ---------------------------------------------------------------------------
-- 3. client-docs: firm assets only — revoke broad public/authenticated
--    client-folder writes. Keep admin/settings + firm/ attorney signature.
-- ---------------------------------------------------------------------------
drop policy if exists "client_docs_authenticated_insert" on storage.objects;
drop policy if exists "client_docs_authenticated_update" on storage.objects;
drop policy if exists "client_docs_authenticated_delete" on storage.objects;
drop policy if exists "Anyone can upload to client-docs" on storage.objects;
drop policy if exists "Anyone can update client-docs" on storage.objects;
drop policy if exists "Users manage own client-docs" on storage.objects;
drop policy if exists "staff_insert_client_docs" on storage.objects;
drop policy if exists "staff_update_client_docs" on storage.objects;
drop policy if exists "staff_delete_client_docs" on storage.objects;
drop policy if exists "staff_select_client_docs" on storage.objects;

-- Staff may manage firm assets under admin/ and firm/ only.
create policy "staff_select_client_docs"
on storage.objects for select to authenticated
using (
  bucket_id = 'client-docs'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
  )
  and (storage.foldername(name))[1] in ('admin', 'firm')
);

create policy "staff_insert_client_docs"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'client-docs'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
  )
  and (storage.foldername(name))[1] in ('admin', 'firm')
);

create policy "staff_update_client_docs"
on storage.objects for update to authenticated
using (
  bucket_id = 'client-docs'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
  )
  and (storage.foldername(name))[1] in ('admin', 'firm')
)
with check (
  bucket_id = 'client-docs'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
  )
  and (storage.foldername(name))[1] in ('admin', 'firm')
);

create policy "staff_delete_client_docs"
on storage.objects for delete to authenticated
using (
  bucket_id = 'client-docs'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
  )
  and (storage.foldername(name))[1] in ('admin', 'firm')
);

-- Mark bucket private when possible (idempotent). Public URLs for legacy
-- objects may still resolve until objects are deleted by the reorg script;
-- new firm assets should be read via signed URL or service role.
update storage.buckets
set public = false
where id = 'client-docs';
