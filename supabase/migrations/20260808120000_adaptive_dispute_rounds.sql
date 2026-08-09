-- Adaptive dispute rounds. This migration is additive: legacy `phase` and
-- bureau-follow-up columns remain readable during the structured cutover.

create table if not exists public.dispute_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  client_account_id uuid not null references public.client_accounts(id) on delete restrict,
  round_number integer not null check (round_number > 0),
  target_type text not null check (target_type in ('furnisher', 'bureau')),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  final_disposition text check (final_disposition is null or final_disposition in ('resolved', 'next_round', 'escalate')),
  final_notes text,
  opened_at timestamptz not null default now(),
  opened_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancel_reason text,
  close_prompted_at timestamptz,
  mailed_email_queued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_account_id, round_number),
  check (
    (status = 'open' and closed_at is null and cancelled_at is null and final_disposition is null)
    or (status = 'closed' and closed_at is not null and cancelled_at is null and final_disposition is not null)
    or (status = 'cancelled' and cancelled_at is not null and closed_at is null and final_disposition is null)
  )
);

create unique index if not exists dispute_rounds_one_open_per_account_idx
  on public.dispute_rounds (user_id, client_account_id)
  where status = 'open';
create index if not exists dispute_rounds_client_status_idx
  on public.dispute_rounds (client_id, status, updated_at desc);
create index if not exists dispute_rounds_account_number_idx
  on public.dispute_rounds (client_account_id, round_number desc);

alter table public.dispute_rounds enable row level security;
drop policy if exists "staff_read_dispute_rounds" on public.dispute_rounds;
create policy "staff_read_dispute_rounds" on public.dispute_rounds for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'auditor')
      and (p.role = 'admin' or dispute_rounds.user_id = p.id)
  )
);
drop policy if exists "client_read_own_dispute_rounds" on public.dispute_rounds;
-- Clients must not receive final_notes/cancel_reason through a permissive
-- table policy. A safe filtered status view is defined below instead.

alter table public.letters
  add column if not exists round_id uuid references public.dispute_rounds(id) on delete restrict,
  add column if not exists round_number integer,
  add column if not exists letter_kind text,
  add column if not exists target_type text,
  add column if not exists target_bureau text,
  add column if not exists response_due_at timestamptz,
  add column if not exists response_window_extension_days integer not null default 0,
  add column if not exists response_window_extended_at timestamptz,
  add column if not exists response_window_extended_by uuid references auth.users(id) on delete set null,
  add column if not exists response_window_extension_reason text,
  add column if not exists round_review_status text,
  add column if not exists round_next_action text,
  add column if not exists round_reviewed_at timestamptz,
  add column if not exists round_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists legacy_reconciliation_status text,
  add column if not exists legacy_reconciled_at timestamptz,
  add column if not exists legacy_reconciled_by uuid references auth.users(id) on delete set null,
  add column if not exists legacy_reconciliation_notes text;

alter table public.letters
  drop constraint if exists letters_round_number_check,
  add constraint letters_round_number_check check (round_number is null or round_number > 0),
  drop constraint if exists letters_letter_kind_check,
  add constraint letters_letter_kind_check check (letter_kind is null or letter_kind in ('dispute', 'file_update', 'legacy_escalation')),
  drop constraint if exists letters_target_type_structured_check,
  add constraint letters_target_type_structured_check check (target_type is null or target_type in ('furnisher', 'bureau')),
  drop constraint if exists letters_target_bureau_check,
  add constraint letters_target_bureau_check check (target_bureau is null or target_bureau in ('equifax', 'experian', 'transunion')),
  drop constraint if exists letters_target_bureau_pairing_check,
  add constraint letters_target_bureau_pairing_check check (
    (target_type = 'bureau' and target_bureau is not null)
    or (target_type is distinct from 'bureau' and target_bureau is null)
  ) not valid,
  drop constraint if exists letters_round_pairing_check,
  add constraint letters_round_pairing_check check (
    (round_id is null and round_number is null)
    or (round_id is not null and round_number is not null and letter_kind = 'dispute' and target_type is not null)
  ) not valid,
  drop constraint if exists letters_response_window_extension_check,
  add constraint letters_response_window_extension_check check (response_window_extension_days in (0, 15)),
  drop constraint if exists letters_response_window_extension_pairing_check,
  add constraint letters_response_window_extension_pairing_check check (
    (response_window_extension_days = 0 and response_window_extended_at is null and response_window_extension_reason is null)
    or (response_window_extension_days = 15 and response_window_extended_at is not null and nullif(btrim(response_window_extension_reason), '') is not null)
  ),
  drop constraint if exists letters_round_review_status_check,
  add constraint letters_round_review_status_check check (
    round_review_status is null or round_review_status in ('not_reviewed', 'resolved', 'follow_up', 'needs_documents', 'escalated')
  ),
  drop constraint if exists letters_round_next_action_check,
  add constraint letters_round_next_action_check check (
    round_next_action is null or round_next_action in ('resolved', 'next_round', 'needs_documents', 'escalate')
  ),
  drop constraint if exists letters_legacy_reconciliation_status_check,
  add constraint letters_legacy_reconciliation_status_check check (
    legacy_reconciliation_status is null or legacy_reconciliation_status in ('pending', 'linked', 'excluded')
  );

