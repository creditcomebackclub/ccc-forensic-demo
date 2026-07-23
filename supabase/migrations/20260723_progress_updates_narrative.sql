-- Retention Build 1b/1d — adds narrative + email-stamp columns to the
-- existing progress_updates table (created ad hoc in the dashboard SQL
-- editor prior to this migration; additive only, no existing column touched).
alter table public.progress_updates add column if not exists narrative text;
alter table public.progress_updates add column if not exists narrative_generated_at timestamptz;
alter table public.progress_updates add column if not exists narrative_model text;
alter table public.progress_updates add column if not exists emailed_at timestamptz;
