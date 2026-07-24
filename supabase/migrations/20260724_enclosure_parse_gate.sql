-- Phase 3 defect report (2026-07-23), P0-1: the letter generator asserted a
-- specific, load-bearing date claim about a furnisher-enclosed transaction
-- ledger that was never cleanly parsed (mirrored/reversed scan, scrambled
-- OCR row-to-date alignment) — a second factual misstatement to the same
-- furnisher's counsel. This adds the flag phase2-analyze-background.mjs
-- sets when the model's own document-quality self-assessment (see
-- phase2Prompt.js) reports an enclosure it could not reliably read, and
-- that netlify/functions/lob.cjs checks as a hard block before any Lob
-- send — enforced server-side, not just a UI warning that could be
-- clicked past.
alter table public.letters add column if not exists enclosure_parse_blocked boolean not null default false;
alter table public.letters add column if not exists enclosure_parse_issues jsonb not null default '[]'::jsonb;
