-- Paid AI jobs are an internal staff workflow. The original job policies
-- only checked `auth.uid() = user_id`, which allowed every signed-in portal
-- client to enqueue their own row and then attempt to start it.
--
-- Keep the established per-staff ownership model, but require a real
-- admin/auditor profile for both creating and polling a job. The Netlify
-- functions enforce the matching JWT and target-record ownership again
-- before they use the service role or call Anthropic.

-- A profile role is the trust root for requireStaff(). Do not let an
-- authenticated browser create its own profiles row with role='admin' or
-- role='auditor'. Existing staff profiles are unchanged; new team members
-- must be provisioned deliberately by an admin through a trusted backend or
-- the Supabase dashboard before their first sign-in.
drop policy if exists "insert_own_profile" on public.profiles;

drop policy if exists "audit_jobs_insert_own" on public.audit_jobs;
drop policy if exists "audit_jobs_select_own" on public.audit_jobs;
create policy "audit_jobs_insert_own_staff" on public.audit_jobs
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'auditor')
    )
  );
create policy "audit_jobs_select_own_staff" on public.audit_jobs
  for select to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'auditor')
    )
  );

drop policy if exists "phase2_jobs_insert_own" on public.phase2_jobs;
drop policy if exists "phase2_jobs_select_own" on public.phase2_jobs;
create policy "phase2_jobs_insert_own_staff" on public.phase2_jobs
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'auditor')
    )
  );
create policy "phase2_jobs_select_own_staff" on public.phase2_jobs
  for select to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'auditor')
    )
  );

drop policy if exists "phase4_jobs_insert_own" on public.phase4_jobs;
drop policy if exists "phase4_jobs_select_own" on public.phase4_jobs;
create policy "phase4_jobs_insert_own_staff" on public.phase4_jobs
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'auditor')
    )
  );
create policy "phase4_jobs_select_own_staff" on public.phase4_jobs
  for select to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'auditor')
    )
  );