create index if not exists letters_round_id_idx on public.letters (round_id);
create index if not exists letters_structured_target_idx
  on public.letters (target_type, target_bureau, saved_at desc);
create index if not exists letters_response_due_idx
  on public.letters (response_due_at, id)
  where mailed_date is not null and response_outcome is null;
create index if not exists letters_legacy_reconciliation_idx
  on public.letters (client_id, legacy_reconciliation_status)
  where client_account_id is null and letter_kind = 'dispute';

create table if not exists public.letter_source_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  letter_id text not null,
  source_letter_id text not null,
  response_evidence_id uuid references public.response_evidence(id) on delete restrict,
  apply_to_bureau text check (apply_to_bureau is null or apply_to_bureau in ('equifax', 'experian', 'transunion')),
  source_order integer not null default 0 check (source_order >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (user_id, letter_id) references public.letters(user_id, id) on delete cascade,
  foreign key (user_id, source_letter_id) references public.letters(user_id, id) on delete restrict,
  unique (user_id, letter_id, source_letter_id, response_evidence_id),
  check (letter_id <> source_letter_id)
);
create index if not exists letter_source_links_letter_idx
  on public.letter_source_links (user_id, letter_id, source_order, created_at);
alter table public.letter_source_links enable row level security;
drop policy if exists "staff_read_letter_source_links" on public.letter_source_links;
create policy "staff_read_letter_source_links" on public.letter_source_links for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
      and (p.role = 'admin' or letter_source_links.user_id = p.id)
  )
);

create table if not exists public.letter_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  letter_id text not null,
  document_id uuid not null references public.documents(id) on delete restrict,
  mail_submission_id uuid references public.mail_submissions(id) on delete restrict,
  storage_path text not null,
  file_name text not null,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  page_count integer check (page_count is null or page_count > 0),
  sha256 text,
  included_by uuid references auth.users(id) on delete set null,
  included_at timestamptz not null default now(),
  foreign key (user_id, letter_id) references public.letters(user_id, id) on delete restrict,
  unique (user_id, letter_id, document_id, mail_submission_id)
);
create index if not exists letter_attachments_letter_idx
  on public.letter_attachments (user_id, letter_id, included_at);
alter table public.letter_attachments enable row level security;
drop policy if exists "staff_read_letter_attachments" on public.letter_attachments;
create policy "staff_read_letter_attachments" on public.letter_attachments for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
      and (p.role = 'admin' or letter_attachments.user_id = p.id)
  )
);

alter table public.mail_submissions
  add column if not exists attachment_manifest jsonb not null default '[]'::jsonb;

create table if not exists public.client_email_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null,
  event_type text,
  subject_template text not null,
  body_template text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.client_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  round_id uuid references public.dispute_rounds(id) on delete set null,
  sent_by uuid references auth.users(id) on delete set null,
  template_id uuid references public.client_email_templates(id) on delete set null,
  event_type text,
  event_key text,
  subject text not null,
  body_html text not null,
  body_text text not null,
  resend_email_id text,
  send_status text not null default 'queued' check (send_status in ('queued', 'sending', 'sent', 'failed')),
  delivery_status text,
  delivery_event_at timestamptz,
  delivery_error text,
  delivered_at timestamptz,
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  idempotency_key text not null default gen_random_uuid()::text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (idempotency_key)
);
create unique index if not exists client_emails_event_key_uidx
  on public.client_emails (user_id, event_key)
  where event_key is not null;
create index if not exists client_emails_client_created_idx
  on public.client_emails (client_id, created_at desc);
create index if not exists client_emails_queue_idx
  on public.client_emails (send_status, created_at)
  where send_status in ('queued', 'failed');

