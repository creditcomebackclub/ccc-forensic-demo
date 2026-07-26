-- escalations.narrative only had room for one narrative, but
-- phase4Prompt.js's PHASE4_SCHEMA generates both a CFPB-specific narrative
-- and an agency-agnostic one for state AG forms (they're framed
-- differently — see phase4Prompt.js's TRACK-SPECIFIC FRAMING). Missed this
-- when the original table was designed. `narrative` continues to hold the
-- CFPB narrative (unchanged, no data migration needed since the table was
-- just created and is still empty); this adds the other two output fields.
alter table public.escalations add column if not exists ag_narrative text;
alter table public.escalations add column if not exists key_facts jsonb not null default '[]'::jsonb;
alter table public.escalations add column if not exists recommended_attachments jsonb not null default '[]'::jsonb;
