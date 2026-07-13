-- client_profiles had no working row-level security: any authenticated
-- user (any client, or a bare self-signup through the auditor signup form)
-- could SELECT every client's profile (DOB, phone, address, signature
-- image, LPOA/agreement paths, partial card info via nmi_vault_id/
-- card_last4/card_type/card_expiry), INSERT arbitrary rows, and UPDATE any
-- other client's row. Verified empirically on 2026-07-14 — all three
-- succeeded for an unrelated throwaway account with no client_profiles or
-- profiles row of its own.
--
-- This drops ALL existing policies on the table (by querying pg_policies,
-- not by guessing names — a prior manual fix attempt left stale permissive
-- policies in place alongside a new one, since Postgres OR-combines
-- multiple policies for the same command) and replaces them with a single
-- "own row or staff" rule per operation. Staff = has a row in public.profiles
-- (the admin/auditor identity table already used elsewhere in the app).
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'client_profiles'
  loop
    execute format('drop policy %I on public.client_profiles', pol.policyname);
  end loop;
end $$;

alter table public.client_profiles enable row level security;

create policy "client_profiles_select_own_or_staff" on public.client_profiles
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles where id = auth.uid())
  );

create policy "client_profiles_insert_own_or_staff" on public.client_profiles
  for insert with check (
    auth.uid() = user_id
    or exists (select 1 from public.profiles where id = auth.uid())
  );

create policy "client_profiles_update_own_or_staff" on public.client_profiles
  for update using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles where id = auth.uid())
  ) with check (
    auth.uid() = user_id
    or exists (select 1 from public.profiles where id = auth.uid())
  );

-- No delete policy — nothing in the app deletes client_profiles rows today;
-- omitting it means only the service role (which bypasses RLS) can delete.
