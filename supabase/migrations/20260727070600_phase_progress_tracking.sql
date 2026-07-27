-- A client-safe snapshot of each confidently diffed account's Phase 1–4
-- lifecycle. The raw response evidence, model analysis, staff notes, and
-- escalation narrative remain in their staff-only tables; this JSON only
-- contains the safe status shown in both the admin comparison and portal.

alter table public.progress_updates
  add column if not exists phase_progress jsonb not null default '[]'::jsonb;

comment on column public.progress_updates.phase_progress is
  'Client-safe Phase 1–4 lifecycle snapshot generated with each report diff.';
