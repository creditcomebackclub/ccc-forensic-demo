-- High-severity RLS hardening from the client_id / storage drift audit:
-- 1. letters / audits / progress_updates client read: name match only when
--    client_profiles.client_id is still null (same predicate as clients
--    hardening in 20260729000000). documents already fixed in
--    20260731000000.
-- 2. responses bucket: admins retain full access; auditors are limited to
--    their own firm folder OR legacy folders rooted at a client auth uid
--    linked to a clients row they own.
-- 3. profiles: drop world-readable SELECT for every authenticated user;
--    allow self + staff via a SECURITY DEFINER helper (avoids recursive
--    profiles RLS when checking role).

-- ---------------------------------------------------------------------------
-- Helper: staff role check without profiles RLS recursion
-- ---------------------------------------------------------------------------
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'auditor')
  );
$$;

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Portal sibling tables — close same-name cross-client read
-- ---------------------------------------------------------------------------
drop policy if exists "client_read_own_letters" on public.letters;
create policy "client_read_own_letters"
on public.letters for select to authenticated
using (
  exists (
    select 1 from public.client_profiles cp
    where cp.user_id = auth.uid()
      and (
        (cp.client_id is not null and cp.client_id = letters.client_id)
        or (cp.client_id is null and cp.full_name = letters.client_name)
      )
  )
);

drop policy if exists "client_read_own_audits" on public.audits;
create policy "client_read_own_audits"
on public.audits for select to authenticated
using (
  exists (
    select 1 from public.client_profiles cp
    where cp.user_id = auth.uid()
      and (
        (cp.client_id is not null and cp.client_id = audits.client_id)
        or (cp.client_id is null and cp.full_name = audits.client_name)
      )
  )
);

drop policy if exists "client_read_own_progress" on public.progress_updates;
create policy "client_read_own_progress"
on public.progress_updates for select to authenticated
using (
  exists (
    select 1 from public.client_profiles cp
    where cp.user_id = auth.uid()
      and (
        (cp.client_id is not null and cp.client_id = progress_updates.client_id)
        or (cp.client_id is null and cp.full_name = progress_updates.client_name)
      )
  )
);

-- ---------------------------------------------------------------------------
-- 2. responses storage — path-scoped staff access
-- ---------------------------------------------------------------------------
-- Path shapes:
--   {firmUserId}/response-evidence/{evidenceId}/...   (current)
--   {clientAuthUid}/{letterId}/...                    (legacy)
-- Client uploads use signed URLs (service-issued); no client storage policy.

drop policy if exists "staff_read_responses" on storage.objects;
drop policy if exists "staff_insert_responses" on storage.objects;
drop policy if exists "staff_update_responses" on storage.objects;
drop policy if exists "staff_delete_responses" on storage.objects;

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
        or exists (
          select 1
          from public.client_profiles cp
          join public.clients c on c.id = cp.client_id
          where cp.user_id::text = (storage.foldername(name))[1]
            and c.user_id = auth.uid()
        )
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
        or exists (
          select 1
          from public.client_profiles cp
          join public.clients c on c.id = cp.client_id
          where cp.user_id::text = (storage.foldername(name))[1]
            and c.user_id = auth.uid()
        )
      )
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
        or exists (
          select 1
          from public.client_profiles cp
          join public.clients c on c.id = cp.client_id
          where cp.user_id::text = (storage.foldername(name))[1]
            and c.user_id = auth.uid()
        )
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
        or exists (
          select 1
          from public.client_profiles cp
          join public.clients c on c.id = cp.client_id
          where cp.user_id::text = (storage.foldername(name))[1]
            and c.user_id = auth.uid()
        )
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
        or exists (
          select 1
          from public.client_profiles cp
          join public.clients c on c.id = cp.client_id
          where cp.user_id::text = (storage.foldername(name))[1]
            and c.user_id = auth.uid()
        )
      )
  )
);

-- ---------------------------------------------------------------------------
-- 3. profiles — self or staff only
-- ---------------------------------------------------------------------------
drop policy if exists "read_all_profiles" on public.profiles;
create policy "read_own_or_staff_profiles"
on public.profiles for select to authenticated
using (
  id = auth.uid()
  or public.is_staff()
);
