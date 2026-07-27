-- Phase 4 jobs: status/progress/result store for server-side CFPB/AG
-- narrative generation, mirroring phase2_jobs (20260713) exactly. Same
-- reasoning: keeps ANTHROPIC_API_KEY server-side only, browser never sees it.
create table if not exists public.phase4_jobs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'queued'
               check (status in ('queued','running','done','error')),
  escalation_id uuid not null references public.escalations(id) on delete cascade,
  stage        text,
  pct          numeric,
  tokens       integer not null default 0,
  result       jsonb,
  usage        jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);

create index if not exists phase4_jobs_user_created_idx
  on public.phase4_jobs (user_id, created_at desc);

alter table public.phase4_jobs enable row level security;

-- Same shape as phase2_jobs: staff create/watch their own jobs, only the
-- service role (the background function) updates rows.
drop policy if exists "phase4_jobs_insert_own" on public.phase4_jobs;
create policy "phase4_jobs_insert_own" on public.phase4_jobs
  for insert with check (auth.uid() = user_id);

drop policy if exists "phase4_jobs_select_own" on public.phase4_jobs;
create policy "phase4_jobs_select_own" on public.phase4_jobs
  for select using (auth.uid() = user_id);
