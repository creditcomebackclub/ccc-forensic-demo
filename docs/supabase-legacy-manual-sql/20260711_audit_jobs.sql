-- Audit jobs: status/progress/result store for server-side audit runs
create table if not exists public.audit_jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'queued'
              check (status in ('queued','running','done','error')),
  mode        text not null check (mode in ('combined','individual','single')),
  files       jsonb not null default '[]'::jsonb,
  stage       text,
  pct         numeric,
  tokens      integer not null default 0,
  result      jsonb,
  usage       jsonb,
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);

create index if not exists audit_jobs_user_created_idx
  on public.audit_jobs (user_id, created_at desc);

alter table public.audit_jobs enable row level security;

-- Auditors create and watch their own jobs; ONLY the service role
-- (the background function) may update rows — no update/delete policies.
create policy "audit_jobs_insert_own" on public.audit_jobs
  for insert with check (auth.uid() = user_id);

create policy "audit_jobs_select_own" on public.audit_jobs
  for select using (auth.uid() = user_id);