alter table public.client_email_templates enable row level security;
alter table public.client_emails enable row level security;
drop policy if exists "staff_manage_client_email_templates" on public.client_email_templates;
create policy "staff_manage_client_email_templates" on public.client_email_templates for all to authenticated
using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor') and (p.role = 'admin' or client_email_templates.user_id = p.id))
)
with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor') and (p.role = 'admin' or client_email_templates.user_id = p.id))
);
drop policy if exists "staff_read_client_emails" on public.client_emails;
create policy "staff_read_client_emails" on public.client_emails for select to authenticated
using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor') and (p.role = 'admin' or client_emails.user_id = p.id))
);

create or replace function public.seed_client_email_templates(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.client_email_templates (user_id, name, category, event_type, subject_template, body_template)
  values
    (p_user_id, 'Round prepared', 'round', 'next_round_prepared', 'Round {{round.number}} is prepared for review', E'Hi {{client.name}},\n\nWe prepared Round {{round.number}} of your dispute campaign. Our team will review the letters and mailing packet before anything is sent.\n\nYou do not need to take action right now.'),
    (p_user_id, 'Round mailed — furnisher', 'round', 'round_mailed:furnisher', 'Round {{round.number}} has been mailed', E'Hi {{client.name}},\n\nEvery direct-furnisher letter in Round {{round.number}} has now been mailed by certified mail. We will monitor delivery and the response window.\n\nIf a response arrives at your home, please upload every page in your portal.'),
    (p_user_id, 'Round mailed — bureau', 'round', 'round_mailed:bureau', 'Round {{round.number}} has been mailed', E'Hi {{client.name}},\n\nEvery selected credit-bureau letter in Round {{round.number}} has now been mailed by certified mail. We will monitor each delivery and response window.\n\nIf a response arrives at your home, please upload every page in your portal.'),
    (p_user_id, 'First response received', 'round', 'first_response_received', 'We received a response for Round {{round.number}}', E'Hi {{client.name}},\n\nA response connected to Round {{round.number}} has been received. Our forensic review will compare it with the exact disputes and evidence in that round before we decide what happens next.\n\nNo action is needed unless we ask for a specific document.'),
    (p_user_id, 'Documents needed', 'round', 'documents_needed', 'Documents needed for Round {{round.number}}', E'Hi {{client.name}},\n\nOur review of Round {{round.number}} identified documents we need from you before we can make the next decision. Please open your portal for the request and upload only the requested items.'),
    (p_user_id, 'Round resolved', 'round', 'round_resolved', 'Round {{round.number}} review is complete', E'Hi {{client.name}},\n\nWe completed our review of every response and nonresponse in Round {{round.number}}. This account''s dispute campaign is now marked resolved. You can view the current status in your portal.'),
    (p_user_id, 'Escalation ready', 'round', 'escalation_ready', 'Round {{round.number}} is ready for escalation review', E'Hi {{client.name}},\n\nWe completed the response review for Round {{round.number}} and marked the record ready for escalation review. This does not mean a complaint or legal filing has been submitted. Our team will review the available path and contact you if anything is needed.')
  on conflict (user_id, name) do nothing;
end;
$$;

do $$
declare staff_row record;
begin
  for staff_row in select id from public.profiles where role in ('admin', 'auditor') loop
    perform public.seed_client_email_templates(staff_row.id);
  end loop;
end;
$$;

create or replace function public.seed_client_email_templates_on_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role in ('admin', 'auditor') then perform public.seed_client_email_templates(new.id); end if;
  return new;
end;
$$;
drop trigger if exists seed_client_email_templates_after_profile on public.profiles;
create trigger seed_client_email_templates_after_profile
after insert or update of role on public.profiles
for each row execute function public.seed_client_email_templates_on_profile();
revoke all on function public.seed_client_email_templates(uuid) from public, anon, authenticated;
revoke all on function public.seed_client_email_templates_on_profile() from public, anon, authenticated;

-- Non-response evidence is durable evidence without uploaded pages.
alter table public.response_evidence
  add column if not exists evidence_kind text not null default 'document_response';
alter table public.response_evidence
  drop constraint if exists response_evidence_evidence_kind_check,
  add constraint response_evidence_evidence_kind_check
    check (evidence_kind in ('document_response', 'non_response'));
alter table public.response_evidence drop constraint if exists response_evidence_source_check;
alter table public.response_evidence add constraint response_evidence_source_check
  check (source in ('client_portal', 'staff_upload', 'legacy_import', 'staff_nonresponse'));

-- Read-only structured summary. The parent row is the lifecycle authority;
-- letter-level counts expose readiness without duplicating that authority.
create or replace view public.dispute_round_summary
with (security_invoker = true) as
select
  r.id as round_id,
  r.user_id,
  r.client_id,
  r.client_account_id,
  r.round_number,
  r.target_type,
  r.status,
  r.final_disposition,
  r.opened_at,
  r.closed_at,
  r.cancelled_at,
  r.close_prompted_at,
  count(l.id)::integer as letter_count,
  count(l.id) filter (where l.html is not null and l.html <> 'GENERATING...' and l.html not like 'ERROR:%')::integer as generated_count,
  count(l.id) filter (where l.mailed_date is not null)::integer as mailed_count,
  count(l.id) filter (where coalesce(l.round_review_status, 'not_reviewed') <> 'not_reviewed')::integer as reviewed_count,
  bool_and(l.mailed_date is not null and coalesce(l.round_review_status, 'not_reviewed') in ('resolved', 'follow_up', 'escalated')) as ready_to_close,
  array_agg(l.id order by l.target_bureau nulls first, l.id) as letter_ids,
  array_remove(array_agg(l.target_bureau order by l.target_bureau), null) as target_bureaus
from public.dispute_rounds r
join public.letters l on l.round_id = r.id and l.user_id = r.user_id
group by r.id;

-- Client-safe lifecycle view. Internal notes, cancellation reasons, evidence,
-- prompts, and staff actor IDs are deliberately absent.
create or replace view public.client_dispute_round_status
with (security_barrier = true) as
select
  r.id as round_id,
  r.client_id,
  r.client_account_id,
  r.round_number,
  r.target_type,
  r.status,
  r.final_disposition,
  r.opened_at,
  r.closed_at,
  r.cancelled_at,
  count(l.id)::integer as letter_count,
  count(l.id) filter (where l.mailed_date is not null)::integer as mailed_count,
  count(l.id) filter (where coalesce(l.round_review_status, 'not_reviewed') <> 'not_reviewed')::integer as reviewed_count
from public.dispute_rounds r
join public.letters l on l.round_id = r.id and l.user_id = r.user_id
where exists (
  select 1 from public.client_profiles cp
  where cp.user_id = auth.uid() and cp.client_id = r.client_id
)
group by r.id;

grant select on public.dispute_rounds, public.dispute_round_summary, public.client_dispute_round_status,
  public.letter_source_links, public.letter_attachments,
  public.client_email_templates, public.client_emails to authenticated;
grant all on public.dispute_rounds, public.letter_source_links,
  public.letter_attachments, public.client_email_templates, public.client_emails to service_role;

-- Replace the legacy phase-derived tracker clock while keeping its return
-- contract stable for deployed clients.
create or replace function public.list_in_flight_letters(
  p_limit integer default 201,
  p_cursor_deadline date default null,
  p_cursor_id text default null
)
returns table (
  letter_id text, client_id uuid, client_name text, furnisher text,
  account_id text, client_account_id uuid, account_last4 text, phase text,
  mailed_date text, delivered_at timestamptz, bureau_review_status text,
  deadline date, sort_deadline date, total_count bigint
)
language sql stable security invoker set search_path = public
as $$
  with matching as (
    select
      l.id as letter_id,
      c.id as client_id,
      c.name as client_name,
      l.furnisher,
      l.account_id,
      l.client_account_id,
      account.account_last4,
      l.phase,
      l.mailed_date,
      l.delivered_at,
      coalesce(l.round_review_status, l.bureau_review_status, 'not_reviewed') as bureau_review_status,
      case
        when l.delivered_at is null then null
        when l.target_type is not null then coalesce(l.response_due_at::date, l.delivered_at::date + 30)
        when l.phase ilike 'Phase 3%' then l.delivered_at::date + 45
        else l.delivered_at::date + 30
      end as deadline
    from public.letters l
    join public.clients c on c.user_id = l.user_id and (
      l.client_id = c.id or (
        l.client_id is null and l.client_name = c.name
        and not exists (select 1 from public.clients same_name where same_name.user_id = c.user_id and same_name.name = c.name and same_name.id <> c.id)
      )
    )
    left join public.client_accounts account on account.id = l.client_account_id
    where l.mailed_date is not null and l.response_outcome is null
      and coalesce(l.round_review_status, l.bureau_review_status, 'not_reviewed') = 'not_reviewed'
  ), ranked as (
    select matching.*, coalesce(deadline, date '9999-12-31') as sort_deadline, count(*) over () as total_count
    from matching
  )
  select letter_id, client_id, client_name, furnisher, account_id, client_account_id,
    account_last4, phase, mailed_date, delivered_at, bureau_review_status,
    deadline, sort_deadline, total_count
  from ranked
  where p_cursor_deadline is null or sort_deadline > p_cursor_deadline
    or (sort_deadline = p_cursor_deadline and letter_id > p_cursor_id)
  order by sort_deadline, letter_id
  limit least(greatest(coalesce(p_limit, 201), 1), 501);
$$;

-- Atomic round + placeholder creation. Generation runs only after this
-- transaction succeeds, so a multi-bureau round can never be half-created.
create or replace function public.start_dispute_round(
  p_client_account_id uuid,
  p_target_type text,
  p_letters jsonb,
  p_sources jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_account public.client_accounts%rowtype;
  v_client public.clients%rowtype;
  v_round_id uuid := gen_random_uuid();
  v_round_number integer;
  v_letter jsonb;
  v_source jsonb;
  v_letter_id text;
  v_letter_ids text[] := '{}';
  v_bureau text;
  v_bureau_code text;
  v_latest_audit jsonb;
  v_audit_account jsonb;
  v_source_letter public.letters%rowtype;
  v_evidence public.response_evidence%rowtype;
begin
  if v_caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select role into v_role from public.profiles where id = v_caller;
  if v_role not in ('admin', 'auditor') then raise exception 'Staff access required' using errcode = '42501'; end if;
  if p_target_type not in ('furnisher', 'bureau') then raise exception 'Invalid round target'; end if;
  if coalesce(jsonb_typeof(p_letters), 'null') <> 'array' or jsonb_array_length(p_letters) < 1 or jsonb_array_length(p_letters) > 3 then
    raise exception 'A round requires one to three letters';
  end if;
  if coalesce(jsonb_typeof(coalesce(p_sources, '[]'::jsonb)), 'null') <> 'array' then raise exception 'Sources must be an array'; end if;
  if p_target_type = 'bureau' and exists (
    select 1
    from jsonb_array_elements(p_letters) item
    group by lower(item->>'target_bureau')
    having count(*) > 1
  ) then raise exception 'A bureau may appear only once in a round'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_client_account_id::text, 0));
  select * into v_account from public.client_accounts where id = p_client_account_id;
  if not found then raise exception 'Account identity not found'; end if;
  if v_role <> 'admin' and v_account.user_id <> v_caller then raise exception 'Not authorized for this account' using errcode = '42501'; end if;
  if v_account.needs_review then raise exception 'Account identity requires reconciliation before starting a round'; end if;
  select * into v_client from public.clients where id = v_account.client_id and user_id = v_account.user_id;
  if not found then raise exception 'Client record not found for account identity'; end if;
  if p_target_type = 'bureau' then
    select a.audit into v_latest_audit
    from public.audits a
    where a.user_id = v_account.user_id and a.client_id = v_client.id
    order by a.saved_at desc, a.id desc
    limit 1;
    if v_latest_audit is null then raise exception 'The client has no latest audit for bureau verification'; end if;
    select item.value into v_audit_account
    from jsonb_array_elements(coalesce(v_latest_audit->'accounts', '[]'::jsonb)) item
    where item.value->>'clientAccountId' = p_client_account_id::text
    limit 1;
    if v_audit_account is null then
      raise exception 'The account identity is not present in the latest audit';
    end if;
  end if;
  if exists (select 1 from public.dispute_rounds where user_id = v_account.user_id and client_account_id = p_client_account_id and status = 'open') then
    raise exception 'This account already has an open round';
  end if;
  if exists (
    select 1 from public.dispute_rounds r
    where r.user_id = v_account.user_id and r.client_account_id = p_client_account_id
      and r.status = 'closed' and r.round_number = (select max(r2.round_number) from public.dispute_rounds r2 where r2.user_id = r.user_id and r2.client_account_id = r.client_account_id)
      and r.final_disposition <> 'next_round'
  ) then raise exception 'The latest round is not approved for a next round'; end if;

  select coalesce(max(round_number), 0) + 1 into v_round_number
  from public.dispute_rounds where user_id = v_account.user_id and client_account_id = p_client_account_id;

  if v_round_number > 1 and jsonb_array_length(coalesce(p_sources, '[]'::jsonb)) < 1 then
    raise exception 'A later round requires at least one reviewed prior letter/evidence pair';
  end if;
  if v_round_number > 1 and exists (
    select 1 from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) source
    where nullif(source->>'response_evidence_id', '') is null
  ) then
    raise exception 'Every later-round source requires reviewed response or non-response evidence';
  end if;

  insert into public.dispute_rounds (
    id, user_id, client_id, client_account_id, round_number, target_type, opened_by
  ) values (
    v_round_id, v_account.user_id, v_client.id, p_client_account_id, v_round_number, p_target_type, v_caller
  );

  for v_letter in select value from jsonb_array_elements(p_letters)
  loop
    v_letter_id := gen_random_uuid()::text;
    v_bureau := nullif(lower(v_letter->>'target_bureau'), '');
    if p_target_type = 'bureau' and v_bureau not in ('equifax', 'experian', 'transunion') then
      raise exception 'Every bureau letter requires an explicit active bureau';
    end if;
    if p_target_type = 'bureau' then
      v_bureau_code := case v_bureau when 'equifax' then 'EQ' when 'experian' then 'EXP' when 'transunion' then 'TU' end;
      if not (coalesce(v_audit_account->'bureaus', '[]'::jsonb) ? v_bureau_code) then
        raise exception 'Selected bureau % is not active for this account on the latest audit', v_bureau;
      end if;
    end if;
    if p_target_type = 'furnisher' and v_bureau is not null then raise exception 'Furnisher letters cannot name a bureau'; end if;

    insert into public.letters (
      id, user_id, created_by, client_id, client_name, furnisher, account_id,
      client_account_id, phase, type, saved_at, date, html, summary,
      dispute_basis, round_id, round_number, letter_kind, target_type,
      target_bureau, round_review_status, covered_furnishers
    ) values (
      v_letter_id, v_account.user_id, v_caller, v_client.id, v_client.name,
      coalesce(v_account.display_furnisher, v_letter->>'furnisher', 'Unknown Furnisher'),
      coalesce(v_letter->>'account_id', ''), p_client_account_id,
      'Round ' || v_round_number::text || ' — ' || case when p_target_type = 'bureau' then initcap(v_bureau) else 'Furnisher' end,
      nullif(v_letter->>'type', ''), now(), current_date::text, 'GENERATING...', null,
      nullif(v_letter->>'dispute_basis', ''), v_round_id, v_round_number,
      'dispute', p_target_type, v_bureau, 'not_reviewed',
      case when p_target_type = 'bureau'
        then jsonb_build_array(coalesce(v_account.display_furnisher, v_letter->>'furnisher', 'Unknown Furnisher'))
        else '[]'::jsonb end
    );
    v_letter_ids := array_append(v_letter_ids, v_letter_id);

    for v_source in select value from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb))
    loop
      if nullif(lower(v_source->>'apply_to_bureau'), '') is not null
        and nullif(lower(v_source->>'apply_to_bureau'), '') is distinct from v_bureau then
        continue;
      end if;
      select * into v_source_letter from public.letters
        where user_id = v_account.user_id and id = v_source->>'source_letter_id';
      if not found or v_source_letter.client_account_id is distinct from p_client_account_id then
        raise exception 'A selected source letter does not belong to this account';
      end if;
      if v_source_letter.round_id is null or v_source_letter.mailed_date is null or not exists (
        select 1 from public.dispute_rounds source_round
        where source_round.id = v_source_letter.round_id
          and source_round.user_id = v_account.user_id
          and source_round.client_account_id = p_client_account_id
          and source_round.status = 'closed'
          and source_round.round_number < v_round_number
      ) then
        raise exception 'Every source must be a mailed letter from a closed prior round';
      end if;
      if nullif(v_source->>'response_evidence_id', '') is not null then
        select * into v_evidence from public.response_evidence
          where id = (v_source->>'response_evidence_id')::uuid
            and firm_user_id = v_account.user_id
            and letter_id = v_source_letter.id;
        if not found or v_evidence.analysis_status <> 'analyzed'
          or coalesce(v_evidence.review_status, 'not_reviewed') = 'not_reviewed' then
          raise exception 'Selected prior response evidence is not analyzed and reviewed';
        end if;
      end if;
      insert into public.letter_source_links (
        user_id, letter_id, source_letter_id, response_evidence_id,
        apply_to_bureau, source_order, created_by
      ) values (
        v_account.user_id, v_letter_id, v_source_letter.id,
        nullif(v_source->>'response_evidence_id', '')::uuid,
        nullif(lower(v_source->>'apply_to_bureau'), ''),
        coalesce((v_source->>'source_order')::integer, 0), v_caller
      );
    end loop;
    if v_round_number > 1 and not exists (
      select 1 from public.letter_source_links link
      where link.user_id = v_account.user_id and link.letter_id = v_letter_id
    ) then
      raise exception 'Every later-round letter requires at least one applicable prior letter/evidence pair';
    end if;
  end loop;

  return jsonb_build_object('round_id', v_round_id, 'round_number', v_round_number, 'letter_ids', to_jsonb(v_letter_ids));
