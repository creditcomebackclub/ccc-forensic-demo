-- Follow-ups from PR #1 review:
-- 1. Narrow staff_insert_responses — no legacy {clientAuthUid}/ write path
--    (reads/updates/deletes keep the join for historic folders).
-- 2. Tighten client-docs INSERT: clients only under their auth.uid() folder;
--    staff may write admin/ (settings.json) or any path.
-- 3. Ambiguity-guarded client_id backfill for remaining null rows on
--    documents/letters/audits/progress_updates/client_profiles.

-- ---------------------------------------------------------------------------
-- 1. responses INSERT — own firm root (or admin) only
-- ---------------------------------------------------------------------------
drop policy if exists "staff_insert_responses" on storage.objects;
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
);

-- ---------------------------------------------------------------------------
-- 2. client-docs upload path ownership
-- ---------------------------------------------------------------------------
drop policy if exists "Clients can upload own docs" on storage.objects;
create policy "client_insert_own_client_docs"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'client-docs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "staff_insert_client_docs" on storage.objects;
create policy "staff_insert_client_docs"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'client-docs'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'auditor')
  )
);

-- ---------------------------------------------------------------------------
-- 3. Unambiguous client_id backfill (name+owner or email = exactly one match)
-- ---------------------------------------------------------------------------
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

update public.letters l
set client_id = c.id
from public.clients c
where l.client_id is null
  and l.user_id = c.user_id
  and l.client_name = c.name
  and (
    select count(*) from public.clients c2
    where c2.user_id = l.user_id and c2.name = l.client_name
  ) = 1;

update public.audits a
set client_id = c.id
from public.clients c
where a.client_id is null
  and a.user_id = c.user_id
  and a.client_name = c.name
  and (
    select count(*) from public.clients c2
    where c2.user_id = a.user_id and c2.name = a.client_name
  ) = 1;

update public.progress_updates p
set client_id = c.id
from public.clients c
where p.client_id is null
  and p.user_id = c.user_id
  and p.client_name = c.name
  and (
    select count(*) from public.clients c2
    where c2.user_id = p.user_id and c2.name = p.client_name
  ) = 1;

-- client_profiles: email first, then unambiguous full_name
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
