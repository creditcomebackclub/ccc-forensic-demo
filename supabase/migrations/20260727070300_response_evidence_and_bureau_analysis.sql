-- Response evidence is deliberately separate from letters. A letter is the
-- campaign record; a response can arrive more than once, be re-analyzed, and
-- contain staff-only findings. Keeping the uploaded files and their analysis
-- here makes that history durable without giving a client permission to patch
-- a letter row directly.

create table if not exists public.response_evidence (
  id uuid primary key default gen_random_uuid(),
  firm_user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  client_account_id uuid references public.client_accounts(id) on delete set null,
  client_name text not null,
  letter_id text not null,
  response_kind text not null check (response_kind in ('furnisher', 'bureau')),
  source text not null default 'client_portal'
    check (source in ('client_portal', 'staff_upload', 'legacy_import')),
  storage_bucket text not null default 'responses',
  storage_paths jsonb not null default '[]'::jsonb,
  file_names jsonb not null default '[]'::jsonb,
  upload_status text not null default 'uploading'
    check (upload_status in ('uploading', 'received', 'error')),
  received_at timestamptz,
  submitted_by uuid references auth.users(id) on delete set null,
  analysis_status text not null default 'not_started'
    check (analysis_status in ('not_started', 'running', 'analyzed', 'error')),
  analysis jsonb,
  analyzed_at timestamptz,
  document_quality jsonb,
  review_status text not null default 'not_reviewed'
    check (review_status in ('not_reviewed', 'resolved', 'follow_up', 'needs_documents', 'escalated')),
  review_notes text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(storage_paths) = 'array'),
  check (jsonb_typeof(file_names) = 'array')
);

create index if not exists response_evidence_letter_created_idx
  on public.response_evidence (letter_id, created_at desc);
create index if not exists response_evidence_client_created_idx
  on public.response_evidence (client_id, created_at desc);
create index if not exists response_evidence_client_account_created_idx
  on public.response_evidence (client_account_id, created_at desc);
create index if not exists response_evidence_firm_status_idx
  on public.response_evidence (firm_user_id, upload_status, analysis_status);

alter table public.response_evidence enable row level security;

-- Evidence includes uploaded mail, model findings, and staff notes. Every
-- authenticated staff role needs the same case packet to review, analyze, and
-- assemble Phase 3 exhibits; clients receive status through the existing
-- letter record, never raw evidence rows.
drop policy if exists "staff_all_response_evidence" on public.response_evidence;
create policy "staff_all_response_evidence" on public.response_evidence for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
    )
  );

-- Phase 3 has a client-safe status field. The full bureau analysis and staff
-- notes live exclusively in response_evidence above.
alter table public.letters
  add column if not exists bureau_response_status text not null default 'not_received'
    check (bureau_response_status in ('not_received', 'received', 'analyzing', 'review_ready', 'reviewed')),
  add column if not exists bureau_response_received_at timestamptz,
  add column if not exists bureau_response_analyzed_at timestamptz;

-- A browser-created analysis job can point to one immutable evidence record.
-- The service function verifies the relationship before reading the file.
alter table public.phase2_jobs
  add column if not exists response_evidence_id uuid references public.response_evidence(id) on delete set null;

alter table public.phase2_jobs drop constraint if exists phase2_jobs_kind_check;
alter table public.phase2_jobs add constraint phase2_jobs_kind_check
  check (kind in ('response', 'non_response', 'bureau_response'));

-- `responses` must remain a private bucket. New uploads are issued through a
-- short-lived signed-upload URL after the server has authenticated the client
-- and verified the target letter. Staff retain the direct storage permissions
-- needed for analysis and Lob exhibit preparation; clients receive no broad
-- storage-object policy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'responses',
  'responses',
  false,
  26214400,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "staff_read_responses" on storage.objects;
create policy "staff_read_responses" on storage.objects for select using (
  bucket_id = 'responses'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
  )
);

drop policy if exists "staff_insert_responses" on storage.objects;
create policy "staff_insert_responses" on storage.objects for insert with check (
  bucket_id = 'responses'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
  )
);

drop policy if exists "staff_update_responses" on storage.objects;
create policy "staff_update_responses" on storage.objects for update using (
  bucket_id = 'responses'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
  )
)
with check (
  bucket_id = 'responses'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
  )
);

drop policy if exists "staff_delete_responses" on storage.objects;
create policy "staff_delete_responses" on storage.objects for delete using (
  bucket_id = 'responses'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
  )
);

-- Clients have always been read-only on letters. Make a future permissive
-- policy explicitly impossible to carry forward with this workflow: uploads
-- now go through response-evidence.cjs, which resolves the caller's own
-- letter server-side and patches only response state.
drop policy if exists "client_update_own_letters" on public.letters;
drop policy if exists "client_write_own_letters" on public.letters;
