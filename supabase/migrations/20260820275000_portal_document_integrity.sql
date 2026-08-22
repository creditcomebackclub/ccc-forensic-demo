-- Additive integrity metadata for canonical portal identity-document uploads.
-- Existing document rows remain valid; new server-side uploads populate all
-- three columns after validating the bytes rather than trusting browser MIME
-- or filename claims.

alter table public.documents
  add column if not exists content_type text,
  add column if not exists byte_size bigint,
  add column if not exists sha256 text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'documents_byte_size_nonnegative_check'
      and conrelid = 'public.documents'::regclass
  ) then
    alter table public.documents
      add constraint documents_byte_size_nonnegative_check
      check (byte_size is null or byte_size >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'documents_sha256_format_check'
      and conrelid = 'public.documents'::regclass
  ) then
    alter table public.documents
      add constraint documents_sha256_format_check
      check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'documents_content_type_allowlist_check'
      and conrelid = 'public.documents'::regclass
  ) then
    alter table public.documents
      add constraint documents_content_type_allowlist_check
      check (
        content_type is null
        or content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
      );
  end if;
end $$;

comment on column public.documents.content_type is
  'Server-detected MIME type for the stored document; browser claims are not authoritative.';
comment on column public.documents.byte_size is
  'Exact decoded byte length recorded by the server at upload time.';
comment on column public.documents.sha256 is
  'Lowercase SHA-256 of the exact stored bytes for integrity verification.';

-- Signed agreement/disclosure/cancellation bytes and content-addressed portal
-- identity evidence are immutable to every browser role. Netlify functions
-- using the service role are the sole writers for those paths; the endpoint
-- itself uses insert-only storage plus an exact-byte idempotent retry check.
create or replace function public.ccc_is_immutable_portal_artifact_path(object_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    (storage.foldername(object_name))[3] = 'agreements'
    or (
      (storage.foldername(object_name))[3] = 'identity'
      and storage.filename(object_name)
        ~ '^(id|address)-[0-9a-f]{16}\.[a-z0-9]+$'
    );
$$;

revoke all on function public.ccc_is_immutable_portal_artifact_path(text) from public;
grant execute on function public.ccc_is_immutable_portal_artifact_path(text) to authenticated;

-- Remove every currently named browser mutation policy for the documents
-- bucket so PostgreSQL's permissive-policy OR behavior cannot leave a wider
-- route behind. Historical policy names are included defensively.
drop policy if exists "client_insert_documents_storage" on storage.objects;
drop policy if exists "client_update_documents_storage" on storage.objects;
drop policy if exists "client_delete_documents_storage" on storage.objects;
drop policy if exists "Users manage own document files" on storage.objects;

drop policy if exists "staff_insert_documents_storage" on storage.objects;
create policy "staff_insert_documents_storage"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[3] is distinct from 'agreements'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'auditor')
      and (p.role = 'admin' or (storage.foldername(name))[1] = auth.uid()::text)
  )
);

drop policy if exists "staff_update_documents_storage" on storage.objects;
create policy "staff_update_documents_storage"
on storage.objects for update to authenticated
using (
  bucket_id = 'documents'
  and not public.ccc_is_immutable_portal_artifact_path(name)
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'auditor')
      and (p.role = 'admin' or (storage.foldername(name))[1] = auth.uid()::text)
  )
)
with check (
  bucket_id = 'documents'
  and not public.ccc_is_immutable_portal_artifact_path(name)
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'auditor')
      and (p.role = 'admin' or (storage.foldername(name))[1] = auth.uid()::text)
  )
);

drop policy if exists "staff_delete_documents_storage" on storage.objects;
create policy "staff_delete_documents_storage"
on storage.objects for delete to authenticated
using (
  bucket_id = 'documents'
  and not public.ccc_is_immutable_portal_artifact_path(name)
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'auditor')
      and (p.role = 'admin' or (storage.foldername(name))[1] = auth.uid()::text)
  )
);

-- Portal browsers keep read access to ordinary identity/other documents for
-- the existing Documents tab, but legal packets are only exposed through the
-- owner-authorized, hash-bound view endpoint.
drop policy if exists "client_select_documents_storage" on storage.objects;
create policy "client_select_documents_storage"
on storage.objects for select to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[3] is distinct from 'agreements'
  and public.client_owns_documents_path(name)
);

-- Registry writes are server-owned too. SELECT remains under the existing
-- exact client_profiles.client_id RLS policy.
drop policy if exists "client_insert_own_documents" on public.documents;
drop policy if exists "client_delete_own_documents" on public.documents;
