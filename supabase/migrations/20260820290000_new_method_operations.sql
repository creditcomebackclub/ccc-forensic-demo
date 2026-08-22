-- Replace the active Operations Control Center doctrine with the CCC
-- Consent / Accuracy / Collection method. Historical Phase 1-4 jobs and
-- letters remain untouched, but they are no longer current work queues.
--
-- Forward path: additive validators + replacement read-only RPCs.
-- Rollback path: redeploy the two RPC definitions from 20260803190000. Keep
-- these validators and indexes; they do not mutate or reinterpret history.

begin;

create index if not exists audits_ccc_deterministic_client_idx
  on public.audits (client_id, saved_at desc, id)
  where audit->>'evaluationMode' = 'deterministic';

create index if not exists letters_ccc_method_client_idx
  on public.letters (client_id, saved_at desc, id)
  where phase like 'CCC Dispute —%';

create index if not exists ccc_account_tracks_review_queue_idx
  on public.ccc_account_tracks (status, updated_at desc, client_id)
  where status = 'review_required';

-- Keep malformed mixed-version JSON out of every downstream readiness query.
-- PL/pgSQL catches invalid casts/shapes so one bad historical row becomes a
-- failed check instead of an outage.
create or replace function public.ccc_operations_deterministic_audit_valid(p_audit jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  return
    coalesce(pg_catalog.jsonb_typeof(p_audit), 'null') = 'object'
    and p_audit->>'evaluationMode' = 'deterministic'
    and p_audit->>'schemaVersion' = 'deterministic-audit-v4'
    and coalesce(pg_catalog.jsonb_typeof(p_audit->'reportCoverage'), 'null') = 'object'
    and p_audit->'reportCoverage'->>'complete' = 'true'
    and coalesce(pg_catalog.jsonb_typeof(p_audit->'reportCoverage'->'missing'), 'null') = 'array'
    and pg_catalog.jsonb_array_length(p_audit->'reportCoverage'->'missing') = 0
    and coalesce(pg_catalog.jsonb_typeof(p_audit->'reportCoverage'->'duplicates'), 'null') = 'array'
    and pg_catalog.jsonb_array_length(p_audit->'reportCoverage'->'duplicates') = 0
    and coalesce(pg_catalog.jsonb_typeof(p_audit->'reportCoverage'->'counts'), 'null') = 'object'
    and (p_audit->'reportCoverage'->'counts'->>'EQ')::integer = 1
    and (p_audit->'reportCoverage'->'counts'->>'EXP')::integer = 1
    and (p_audit->'reportCoverage'->'counts'->>'TU')::integer = 1
    and coalesce(pg_catalog.jsonb_typeof(p_audit->'accounts'), 'null') = 'array';
exception when others then
  return false;
end;
$$;

revoke all on function public.ccc_operations_deterministic_audit_valid(jsonb) from public;
grant execute on function public.ccc_operations_deterministic_audit_valid(jsonb) to service_role;

-- Fail closed if a review was copied, partially saved, had its canonical
-- snapshot changed, or names an unauthorized reviewer. This helper is not a
-- browser API; the admin readiness RPC calls it under its own definer role.
create or replace function public.ccc_operations_classification_review_valid(
  p_audit_id text,
  p_client_id uuid,
  p_audit jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_audit public.audits%rowtype;
  v_review jsonb;
  v_snapshot jsonb;
  v_canonical text;
  v_reviewer uuid;
  v_review_version integer;
  v_audit_account jsonb;
  v_snapshot_account jsonb;
  v_match_count integer;
  v_expected_route_count integer;
begin
  if nullif(pg_catalog.btrim(coalesce(p_audit_id, '')), '') is null
    or p_client_id is null
    or not public.ccc_operations_deterministic_audit_valid(p_audit) then
    return false;
  end if;

  select audit_row.* into v_audit
  from public.audits audit_row
  where audit_row.id = p_audit_id
    and audit_row.client_id = p_client_id
    and audit_row.audit = p_audit
  limit 1;
  if not found then return false; end if;

  -- Validate the exact supplied audit. Once its routes initialize account
  -- tracks, that audit remains the immutable R1 lifecycle source. Later 3B
  -- reports are outcome evidence and must never silently restart the client.
  if not exists (
      select 1
      from public.clients client
      where client.id = p_client_id and client.user_id = v_audit.user_id
    ) then
    return false;
  end if;

  v_review := p_audit->'classificationReview';
  if coalesce(pg_catalog.jsonb_typeof(v_review), 'null') <> 'object'
    or v_review->>'status' is distinct from 'confirmed'
    or v_review->>'auditId' is distinct from p_audit_id
    or v_review->>'clientId' is distinct from p_client_id::text
    or v_review->>'methodVersion' is distinct from 'ccc_skool_2026_v1'
    or coalesce(v_review->>'version', '') !~ '^[1-9][0-9]*$'
    or nullif(v_review->>'reviewedAt', '') is null
    or nullif(v_review->>'reviewedBy', '') is null
    or coalesce(pg_catalog.jsonb_typeof(v_review->'routes'), 'null') <> 'array'
    or pg_catalog.jsonb_array_length(v_review->'routes') not between 1 and 50
    or lower(coalesce(v_review->>'routesSha256', '')) !~ '^[0-9a-f]{64}$'
    or coalesce(pg_catalog.jsonb_typeof(v_review->'routingSnapshot'), 'null') <> 'object'
    or nullif(v_review->>'routingSnapshotCanonical', '') is null
    or lower(coalesce(v_review->>'routingSnapshotSha256', '')) !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  begin
    v_reviewer := (v_review->>'reviewedBy')::uuid;
    v_review_version := (v_review->>'version')::integer;
  exception when others then
    return false;
  end;
  if v_review_version < 1 or not exists (
    select 1
    from public.profiles reviewer
    where reviewer.id = v_reviewer
      and reviewer.role in ('admin', 'auditor')
      and (reviewer.role = 'admin' or reviewer.id = v_audit.user_id)
  ) then
    return false;
  end if;

  if lower(v_review->>'routesSha256') is distinct from
      public.ccc_classification_routes_sha256(v_review->'routes') then
    return false;
  end if;

  v_snapshot := v_review->'routingSnapshot';
  v_canonical := v_review->>'routingSnapshotCanonical';
  if lower(v_review->>'routingSnapshotSha256') is distinct from
      pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_canonical, 'UTF8'), 'sha256'), 'hex')
    or v_canonical::jsonb is distinct from v_snapshot
    or v_snapshot->>'auditId' is distinct from p_audit_id
    or v_snapshot->>'clientId' is distinct from p_client_id::text
    or v_snapshot->>'methodVersion' is distinct from 'ccc_skool_2026_v1'
    or coalesce(pg_catalog.jsonb_typeof(v_snapshot->'accounts'), 'null') <> 'array'
    or coalesce(pg_catalog.jsonb_typeof(v_snapshot->'routes'), 'null') <> 'array'
    or public.ccc_canonical_classification_routes(v_snapshot->'routes')
      is distinct from public.ccc_canonical_classification_routes(v_review->'routes') then
    return false;
  end if;

  -- Re-run the initializer's canonical source/snapshot invariants here. A
  -- self-consistent hash is insufficient when the hashed payload itself was
  -- copied or rebuilt from facts that no longer match the source audit.
  if pg_catalog.jsonb_array_length(v_snapshot->'accounts')
      <> pg_catalog.jsonb_array_length(v_audit.audit->'accounts')
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_audit.audit->'accounts') source(value)
      where coalesce(pg_catalog.jsonb_typeof(source.value), 'null') <> 'object'
        or nullif(source.value->>'id', '') is null
        or nullif(coalesce(source.value->>'clientAccountId', source.value->>'client_account_id'), '') is null
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_audit.audit->'accounts') source(value)
      group by source.value->>'id'
      having count(*) > 1
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_audit.audit->'accounts') source(value)
      group by coalesce(source.value->>'clientAccountId', source.value->>'client_account_id')
      having count(*) > 1
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_snapshot->'accounts') snapshot_account(value)
      where coalesce(pg_catalog.jsonb_typeof(snapshot_account.value), 'null') <> 'object'
        or nullif(snapshot_account.value->>'accountId', '') is null
        or nullif(snapshot_account.value->>'clientAccountId', '') is null
        or coalesce(pg_catalog.jsonb_typeof(snapshot_account.value->'bureaus'), 'null') <> 'array'
        or coalesce(pg_catalog.jsonb_typeof(snapshot_account.value->'routingFacts'), 'null') <> 'object'
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_snapshot->'accounts') snapshot_account(value)
      group by snapshot_account.value->>'accountId'
      having count(*) > 1
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_snapshot->'accounts') snapshot_account(value)
      group by snapshot_account.value->>'clientAccountId'
      having count(*) > 1
    ) then
    return false;
  end if;

  for v_audit_account in
    select source.value
    from pg_catalog.jsonb_array_elements(v_audit.audit->'accounts') source(value)
  loop
    select count(*) into v_match_count
    from pg_catalog.jsonb_array_elements(v_snapshot->'accounts') snapshot_account(value)
    where snapshot_account.value->>'accountId' = v_audit_account->>'id';
    v_snapshot_account := null;
    select snapshot_account.value into v_snapshot_account
    from pg_catalog.jsonb_array_elements(v_snapshot->'accounts') snapshot_account(value)
    where snapshot_account.value->>'accountId' = v_audit_account->>'id'
    limit 1;

    if coalesce(pg_catalog.jsonb_typeof(v_audit_account->'routingFacts'), 'null') <> 'object'
      or coalesce(pg_catalog.jsonb_typeof(v_audit_account->'bureaus'), 'null') <> 'array'
      or coalesce(pg_catalog.jsonb_typeof(v_audit_account->'routingFacts'->'blockingCodes'), 'null') <> 'array'
      or v_audit_account->'routingFacts'->>'status' is distinct from 'confirmed'
      or v_audit_account->'routingFacts'->>'source' is distinct from 'staff_review'
      or v_audit_account->'routingFacts'->>'reviewedBy' is distinct from v_review->>'reviewedBy'
      or v_audit_account->'routingFacts'->>'reviewedAt' is distinct from v_review->>'reviewedAt'
      or coalesce((v_audit_account->'routingFacts'->>'staffAttested')::boolean, false) is not true
      or pg_catalog.jsonb_array_length(v_audit_account->'routingFacts'->'blockingCodes') <> 0
      or v_match_count <> 1
      or v_snapshot_account->>'clientAccountId' is distinct from
        coalesce(v_audit_account->>'clientAccountId', v_audit_account->>'client_account_id')
      or v_snapshot_account->>'accountKind' is distinct from
        public.ccc_normalize_account_kind(v_audit_account->'routingFacts'->>'accountKind')
      or coalesce((v_snapshot_account->>'excluded')::boolean, false) is distinct from
        (public.ccc_normalize_account_kind(v_audit_account->'routingFacts'->>'accountKind') = 'positive')
      or public.ccc_canonical_bureau_array(v_snapshot_account->'bureaus') is distinct from
        public.ccc_canonical_bureau_array(v_audit_account->'bureaus')
      or v_snapshot_account->'routingFacts' is distinct from v_audit_account->'routingFacts'
      or not exists (
        select 1
        from public.client_accounts account
        where account.id = coalesce(
            v_audit_account->>'clientAccountId',
            v_audit_account->>'client_account_id'
          )::uuid
          and account.user_id = v_audit.user_id
          and account.client_id = p_client_id
          and coalesce(account.needs_review, false) = false
      ) then
      return false;
    end if;
  end loop;

  -- The reviewed routes must be a duplicate-free, supported set with exactly
  -- one route for every non-positive source account/bureau pair and no extras.
  if exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_review->'routes') route(value)
      group by route.value->>'clientAccountId', public.ccc_normalize_bureau_code(route.value->>'bureauCode')
      having count(*) > 1
    ) or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_review->'routes') route(value)
      where public.ccc_normalize_account_kind(route.value->>'accountKind') not in (
          'collection', 'repossession', 'charge_off', 'late_payment', 'student_loan', 'bankruptcy'
        )
        or lower(pg_catalog.btrim(route.value->>'nativeFlow')) not in (
          'accuracy', 'collection', 'consent', 'late_pay', 'repo'
        )
        or (public.ccc_normalize_account_kind(route.value->>'accountKind') = 'repossession')
          is distinct from (lower(pg_catalog.btrim(route.value->>'nativeFlow')) = 'repo')
    ) or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_review->'routes') route(value)
      join lateral (
        select source.value
        from pg_catalog.jsonb_array_elements(v_audit.audit->'accounts') source(value)
        where coalesce(source.value->>'clientAccountId', source.value->>'client_account_id') =
          route.value->>'clientAccountId'
        limit 1
      ) source on true
      cross join lateral (
        select source.value->'routingFacts'->'bureauFacts'->
          public.ccc_normalize_bureau_code(route.value->>'bureauCode') as value
      ) bureau_fact
      where public.ccc_normalize_account_kind(route.value->>'accountKind') = 'late_payment'
        and (
          coalesce(pg_catalog.jsonb_typeof(bureau_fact.value), 'null') <> 'object'
          or bureau_fact.value->>'accountKind' is distinct from 'late_payment'
          or bureau_fact.value->>'latePaymentStatus' is distinct from 'confirmed'
          or bureau_fact.value->>'latePaymentBand' not in ('two_or_fewer', 'three_or_more', 'mixed')
          or coalesce(bureau_fact.value->>'latePaymentCount', '') !~ '^[0-9]{1,3}$'
          or (bureau_fact.value->>'latePaymentCount')::integer not between 1 and 500
          or (
            bureau_fact.value->>'latePaymentBand' = 'two_or_fewer'
            and (bureau_fact.value->>'latePaymentCount')::integer not between 1 and 2
          )
          or (
            bureau_fact.value->>'latePaymentBand' in ('three_or_more', 'mixed')
            and (bureau_fact.value->>'latePaymentCount')::integer < 3
          )
        )
    ) then
    return false;
  end if;

  select count(*) into v_expected_route_count
  from pg_catalog.jsonb_array_elements(v_audit.audit->'accounts') source(value)
  cross join lateral pg_catalog.jsonb_array_elements_text(source.value->'bureaus') bureau(value)
  where public.ccc_normalize_account_kind(source.value->'routingFacts'->>'accountKind') <> 'positive';

  if v_expected_route_count <> pg_catalog.jsonb_array_length(v_review->'routes')
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_audit.audit->'accounts') source(value)
      cross join lateral pg_catalog.jsonb_array_elements_text(source.value->'bureaus') bureau(value)
      where public.ccc_normalize_account_kind(source.value->'routingFacts'->>'accountKind') <> 'positive'
        and not exists (
          select 1
          from pg_catalog.jsonb_array_elements(v_review->'routes') route(value)
          where route.value->>'clientAccountId' =
              coalesce(source.value->>'clientAccountId', source.value->>'client_account_id')
            and public.ccc_normalize_bureau_code(route.value->>'bureauCode') =
              public.ccc_normalize_bureau_code(bureau.value)
            and public.ccc_normalize_account_kind(route.value->>'accountKind') =
              public.ccc_normalize_account_kind(source.value->'routingFacts'->>'accountKind')
        )
    ) or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_review->'routes') route(value)
      where not exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_audit.audit->'accounts') source(value)
        cross join lateral pg_catalog.jsonb_array_elements_text(source.value->'bureaus') bureau(value)
        where public.ccc_normalize_account_kind(source.value->'routingFacts'->>'accountKind') <> 'positive'
          and route.value->>'clientAccountId' =
            coalesce(source.value->>'clientAccountId', source.value->>'client_account_id')
          and public.ccc_normalize_bureau_code(route.value->>'bureauCode') =
            public.ccc_normalize_bureau_code(bureau.value)
          and public.ccc_normalize_account_kind(route.value->>'accountKind') =
            public.ccc_normalize_account_kind(source.value->'routingFacts'->>'accountKind')
      )
    ) then
    return false;
  end if;

  return true;
