-- Phase 2 jobs: status/progress/result store for server-side response
-- analysis, mirroring audit_jobs (20260711). Moves the Anthropic API call
-- out of the browser (which read a client-managed key from localStorage)
-- onto the server, using the same ANTHROPIC_API_KEY env var the audit
-- pipeline already uses.
create table if not exists public.phase2_jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'queued'
              check (status in ('queued','running','done','error')),
  letter_id   text not null,
  kind        text not null check (kind in ('response','non_response')),
  -- files holds [{path, fileName}] entries in the responses storage bucket, in page order
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

create index if not exists phase2_jobs_user_created_idx
  on public.phase2_jobs (user_id, created_at desc);

alter table public.phase2_jobs enable row level security;

-- Auditors create and watch their own jobs; ONLY the service role
-- (the background function) may update rows — no update/delete policies.
create policy "phase2_jobs_insert_own" on public.phase2_jobs
  for insert with check (auth.uid() = user_id);

create policy "phase2_jobs_select_own" on public.phase2_jobs
  for select using (auth.uid() = user_id);