end;
$$;

create or replace function public.close_dispute_round(
  p_round_id uuid,
  p_disposition text,
  p_notes text default null
)
returns public.dispute_rounds
language plpgsql
security definer
set search_path = public
as $$
declare v_round public.dispute_rounds%rowtype; v_role text;
begin
  select * into v_round from public.dispute_rounds where id = p_round_id for update;
  if not found then raise exception 'Round not found'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin', 'auditor') or (v_role <> 'admin' and v_round.user_id <> auth.uid()) then
    raise exception 'Not authorized for this round' using errcode = '42501';
  end if;
  if v_round.status <> 'open' then raise exception 'Only an open round can be closed'; end if;
  if p_disposition not in ('resolved', 'next_round', 'escalate') then raise exception 'Invalid final disposition'; end if;
  if exists (
    select 1 from public.letters l where l.round_id = p_round_id
      and (l.html = 'GENERATING...' or l.html like 'ERROR:%' or l.mailed_date is null
        or coalesce(l.round_review_status, 'not_reviewed') in ('not_reviewed', 'needs_documents'))
  ) then raise exception 'Every round letter must be generated, mailed, and reviewed before closure'; end if;
  if p_disposition = 'resolved' and exists (
    select 1 from public.letters l where l.round_id = p_round_id and l.round_next_action is distinct from 'resolved'
  ) then raise exception 'Resolved requires every sibling review to be resolved'; end if;
  if p_disposition = 'next_round' and (
    not exists (select 1 from public.letters l where l.round_id = p_round_id and l.round_next_action = 'next_round')
    or exists (select 1 from public.letters l where l.round_id = p_round_id and l.round_next_action = 'escalate')
  ) then raise exception 'Another round requires a follow-up review and no escalation review'; end if;
  if p_disposition = 'escalate' and not exists (
    select 1 from public.letters l where l.round_id = p_round_id and l.round_next_action = 'escalate'
  ) then raise exception 'Escalation requires an explicit sibling escalation review'; end if;
  update public.dispute_rounds set
    status = 'closed', final_disposition = p_disposition, final_notes = nullif(btrim(p_notes), ''),
    closed_at = now(), closed_by = auth.uid(), updated_at = now()
  where id = p_round_id returning * into v_round;
  return v_round;
