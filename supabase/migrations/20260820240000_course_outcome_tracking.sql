-- Course-aligned outcome tracking. One reviewed transaction covers every
-- exact account/track snapshot on one mailed CCC letter. The saved post-mail
-- audit, current result rows, immutable events, and account-state transitions
-- commit or roll back together.

create table if not exists public.ccc_outcome_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  letter_id text not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  evidence_audit_id text not null,
  evidence_report_date date not null,
  evidence_saved_at timestamptz not null,
  letter_track_snapshots jsonb not null,
  outcome_snapshot jsonb not null,
  result_count integer not null check (result_count between 1 and 50),
  is_letter_win boolean not null,
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null default now(),
  foreign key (user_id, letter_id) references public.letters(user_id, id) on delete restrict,
  foreign key (user_id, evidence_audit_id) references public.audits(user_id, id) on delete restrict,
  unique (user_id, letter_id),
  check (jsonb_typeof(letter_track_snapshots) = 'array' and jsonb_array_length(letter_track_snapshots) = result_count),
  check (jsonb_typeof(outcome_snapshot) = 'array' and jsonb_array_length(outcome_snapshot) = result_count),
  check (pg_column_size(letter_track_snapshots) <= 262144 and pg_column_size(outcome_snapshot) <= 262144)
);

comment on table public.ccc_outcome_batches is
  'One immutable, all-accounts-reviewed outcome transaction for one mailed CCC letter. A letter win means one or more covered accounts achieved the course target.';

-- The old result_code mixed a response, a target result, and a duplicate
-- classification. Preserve it only for historical rows. New batch-owned rows
-- use the independent course fields below and keep result_code null.
alter table public.dispute_letter_results
  alter column result_code drop not null,
  add column if not exists batch_id uuid references public.ccc_outcome_batches(id) on delete restrict,
  add column if not exists track_id uuid references public.ccc_account_tracks(id) on delete restrict,
  add column if not exists track_revision integer,
  add column if not exists track_revision_after integer,
  add column if not exists method_version text,
  add column if not exists target_status text,
  add column if not exists response_status text,
  add column if not exists achieved_target text,
  add column if not exists next_action text,
  add column if not exists evidence_audit_id text,
  add column if not exists evidence_account_snapshot jsonb,
  add column if not exists r7_statement_match_status text,
  add column if not exists current_report_comment text;

alter table public.dispute_letter_results
  drop constraint if exists dispute_letter_results_course_fields_check,
  add constraint dispute_letter_results_course_fields_check check (
    (
      batch_id is null
      and track_id is null
      and track_revision is null
      and track_revision_after is null
      and method_version is null
      and target_status is null
      and response_status is null
      and achieved_target is null
      and next_action is null
      and evidence_audit_id is null
      and evidence_account_snapshot is null
      and r7_statement_match_status is null
      and current_report_comment is null
    )
    or (
      batch_id is not null
      and result_code is null
      and track_id is not null
      and track_revision >= 0
      and track_revision_after >= track_revision
      and nullif(btrim(method_version), '') is not null
      and target_status in ('achieved', 'partial', 'remains', 'indeterminate')
      and response_status in ('deleted', 'updated', 'verified', 'no_response', 'duplicate', 'unreadable')
      and achieved_target in (
        'none', 'account_deletion', 'factual_correction',
        'late_payment_removal', 'consumer_statement_full_match'
      )
      and next_action in ('close', 'advance', 'switch', 'hold')
      and evidence_audit_id is not null
      and jsonb_typeof(evidence_account_snapshot) = 'object'
      and (r7_statement_match_status is null or r7_statement_match_status in ('full', 'missing', 'generic', 'partial'))
      and length(coalesce(current_report_comment, '')) <= 32768
      and ((target_status = 'achieved' and achieved_target <> 'none') or (target_status <> 'achieved' and achieved_target = 'none'))
    )
  ),
  drop constraint if exists dispute_letter_results_evidence_audit_fkey,
  add constraint dispute_letter_results_evidence_audit_fkey
    foreign key (user_id, evidence_audit_id) references public.audits(user_id, id) on delete restrict;

create unique index if not exists dispute_letter_results_batch_track_uidx
  on public.dispute_letter_results (batch_id, track_id)
  where batch_id is not null;

