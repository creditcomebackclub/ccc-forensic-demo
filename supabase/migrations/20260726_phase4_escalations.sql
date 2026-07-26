-- Phase 4: CFPB / state-AG escalation tracking. Purely additive — two new
-- tables, no changes to any existing column, index, or policy.
--
-- ag_directory is a reference table (staff-readable, not client-facing) of
-- how each state's consumer-complaint channel actually works. Seeded from
-- research done 2026-07-26 (see memory: ccc-phase4-state-ag-matrix). Two
-- things that research surfaced which shape this schema directly:
--   1. It is NOT always the Attorney General — Utah's consumer complaints go
--      to the Division of Consumer Protection under the Dept. of Commerce.
--      agency_name is a real column, not assumed to be "<State> AG".
--   2. Not one of the 8 researched offices publishes whether it actually
--      works FCRA/credit-reporting complaints (California explicitly
--      reserves the right to refer elsewhere). fcra_scope_confirmed
--      defaults false so the UI can surface "unconfirmed — call first"
--      instead of silently implying every state is equally reliable.
--
-- escalations tracks each individual CFPB or state-AG filing. Two hard
-- constraints from that same research, both load-bearing:
--   - One company per complaint (CFPB's own complaint DB carries a single
--     scalar `company` per complaint_id; Florida's AG form says "Only one
--     business per complaint form"). So this is per-furnisher/per-bureau,
--     never per-client — there is no client-level "one big complaint" row.
--   - CRA-directed and furnisher-directed complaints are different tracks
--     with different prerequisites: a CRA-directed CFPB complaint requires
--     45 days (or a no-longer-pending dispute) under 15 U.S.C. §1681i(a)&(e)
--     before it's fileable at all; furnisher-directed complaints carry no
--     equivalent statutory gate. `track` records which rule applies so the
--     app never has to guess later.

create table if not exists public.ag_directory (
  id uuid primary key default gen_random_uuid(),
  state text not null,                        -- 2-letter, e.g. 'UT'
  agency_name text not null,                   -- real name, not assumed "<State> AG"
  portal_url text,
  mail_address text,                           -- null where not yet researched/published
  attachment_notes text,                       -- e.g. '.jpg/.pdf only, 10MB per file'
  fcra_scope_confirmed boolean not null default false,
  source_notes text,                           -- citation/provenance — never blank per the
                                                -- same cite-or-stop discipline as Metro 2 fields
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ag_directory_state_agency_idx on public.ag_directory (state, agency_name);

create table if not exists public.escalations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,                       -- staff owner, matches every other table's RLS shape
  client_id uuid references public.clients(id) on delete cascade,
  client_account_id uuid references public.client_accounts(id) on delete set null,
  phase3_letter_id uuid references public.letters(id) on delete set null,
  track text not null check (track in ('furnisher', 'bureau')),
  channel text not null check (channel in ('cfpb', 'state_ag')),
  state text,                                  -- state_ag channel only; which ag_directory row applies
  furnisher_name text not null,
  status text not null default 'draft' check (status in ('draft', 'ready', 'filed', 'responded', 'closed')),
  cfpb_category text,                          -- plain text, not an enum: CFPB's own picklist changes
  cfpb_sub_issue text,                         -- (confirmed live 2026-07-26 — the product label had
                                                -- already changed once), a DB enum would need a
                                                -- migration every time their form does
  narrative text,
  attachments jsonb not null default '[]'::jsonb,  -- pointers into existing storage, not new files
  filed_at timestamptz,
  response_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists escalations_client_id_idx on public.escalations (client_id);
create index if not exists escalations_user_id_idx on public.escalations (user_id);

alter table public.ag_directory enable row level security;
alter table public.escalations enable row level security;

-- ag_directory: staff-readable reference data, no client-facing policy at
-- all (matches profiles' read_all_profiles precedent for staff-only tables).
create policy "staff_read_ag_directory" on public.ag_directory for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor'))
);
create policy "staff_write_ag_directory" on public.ag_directory for insert with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "staff_update_ag_directory" on public.ag_directory for update using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- escalations: same staff_all_* shape as audits/letters/documents. No
-- client-facing policy — this table isn't shown in the client portal.
create policy "staff_all_escalations" on public.escalations for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role = 'admin' or escalations.user_id = p.id))
);

