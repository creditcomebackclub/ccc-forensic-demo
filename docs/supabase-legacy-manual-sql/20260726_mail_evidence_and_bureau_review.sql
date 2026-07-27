-- Immutable evidence for physical mail and an explicit staff decision after
-- a Phase 3 bureau response. These changes are additive: historical letters
-- continue to work, and only newly archived Lob artifacts appear as evidence.

create table if not exists public.mail_artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  letter_id text not null,
  lob_id text not null,
  artifact_type text not null check (artifact_type in ('mailpiece_pdf', 'return_receipt')),
  storage_bucket text not null default 'documents',
  storage_path text not null,
  content_type text,
  byte_size bigint,
  sha256 text,
  status text not null default 'archived' check (status in ('archived', 'unavailable', 'error')),
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lob_id, artifact_type)
);

create index if not exists mail_artifacts_letter_id_idx on public.mail_artifacts (letter_id);
create index if not exists mail_artifacts_client_id_idx on public.mail_artifacts (client_id);

alter table public.mail_artifacts enable row level security;

drop policy if exists "staff_read_mail_artifacts" on public.mail_artifacts;
create policy "staff_read_mail_artifacts" on public.mail_artifacts for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
  )
);

-- Service-role functions archive mailpieces. Staff can update a status only
-- when an archive needs manual reconciliation; clients never receive access.
drop policy if exists "staff_update_mail_artifacts" on public.mail_artifacts;
create policy "staff_update_mail_artifacts" on public.mail_artifacts for update using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
  )
);

alter table public.letters
  add column if not exists bureau_review_status text not null default 'not_reviewed'
    check (bureau_review_status in ('not_reviewed', 'resolved', 'follow_up', 'needs_documents', 'escalated')),
  add column if not exists bureau_next_action text,
  add column if not exists bureau_review_notes text,
  add column if not exists bureau_reviewed_at timestamptz;

-- Existing Phase 4 records are already an explicit escalation decision. Mark
-- their linked Phase 3 rows so the queue does not keep presenting them as
-- unworked after this release.
update public.letters l
set bureau_review_status = 'escalated',
    bureau_next_action = 'escalation',
    bureau_reviewed_at = coalesce(l.bureau_reviewed_at, e.created_at)
from public.escalations e
where e.phase3_letter_id = l.id
  and l.phase like 'Phase 3%'
  and l.bureau_review_status = 'not_reviewed';
