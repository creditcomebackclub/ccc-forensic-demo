-- Phase 2 analysis persistence: the full analysis JSON (classification,
-- demand-by-demand table, admissions, phase3Leverage, generated letters)
-- is stored on the Phase 1 letter row it analyzed — previously only the
-- summary survived, on the Phase 3 rows. Written by ResponseAnalyzer via
-- storage.updateLetter(); read back by normalizeLetter() so reopening the
-- analyzer shows the stored analysis without re-running it.
alter table public.letters
  add column if not exists phase2_analysis jsonb,
  add column if not exists phase2_analyzed_at timestamptz;