end;
$$;

create or replace function public.reopen_dispute_round(p_round_id uuid)
returns public.dispute_rounds
language plpgsql security definer set search_path = public
as $$
declare v_round public.dispute_rounds%rowtype; v_role text;
begin
  select * into v_round from public.dispute_rounds where id = p_round_id for update;
  if not found then raise exception 'Round not found'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin', 'auditor') or (v_role <> 'admin' and v_round.user_id <> auth.uid()) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if v_round.status <> 'closed' then raise exception 'Only a closed round can be reopened'; end if;
  if exists (select 1 from public.dispute_rounds later where later.user_id = v_round.user_id and later.client_account_id = v_round.client_account_id and later.round_number > v_round.round_number and later.status <> 'cancelled') then
    raise exception 'A later round already exists';
  end if;
  if exists (select 1 from public.escalations e join public.letters l on l.user_id = e.user_id and l.id = e.phase3_letter_id where l.round_id = p_round_id and e.status in ('filed', 'responded', 'closed')) then
    raise exception 'A filed escalation prevents reopening this round';
  end if;
  update public.dispute_rounds set status = 'open', final_disposition = null, final_notes = null,
    closed_at = null, closed_by = null, close_prompted_at = null, updated_at = now()
  where id = p_round_id returning * into v_round;
  return v_round;