create table if not exists public.ccc_outcome_result_events (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.ccc_outcome_batches(id) on delete restrict,
  current_result_id uuid not null references public.dispute_letter_results(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  letter_id text not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  client_account_id uuid not null references public.client_accounts(id) on delete restrict,
  track_id uuid not null references public.ccc_account_tracks(id) on delete restrict,
  track_revision integer not null check (track_revision >= 0),
  track_revision_after integer not null check (track_revision_after >= track_revision),
  method_version text not null,
  target_status text not null check (target_status in ('achieved', 'partial', 'remains', 'indeterminate')),
  response_status text not null check (response_status in ('deleted', 'updated', 'verified', 'no_response', 'duplicate', 'unreadable')),
  achieved_target text not null check (achieved_target in (
    'none', 'account_deletion', 'factual_correction',
    'late_payment_removal', 'consumer_statement_full_match'
  )),
  next_action text not null check (next_action in ('close', 'advance', 'switch', 'hold')),
  transition_outcome text check (transition_outcome is null or transition_outcome in ('deleted', 'resolved', 'remains', 'combo_side_deleted')),
  transition_event_id uuid references public.ccc_account_track_events(id) on delete restrict,
  evidence_audit_id text not null,
  evidence_account_snapshot jsonb not null check (jsonb_typeof(evidence_account_snapshot) = 'object'),
  r7_statement_match_status text check (r7_statement_match_status is null or r7_statement_match_status in ('full', 'missing', 'generic', 'partial')),
  mailed_consumer_statement_sha256 text,
  current_report_comment text,
  before_state jsonb not null check (jsonb_typeof(before_state) = 'object'),
  after_state jsonb not null check (jsonb_typeof(after_state) = 'object'),
  notes text,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (user_id, letter_id) references public.letters(user_id, id) on delete restrict,
  foreign key (user_id, evidence_audit_id) references public.audits(user_id, id) on delete restrict,
  unique (batch_id, track_id),
  check (length(coalesce(current_report_comment, '')) <= 32768),
  check (length(coalesce(notes, '')) <= 2000),
  check ((transition_outcome is null and transition_event_id is null and next_action = 'hold')
    or (transition_outcome is not null and transition_event_id is not null)),
  check ((target_status = 'achieved' and achieved_target <> 'none') or (target_status <> 'achieved' and achieved_target = 'none'))
);

create index if not exists ccc_outcome_result_events_letter_idx
  on public.ccc_outcome_result_events (user_id, letter_id, created_at);
create index if not exists ccc_outcome_result_events_track_idx
  on public.ccc_outcome_result_events (track_id, track_revision, created_at);

comment on table public.ccc_outcome_result_events is
  'Append-only per-account course outcomes, exact report evidence, and the account-state transition produced in the same transaction.';

alter table public.ccc_outcome_batches enable row level security;
alter table public.ccc_outcome_result_events enable row level security;

drop policy if exists "staff_read_ccc_outcome_batches" on public.ccc_outcome_batches;
create policy "staff_read_ccc_outcome_batches"
on public.ccc_outcome_batches for select to authenticated
using (
  exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid()
      and profile.role in ('admin', 'auditor')
      and (profile.role = 'admin' or ccc_outcome_batches.user_id = auth.uid())
  )
);

drop policy if exists "staff_read_ccc_outcome_result_events" on public.ccc_outcome_result_events;
create policy "staff_read_ccc_outcome_result_events"
on public.ccc_outcome_result_events for select to authenticated
using (
  exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid()
      and profile.role in ('admin', 'auditor')
      and (profile.role = 'admin' or ccc_outcome_result_events.user_id = auth.uid())
  )
);

-- Browser writes are intentionally removed. Only the security-definer batch
-- RPC below can create a course result or move account state.
drop policy if exists "staff_insert_dispute_letter_results" on public.dispute_letter_results;
drop policy if exists "staff_update_dispute_letter_results" on public.dispute_letter_results;
revoke all on public.ccc_outcome_batches, public.ccc_outcome_result_events from anon, authenticated;
grant select on public.ccc_outcome_batches, public.ccc_outcome_result_events to authenticated;
grant all on public.ccc_outcome_batches, public.ccc_outcome_result_events to service_role;
revoke insert, update, delete on public.dispute_letter_results from anon, authenticated;
grant select on public.dispute_letter_results to authenticated;

create or replace function public.prevent_ccc_outcome_evidence_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'CCC outcome evidence is immutable';
end;
$$;

drop trigger if exists protect_ccc_outcome_batches on public.ccc_outcome_batches;
create trigger protect_ccc_outcome_batches
before update or delete on public.ccc_outcome_batches
for each row execute function public.prevent_ccc_outcome_evidence_rewrite();

drop trigger if exists protect_ccc_outcome_result_events on public.ccc_outcome_result_events;
create trigger protect_ccc_outcome_result_events
before update or delete on public.ccc_outcome_result_events
for each row execute function public.prevent_ccc_outcome_evidence_rewrite();