exception when others then
  -- Corrupt or mixed-version JSON must make readiness false, never take down
  -- the whole control center or accidentally certify a client.
  return false;
end;
$$;

revoke all on function public.ccc_operations_classification_review_valid(text, uuid, jsonb) from public;
grant execute on function public.ccc_operations_classification_review_valid(text, uuid, jsonb) to service_role;

-- Prove that every reviewed account/bureau route was initialized once at R1
-- and that the immutable revision-zero event binds the exact source audit.
-- Current tracks may legitimately be on later rounds; initialization evidence
-- is what certifies the required fresh start.
create or replace function public.ccc_operations_r1_tracks_valid(
  p_client_id uuid,
  p_audit_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_audit public.audits%rowtype;
  v_routes jsonb;
  v_route_count integer;
begin
  select audit_row.* into v_audit
  from public.audits audit_row
  where audit_row.client_id = p_client_id
    and audit_row.id = p_audit_id
  order by audit_row.saved_at desc
  limit 1;

  if not found
    or not public.ccc_operations_classification_review_valid(v_audit.id, p_client_id, v_audit.audit) then
    return false;
  end if;

  v_routes := v_audit.audit->'classificationReview'->'routes';
  v_route_count := pg_catalog.jsonb_array_length(v_routes);
  if v_route_count < 1 or (
    select count(*)
    from public.ccc_account_tracks track
    where track.client_id = p_client_id
      and track.user_id = v_audit.user_id
      and track.source_audit_id = v_audit.id
      and track.method_version = 'ccc_skool_2026_v1'
      and track.track_scope = 'cra'
  ) <> v_route_count then
    return false;
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_routes) route(value)
    where not exists (
      select 1
      from public.ccc_account_tracks track
      where track.client_id = p_client_id
        and track.user_id = v_audit.user_id
        and track.source_audit_id = v_audit.id
        and track.method_version = 'ccc_skool_2026_v1'
        and track.track_scope = 'cra'
        and track.client_account_id::text = route.value->>'clientAccountId'
        and track.bureau_code = public.ccc_normalize_bureau_code(route.value->>'bureauCode')
        and track.account_kind = public.ccc_normalize_account_kind(route.value->>'accountKind')
        and track.native_flow = lower(pg_catalog.btrim(route.value->>'nativeFlow'))
    )
  ) or exists (
    select 1
    from public.ccc_account_tracks track
    where track.client_id = p_client_id
      and track.user_id = v_audit.user_id
      and track.source_audit_id = v_audit.id
      and track.method_version = 'ccc_skool_2026_v1'
      and track.track_scope = 'cra'
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_routes) route(value)
        where route.value->>'clientAccountId' = track.client_account_id::text
          and public.ccc_normalize_bureau_code(route.value->>'bureauCode') = track.bureau_code
          and public.ccc_normalize_account_kind(route.value->>'accountKind') = track.account_kind
          and lower(pg_catalog.btrim(route.value->>'nativeFlow')) = track.native_flow
      )
  ) or exists (
    select 1
    from public.ccc_account_tracks track
    where track.client_id = p_client_id
      and track.user_id = v_audit.user_id
      and track.source_audit_id = v_audit.id
      and track.method_version = 'ccc_skool_2026_v1'
      and track.track_scope = 'cra'
      and not exists (
        select 1
        from public.ccc_account_track_events event
        where event.track_id = track.id
          and event.event_type = 'initialized'
          and event.transition_code = 'fresh_classification_r1'
          and event.from_revision is null
          and event.to_revision = 0
          and event.event_context->>'source_audit_id' = v_audit.id
          and event.after_state->>'id' = track.id::text
          and event.after_state->>'client_id' = p_client_id::text
          and event.after_state->>'source_audit_id' = v_audit.id
          and event.after_state->>'method_version' = 'ccc_skool_2026_v1'
          and event.after_state->>'track_scope' = 'cra'
          and event.after_state->>'current_round' = '1'
          and event.after_state->>'revision' = '0'
          and event.after_state->>'cycle' = '1'
          and event.after_state->>'status' = 'active'
      )
  ) then
    return false;
  end if;

  return true;
