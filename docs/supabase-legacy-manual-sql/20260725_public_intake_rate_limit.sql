-- Backing store for public-intake.cjs's per-IP rate limiting. Netlify
-- functions have no shared memory between invocations, so counting recent
-- attempts has to live somewhere persistent. Purely internal bookkeeping —
-- no client-facing reads/writes, service role only.
create table if not exists public.public_intake_attempts (
  id uuid primary key default gen_random_uuid(),
  ip text not null,
  created_at timestamptz not null default now()
);

create index if not exists public_intake_attempts_ip_created_idx
  on public.public_intake_attempts (ip, created_at desc);

alter table public.public_intake_attempts enable row level security;
-- No policies at all: RLS enabled with zero policies denies every request
-- through the anon/authenticated PostgREST roles. Only the service-role
-- key (used exclusively by public-intake.cjs) can read/write this table.