create or replace function public.prevent_current_ccc_outcome_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.batch_id is not null or (tg_op = 'UPDATE' and new.batch_id is not null) then
    raise exception 'A recorded CCC course outcome is immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists protect_current_ccc_outcomes on public.dispute_letter_results;
create trigger protect_current_ccc_outcomes
before update or delete on public.dispute_letter_results
for each row execute function public.prevent_current_ccc_outcome_rewrite();

create or replace function public.ccc_normalize_course_text(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]+', ' ', 'g'));
$$;

create or replace function public.ccc_r7_statement_match(p_mailed_statement text, p_current_comment text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_statement text := public.ccc_normalize_course_text(p_mailed_statement);
  v_comment text := public.ccc_normalize_course_text(p_current_comment);
begin
  if v_comment = '' then return 'missing'; end if;
  if v_statement <> '' and (v_comment = v_statement or position(v_statement in v_comment) > 0) then return 'full'; end if;
  if v_comment = any(array[
    'account information disputed by consumer',
    'consumer disputes account information',
    'consumer disputes this account information',
    'consumer disputes after resolution',
    'disputed by consumer',
    'consumer statement',
    'meets fcra requirements'
  ]) then return 'generic'; end if;
  return 'partial';
end;
$$;

create or replace function public.ccc_evidence_comment_for_account(p_account jsonb, p_bureau_code text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_key text := case p_bureau_code when 'EQ' then 'equifax' when 'EXP' then 'experian' when 'TU' then 'transunion' end;
  v_comment text;
begin
  if p_account is null or v_key is null then return null; end if;
  v_comment := coalesce(
    nullif(btrim(p_account #>> array['extractedByBureau', v_key, 'remarks']), ''),
    nullif(btrim(p_account #>> array['extractedByBureau', v_key, 'specialComment']), ''),
    nullif(btrim(p_account #>> array['extractedByBureau', p_bureau_code, 'remarks']), ''),
    nullif(btrim(p_account #>> array['extractedByBureau', lower(p_bureau_code), 'remarks']), '')
  );
  if v_comment is not null then return v_comment; end if;
  if jsonb_typeof(p_account->'bureaus') = 'array'
    and jsonb_array_length(p_account->'bureaus') = 1
    and (p_account->'bureaus') ? p_bureau_code then
    return coalesce(nullif(btrim(p_account->>'remarks'), ''), nullif(btrim(p_account->>'specialComment'), ''));
  end if;
  return null;
end;
$$;

create or replace function public.record_ccc_outcome_batch(
  p_letter_user_id uuid,
  p_letter_id text,
  p_evidence_audit_id text,
  p_outcomes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_letter public.letters%rowtype;
  v_submission public.mail_submissions%rowtype;
  v_evidence public.audits%rowtype;
  v_batch public.ccc_outcome_batches%rowtype;
  v_track public.ccc_account_tracks%rowtype;
  v_track_after public.ccc_account_tracks%rowtype;
  v_account public.client_accounts%rowtype;
  v_snapshot jsonb;
  v_outcome jsonb;
  v_letter_account jsonb;
  v_evidence_account jsonb;
  v_evidence_snapshot jsonb;
  v_before jsonb;
  v_after jsonb;
  v_expected_concrete jsonb;
  v_target_status text;
  v_response_status text;
  v_achieved_target text;
  v_next_action text;
  v_transition_outcome text;
  v_transition_context jsonb;
  v_current_comment text;
  v_r7_match text;
  v_other_side text;
  v_opposite_achieved boolean;
  v_is_r7 boolean;
  v_account_present boolean;
  v_result_date date;
  v_result public.dispute_letter_results%rowtype;
  v_transition_event_id uuid;
  v_results jsonb;
begin
  if v_caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select role into v_role from public.profiles where id = v_caller;
  if v_role is null or v_role not in ('admin', 'auditor') then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  if p_letter_user_id is null or nullif(btrim(p_letter_id), '') is null or nullif(btrim(p_evidence_audit_id), '') is null then
    raise exception 'Exact letter owner, letter, and evidence audit are required';
  end if;
  if jsonb_typeof(p_outcomes) is distinct from 'array'
    or jsonb_array_length(p_outcomes) not between 1 and 50
    or pg_column_size(p_outcomes) > 262144 then
    raise exception 'Outcomes must be a bounded non-empty array';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_outcomes) item(value)
    where jsonb_typeof(item.value) <> 'object'
      or not (item.value ?& array['trackId','expectedRevision','targetStatus','responseStatus','achievedTarget','notes'])
      or (select count(*) from jsonb_object_keys(item.value)) <> 6
      or not ((item.value->>'trackId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      or jsonb_typeof(item.value->'expectedRevision') <> 'number'
      or not ((item.value->>'expectedRevision') ~ '^[0-9]+$')
      or (item.value->>'targetStatus') not in ('achieved','partial','remains','indeterminate')
      or (item.value->>'responseStatus') not in ('deleted','updated','verified','no_response','duplicate','unreadable')
      or (item.value->>'achievedTarget') not in ('none','account_deletion','factual_correction','late_payment_removal','consumer_statement_full_match')
      or jsonb_typeof(item.value->'notes') not in ('string','null')
      or length(coalesce(item.value->>'notes','')) > 2000
  ) then raise exception 'Every outcome must use the exact course outcome contract'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_outcomes) item(value)
    group by lower(item.value->>'trackId') having count(*) > 1
  ) then raise exception 'Every letter track must be reviewed exactly once'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_letter_user_id::text || ':' || p_letter_id, 0));
  select * into v_letter from public.letters
  where user_id = p_letter_user_id and id = p_letter_id
  for update;
  if not found or (v_role is distinct from 'admin' and v_letter.user_id is distinct from v_caller) then
    raise exception 'Mailed CCC letter not found' using errcode = '42501';
  end if;
  if v_letter.client_id is null or v_letter.dispute_template_id is null or v_letter.mailed_date is null
    or coalesce(v_letter.phase, '') not like 'CCC Dispute —%'
    or not public.ccc_letter_track_snapshots_valid(v_letter.ccc_account_track_snapshots)
    or jsonb_array_length(v_letter.ccc_account_track_snapshots) = 0 then
    raise exception 'This historical letter lacks the exact mailed CCC account/track snapshot; it cannot move course state';
  end if;
  if jsonb_array_length(v_letter.ccc_account_track_snapshots) <> jsonb_array_length(p_outcomes) then
    raise exception 'The reviewed batch must cover every exact account/track snapshot on this letter';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_letter.ccc_account_track_snapshots) snapshot(value)
    where not exists (
      select 1 from jsonb_array_elements(p_outcomes) outcome(value)
      where lower(outcome.value->>'trackId') = lower(snapshot.value->>'trackId')
    )
  ) or exists (
    select 1 from jsonb_array_elements(p_outcomes) outcome(value)
    where not exists (
      select 1 from jsonb_array_elements(v_letter.ccc_account_track_snapshots) snapshot(value)
      where lower(snapshot.value->>'trackId') = lower(outcome.value->>'trackId')
    )
  ) then raise exception 'Outcome track identities must exactly equal the immutable letter snapshot'; end if;
  if jsonb_typeof(v_letter.dispute_account_snapshot) <> 'array'
    or jsonb_array_length(v_letter.dispute_account_snapshot) <> jsonb_array_length(v_letter.ccc_account_track_snapshots)
    or exists (
      select 1 from jsonb_array_elements(v_letter.ccc_account_track_snapshots) snapshot(value)
      where not exists (
        select 1 from jsonb_array_elements(v_letter.dispute_account_snapshot) account(value)
        where coalesce(account.value->>'clientAccountId', account.value->>'client_account_id') = snapshot.value->>'clientAccountId'
      )
    )
    or exists (
      select 1 from jsonb_array_elements(v_letter.dispute_account_snapshot) account(value)
      where nullif(coalesce(account.value->>'clientAccountId', account.value->>'client_account_id'), '') is null
        or not exists (
          select 1 from jsonb_array_elements(v_letter.ccc_account_track_snapshots) snapshot(value)
          where snapshot.value->>'clientAccountId' = coalesce(account.value->>'clientAccountId', account.value->>'client_account_id')
        )
    ) then raise exception 'Letter account coverage is not the exact canonical track coverage'; end if;
  if exists (
    select 1 from public.ccc_outcome_batches batch
    where batch.user_id = v_letter.user_id and batch.letter_id = v_letter.id
  ) then raise exception 'This mailed letter already has an immutable reviewed outcome batch'; end if;

  select * into v_submission from public.mail_submissions
  where user_id = v_letter.user_id and letter_id = v_letter.id;
  if not found or v_submission.submitted_at is null or v_submission.status not in ('submitted','accepted_unreconciled') then
    raise exception 'The exact accepted mail submission is required before outcome review';
  end if;
  select * into v_evidence from public.audits
  where user_id = v_letter.user_id and id = p_evidence_audit_id;
  if not found or v_evidence.client_id is distinct from v_letter.client_id then
    raise exception 'Evidence audit must belong to the exact letter owner and client';
  end if;
  if v_evidence.saved_at is null or v_evidence.saved_at <= v_submission.submitted_at
    or v_evidence.audit->>'evaluationMode' is distinct from 'deterministic'
    or v_evidence.audit->>'schemaVersion' is distinct from 'deterministic-audit-v4'
    or jsonb_typeof(v_evidence.audit->'accounts') is distinct from 'array'
    or jsonb_array_length(v_evidence.audit->'accounts') = 0
    or jsonb_typeof(v_evidence.audit->'reportCoverage') is distinct from 'object'
    or v_evidence.audit->'reportCoverage'->>'complete' is distinct from 'true'
    or jsonb_typeof(v_evidence.audit->'reportCoverage'->'missing') is distinct from 'array'
    or jsonb_array_length(v_evidence.audit->'reportCoverage'->'missing') <> 0
    or jsonb_typeof(v_evidence.audit->'reportCoverage'->'duplicates') is distinct from 'array'
    or jsonb_array_length(v_evidence.audit->'reportCoverage'->'duplicates') <> 0
    or jsonb_typeof(v_evidence.audit->'reportCoverage'->'counts') is distinct from 'object'
    or coalesce((v_evidence.audit->'reportCoverage'->'counts'->>'EQ')::integer, 0) <> 1
    or coalesce((v_evidence.audit->'reportCoverage'->'counts'->>'EXP')::integer, 0) <> 1
    or coalesce((v_evidence.audit->'reportCoverage'->'counts'->>'TU')::integer, 0) <> 1 then
    raise exception 'Evidence must be a complete deterministic-audit-v4 3B saved after this exact accepted mail submission';
  end if;
  if v_evidence.report_date !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Evidence audit requires an exact ISO report date';
  end if;
  v_result_date := v_evidence.report_date::date;

  insert into public.ccc_outcome_batches (
    user_id, letter_id, client_id, evidence_audit_id, evidence_report_date,
    evidence_saved_at, letter_track_snapshots, outcome_snapshot, result_count,
    is_letter_win, reviewed_by
  ) values (
    v_letter.user_id, v_letter.id, v_letter.client_id, v_evidence.id, v_result_date,
    v_evidence.saved_at, v_letter.ccc_account_track_snapshots, p_outcomes,
    jsonb_array_length(p_outcomes),
    exists (select 1 from jsonb_array_elements(p_outcomes) item(value) where item.value->>'targetStatus' = 'achieved'),
    v_caller
  ) returning * into v_batch;

  for v_snapshot in
    select value from jsonb_array_elements(v_letter.ccc_account_track_snapshots) snapshot(value)
    order by lower(value->>'trackId')
  loop
    select value into v_outcome from jsonb_array_elements(p_outcomes) outcome(value)
    where lower(outcome.value->>'trackId') = lower(v_snapshot->>'trackId');
    select * into v_track from public.ccc_account_tracks
    where id = (v_snapshot->>'trackId')::uuid
    for update;
    if not found
      or v_track.user_id is distinct from v_letter.user_id
      or v_track.client_id is distinct from v_letter.client_id
      or v_track.client_account_id::text is distinct from v_snapshot->>'clientAccountId'
      or v_track.revision is distinct from (v_snapshot->>'revision')::integer
      or v_track.revision is distinct from (v_outcome->>'expectedRevision')::integer
      or v_track.method_version is distinct from v_snapshot->>'methodVersion'
      or v_track.track_scope is distinct from v_snapshot->>'trackScope'
      or v_track.bureau_code is distinct from v_snapshot->>'bureauCode'
      or v_track.account_kind is distinct from v_snapshot->>'accountKind'
      or v_track.native_flow is distinct from v_snapshot->>'nativeFlow'
      or v_track.current_flow is distinct from v_snapshot->>'logicalFlow'
      or v_track.current_round is distinct from (v_snapshot->>'logicalRound')::integer
      or v_track.cycle is distinct from (v_snapshot->>'cycle')::integer
      or v_track.path_role is distinct from v_snapshot->>'pathRole'
      or v_track.status is distinct from 'active' then
      raise exception 'CCC track % changed after this letter was built; do not score stale state', v_snapshot->>'trackId' using errcode = '40001';
    end if;
    v_expected_concrete := public.ccc_concrete_template_step(v_track.current_flow, v_track.current_round);
    if v_expected_concrete->>'flow' is distinct from v_snapshot->>'concreteFlow'
      or (v_expected_concrete->>'round')::integer is distinct from (v_snapshot->>'concreteRound')::integer then
      raise exception 'Letter snapshot no longer maps to the exact concrete course template';
    end if;

    select value into v_letter_account from jsonb_array_elements(v_letter.dispute_account_snapshot) account(value)
    where coalesce(account.value->>'clientAccountId', account.value->>'client_account_id') = v_track.client_account_id::text;
    select * into v_account from public.client_accounts
    where id = v_track.client_account_id and user_id = v_track.user_id and client_id = v_track.client_id;
    if not found then raise exception 'Canonical client account no longer exists'; end if;
    if (
      select count(*) from jsonb_array_elements(v_evidence.audit->'accounts') account(value)
      where coalesce(account.value->>'clientAccountId', account.value->>'client_account_id') = v_track.client_account_id::text
    ) > 1 then raise exception 'Evidence audit duplicated canonical account %', v_track.client_account_id; end if;
    select value into v_evidence_account from jsonb_array_elements(v_evidence.audit->'accounts') account(value)
    where coalesce(account.value->>'clientAccountId', account.value->>'client_account_id') = v_track.client_account_id::text;
    v_account_present := v_evidence_account is not null and (
      v_track.track_scope = 'direct'
      or (
        jsonb_typeof(v_evidence_account->'extractedByBureau') = 'object'
        and (
          (v_evidence_account->'extractedByBureau') ? (case v_track.bureau_code when 'EQ' then 'equifax' when 'EXP' then 'experian' when 'TU' then 'transunion' end)
          or (v_evidence_account->'extractedByBureau') ? v_track.bureau_code
          or (v_evidence_account->'extractedByBureau') ? lower(v_track.bureau_code)
        )
      )
      or (
        jsonb_typeof(v_evidence_account->'bureaus') = 'array'
        and (v_evidence_account->'bureaus') ? v_track.bureau_code
      )
    );
    v_evidence_snapshot := case when v_account_present then v_evidence_account else jsonb_build_object(
      'status', 'absent', 'clientAccountId', v_track.client_account_id,
      'bureauCode', v_track.bureau_code, 'evidenceAuditId', v_evidence.id
    ) end;

    v_target_status := v_outcome->>'targetStatus';
    v_response_status := v_outcome->>'responseStatus';
    v_achieved_target := v_outcome->>'achievedTarget';
    v_is_r7 := v_snapshot->>'concreteFlow' = 'accuracy' and (v_snapshot->>'concreteRound')::integer = 7;
    v_current_comment := case when v_is_r7 and v_account_present
      then public.ccc_evidence_comment_for_account(v_evidence_account, v_track.bureau_code)
      else null end;
    v_r7_match := case when v_is_r7
      then public.ccc_r7_statement_match(v_submission.consumer_statement_text, v_current_comment)
      else null end;

    if v_target_status = 'achieved' and v_achieved_target = 'none'
      or v_target_status <> 'achieved' and v_achieved_target <> 'none' then
      raise exception 'Achieved target must be separate from target status and present only for achieved accounts';
    end if;
    if v_response_status = 'unreadable' and v_target_status <> 'indeterminate'
      or v_target_status = 'indeterminate' and v_response_status <> 'unreadable' then
      raise exception 'Indeterminate outcomes require unreadable/insufficient evidence and must hold';
    end if;
    if not v_account_present and not (
      (v_target_status = 'achieved' and v_achieved_target = 'account_deletion' and v_response_status <> 'unreadable')
      or (v_target_status = 'indeterminate' and v_response_status = 'unreadable')
    ) then raise exception 'An account absent from the evidence audit must be confirmed deleted or held as indeterminate'; end if;
    if v_account_present and (v_response_status = 'deleted' or v_achieved_target = 'account_deletion') then
      raise exception 'The evidence audit still contains this canonical account, so deletion cannot be recorded';
    end if;
    if v_response_status = 'deleted' and not (v_target_status = 'achieved' and v_achieved_target = 'account_deletion') then
      raise exception 'Deleted is a response status only when the account-deletion target is achieved';
    end if;

    if v_is_r7 and v_account_present then
      if v_submission.consumer_statement_text is null or v_submission.consumer_statement_sha256 is null then
        raise exception 'R7 requires the exact Consumer Statement captured from the mailed packet';
      end if;
      if v_r7_match = 'full' and not (
        v_target_status = 'achieved' and v_achieved_target = 'consumer_statement_full_match'
      ) then raise exception 'A full normalized R7 match must be recorded as the Consumer Statement target achieved'; end if;
      if v_r7_match = 'partial' and not (
        v_target_status = 'partial' and v_achieved_target = 'none'
      ) then raise exception 'A partial R7 statement match requires manual hold, not an automatic pass'; end if;
      if v_r7_match in ('missing','generic') and not (
        v_target_status = 'remains' and v_achieved_target = 'none'
      ) then raise exception 'Missing or generic R7 comments mean the exact statement target remains'; end if;
    elsif v_target_status = 'achieved' then
      if v_achieved_target = 'account_deletion' then
        if v_account_present or v_response_status = 'unreadable' then raise exception 'Account deletion requires exact absence in readable report evidence'; end if;
      elsif v_achieved_target = 'factual_correction' then
        if not v_account_present
          or not (v_track.native_flow = 'accuracy' or v_track.current_flow = 'accuracy')
          or v_response_status in ('deleted','unreadable') then
          raise exception 'Only a present Accuracy target with a fully corrected fact can close as factual correction';
        end if;
      elsif v_achieved_target = 'late_payment_removal' then
        if not v_account_present
          or v_track.current_flow is distinct from 'late_pay'
          or v_response_status in ('deleted','unreadable')
          or not (
            coalesce(v_evidence_account->>'latePaymentBand','') = 'none'
            or (v_evidence_account->>'latePaymentCount') ~ '^0$'
          ) then raise exception 'Late Pay closes only when the exact report update shows no targeted late remaining'; end if;
      elsif v_achieved_target = 'consumer_statement_full_match' then
        raise exception 'Consumer Statement full-match is valid only on the exact Accuracy R7 step';
      else
        raise exception 'Unsupported achieved target for this account track';
      end if;
    end if;

    v_transition_context := jsonb_build_object('outcome_batch_id', v_batch.id, 'evidence_audit_id', v_evidence.id);
    if v_target_status = 'achieved' then
      v_next_action := 'close';
      v_transition_outcome := case when v_achieved_target = 'account_deletion' then 'deleted' else 'resolved' end;
    elsif v_target_status = 'indeterminate' or (v_is_r7 and v_r7_match = 'partial') then
      v_next_action := 'hold';
      v_transition_outcome := null;
    else
      v_other_side := case v_track.native_flow when 'accuracy' then 'collection' when 'collection' then 'accuracy' end;
      v_opposite_achieved := false;
      if v_track.current_flow = 'combo' and v_other_side is not null then
        select count(*) > 0 and bool_and(outcome.value->>'targetStatus' = 'achieved')
        into v_opposite_achieved
        from jsonb_array_elements(v_letter.ccc_account_track_snapshots) snapshot(value)
        join jsonb_array_elements(p_outcomes) outcome(value)
          on lower(outcome.value->>'trackId') = lower(snapshot.value->>'trackId')
        where snapshot.value->>'nativeFlow' = v_other_side;
      end if;
      if v_opposite_achieved then
        v_next_action := 'switch';
        v_transition_outcome := 'combo_side_deleted';
        v_transition_context := v_transition_context || jsonb_build_object('deleted_side', v_other_side);
      else
        v_next_action := 'advance';
        v_transition_outcome := 'remains';
      end if;
    end if;

    v_before := to_jsonb(v_track);
    v_transition_event_id := null;
    if v_transition_outcome is not null then
      select * into v_track_after from public.transition_ccc_account_track(
        v_track.id, v_track.revision, v_transition_outcome, v_transition_context, v_letter.id
      );
      if v_track_after.status = 'review_required' then v_next_action := 'hold'; end if;
      select id into v_transition_event_id from public.ccc_account_track_events
      where track_id = v_track_after.id and to_revision = v_track_after.revision;
      if v_transition_event_id is null then raise exception 'Atomic account-state transition event is missing'; end if;
      v_after := to_jsonb(v_track_after);
    else
      v_track_after := v_track;
      v_after := v_before;
    end if;

    insert into public.dispute_letter_results (
      user_id, letter_id, client_id, client_account_id, account_key, furnisher,
      bureau_code, result_code, result_date, notes, recorded_by, updated_at,
      batch_id, track_id, track_revision, track_revision_after, method_version,
      target_status, response_status, achieved_target, next_action,
      evidence_audit_id, evidence_account_snapshot, r7_statement_match_status,
      current_report_comment
    ) values (
      v_letter.user_id, v_letter.id, v_letter.client_id, v_track.client_account_id,
      'client-account:' || v_track.client_account_id,
      coalesce(nullif(btrim(v_letter_account->>'furnisher'), ''), nullif(btrim(v_account.display_furnisher), ''), v_letter.furnisher, 'Unknown furnisher'),
      v_track.bureau_code, null, v_result_date, nullif(btrim(v_outcome->>'notes'), ''), v_caller, now(),
      v_batch.id, v_track.id, v_track.revision, v_track_after.revision, v_track.method_version,
      v_target_status, v_response_status, v_achieved_target, v_next_action,
      v_evidence.id, v_evidence_snapshot, v_r7_match, v_current_comment
    ) returning * into v_result;

    insert into public.ccc_outcome_result_events (
      batch_id, current_result_id, user_id, letter_id, client_id,
      client_account_id, track_id, track_revision, track_revision_after,
      method_version, target_status, response_status, achieved_target,
      next_action, transition_outcome, transition_event_id, evidence_audit_id,
      evidence_account_snapshot, r7_statement_match_status,
      mailed_consumer_statement_sha256, current_report_comment,
      before_state, after_state, notes, actor_id
    ) values (
      v_batch.id, v_result.id, v_letter.user_id, v_letter.id, v_letter.client_id,
      v_track.client_account_id, v_track.id, v_track.revision, v_track_after.revision,
      v_track.method_version, v_target_status, v_response_status, v_achieved_target,
      v_next_action, v_transition_outcome, v_transition_event_id, v_evidence.id,
      v_evidence_snapshot, v_r7_match,
      case when v_is_r7 then v_submission.consumer_statement_sha256 else null end,
      v_current_comment, v_before, v_after, nullif(btrim(v_outcome->>'notes'), ''), v_caller
    );
  end loop;

  select coalesce(jsonb_agg(to_jsonb(result) order by result.furnisher, result.id), '[]'::jsonb)
  into v_results from public.dispute_letter_results result where result.batch_id = v_batch.id;
  return jsonb_build_object('batch', to_jsonb(v_batch), 'results', v_results, 'letterWin', v_batch.is_letter_win);
end;
$$;

revoke all on function public.prevent_ccc_outcome_evidence_rewrite() from public;
revoke all on function public.prevent_current_ccc_outcome_rewrite() from public;
revoke all on function public.ccc_normalize_course_text(text) from public;
revoke all on function public.ccc_r7_statement_match(text,text) from public;
revoke all on function public.ccc_evidence_comment_for_account(jsonb,text) from public;
revoke all on function public.record_ccc_outcome_batch(uuid,text,text,jsonb) from public;
grant execute on function public.record_ccc_outcome_batch(uuid,text,text,jsonb) to authenticated;

-- Performance is letter-level: one letter win when any covered account
-- achieved, regardless of how many other accounts remain in sequence.
create or replace view public.dispute_template_performance
with (security_invoker = true)
as
with scored_letters as (
  select
    letter.user_id,
    letter.id,
    letter.dispute_template_id,
    letter.mailed_date,
    (batch.id is not null or legacy.reviewed) as reviewed,
    coalesce(batch.is_letter_win, legacy.won, false) as won
  from public.letters letter
  join public.profiles caller
    on caller.id = auth.uid()
   and caller.role in ('admin', 'auditor')
   and (caller.role = 'admin' or letter.user_id = auth.uid())
  left join public.ccc_outcome_batches batch
    on batch.user_id = letter.user_id and batch.letter_id = letter.id
  left join lateral (
    select
      count(*) > 0 as reviewed,
      coalesce(bool_or(result.result_code = 'deleted'), false) as won
    from public.dispute_letter_results result
    where result.user_id = letter.user_id
      and result.letter_id = letter.id
      and result.batch_id is null
  ) legacy on true
  where letter.dispute_template_id is not null
)
select
  template.id as template_id,
  count(distinct scored.id) filter (where scored.mailed_date is not null) as times_mailed,
  count(distinct scored.id) filter (where scored.reviewed) as results_recorded,
  count(distinct scored.id) filter (where scored.reviewed and scored.won) as wins,
  count(distinct scored.id) filter (where scored.reviewed and not scored.won) as non_deletion_results,
  case
    when count(distinct scored.id) filter (where scored.reviewed) = 0 then null
    else round(
      count(distinct scored.id) filter (where scored.reviewed and scored.won)::numeric
      / count(distinct scored.id) filter (where scored.reviewed)::numeric,
      4
    )
  end as win_rate
from public.dispute_templates template
left join scored_letters scored on scored.dispute_template_id = template.id
group by template.id;

grant select on public.dispute_template_performance to authenticated;

-- Rollback: deploy readers that ignore the additive batch/event columns and
-- RPC. Preserve recorded rows, immutable events, and transitioned account
-- history; destructive rollback would break the evidentiary chain.
