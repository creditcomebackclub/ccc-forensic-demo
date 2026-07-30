-- Closes 6 of 7 Security Advisor findings (2026-07-30). The 7th (Leaked
-- Password Protection) is an Auth dashboard toggle, not schema — no SQL fix
-- exists for it.

-- 1. Function Search Path Mutable — public.handle_new_user
-- protect_client_columns() already pins search_path; this one never did.
-- Body already fully-qualifies every reference (public.client_profiles,
-- public.profiles), so pinning search_path changes nothing functionally —
-- it only removes the theoretical resolution-shadowing risk a SECURITY
-- DEFINER function has without one.
create or replace function public.handle_new_user() returns trigger
    language plpgsql security definer
    set search_path to 'public'
    as $$
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

    return new;
  end;
  $$;

-- 2, 4, 5, 7 — Public/signed-in EXECUTE on the two SECURITY DEFINER trigger
-- functions. Both are RETURNS trigger and reference new/old, which only
-- exist inside an actual trigger firing — calling either directly via
-- /rest/v1/rpc/<name> errors out rather than executing, so this was closer
-- to theoretical than live-exploitable. Revoking anyway: triggers invoke
-- via the trigger mechanism, not a role's own EXECUTE grant, so this has
-- zero effect on handle_new_user firing on signup or protect_client_columns
-- firing on client updates.
revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke execute on function public.protect_client_columns() from anon, authenticated, public;

-- 3. Public Bucket Allows Listing — storage.lpoa
-- Public buckets serve objects by URL without needing a SELECT policy at
-- all (that's what "public" already means for storage.objects) — this
-- policy only ever added the ability to LIST/enumerate every file in the
-- bucket, never anything the app's own public-URL reads required. Exact
-- policy name from Supabase's advisor; if-exists guard makes this safe to
-- run even if the name doesn't match live.
drop policy if exists "Public read lpoa files" on storage.objects;