end;
$$;

create or replace function public.cancel_dispute_round(p_round_id uuid, p_reason text)
returns public.dispute_rounds
language plpgsql security definer set search_path = public
as $$
declare v_round public.dispute_rounds%rowtype; v_role text;
begin
  select * into v_round from public.dispute_rounds where id = p_round_id for update;
  if not found then raise exception 'Round not found'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin', 'auditor') or (v_role <> 'admin' and v_round.user_id <> auth.uid()) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if v_round.status <> 'open' then raise exception 'Only an open round can be cancelled'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Cancellation reason is required'; end if;
  if exists (select 1 from public.letters where round_id = p_round_id and mailed_date is not null) then
    raise exception 'A partially mailed round cannot be cancelled';
  end if;
  update public.dispute_rounds set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
    cancel_reason = btrim(p_reason), updated_at = now()
  where id = p_round_id returning * into v_round;
  return v_round;
end;
$$;

create or replace function public.extend_letter_deadline(p_letter_id text, p_reason text)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare v_user_id uuid; v_due timestamptz; v_role text;
begin
  select user_id, response_due_at into v_user_id, v_due from public.letters
    where id = p_letter_id and (user_id = auth.uid() or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')) for update;
  if not found then raise exception 'Letter not found or not authorized'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin', 'auditor') then raise exception 'Staff access required' using errcode = '42501'; end if;
  if v_due is null then raise exception 'The response clock has not started'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Extension reason is required'; end if;
  update public.letters set response_due_at = response_due_at + interval '15 days',
    response_window_extension_days = 15, response_window_extended_at = now(),
    response_window_extended_by = auth.uid(), response_window_extension_reason = btrim(p_reason)
  where user_id = v_user_id and id = p_letter_id and response_window_extension_days = 0
  returning response_due_at into v_due;
  if not found then raise exception 'This letter already has an extension'; end if;
  return v_due;
end;
$$;

create or replace function public.mark_round_close_prompted(p_round_id uuid)
returns timestamptz
language sql security definer set search_path = public
as $$
  update public.dispute_rounds r set close_prompted_at = coalesce(r.close_prompted_at, now()), updated_at = now()
  where r.id = p_round_id and r.status = 'open'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor') and (p.role = 'admin' or r.user_id = p.id))
  returning close_prompted_at;
$$;

create or replace function public.review_round_letter(
  p_letter_id text,
  p_response_evidence_id uuid,
  p_review_status text,
  p_next_action text,
  p_notes text default null
)
returns public.letters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_letter public.letters%rowtype;
  v_evidence public.response_evidence%rowtype;
  v_role text;
begin
  select * into v_letter from public.letters where id = p_letter_id and round_id is not null for update;
  if not found then raise exception 'Structured round letter not found'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('admin', 'auditor') or (v_role <> 'admin' and v_letter.user_id <> auth.uid()) then
    raise exception 'Not authorized for this letter' using errcode = '42501';
  end if;
  if p_review_status not in ('resolved', 'follow_up', 'needs_documents', 'escalated') then raise exception 'Invalid review status'; end if;
  if p_next_action not in ('resolved', 'next_round', 'needs_documents', 'escalate') then raise exception 'Invalid next action'; end if;
  if (p_review_status = 'resolved' and p_next_action <> 'resolved')
    or (p_review_status = 'follow_up' and p_next_action <> 'next_round')
    or (p_review_status = 'needs_documents' and p_next_action <> 'needs_documents')
    or (p_review_status = 'escalated' and p_next_action <> 'escalate') then
    raise exception 'Review status and next action do not match';
  end if;
  select * into v_evidence from public.response_evidence
  where id = p_response_evidence_id and letter_id = p_letter_id and firm_user_id = v_letter.user_id for update;
  if not found or v_evidence.analysis_status <> 'analyzed' then raise exception 'Analyzed response evidence is required'; end if;
  update public.response_evidence set
    review_status = p_review_status,
    review_notes = nullif(btrim(p_notes), ''),
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    updated_at = now()
  where id = p_response_evidence_id;
  update public.letters set
    round_review_status = p_review_status,
    round_next_action = p_next_action,
    round_reviewed_by = auth.uid(),
    round_reviewed_at = now()
  where user_id = v_letter.user_id and id = p_letter_id returning * into v_letter;
  return v_letter;
end;
$$;

revoke all on function public.start_dispute_round(uuid, text, jsonb, jsonb) from public;
revoke all on function public.review_round_letter(text, uuid, text, text, text) from public;
revoke all on function public.close_dispute_round(uuid, text, text) from public;
revoke all on function public.reopen_dispute_round(uuid) from public;
revoke all on function public.cancel_dispute_round(uuid, text) from public;
revoke all on function public.extend_letter_deadline(text, text) from public;
revoke all on function public.mark_round_close_prompted(uuid) from public;
grant execute on function public.start_dispute_round(uuid, text, jsonb, jsonb) to authenticated;
grant execute on function public.review_round_letter(text, uuid, text, text, text) to authenticated;
grant execute on function public.close_dispute_round(uuid, text, text) to authenticated;
grant execute on function public.reopen_dispute_round(uuid) to authenticated;
grant execute on function public.cancel_dispute_round(uuid, text) to authenticated;
grant execute on function public.extend_letter_deadline(text, text) to authenticated;
grant execute on function public.mark_round_close_prompted(uuid) to authenticated;