exception when others then
  return false;
end;
$$;

revoke all on function public.ccc_operations_r1_tracks_valid(uuid, text) from public;
grant execute on function public.ccc_operations_r1_tracks_valid(uuid, text) to service_role;

-- Validate one exact physical letter against the immutable account-state
-- event at the revision captured by Campaign Studio. This remains valid after
-- a later course outcome advances the live track.
create or replace function public.ccc_operations_letter_snapshot_valid(
  p_user_id uuid,
  p_letter_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_letter public.letters%rowtype;
  v_template public.dispute_templates%rowtype;
begin
  select letter.* into v_letter
  from public.letters letter
  where letter.user_id = p_user_id and letter.id = p_letter_id;
  if not found
    or v_letter.client_id is null
    or coalesce(v_letter.phase, '') not like 'CCC Dispute —%'
    or v_letter.dispute_template_id is null
    or nullif(pg_catalog.btrim(coalesce(v_letter.dispute_template_snapshot, '')), '') is null
    or nullif(pg_catalog.btrim(coalesce(v_letter.dispute_template_family_key, '')), '') is null
    or nullif(pg_catalog.btrim(coalesce(v_letter.dispute_template_version_label, '')), '') is null
    or v_letter.dispute_flow_code is null
    or v_letter.dispute_round_number is null
    or not public.ccc_letter_identity_snapshot_matches_current(
      v_letter.user_id,
      v_letter.client_id,
      v_letter.ccc_letter_identity_snapshot
    )
    or coalesce(pg_catalog.jsonb_typeof(v_letter.dispute_automatic_values_snapshot), 'null') <> 'object'
    or not public.ccc_letter_track_snapshots_valid(v_letter.ccc_account_track_snapshots)
    or pg_catalog.jsonb_array_length(v_letter.ccc_account_track_snapshots) = 0
    or coalesce(pg_catalog.jsonb_typeof(v_letter.dispute_account_snapshot), 'null') <> 'array'
    or pg_catalog.jsonb_array_length(v_letter.dispute_account_snapshot)
      <> pg_catalog.jsonb_array_length(v_letter.ccc_account_track_snapshots) then
    return false;
  end if;

  select template.* into v_template
  from public.dispute_templates template
  where template.id = v_letter.dispute_template_id;
  if not found
    or v_template.flow_code is distinct from v_letter.dispute_flow_code
    or v_template.round_number is distinct from v_letter.dispute_round_number
    or v_template.template_family_key is distinct from v_letter.dispute_template_family_key
    or v_template.version_label is distinct from v_letter.dispute_template_version_label
    or v_template.body_text is distinct from v_letter.dispute_template_snapshot then
    return false;
  end if;

  if v_letter.target_type = 'bureau' then
    if coalesce(v_template.bureau_code, '') not in ('ALL', v_letter.dispute_bureau_code) then
      return false;
    end if;
  elsif v_letter.target_type = 'furnisher' then
    if v_template.bureau_code is distinct from 'ALL' then
      return false;
    end if;
  else
    return false;
  end if;

  if v_letter.dispute_automatic_values_snapshot->>'client_first_name'
      is distinct from v_letter.ccc_letter_identity_snapshot->>'firstName'
    or v_letter.dispute_automatic_values_snapshot->>'client_last_name'
      is distinct from v_letter.ccc_letter_identity_snapshot->>'lastName'
    or v_letter.dispute_automatic_values_snapshot->>'client_address'
      is distinct from pg_catalog.concat_ws(
        E'\n',
        v_letter.ccc_letter_identity_snapshot->>'addressLine1',
        nullif(v_letter.ccc_letter_identity_snapshot->>'addressLine2', ''),
        (v_letter.ccc_letter_identity_snapshot->>'city') || ', '
          || (v_letter.ccc_letter_identity_snapshot->>'state') || ' '
          || (v_letter.ccc_letter_identity_snapshot->>'zip')
      ) then
    return false;
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_letter.ccc_account_track_snapshots) snapshot(value)
    where snapshot.value->>'concreteFlow' is distinct from v_letter.dispute_flow_code
      or (snapshot.value->>'concreteRound')::integer is distinct from v_letter.dispute_round_number
      or (
        snapshot.value->>'trackScope' = 'cra'
        and (
          v_letter.target_type is distinct from 'bureau'
          or v_letter.target_bureau is distinct from case snapshot.value->>'bureauCode'
            when 'EQ' then 'equifax'
            when 'EXP' then 'experian'
            when 'TU' then 'transunion'
            else null
          end
          or v_letter.dispute_bureau_code is distinct from snapshot.value->>'bureauCode'
        )
      )
      or (
        snapshot.value->>'trackScope' = 'direct'
        and (
          v_letter.target_type is distinct from 'furnisher'
          or v_letter.target_bureau is not null
          or v_letter.dispute_bureau_code is not null
        )
      )
      or not exists (
        select 1
        from public.ccc_account_tracks track
        where track.id = (snapshot.value->>'trackId')::uuid
          and track.user_id = v_letter.user_id
          and track.client_id = v_letter.client_id
          and track.client_account_id::text = snapshot.value->>'clientAccountId'
          and track.method_version = snapshot.value->>'methodVersion'
          and track.track_scope = snapshot.value->>'trackScope'
          and track.bureau_code is not distinct from nullif(snapshot.value->>'bureauCode', '')
          and track.account_kind = snapshot.value->>'accountKind'
          and track.native_flow = snapshot.value->>'nativeFlow'
      )
      or not exists (
        select 1
        from public.ccc_account_track_events event
        where event.track_id = (snapshot.value->>'trackId')::uuid
          and event.to_revision = (snapshot.value->>'revision')::integer
          and event.after_state->>'current_flow' = snapshot.value->>'logicalFlow'
          and event.after_state->>'current_round' = snapshot.value->>'logicalRound'
          and event.after_state->>'cycle' = snapshot.value->>'cycle'
          and event.after_state->>'path_role' = snapshot.value->>'pathRole'
      )
      or not exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_letter.dispute_account_snapshot) account(value)
        where coalesce(account.value->>'clientAccountId', account.value->>'client_account_id')
          = snapshot.value->>'clientAccountId'
      )
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_letter.dispute_account_snapshot) account(value)
    where nullif(coalesce(account.value->>'clientAccountId', account.value->>'client_account_id'), '') is null
      or not exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_letter.ccc_account_track_snapshots) snapshot(value)
        where snapshot.value->>'clientAccountId'
          = coalesce(account.value->>'clientAccountId', account.value->>'client_account_id')
      )
  ) then
    return false;
  end if;

  return true;
