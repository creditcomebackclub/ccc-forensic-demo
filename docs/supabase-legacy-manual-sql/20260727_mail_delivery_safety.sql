-- Durable, server-owned state for irreversible physical-mail sends and Lob
-- webhook observability. Letter IDs are legacy text IDs without a reliable
-- foreign key constraint, so they are deliberately stored as text here.

create table if not exists public.mail_submissions (
  id uuid primary key default gen_random_uuid(),
  letter_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  idempotency_key text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'submitted', 'failed', 'accepted_unreconciled')),
  lob_id text unique,
  tracking_number text,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  submitted_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (letter_id)
);

create index if not exists mail_submissions_client_idx
  on public.mail_submissions (client_id, created_at desc);
create index if not exists mail_submissions_status_idx
  on public.mail_submissions (status, updated_at);

alter table public.mail_submissions enable row level security;

drop policy if exists "staff_read_mail_submissions" on public.mail_submissions;
create policy "staff_read_mail_submissions" on public.mail_submissions for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
  )
);

-- We keep an event ledger without storing the signed raw body (which can
-- contain client information). The SHA-256 fingerprint is stable for Lob
-- retries and gives staff an audit trail for every delivery transition.
create table if not exists public.lob_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  lob_id text not null,
  letter_id text,
  event_occurred_at timestamptz,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists lob_webhook_events_lob_idx
  on public.lob_webhook_events (lob_id, received_at desc);
create index if not exists lob_webhook_events_letter_idx
  on public.lob_webhook_events (letter_id, received_at desc);

alter table public.lob_webhook_events enable row level security;

drop policy if exists "staff_read_lob_webhook_events" on public.lob_webhook_events;
create policy "staff_read_lob_webhook_events" on public.lob_webhook_events for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
  )
);
