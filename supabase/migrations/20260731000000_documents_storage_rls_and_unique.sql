-- Critical fixes from the client_id / storage drift audit (2026-07-31):
-- 1. Drop legacy UNIQUE (user_id, client_name, doc_type) so id-keyed upserts
--    are not blocked by orphan name-keyed rows.
-- 2. Harden documents table client RLS to match clients portal hardening
--    (name match only when client_profiles.client_id is still null) and add
--    client DELETE so portal remove works under staff-owned user_id rows.
-- 3. Version documents-bucket storage.objects policies: path shape is
--    {staffOwnerUserId}/{clientId}/{filename} (plus staff temp prefixes
--    under {staffOwnerUserId}/…). Clients access only their own clientId
--    segment under their firm's staff owner; staff manage their own root
--    folder; admins manage the whole bucket.

-- ---------------------------------------------------------------------------
-- 1. Unique constraint
-- ---------------------------------------------------------------------------
alter table public.documents
  drop constraint if exists documents_user_client_type;

-- Keep the canonical upsert target (already present in baseline):
--   documents_user_client_doctype_idx on (user_id, client_id, doc_type)

-- ---------------------------------------------------------------------------
-- 2. documents table RLS (client)
-- ---------------------------------------------------------------------------
drop policy if exists "client_read_own_documents" on public.documents;
create policy "client_read_own_documents"
on public.documents for select to authenticated
using (
  exists (
    select 1 from public.client_profiles cp
    where cp.user_id = auth.uid()
      and (
        (cp.client_id is not null and cp.client_id = documents.client_id)
        or (cp.client_id is null and cp.full_name = documents.client_name)
      )
  )
);

drop policy if exists "client_insert_own_documents" on public.documents;
create policy "client_insert_own_documents"
on public.documents for insert to authenticated
with check (
  exists (
    select 1 from public.client_profiles cp
    where cp.user_id = auth.uid()
      and (
        (cp.client_id is not null and cp.client_id = documents.client_id)
        or (cp.client_id is null and cp.full_name = documents.client_name)
      )
  )
);

drop policy if exists "client_delete_own_documents" on public.documents;
create policy "client_delete_own_documents"
on public.documents for delete to authenticated
using (
  exists (
    select 1 from public.client_profiles cp
    where cp.user_id = auth.uid()
      and (
        (cp.client_id is not null and cp.client_id = documents.client_id)
        or (cp.client_id is null and cp.full_name = documents.client_name)
      )
  )
);

-- ---------------------------------------------------------------------------
-- 3. documents storage bucket + policies
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  26214400,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/html',
    'text/html;charset=utf-8'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Drop prior names (dashboard or earlier drafts) before recreate.
drop policy if exists "staff_select_documents_storage" on storage.objects;
drop policy if exists "staff_insert_documents_storage" on storage.objects;
drop policy if exists "staff_update_documents_storage" on storage.objects;
drop policy if exists "staff_delete_documents_storage" on storage.objects;
drop policy if exists "client_select_documents_storage" on storage.objects;
drop policy if exists "client_insert_documents_storage" on storage.objects;
drop policy if exists "client_update_documents_storage" on storage.objects;
drop policy if exists "client_delete_documents_storage" on storage.objects;

-- Staff: admin sees all documents-bucket objects; auditor/staff only their
-- own root folder (auth.uid() as first path segment) — covers client docs,
-- temp-letters, audit-jobs, and mail-artifacts under that owner.
create policy "staff_select_documents_storage"
on storage.objects for select to authenticated
using (
  bucket_id = 'documents'
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

create policy "staff_insert_documents_storage"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'documents'
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

create policy "staff_update_documents_storage"
on storage.objects for update to authenticated
using (
  bucket_id = 'documents'
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
  bucket_id = 'documents'
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

create policy "staff_delete_documents_storage"
on storage.objects for delete to authenticated
using (
  bucket_id = 'documents'
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

-- Clients: only {firmStaffUserId}/{theirClientId}/… — matches uploadDocument
-- / deleteDocument ownerUserId + clientId contract.
create policy "client_select_documents_storage"
on storage.objects for select to authenticated
using (
  bucket_id = 'documents'
  and exists (
    select 1
    from public.client_profiles cp
    join public.clients c on c.id = cp.client_id
    where cp.user_id = auth.uid()
      and cp.client_id is not null
      and (storage.foldername(name))[1] = c.user_id::text
      and (storage.foldername(name))[2] = cp.client_id::text
  )
);

create policy "client_insert_documents_storage"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'documents'
  and exists (
    select 1
    from public.client_profiles cp
    join public.clients c on c.id = cp.client_id
    where cp.user_id = auth.uid()
      and cp.client_id is not null
      and (storage.foldername(name))[1] = c.user_id::text
      and (storage.foldername(name))[2] = cp.client_id::text
  )
);

create policy "client_update_documents_storage"
on storage.objects for update to authenticated
using (
  bucket_id = 'documents'
  and exists (
    select 1
    from public.client_profiles cp
    join public.clients c on c.id = cp.client_id
    where cp.user_id = auth.uid()
      and cp.client_id is not null
      and (storage.foldername(name))[1] = c.user_id::text
      and (storage.foldername(name))[2] = cp.client_id::text
  )
)
with check (
  bucket_id = 'documents'
  and exists (
    select 1
    from public.client_profiles cp
    join public.clients c on c.id = cp.client_id
    where cp.user_id = auth.uid()
      and cp.client_id is not null
      and (storage.foldername(name))[1] = c.user_id::text
      and (storage.foldername(name))[2] = cp.client_id::text
  )
);

create policy "client_delete_documents_storage"
on storage.objects for delete to authenticated
using (
  bucket_id = 'documents'
  and exists (
    select 1
    from public.client_profiles cp
    join public.clients c on c.id = cp.client_id
    where cp.user_id = auth.uid()
      and cp.client_id is not null
      and (storage.foldername(name))[1] = c.user_id::text
      and (storage.foldername(name))[2] = cp.client_id::text
  )
);
