-- Phase 3 defect report (2026-07-23). Generic "this letter needs a human
-- before it can be sent" gate, covering two cases so far:
-- P0-1: the letter generator asserted a specific, load-bearing date claim
--   about a furnisher-enclosed transaction ledger that was never cleanly
--   parsed (mirrored/reversed scan, scrambled OCR row-to-date alignment) —
--   a second factual misstatement to the same furnisher's counsel.
-- P1-2c: a citation lint that blocks any Phase 3 CRA letter that slipped a
--   §1681s-2(a) citation back in despite the prompt instruction not to —
--   that subsection has already been used as an exploitable flank by
--   opposing counsel once.
-- phase2-analyze-background.mjs sets this flag from the model's own
-- document-quality self-assessment (phase2Prompt.js) and a scan of the
-- generated letter HTML; netlify/functions/lob.cjs checks it as a hard
-- block before any Lob send — enforced server-side, not just a UI warning
-- that could be clicked past.
alter table public.letters add column if not exists enclosure_parse_blocked boolean not null default false;
alter table public.letters add column if not exists enclosure_parse_issues jsonb not null default '[]'::jsonb;
