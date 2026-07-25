-- LPOA signature audit trail (IMPROVEMENT_ROADMAP.md 1.2). Under ESIGN Act
-- / CROA, proving a client actually signed this specific document at this
-- specific time matters — and the previous design (a single JSON blob on
-- clients.lpoa_signature_data) had two real gaps: no hash proving the
-- stored HTML wasn't altered after signing, and no history — every
-- re-sign (now routine, since the standalone flow has both a standard and
-- an inquiry-only variant) silently overwrote the prior record instead of
-- superseding it.
--
-- Append-only by design: no update/delete policy for anyone but the
-- service role, so a record, once written, stays evidence.
create table if not exists public.lpoa_audit_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  client_name text not null,
  document_hash text not null,
  document_url text,
  signer_name text,
  ip text,
  user_agent text,
  lpoa_type text not null default 'standard',
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists lpoa_audit_log_client_idx
  on public.lpoa_audit_log (client_id, signed_at desc);

alter table public.lpoa_audit_log enable row level security;

-- Staff (admin/auditor) can read the full history for their own clients —
-- same ownership pattern as every other staff-facing table.
create policy "staff_read_lpoa_audit_log" on public.lpoa_audit_log
  for select using (
    exists (
      select 1 from public.clients c
      join public.profiles p on p.id = auth.uid()
      where c.id = lpoa_audit_log.client_id
        and (p.role = 'admin' or c.user_id = p.id)
    )
  );

-- record-lpoa-audit.cjs (service role) is the only INSERT path — it
-- verifies the caller's own session before writing, and captures ip/
-- user_agent server-side from request headers rather than trusting
-- client-supplied values for either. No insert policy here means the
-- anon/authenticated PostgREST roles cannot write directly; only the
-- service-role key (which bypasses RLS entirely) can.

-- Quick-reference hash of the most recent signed document, for a fast
-- "does this match?" check without joining the full audit log.
alter table public.clients
  add column if not exists lpoa_document_hash text;
