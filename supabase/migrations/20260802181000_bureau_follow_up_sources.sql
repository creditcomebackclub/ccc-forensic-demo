-- A saved bureau follow-up must retain the exact prior Phase 3 letter and
-- exact bureau-response upload that the generator used. Lob validates these
-- relationships before accepting a physical-mail submission.

alter table public.letters
  add column if not exists source_phase3_letter_id text,
  add column if not exists source_bureau_response_evidence_id uuid
    references public.response_evidence(id) on delete restrict;

-- Backfill already-saved follow-ups only when their HTML exactly matches a
-- completed follow-up job and both source relationships independently match
-- the same firm/client. Ambiguous or legacy rows remain null and therefore
-- fail closed in Lob until staff regenerates them.
with candidates as (
  select distinct on (follow_up.user_id, follow_up.id)
    follow_up.user_id,
    follow_up.id,
    job.result ->> 'source_letter_id' as source_letter_id,
    evidence.id as source_evidence_id
  from public.letters follow_up
  join public.phase2_jobs job
    on job.user_id = follow_up.user_id
   and job.kind = 'bureau_follow_up'
   and job.status = 'done'
   and job.result ->> 'letterHtml' = follow_up.html
  join public.letters prior
    on prior.user_id = follow_up.user_id
   and prior.id = job.result ->> 'source_letter_id'
   and prior.client_id = follow_up.client_id
   and prior.phase like 'Phase 3%'
  join public.response_evidence evidence
    on evidence.id::text = job.result ->> 'source_evidence_id'
   and evidence.firm_user_id = follow_up.user_id
   and evidence.client_id = follow_up.client_id
   and evidence.letter_id = prior.id
   and evidence.response_kind = 'bureau'
   and evidence.upload_status = 'received'
  where follow_up.phase ilike 'Phase 3%Follow-up%'
    and follow_up.source_phase3_letter_id is null
    and follow_up.source_bureau_response_evidence_id is null
    and prior.id <> follow_up.id
  order by follow_up.user_id, follow_up.id, job.finished_at desc nulls last, job.created_at desc
)
update public.letters follow_up
set
  source_phase3_letter_id = candidates.source_letter_id,
  source_bureau_response_evidence_id = candidates.source_evidence_id
from candidates
where follow_up.user_id = candidates.user_id
  and follow_up.id = candidates.id;

alter table public.letters
  drop constraint if exists letters_follow_up_sources_paired_check;

alter table public.letters
  add constraint letters_follow_up_sources_paired_check
  check (
    (source_phase3_letter_id is null) =
    (source_bureau_response_evidence_id is null)
  );

alter table public.letters
  drop constraint if exists letters_follow_up_source_not_self_check;

alter table public.letters
  add constraint letters_follow_up_source_not_self_check
  check (
    source_phase3_letter_id is null
    or source_phase3_letter_id <> id
  );

create index if not exists letters_source_phase3_letter_id_idx
  on public.letters (source_phase3_letter_id)
  where source_phase3_letter_id is not null;

create index if not exists letters_source_bureau_response_evidence_id_idx
  on public.letters (source_bureau_response_evidence_id)
  where source_bureau_response_evidence_id is not null;

comment on column public.letters.source_phase3_letter_id is
  'Exact prior Phase 3 letter enclosed as Exhibit A for a bureau follow-up.';

comment on column public.letters.source_bureau_response_evidence_id is
  'Exact response_evidence row enclosed as Exhibit B for a bureau follow-up.';
