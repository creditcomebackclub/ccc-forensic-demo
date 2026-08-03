-- Manual / legacy apply: same as supabase/migrations/20260803170000_audit_bureau_parses.sql
-- Run in Supabase SQL editor if migrations are applied by hand.

create table if not exists public.audit_bureau_parses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  client_name text not null,
  bureau text not null
    check (bureau = any (array['equifax'::text, 'experian'::text, 'transunion'::text])),
  report_date date not null default (timezone('utc', now()))::date,
  parse jsonb not null,
  source_job_id uuid,
  page_count integer,
  chunk_count integer,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists audit_bureau_parses_user_client_bureau_uidx
  on public.audit_bureau_parses (user_id, client_id, bureau)
  where client_id is not null;

create unique index if not exists audit_bureau_parses_user_name_bureau_uidx
  on public.audit_bureau_parses (user_id, lower(client_name), bureau)
  where client_id is null;

create index if not exists audit_bureau_parses_user_client_idx
  on public.audit_bureau_parses (user_id, client_id, updated_at desc);

alter table public.audit_bureau_parses enable row level security;

drop policy if exists "audit_bureau_parses_select_own_staff" on public.audit_bureau_parses;
create policy "audit_bureau_parses_select_own_staff" on public.audit_bureau_parses
  for select to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'auditor')
    )
  );

drop policy if exists "audit_bureau_parses_delete_own_staff" on public.audit_bureau_parses;
create policy "audit_bureau_parses_delete_own_staff" on public.audit_bureau_parses
  for delete to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'auditor')
    )
  );

grant select, delete on public.audit_bureau_parses to authenticated;
grant all on public.audit_bureau_parses to service_role;

alter table public.audit_jobs
  drop constraint if exists audit_jobs_mode_check;

alter table public.audit_jobs
  add constraint audit_jobs_mode_check
  check (mode = any (array[
    'combined'::text,
    'individual'::text,
    'single'::text,
    'merge'::text
  ]));
