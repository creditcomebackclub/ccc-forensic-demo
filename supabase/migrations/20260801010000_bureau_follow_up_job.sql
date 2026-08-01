-- Allow phase2_jobs to run bureau follow-up letter drafting after staff
-- chooses "Continue with bureau follow-up" in BureauResponseReview.

alter table public.phase2_jobs drop constraint if exists phase2_jobs_kind_check;
alter table public.phase2_jobs add constraint phase2_jobs_kind_check
  check (kind in ('response', 'non_response', 'bureau_response', 'bureau_follow_up'));
