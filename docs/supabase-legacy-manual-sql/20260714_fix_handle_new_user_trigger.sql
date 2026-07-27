-- Root cause of "every client invite becomes an auditor": handle_new_user()
-- fires on every auth.users insert and falls back to role='auditor' whenever
-- no matching client_profiles row is found yet. provision-user.cjs creates
-- the auth user BEFORE the client_profiles row, so that match always misses
-- for a brand-new client invite, and every new client silently got granted
-- full admin-dashboard access before ever logging in.
--
-- Fix: drop the auditor fallback entirely. An unmatched signup now gets no
-- profiles row at all (Chris is the only staff member; there is no
-- legitimate self-service path to staff access today). This does not affect
-- clients functionally — client portal routing is driven by client_profiles
-- membership, not profiles.role; three of five real clients already have no
-- profiles row and work fine.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $function$
declare
  pending_profile record;
begin
  select * into pending_profile
  from public.client_profiles
  where email = new.email
  limit 1;

  if found then
    insert into public.profiles (id, full_name, role)
    values (new.id, pending_profile.full_name, 'client')
    on conflict (id) do update set role = 'client', full_name = pending_profile.full_name;

    update public.client_profiles
    set user_id = new.id
    where email = new.email and user_id = '00000000-0000-0000-0000-000000000000';
  end if;
  -- No else branch — granting staff (admin/auditor) access is now
  -- exclusively a manual, deliberate action, never automatic.

  return new;
end;
$function$;

-- Also tighten client_profiles RLS: "staff" must mean role in
-- (admin, auditor) specifically, not merely "has any row in profiles" —
-- a client with a stray profiles row (role='client') should never satisfy
-- this check.
drop policy if exists "client_profiles_select_own_or_staff" on public.client_profiles;
drop policy if exists "client_profiles_insert_own_or_staff" on public.client_profiles;
drop policy if exists "client_profiles_update_own_or_staff" on public.client_profiles;

create policy "client_profiles_select_own_or_staff" on public.client_profiles
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'auditor'))
  );

create policy "client_profiles_insert_own_or_staff" on public.client_profiles
  for insert with check (
    auth.uid() = user_id
    or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'auditor'))
  );

create policy "client_profiles_update_own_or_staff" on public.client_profiles
  for update using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'auditor'))
  ) with check (
    auth.uid() = user_id
    or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'auditor'))
  );