exception when others then
  return false;
end;
$$;

revoke all on function public.ccc_operations_letter_snapshot_valid(uuid, text) from public;
grant execute on function public.ccc_operations_letter_snapshot_valid(uuid, text) to service_role;

create or replace function public.get_operations_queue(p_limit integer default 200)
returns table (
  issue_key text,
  source text,
  source_id text,
  severity text,
  status text,
  client_id uuid,
  client_name text,
  title text,
  detail text,
  occurred_at timestamptz,
  updated_at timestamptz,
  destination text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  return query
  with issues as (
    -- Generic ingestion/runtime health remains part of the new method.
    select
      'audit_job:' || job.id::text as issue_key,
      'audit_job'::text as source,
      job.id::text as source_id,
      case when job.status = 'error' then 'critical' else 'warning' end as severity,
      job.status,
      job.selected_client_id as client_id,
      client.name as client_name,
      case
        when job.status = 'error' then '3B analysis failed'
        when job.status = 'running' then '3B analysis appears stalled'
        else '3B analysis has not started'
      end as title,
      coalesce(nullif(job.error, ''), nullif(job.stage, ''), 'No diagnostic detail was recorded.') as detail,
      job.created_at as occurred_at,
      job.updated_at,
      case when job.selected_client_id is null then 'audit' else 'clients' end as destination,
      case when job.status = 'error' then 0 else 1 end as severity_rank
    from public.audit_jobs job
    left join public.clients client on client.id = job.selected_client_id
    where
      (job.status = 'error' and job.updated_at >= now() - interval '14 days' and not exists (
        select 1 from public.audit_jobs retry
        where retry.created_at > job.created_at
          and retry.status = 'done'
          and retry.mode = job.mode
          and retry.selected_client_id is not distinct from job.selected_client_id
      ))
      or (job.status = 'queued' and job.updated_at < now() - interval '15 minutes')
      or (job.status = 'running' and job.updated_at < now() - interval '20 minutes')

    union all

    -- Lob failure/reconciliation remains authoritative. CCC uses untracked
    -- USPS First Class, so delivery is never represented as certified proof.
    select
      'mail_submission:' || submission.id::text,
      'mail_submission'::text,
      submission.id::text,
      'critical'::text,
      submission.status,
      coalesce(submission.client_id, letter.client_id),
      coalesce(client.name, letter.client_name),
      case
        when coalesce(letter.phase, '') like 'CCC Dispute —%'
          and submission.status = 'accepted_unreconciled' then 'First Class mail needs Lob reconciliation'
        when coalesce(letter.phase, '') like 'CCC Dispute —%'
          and submission.status = 'failed' then 'First Class mail submission failed'
        when coalesce(letter.phase, '') like 'CCC Dispute —%'
          then 'First Class mail submission appears stalled'
        when submission.status = 'accepted_unreconciled' then 'Historical mail needs Lob reconciliation'
        when submission.status = 'failed' then 'Historical mail submission failed'
        else 'Historical mail submission appears stalled'
      end,
      coalesce(nullif(submission.last_error, ''), 'No diagnostic detail was recorded.'),
      submission.created_at,
      submission.updated_at,
      'letter-tracker'::text,
      0
    from public.mail_submissions submission
    left join public.letters letter on letter.id = submission.letter_id
    left join public.clients client on client.id = coalesce(submission.client_id, letter.client_id)
    where submission.status in ('failed', 'accepted_unreconciled')
       or (submission.status = 'pending' and submission.updated_at < now() - interval '10 minutes')

    union all

    -- Blueprint delivery is still a live pre-service/client communication,
    -- independent of the retired Phase workflow.
    select
      'recovery_blueprint:' || blueprint.id::text,
      'recovery_blueprint'::text,
      blueprint.id::text,
      case when blueprint.delivery_status in ('bounced', 'dropped') then 'critical' else 'warning' end,
      coalesce(blueprint.delivery_status, blueprint.status),
      blueprint.client_id,
      coalesce(client.name, blueprint.client_name),
      case
        when blueprint.delivery_status = 'bounced' then 'Recovery Blueprint email bounced'
        when blueprint.delivery_status = 'dropped' then 'Recovery Blueprint email was dropped'
        when blueprint.delivery_status = 'deferred' then 'Recovery Blueprint delivery is delayed'
        else 'Approved Recovery Blueprint has not been sent'
      end,
      coalesce(nullif(blueprint.delivery_error, ''),
        case when blueprint.status = 'approved' then 'Approved more than 24 hours ago.' else 'SendGrid has not confirmed delivery.' end),
      blueprint.approved_at,
      blueprint.updated_at,
      'clients'::text,
      case when blueprint.delivery_status in ('bounced', 'dropped') then 0 else 1 end
    from public.recovery_blueprints blueprint
    left join public.clients client on client.id = blueprint.client_id
    where blueprint.delivery_status in ('bounced', 'dropped')
       or (blueprint.delivery_status = 'deferred' and blueprint.updated_at < now() - interval '30 minutes')
       or (blueprint.status = 'approved' and blueprint.approved_at < now() - interval '24 hours')

    union all

    select
      'onboarding:' || profile.id::text,
      'onboarding'::text,
      profile.id::text,
      'warning'::text,
      'incomplete'::text,
      profile.client_id,
      coalesce(client.name, profile.full_name),
      'New-client onboarding is incomplete',
      'The secure onboarding link is older than 24 hours and the client has not completed authorization.',
      profile.created_at,
      profile.created_at,
      'clients'::text,
      1
    from public.client_profiles profile
    left join public.clients client on client.id = profile.client_id
    where coalesce(profile.onboarding_complete, false) = false
      and profile.created_at < now() - interval '24 hours'
      and not public.ccc_has_service_authorization(profile.client_id)

    union all

    -- Dispute production may never outrun the authoritative v2 agreement or
    -- immutable one-time grandfather evidence from migration 2800.
    select
      'service_authorization:' || client.id::text,
      'service_authorization'::text,
      client.id::text,
      'critical'::text,
      'blocked'::text,
      client.id,
      client.name,
      'Dispute work has no service authorization',
      'Account tracks or CCC letters exist, but the service-authorization check is not satisfied.',
      work.occurred_at,
      work.updated_at,
      'clients'::text,
      0
    from public.clients client
    join lateral (
      select min(item.at) as occurred_at, max(item.at) as updated_at
      from (
        select track.initialized_at as at
        from public.ccc_account_tracks track where track.client_id = client.id
        union all
        select letter.saved_at
        from public.letters letter
        where letter.client_id = client.id and letter.phase like 'CCC Dispute —%'
      ) item
    ) work on work.updated_at is not null
    where not public.ccc_has_service_authorization(client.id)

    union all

    select
      'classification_review:' || audit_row.user_id::text || ':' || audit_row.id,
      'classification_review'::text,
      audit_row.id,
      'warning'::text,
      'review_required'::text,
      client.id,
      client.name,
      'R1 classification needs staff confirmation',
      'A complete deterministic 3B is saved, but its exact account/bureau routing snapshot is not confirmed and hash-valid.',
      audit_row.saved_at,
      audit_row.saved_at,
      'clients'::text,
      1
    from public.clients client
    join lateral (
      select candidate.*
      from public.audits candidate
      where candidate.client_id = client.id
        and public.ccc_operations_deterministic_audit_valid(candidate.audit)
      order by candidate.saved_at desc, candidate.id desc
      limit 1
    ) audit_row on true
    where public.ccc_has_service_authorization(client.id)
      and client.engagement_status = 'active'
      and not exists (
        select 1 from public.ccc_account_tracks existing_track
        where existing_track.client_id = client.id
          and existing_track.track_scope = 'cra'
      )
      and audit_row.saved_at < now() - interval '24 hours'
      and not public.ccc_operations_classification_review_valid(audit_row.id, client.id, audit_row.audit)

    union all

    select
      'r1_tracks:' || audit_row.user_id::text || ':' || audit_row.id,
      'r1_tracks'::text,
      audit_row.id,
      'critical'::text,
      'blocked'::text,
      client.id,
      client.name,
      'R1 account/bureau setup is incomplete',
      'The confirmed routing review does not have one exact immutable R1 initialization event for every reviewed route.',
      audit_row.saved_at,
      audit_row.saved_at,
      'clients'::text,
      0
    from public.clients client
    join lateral (
      with track_source as (
        select
          min(track.source_audit_id) as audit_id,
          count(*)::integer as track_count,
          count(distinct track.source_audit_id)::integer as source_count
        from public.ccc_account_tracks track
        where track.client_id = client.id and track.track_scope = 'cra'
      ), lifecycle_source as (
        select case
          when source.track_count > 0 and source.source_count = 1 then source.audit_id
          when source.track_count = 0 then (
            select latest.id
            from public.audits latest
            where latest.client_id = client.id
              and public.ccc_operations_deterministic_audit_valid(latest.audit)
            order by latest.saved_at desc, latest.id desc
            limit 1
          )
          else null
        end as audit_id
        from track_source source
      )
      select candidate.*
      from public.audits candidate
      join lifecycle_source source on source.audit_id = candidate.id
      where candidate.client_id = client.id
        and public.ccc_operations_classification_review_valid(candidate.id, client.id, candidate.audit)
      limit 1
    ) audit_row on true
    where public.ccc_has_service_authorization(client.id)
      and client.engagement_status = 'active'
      and audit_row.saved_at < now() - interval '24 hours'
      and not public.ccc_operations_r1_tracks_valid(client.id, audit_row.id)

    union all

    select
      'letter_snapshot:' || letter.user_id::text || ':' || letter.id,
      'letter_snapshot'::text,
      letter.id,
      'critical'::text,
      'blocked'::text,
      letter.client_id,
      coalesce(client.name, letter.client_name),
      'CCC letter is not bound to exact account state',
      'Rebuild this draft from the current account tracks before mailing it.',
      letter.saved_at,
      letter.saved_at,
      'clients'::text,
      0
    from public.letters letter
    left join public.clients client on client.id = letter.client_id
    where letter.phase like 'CCC Dispute —%'
      and not public.ccc_operations_letter_snapshot_valid(letter.user_id, letter.id)
      and (
        letter.saved_at >= now() - interval '14 days'
        or exists (select 1 from public.mail_submissions submission where submission.letter_id = letter.id)
      )

    union all

    select
      'mail_method:' || submission.id::text,
      'mail_method'::text,
      submission.id::text,
      'critical'::text,
      'blocked'::text,
      coalesce(submission.client_id, letter.client_id),
      coalesce(client.name, letter.client_name),
      'CCC mailpiece is not First Class',
      'The new method requires USPS First Class. Do not treat certified mail or a missing service as ready.',
      submission.created_at,
      submission.updated_at,
      'letter-tracker'::text,
      0
    from public.mail_submissions submission
    join public.letters letter on letter.id = submission.letter_id
    left join public.clients client on client.id = coalesce(submission.client_id, letter.client_id)
    where letter.phase like 'CCC Dispute —%'
      and submission.status in ('pending', 'submitted', 'accepted_unreconciled')
      and letter.mail_service is distinct from 'usps_first_class'

    union all

    select
      'course_outcome:' || submission.id::text,
      'course_outcome'::text,
      submission.id::text,
      'warning'::text,
      'review_required'::text,
      letter.client_id,
      coalesce(client.name, letter.client_name),
      'Course result is ready for win/fail review',
      'A newer saved 3B exists after this accepted First Class letter. Review every covered account and record the letter result.',
      submission.submitted_at,
      later_audit.saved_at,
      'letter-tracker'::text,
      1
    from public.mail_submissions submission
    join public.letters letter on letter.id = submission.letter_id
    left join public.clients client on client.id = letter.client_id
    join lateral (
      select audit_row.saved_at
      from public.audits audit_row
      where audit_row.client_id = letter.client_id
        and audit_row.user_id = letter.user_id
        and submission.submitted_at is not null
        and audit_row.saved_at > submission.submitted_at
        and public.ccc_operations_deterministic_audit_valid(audit_row.audit)
      order by audit_row.saved_at desc
      limit 1
    ) later_audit on true
    where letter.phase like 'CCC Dispute —%'
      and letter.mail_service = 'usps_first_class'
      and submission.status = 'submitted'
      and not exists (
        select 1 from public.ccc_outcome_batches batch
        where batch.user_id = letter.user_id and batch.letter_id = letter.id
      )

    union all

    select
      'account_track_state:' || track.id::text,
      'account_track_state'::text,
      track.id::text,
      'critical'::text,
      track.status,
      track.client_id,
      client.name,
      'Account flow needs staff review',
      coalesce(nullif(track.review_reason, ''), 'The rules could not determine the next flow state. Do not create another letter until reviewed.'),
      track.initialized_at,
      track.updated_at,
      'clients'::text,
      0
    from public.ccc_account_tracks track
    left join public.clients client on client.id = track.client_id
    where track.status = 'review_required'

    union all

    select
      'template_review:' || template.id::text,
      'template_review'::text,
      template.id::text,
      'warning'::text,
      'review_due'::text,
      null::uuid,
      null::text,
      'Letter wording version reached seven weeks',
      template.name || ' · ' || template.version_label || ' is due for a new reviewed wording version. Existing mailed snapshots stay unchanged.',
      template.published_on::timestamptz,
      template.review_due_on::timestamptz,
      'methodology'::text,
      1
    from public.dispute_templates template
    where template.is_active = true
      and template.retired_at is null
      and template.review_due_on <= current_date
  )
  select
    issue.issue_key, issue.source, issue.source_id, issue.severity, issue.status,
    issue.client_id, issue.client_name, issue.title, issue.detail,
    issue.occurred_at, issue.updated_at, issue.destination
  from issues issue
  order by issue.severity_rank, issue.updated_at desc nulls last, issue.issue_key
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

revoke all on function public.get_operations_queue(integer) from public;
grant execute on function public.get_operations_queue(integer) to authenticated;

comment on function public.get_operations_queue(integer) is
  'Admin-only exception queue for the CCC Consent/Accuracy/Collection method. Legacy Phase jobs remain historical and are intentionally excluded.';

create or replace function public.get_client_production_readiness(p_client_id uuid)
returns table (
  sequence integer,
  check_key text,
  label text,
  status text,
  detail text,
  evidence_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.clients%rowtype;
begin
  if not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select client.* into target from public.clients client where client.id = p_client_id;
  if not found then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;

  return query
  with deterministic_audit as (
    select audit_row.*
    from public.audits audit_row
    where audit_row.client_id = p_client_id
      and public.ccc_operations_deterministic_audit_valid(audit_row.audit)
    order by audit_row.saved_at desc, audit_row.id desc
    limit 1
  ), track_source as (
    select
      min(track.source_audit_id) as audit_id,
      count(*)::integer as track_count,
      count(distinct track.source_audit_id)::integer as source_count
    from public.ccc_account_tracks track
    where track.client_id = p_client_id and track.track_scope = 'cra'
  ), lifecycle_audit as (
    -- Existing account tracks freeze the R1 source audit. A newer complete 3B
    -- remains visible above as report/outcome evidence but does not replace
    -- the classification that owns the active lifecycle.
    select audit_row.*
    from public.audits audit_row
    cross join track_source source
    where audit_row.client_id = p_client_id
      and public.ccc_operations_deterministic_audit_valid(audit_row.audit)
      and (
        (source.track_count > 0 and source.source_count = 1 and audit_row.id = source.audit_id)
        or (source.track_count = 0 and audit_row.id = (select latest.id from deterministic_audit latest))
      )
  ), reviewed_audit as (
    -- Validate the lifecycle source, not an unrelated later outcome report.
    select audit_row.*
    from lifecycle_audit audit_row
    where public.ccc_operations_classification_review_valid(
      audit_row.id,
      p_client_id,
      audit_row.audit
    )
  ), lifecycle_letter_candidate as (
    select letter.*
    from public.letters letter
    where letter.user_id = target.user_id
      and letter.client_id = p_client_id
      and letter.phase like 'CCC Dispute —%'
    -- Always inspect the latest physical CCC letter first. Filtering for a
    -- valid letter before ordering could let an older completed letter hide a
    -- newer malformed or still-pending one.
    order by letter.saved_at desc, letter.id desc
    limit 1
  ), lifecycle_letter as (
    select letter.*
    from lifecycle_letter_candidate letter
    join reviewed_audit reviewed on true
    where case
      when public.ccc_operations_letter_snapshot_valid(letter.user_id, letter.id) then not exists (
        select 1
        from jsonb_array_elements(letter.ccc_account_track_snapshots) snapshot(value)
        join public.ccc_account_tracks track on track.id = (snapshot.value->>'trackId')::uuid
        where track.source_audit_id is distinct from reviewed.id
      )
      else false
    end
  ), accepted_mail as (
    select submission.*
    from public.mail_submissions submission
    join lifecycle_letter letter on letter.id = submission.letter_id
    where submission.status = 'submitted'
      and letter.mail_service = 'usps_first_class'
    limit 1
  ), reviewed_outcome as (
    select batch.*
    from public.ccc_outcome_batches batch
    join lifecycle_letter letter
      on letter.user_id = batch.user_id and letter.id = batch.letter_id
    order by batch.reviewed_at desc
    limit 1
  ), resulting_state as (
    select
      max(event.created_at) as state_at,
      count(*)::integer as state_count,
      coalesce(bool_and(
        jsonb_typeof(event.before_state) = 'object'
        and jsonb_typeof(event.after_state) = 'object'
        and event.track_revision_after >= event.track_revision
        and (
          (event.next_action = 'hold' and event.transition_event_id is null)
          or (event.next_action <> 'hold' and event.transition_event_id is not null)
        )
      ), false) as state_valid
    from public.ccc_outcome_result_events event
    join reviewed_outcome batch on batch.id = event.batch_id
  ), facts as (
    select
      public.ccc_has_service_authorization(p_client_id) as service_authorized,
      deterministic.id as deterministic_audit_id,
      deterministic.saved_at as deterministic_audit_at,
      deterministic.report_date as deterministic_report_date,
      lifecycle.id as lifecycle_audit_id,
      lifecycle.audit->'classificationReview' is not null as has_review_payload,
      coalesce(source.track_count, 0) as lifecycle_track_count,
      coalesce(source.source_count, 0) as lifecycle_source_count,
      reviewed.id as reviewed_audit_id,
      reviewed.saved_at as reviewed_at,
      coalesce(jsonb_array_length(reviewed.audit->'classificationReview'->'routes'), 0) as reviewed_route_count,
      case when reviewed.id is null then false
        else public.ccc_operations_r1_tracks_valid(p_client_id, reviewed.id)
      end as r1_tracks_valid,
      (select count(*)::integer from public.ccc_account_tracks track
        where track.client_id = p_client_id and track.source_audit_id = reviewed.id and track.track_scope = 'cra') as r1_track_count,
      coalesce(source.track_count, 0) > 0 as has_source_tracks,
      letter.id as letter_id,
      letter.saved_at as letter_at,
      letter.dispute_flow_code as letter_flow,
      letter.dispute_round_number as letter_round,
      letter.dispute_bureau_code as letter_bureau,
      letter.dispute_template_version_label as letter_version,
      exists (select 1 from public.letters any_letter
        where any_letter.client_id = p_client_id and any_letter.phase like 'CCC Dispute —%') as has_ccc_letter,
      mail.id as mail_id,
      coalesce(mail.submitted_at, mail.updated_at) as mail_at,
      exists (
        select 1
        from public.mail_submissions wrong_mail
        join public.letters wrong_letter on wrong_letter.id = wrong_mail.letter_id
        where wrong_letter.client_id = p_client_id
          and wrong_letter.phase like 'CCC Dispute —%'
          and wrong_mail.status in ('pending', 'submitted', 'accepted_unreconciled')
          and wrong_letter.mail_service is distinct from 'usps_first_class'
      ) as has_wrong_mail_method,
      outcome.id as outcome_id,
      outcome.reviewed_at as outcome_at,
      outcome.result_count,
      outcome.is_letter_win,
      state.state_at,
      state.state_count,
      state.state_valid,
      exists (select 1 from public.ccc_account_tracks track
        where track.client_id = p_client_id and track.status = 'review_required') as has_blocked_track
    from (select 1) seed
    left join deterministic_audit deterministic on true
    left join track_source source on true
    left join lifecycle_audit lifecycle on true
    left join reviewed_audit reviewed on true
    left join lifecycle_letter letter on true
    left join accepted_mail mail on true
    left join reviewed_outcome outcome on true
    left join resulting_state state on true
  )
  select check_row.sequence, check_row.check_key, check_row.label,
    check_row.status, check_row.detail, check_row.evidence_at
  from facts fact
  cross join lateral (values
    (1, 'service_authorization', 'Onboarding and service authorization',
      case when fact.service_authorized then 'passed' else 'pending' end,
      case when fact.service_authorized
        then 'The current service-agreement or immutable grandfather check passed.'
        else 'Complete the new-client agreement flow before dispute production. Existing signed clients pass only through the grandfather record.'
      end,
      null::timestamptz),
    (2, 'deterministic_audit', 'Complete deterministic 3B saved',
      case when fact.deterministic_audit_id is not null then 'passed' else 'pending' end,
      case when fact.deterministic_audit_id is not null
        then 'Stored ' || coalesce(fact.deterministic_report_date, 'undated report') || ' with complete Equifax, Experian, and TransUnion coverage.'
        else 'No complete deterministic-audit-v4 3B is stored for this client.'
      end,
      fact.deterministic_audit_at),
    (3, 'classification_review', 'R1 routing confirmed',
      case
        when fact.reviewed_audit_id is not null then 'passed'
        when fact.has_review_payload or fact.lifecycle_track_count > 0 then 'blocked'
        else 'pending'
      end,
      case
        when fact.reviewed_audit_id is not null then fact.reviewed_route_count::text || ' account/bureau route(s) are staff-confirmed and hash-valid for the immutable R1 source audit. Later 3B reports remain outcome evidence.'
        when fact.lifecycle_track_count > 0 and fact.lifecycle_source_count <> 1 then 'Existing CRA tracks do not resolve to one immutable R1 source audit. Hold production for data review.'
        when fact.lifecycle_track_count > 0 and fact.lifecycle_audit_id is null then 'Existing CRA tracks reference a missing or invalid R1 source audit. Hold production for data review.'
        when fact.has_review_payload then 'A review payload exists, but its identity, reviewer, route hash, or full routing snapshot did not validate.'
        else 'Staff has not confirmed the exact account/bureau R1 routing snapshot.'
      end,
      fact.reviewed_at),
    (4, 'r1_tracks', 'Every account/bureau started at R1',
      case
        when fact.r1_tracks_valid then 'passed'
        when fact.has_source_tracks then 'blocked'
        else 'pending'
      end,
      case
        when fact.r1_tracks_valid then fact.r1_track_count::text || ' immutable CRA initialization event(s) prove a fresh R1 start.'
        when fact.has_source_tracks then 'Tracks exist, but they do not exactly match the confirmed routes and revision-zero R1 evidence.'
        else 'Initialize the confirmed classification into one R1 CRA track per account and bureau.'
      end,
      fact.reviewed_at),
    (5, 'state_bound_letter', 'Latest physical letter is state-bound',
      case
        when fact.letter_id is not null then 'passed'
        when fact.has_ccc_letter then 'blocked'
        else 'pending'
      end,
      case
        when fact.letter_id is not null then 'Latest validated letter: ' || initcap(replace(fact.letter_flow, '_', ' ')) || ' R' || fact.letter_round::text || coalesce(' · ' || fact.letter_bureau, '') || ' uses frozen template ' || fact.letter_version || '. This check does not certify other bureau or flow letters.'
        when fact.has_ccc_letter then 'The latest physical CCC draft did not validate against its template, recipient, account coverage, or immutable track revision.'
        else 'Build the next physical letter from its exact current track state and template version.'
      end,
      fact.letter_at),
    (6, 'first_class_mail', 'Latest letter accepted as First Class',
      case
        when fact.mail_id is not null then 'passed'
        when fact.has_wrong_mail_method then 'blocked'
        else 'pending'
      end,
      case
        when fact.mail_id is not null then 'Lob accepted this latest state-bound letter as USPS First Class; other required letters are evaluated separately.'
        when fact.has_wrong_mail_method then 'A CCC submission uses certified mail or has no explicit First Class service. Correct it before proceeding.'
        else 'No accepted USPS First Class submission is stored for this latest state-bound letter.'
      end,
      fact.mail_at),
    (7, 'course_outcome', 'Course win/fail reviewed',
      case when fact.outcome_id is not null then 'passed' else 'pending' end,
      case when fact.outcome_id is not null
        then 'Every covered account was reviewed; this letter is recorded as ' || case when fact.is_letter_win then 'WIN' else 'FAIL' end || '.'
        else 'After a new 3B is saved, review every covered account and record one immutable letter result.'
      end,
      fact.outcome_at),
    (8, 'next_track_state', 'Next account state stored',
      case
        when fact.outcome_id is not null
          and fact.state_valid
          and fact.state_count = fact.result_count
          and not fact.has_blocked_track then 'passed'
        when fact.outcome_id is not null then 'blocked'
        else 'pending'
      end,
      case
        when fact.outcome_id is not null
          and fact.state_valid
          and fact.state_count = fact.result_count
          and not fact.has_blocked_track then fact.state_count::text || ' reviewed result(s) stored the next close, advance, switch, or hold state.'
        when fact.outcome_id is not null and fact.has_blocked_track then 'At least one account reached review-required. Resolve it before creating the next letter.'
        when fact.outcome_id is not null then 'The result batch does not have a complete matching next-state record.'
        else 'Next state is recorded atomically when the course result is reviewed.'
      end,
      fact.state_at)
  ) as check_row(sequence, check_key, label, status, detail, evidence_at)
  order by check_row.sequence;
end;
$$;

revoke all on function public.get_client_production_readiness(uuid) from public;
grant execute on function public.get_client_production_readiness(uuid) to authenticated;

comment on function public.get_client_production_readiness(uuid) is
  'Admin-only, fail-closed evidence checklist for one client under the CCC Consent/Accuracy/Collection method.';

commit;
