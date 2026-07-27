-- Security Hardening: Row Level Security for core data tables
-- Fixes medium severity findings from security audit (Items 5, 6, 7)

-- Helper: Drop existing policies to ensure clean slate
do $$
declare
  t text;
  pol record;
begin
  for t in select unnest(array['audits', 'letters', 'documents', 'clients', 'progress_updates', 'profiles']) loop
    for pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
  end loop;
end $$;

-- Enable RLS
alter table public.audits enable row level security;
alter table public.letters enable row level security;
alter table public.documents enable row level security;
alter table public.clients enable row level security;
alter table public.progress_updates enable row level security;
alter table public.profiles enable row level security;

-- Client read access: match auth.uid() via client_profiles
-- (For 'clients' table, the name column is 'name', for others it's 'client_name')

-- audits
create policy "client_read_own_audits" on public.audits for select using (
  exists (select 1 from public.client_profiles cp where cp.user_id = auth.uid() and cp.full_name = audits.client_name)
);
create policy "staff_all_audits" on public.audits for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role = 'admin' or audits.user_id = p.id))
);

-- letters
create policy "client_read_own_letters" on public.letters for select using (
  exists (select 1 from public.client_profiles cp where cp.user_id = auth.uid() and cp.full_name = letters.client_name)
);
create policy "staff_all_letters" on public.letters for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role = 'admin' or letters.user_id = p.id))
);

-- documents
create policy "client_read_own_documents" on public.documents for select using (
  exists (select 1 from public.client_profiles cp where cp.user_id = auth.uid() and cp.full_name = documents.client_name)
);
create policy "client_insert_own_documents" on public.documents for insert with check (
  exists (select 1 from public.client_profiles cp where cp.user_id = auth.uid() and cp.full_name = documents.client_name)
);
create policy "staff_all_documents" on public.documents for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role = 'admin' or documents.user_id = p.id))
);

-- clients (metadata table)
create policy "client_read_own_meta" on public.clients for select using (
  exists (select 1 from public.client_profiles cp where cp.user_id = auth.uid() and cp.full_name = clients.name)
);
create policy "client_update_own_meta" on public.clients for update using (
  exists (select 1 from public.client_profiles cp where cp.user_id = auth.uid() and cp.full_name = clients.name)
);
create policy "staff_all_clients" on public.clients for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role = 'admin' or clients.user_id = p.id))
);

-- progress_updates
create policy "client_read_own_progress" on public.progress_updates for select using (
  exists (select 1 from public.client_profiles cp where cp.user_id = auth.uid() and cp.full_name = progress_updates.client_name)
);
create policy "staff_all_progress" on public.progress_updates for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role = 'admin' or progress_updates.user_id = p.id))
);

-- profiles (staff table)
-- Anyone authenticated can read profiles (needed for avatar names/roles)
create policy "read_all_profiles" on public.profiles for select using (
  auth.role() = 'authenticated'
);
-- ONLY admins can update profiles (prevents client-side role elevation)
create policy "admin_update_profiles" on public.profiles for update using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
-- Users can insert their own profile on signup
create policy "insert_own_profile" on public.profiles for insert with check (
  auth.uid() = id
);
