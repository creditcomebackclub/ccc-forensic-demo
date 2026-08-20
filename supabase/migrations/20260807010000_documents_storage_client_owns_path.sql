-- Enrollment signature upload was failing with:
--   "new row violates row-level security policy"
-- Clients insert into storage.objects under {firmUid}/{clientId}/…, and the
-- prior policies joined client_profiles → clients under the caller's RLS.
-- Nested-table RLS during storage policy evaluation is brittle (especially
-- when client_id is mid-wire on first login). Evaluate ownership in a
-- SECURITY DEFINER helper so the path check is authoritative.

create or replace function public.client_owns_documents_path(object_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'storage'
as $$
  select exists (
    select 1
    from public.client_profiles cp
    join public.clients c on c.id = cp.client_id
    where cp.user_id = auth.uid()
      and cp.client_id is not null
      and c.user_id is not null
      and (storage.foldername(object_name))[1] = c.user_id::text
      and (storage.foldername(object_name))[2] = cp.client_id::text
  );
$$;

revoke all on function public.client_owns_documents_path(text) from public;
grant execute on function public.client_owns_documents_path(text) to authenticated;

drop policy if exists "client_select_documents_storage" on storage.objects;
create policy "client_select_documents_storage"
on storage.objects for select to authenticated
using (
  bucket_id = 'documents'
  and public.client_owns_documents_path(name)
);

drop policy if exists "client_insert_documents_storage" on storage.objects;
create policy "client_insert_documents_storage"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'documents'
  and public.client_owns_documents_path(name)
);

drop policy if exists "client_update_documents_storage" on storage.objects;
create policy "client_update_documents_storage"
on storage.objects for update to authenticated
using (
  bucket_id = 'documents'
  and public.client_owns_documents_path(name)
)
with check (
  bucket_id = 'documents'
  and public.client_owns_documents_path(name)
);

drop policy if exists "client_delete_documents_storage" on storage.objects;
create policy "client_delete_documents_storage"
on storage.objects for delete to authenticated
using (
  bucket_id = 'documents'
  and public.client_owns_documents_path(name)
);