-- Seed ag_directory with the 8 states researched 2026-07-26 for current
-- clients (AL, AZ, CA, FL, GA, IN, TN, UT). All 8 have an online portal —
-- none of these clients needs the Lob-mail branch originally scoped.
insert into public.ag_directory (state, agency_name, portal_url, mail_address, attachment_notes, fcra_scope_confirmed, source_notes) values
('AL', 'Alabama Attorney General — Consumer Interest Division', 'https://www.alabamaag.gov/consumer-complaint/', null, '.jpg/.pdf only, 10MB per file. Supplements to ConsumerInterest@AlabamaAG.gov.', false, 'alabamaag.gov/consumer-complaint, researched 2026-07-26. States filing "is not a legal action." No published subject-matter scope.'),
('AZ', 'Arizona Attorney General — Consumer Information & Complaints', 'https://consumer-complaint.azag.gov/', '2005 N Central Ave, Attn: Consumer Information and Complaints, Phoenix, AZ 85004', 'Fax 602-542-4579.', false, 'azag.gov, researched 2026-07-26. NOTE: 2005 N Central Ave is current — 1275 W. Washington is a stale/old address, do not use.'),
('CA', 'California Attorney General — Public Inquiry Unit', 'https://oag.ca.gov/contact/consumer-complaint-against-business-or-company', null, null, false, 'oag.ca.gov, researched 2026-07-26. Explicitly reserves the right to refer the complaint to another agency — lowest-confidence of the 8 for actually working an FCRA complaint.'),
('FL', 'Florida Attorney General — Consumer Protection Division', 'https://www.myfloridalegal.com/consumer-protection/consumer-complaint-form', 'Office of the Attorney General, PL-01 The Capitol, Tallahassee, FL 32399-1050', 'Only one business per complaint form (independently confirms the CFPB one-company-per-complaint finding). Copies only, not originals.', false, 'myfloridalegal.com, researched 2026-07-26.'),
('GA', 'Georgia Attorney General — Consumer Protection Division', 'https://consumer.georgia.gov/resolve-your-dispute/how-do-i-file-complaint', null, 'Max 3 attachments, 10MB total online. Fax ≤5 pages. Requires chronological narrative + supporting documents.', false, 'consumer.georgia.gov, researched 2026-07-26. Fax 404-651-9018.'),
('IN', 'Indiana Attorney General — Consumer Protection Division', 'https://inoag.my.site.com/ConsumerComplaintOnlineOAG/s/', null, null, false, 'in.gov/attorneygeneral, researched 2026-07-26. Salesforce-hosted complaint portal.'),
('TN', 'Tennessee Division of Consumer Affairs (housed in the AG''s office)', 'https://www.tn.gov/attorneygeneral/working-for-tennessee/consumer/file-a-complaint.html', 'Tennessee Division of Consumer Affairs, Tennessee Attorney General''s Office, P.O. Box 20207, Nashville, TN 37202-0207', null, false, 'tn.gov/attorneygeneral, researched 2026-07-26. consumer.affairs@ag.tn.gov.'),
('UT', 'Utah Division of Consumer Protection (Dept. of Commerce — NOT the Attorney General)', 'https://services.dcp.utah.gov/s/', '160 East 300 South, PO Box 146704, Salt Lake City, UT 84114', null, false, 'dcp.utah.gov, researched 2026-07-26. A source-given ZIP+4 (84114-6741) did not correspond to box 146704 — do not use a +4 here without independently confirming it.')
on conflict (state, agency_name) do nothing;
