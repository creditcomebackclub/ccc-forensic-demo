-- Compatibility-safe hardening: existing CCC tracks/events are preserved.
-- New CRA initialization requires a versioned, staff-attested review whose
-- complete routing-facts snapshot is hashed and frozen into every track.
-- Rollback is the prior 2200 RPC definition plus removal of the audit trigger;
-- no stored client data is deleted by this migration.

create or replace function public.ccc_normalize_bureau_code(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select case regexp_replace(lower(btrim(coalesce(p_value, ''))), '[^a-z]', '', 'g')
    when 'eq' then 'EQ'
    when 'equifax' then 'EQ'
    when 'exp' then 'EXP'
    when 'experian' then 'EXP'
    when 'tu' then 'TU'
    when 'transunion' then 'TU'
    else null
  end;
$$;

create or replace function public.ccc_normalize_account_kind(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(regexp_replace(btrim(coalesce(p_value, '')), '[ -]+', '_', 'g'))
    when 'chargeoff' then 'charge_off'
    when 'charged_off' then 'charge_off'
    when 'collection_account' then 'collection'
    when 'repo' then 'repossession'
    when 'late' then 'late_payment'
    else lower(regexp_replace(btrim(coalesce(p_value, '')), '[ -]+', '_', 'g'))
  end;
$$;

create or replace function public.ccc_canonical_bureau_array(p_bureaus jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_result text;
begin
  if coalesce(jsonb_typeof(p_bureaus), 'null') <> 'array' then
    raise exception 'Reported bureaus must be an array';
  end if;
  if jsonb_array_length(p_bureaus) = 0 or exists (
    select 1 from jsonb_array_elements_text(p_bureaus) item(value)
    where public.ccc_normalize_bureau_code(item.value) is null
  ) or exists (
    select 1 from jsonb_array_elements_text(p_bureaus) item(value)
    group by public.ccc_normalize_bureau_code(item.value)
    having count(*) > 1
  ) then
    raise exception 'Every account requires a unique, recognized reported-bureau list';
  end if;
  select '[' || string_agg(to_jsonb(public.ccc_normalize_bureau_code(item.value))::text, ',' order by public.ccc_normalize_bureau_code(item.value)) || ']'
  into v_result
  from jsonb_array_elements_text(p_bureaus) item(value);
  return v_result;
end;
$$;

create or replace function public.ccc_canonical_classification_routes(p_routes jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_result text;
begin
  if coalesce(jsonb_typeof(p_routes), 'null') <> 'array' then
    raise exception 'Classification review routes must be an array';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_routes) item(value)
    where jsonb_typeof(item.value) <> 'object'
      or nullif(item.value->>'accountKind', '') is null
      or public.ccc_normalize_bureau_code(item.value->>'bureauCode') is null
      or nullif(item.value->>'clientAccountId', '') is null
      or nullif(item.value->>'nativeFlow', '') is null
  ) then
    raise exception 'Classification review routes contain an incomplete route';
  end if;

  select '[' || coalesce(string_agg(
    '{"accountKind":' || to_jsonb(public.ccc_normalize_account_kind(item.value->>'accountKind'))::text
      || ',"bureauCode":' || to_jsonb(public.ccc_normalize_bureau_code(item.value->>'bureauCode'))::text
      || ',"clientAccountId":' || to_jsonb(btrim(item.value->>'clientAccountId'))::text
      || ',"nativeFlow":' || to_jsonb(lower(btrim(item.value->>'nativeFlow')))::text || '}',
    ',' order by btrim(item.value->>'clientAccountId'), public.ccc_normalize_bureau_code(item.value->>'bureauCode'),
      public.ccc_normalize_account_kind(item.value->>'accountKind'), lower(btrim(item.value->>'nativeFlow'))
  ), '') || ']'
  into v_result
  from jsonb_array_elements(p_routes) item(value);
  return v_result;
end;
$$;

create or replace function public.ccc_classification_routes_sha256(p_routes jsonb)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(
    extensions.digest(convert_to(public.ccc_canonical_classification_routes(p_routes), 'UTF8'), 'sha256'),
    'hex'
  );
$$;

create or replace function public.prevent_initialized_audit_routing_rewrite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    old.audit->'classificationReview' is distinct from new.audit->'classificationReview'
    or old.audit->'accounts' is distinct from new.audit->'accounts'
    or old.audit->'reportCoverage' is distinct from new.audit->'reportCoverage'
  ) and exists (
    select 1 from public.ccc_account_tracks track
    where track.user_id = old.user_id
      and track.source_audit_id = old.id
      and track.track_scope = 'cra'
  ) then
    raise exception 'Initialized CCC audit classifications and routing facts are immutable; use a new saved audit';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_initialized_audit_routing on public.audits;
create trigger protect_initialized_audit_routing
before update of audit on public.audits
for each row execute function public.prevent_initialized_audit_routing_rewrite();

-- Remove the four-argument initializer so an older browser cannot bypass the
-- review-version and full-snapshot binding added below.
drop function if exists public.initialize_ccc_account_tracks(uuid, text, jsonb, text);
drop function if exists public.initialize_ccc_account_tracks(uuid, text, jsonb, integer, text, text);

create function public.initialize_ccc_account_tracks(
  p_client_id uuid,
  p_audit_id text,
  p_classifications jsonb,
  p_review_version integer,
  p_review_snapshot_sha256 text,
  p_method_version text default 'ccc_skool_2026_v1'
)
returns setof public.ccc_account_tracks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_client public.clients%rowtype;
  v_audit public.audits%rowtype;
  v_review jsonb;
  v_review_routes jsonb;
  v_input_routes jsonb;
  v_review_hash text;
  v_snapshot jsonb;
  v_snapshot_canonical text;
  v_snapshot_hash text;
  v_item jsonb;
  v_audit_account jsonb;
  v_snapshot_account jsonb;
  v_routing jsonb;
  v_bureau_fact jsonb;
  v_account public.client_accounts%rowtype;
  v_account_id uuid;
  v_kind text;
  v_native_flow text;
  v_bureau text;
  v_has_repo boolean;
  v_has_accuracy boolean;
  v_has_collection boolean;
  v_current_flow text;
  v_path_role text;
  v_track public.ccc_account_tracks%rowtype;
  v_match_count integer;
  v_expected_route_count integer;
begin
  if v_caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select role into v_role from public.profiles where id = v_caller;
  if v_role is null or v_role not in ('admin', 'auditor') then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(p_classifications), 'null') <> 'array'
    or jsonb_array_length(p_classifications) = 0 then
    raise exception 'Fresh reviewed classifications are required';
  end if;
  if pg_column_size(p_classifications) > 1048576
    or exists (
      select 1 from jsonb_array_elements(p_classifications) classification(value)
      where jsonb_typeof(classification.value) <> 'object'
    ) then
    raise exception 'Classifications must be a bounded array of objects';
  end if;
  if p_method_version is distinct from 'ccc_skool_2026_v1' then
    raise exception 'Unsupported CCC method version';
  end if;
  if p_review_version is null or p_review_version < 1
    or lower(coalesce(p_review_snapshot_sha256, '')) !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid frozen classification review version and snapshot hash are required';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_classifications) item(value)
    where coalesce(jsonb_typeof(item.value->'bureaus'), 'null') <> 'array'
      or jsonb_array_length(item.value->'bureaus') <> 1
      or public.ccc_normalize_bureau_code(item.value->'bureaus'->>0) is null
  ) then
    raise exception 'Every reviewed classification must contain exactly one recognized bureau';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_classifications) item(value)
    group by item.value->>'client_account_id', public.ccc_normalize_bureau_code(item.value->'bureaus'->>0)
    having count(*) > 1
  ) then
    raise exception 'Duplicate account/bureau route in CCC initialization';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_classifications) item(value)
    where coalesce((item.value->>'direct_track')::boolean, false)
  ) then
    raise exception 'Direct tracks cannot be created from the CRA classification review';
  end if;

  select * into v_client
  from public.clients
  where id = p_client_id
  for update;
  if not found or (v_role is distinct from 'admin' and v_client.user_id is distinct from v_caller) then
    raise exception 'Client not found' using errcode = '42501';
  end if;
  if coalesce(v_client.engagement_status, 'pending_onboarding') is distinct from 'active' then
    raise exception 'Fresh CCC account tracks require an active client engagement' using errcode = '42501';
  end if;
  if public.ccc_has_service_authorization(v_client.id) is not true then
    raise exception 'Fresh CCC account tracks require current service authorization' using errcode = '42501';
  end if;

  -- The row lock serializes a classification save against initialization. The
  -- audit trigger then makes the bound review/routing facts immutable once the
  -- first track insert commits.
  perform pg_advisory_xact_lock(hashtextextended(v_client.user_id::text || ':' || p_audit_id || ':' || p_method_version, 0));
  select * into v_audit from public.audits
  where user_id = v_client.user_id and client_id = v_client.id and id = p_audit_id
  for update;
  if not found then raise exception 'The source audit does not belong to this client'; end if;

  v_review := v_audit.audit->'classificationReview';
  if coalesce(jsonb_typeof(v_review), 'null') <> 'object'
    or v_review->>'status' is distinct from 'confirmed'
    or v_review->>'methodVersion' is distinct from p_method_version
    or v_review->>'auditId' is distinct from p_audit_id
    or v_review->>'clientId' is distinct from p_client_id::text
    or (case when coalesce(v_review->>'version', '') ~ '^\d+$' then (v_review->>'version')::integer else 0 end) is distinct from p_review_version
    or nullif(v_review->>'reviewedAt', '') is null
    or nullif(v_review->>'reviewedBy', '') is null
    or coalesce(v_review->>'reviewedBy', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'The exact source audit has no matching versioned staff classification review';
  end if;
  if not exists (
    select 1 from public.profiles reviewer
    where reviewer.id = (v_review->>'reviewedBy')::uuid
      and reviewer.role in ('admin', 'auditor')
      and (reviewer.role = 'admin' or reviewer.id = v_audit.user_id)
  ) then
    raise exception 'Classification reviewer is not authorized for this audit';
  end if;
  if coalesce((v_audit.audit->'reportCoverage'->>'complete')::boolean, false) is not true
    or jsonb_array_length(coalesce(v_audit.audit->'reportCoverage'->'missing', '[]'::jsonb)) <> 0
    or jsonb_array_length(coalesce(v_audit.audit->'reportCoverage'->'duplicates', '[]'::jsonb)) <> 0
    or coalesce((v_audit.audit->'reportCoverage'->'counts'->>'EQ')::integer, 0) <> 1
    or coalesce((v_audit.audit->'reportCoverage'->'counts'->>'EXP')::integer, 0) <> 1
    or coalesce((v_audit.audit->'reportCoverage'->'counts'->>'TU')::integer, 0) <> 1 then
    raise exception 'A complete one-of-each 3B source is required';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_audit.audit->'accounts', '[]'::jsonb)) source(value)
    where nullif(source.value->>'id', '') is null
      or nullif(coalesce(source.value->>'clientAccountId', source.value->>'client_account_id'), '') is null
  ) or exists (
    select 1
    from jsonb_array_elements(coalesce(v_audit.audit->'accounts', '[]'::jsonb)) source(value)
    group by source.value->>'id'
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_array_elements(coalesce(v_audit.audit->'accounts', '[]'::jsonb)) source(value)
    group by coalesce(source.value->>'clientAccountId', source.value->>'client_account_id')
    having count(*) > 1
  ) then
    raise exception 'Every source account requires unique audit and canonical client account identities';
  end if;

  v_review_routes := v_review->'routes';
  v_review_hash := lower(coalesce(v_review->>'routesSha256', ''));
  if v_review_hash !~ '^[0-9a-f]{64}$'
    or v_review_hash is distinct from public.ccc_classification_routes_sha256(v_review_routes) then
    raise exception 'Stored classification review route hash is missing or invalid';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_review_routes) route(value)
    group by route.value->>'clientAccountId', public.ccc_normalize_bureau_code(route.value->>'bureauCode')
    having count(*) > 1
  ) then
    raise exception 'Stored classification review contains duplicate routes';
  end if;

  v_snapshot := v_review->'routingSnapshot';
  v_snapshot_canonical := v_review->>'routingSnapshotCanonical';
  v_snapshot_hash := lower(coalesce(v_review->>'routingSnapshotSha256', ''));
  if coalesce(jsonb_typeof(v_snapshot), 'null') <> 'object'
    or nullif(v_snapshot_canonical, '') is null
    or v_snapshot_hash is distinct from lower(p_review_snapshot_sha256)
    or v_snapshot_hash !~ '^[0-9a-f]{64}$'
    or v_snapshot_hash is distinct from encode(extensions.digest(convert_to(v_snapshot_canonical, 'UTF8'), 'sha256'), 'hex') then
    raise exception 'The full routing-facts snapshot hash is missing or invalid';
  end if;
  begin
    if v_snapshot_canonical::jsonb is distinct from v_snapshot then
      raise exception 'The canonical routing snapshot does not match its JSON value';
    end if;
  exception when invalid_text_representation then
    raise exception 'The canonical routing snapshot is not valid JSON';
  end;
  if v_snapshot->>'auditId' is distinct from p_audit_id
    or v_snapshot->>'clientId' is distinct from p_client_id::text
    or v_snapshot->>'methodVersion' is distinct from p_method_version
    or public.ccc_canonical_classification_routes(v_snapshot->'routes')
      is distinct from public.ccc_canonical_classification_routes(v_review_routes) then
    raise exception 'The full routing snapshot does not bind this exact audit, client, method, and route set';
  end if;

  -- The snapshot must contain every source account exactly once, with the full
  -- reviewed routingFacts object and normalized bureau scope unchanged.
  if jsonb_array_length(coalesce(v_snapshot->'accounts', '[]'::jsonb))
    <> jsonb_array_length(coalesce(v_audit.audit->'accounts', '[]'::jsonb)) then
    raise exception 'The routing snapshot does not contain every source account';
  end if;
  for v_audit_account in select value from jsonb_array_elements(coalesce(v_audit.audit->'accounts', '[]'::jsonb)) loop
    select count(*)
    into v_match_count
    from jsonb_array_elements(coalesce(v_snapshot->'accounts', '[]'::jsonb)) snapshot_account(value)
    where snapshot_account.value->>'accountId' = v_audit_account->>'id';
    select snapshot_account.value
    into v_snapshot_account
    from jsonb_array_elements(coalesce(v_snapshot->'accounts', '[]'::jsonb)) snapshot_account(value)
    where snapshot_account.value->>'accountId' = v_audit_account->>'id'
    limit 1;
    if v_match_count <> 1
      or v_snapshot_account->>'clientAccountId' is distinct from coalesce(v_audit_account->>'clientAccountId', v_audit_account->>'client_account_id')
      or v_snapshot_account->>'accountKind' is distinct from public.ccc_normalize_account_kind(v_audit_account->'routingFacts'->>'accountKind')
      or coalesce((v_snapshot_account->>'excluded')::boolean, false) is distinct from (public.ccc_normalize_account_kind(v_audit_account->'routingFacts'->>'accountKind') = 'positive')
      or public.ccc_canonical_bureau_array(v_snapshot_account->'bureaus') is distinct from public.ccc_canonical_bureau_array(v_audit_account->'bureaus')
      or v_snapshot_account->'routingFacts' is distinct from v_audit_account->'routingFacts' then
      raise exception 'The frozen routing snapshot does not exactly match source account %', coalesce(v_audit_account->>'id', 'unknown');
    end if;
  end loop;

  -- Prove set equality: every non-positive source account/bureau pair has one
  -- route and positive/excluded accounts have none. Aliases/lowercase normalize
  -- before comparison; duplicates have already been rejected.
  select count(*) into v_expected_route_count
  from jsonb_array_elements(coalesce(v_audit.audit->'accounts', '[]'::jsonb)) source(value)
  cross join lateral jsonb_array_elements_text(source.value->'bureaus') bureau(value)
  where public.ccc_normalize_account_kind(source.value->'routingFacts'->>'accountKind') <> 'positive';
  if v_expected_route_count <> jsonb_array_length(v_review_routes)
    or exists (
      select 1
      from jsonb_array_elements(coalesce(v_audit.audit->'accounts', '[]'::jsonb)) source(value)
      cross join lateral jsonb_array_elements_text(source.value->'bureaus') bureau(value)
      where public.ccc_normalize_account_kind(source.value->'routingFacts'->>'accountKind') <> 'positive'
        and not exists (
          select 1 from jsonb_array_elements(v_review_routes) route(value)
          where route.value->>'clientAccountId' = coalesce(source.value->>'clientAccountId', source.value->>'client_account_id')
            and public.ccc_normalize_bureau_code(route.value->>'bureauCode') = public.ccc_normalize_bureau_code(bureau.value)
            and public.ccc_normalize_account_kind(route.value->>'accountKind') = public.ccc_normalize_account_kind(source.value->'routingFacts'->>'accountKind')
        )
    ) or exists (
      select 1 from jsonb_array_elements(v_review_routes) route(value)
      where not exists (
        select 1
        from jsonb_array_elements(coalesce(v_audit.audit->'accounts', '[]'::jsonb)) source(value)
        cross join lateral jsonb_array_elements_text(source.value->'bureaus') bureau(value)
        where public.ccc_normalize_account_kind(source.value->'routingFacts'->>'accountKind') <> 'positive'
          and route.value->>'clientAccountId' = coalesce(source.value->>'clientAccountId', source.value->>'client_account_id')
          and public.ccc_normalize_bureau_code(route.value->>'bureauCode') = public.ccc_normalize_bureau_code(bureau.value)
      )
    ) then
    raise exception 'Every non-excluded source account/bureau pair must have exactly one normalized route';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'accountKind', public.ccc_normalize_account_kind(item.value->>'account_kind'),
    'bureauCode', public.ccc_normalize_bureau_code(item.value->'bureaus'->>0),
    'clientAccountId', btrim(item.value->>'client_account_id'),
    'nativeFlow', lower(btrim(item.value->>'native_flow'))
  )), '[]'::jsonb)
  into v_input_routes
  from jsonb_array_elements(p_classifications) item(value);
  if public.ccc_canonical_classification_routes(v_input_routes)
    is distinct from public.ccc_canonical_classification_routes(v_review_routes) then
    raise exception 'Requested classifications do not exactly match the saved staff review';
  end if;

  for v_item in select value from jsonb_array_elements(p_classifications) loop
    begin
      v_account_id := nullif(v_item->>'client_account_id', '')::uuid;
    exception when others then
      raise exception 'Every reviewed route requires a valid canonical client account id';
    end;
    v_kind := public.ccc_normalize_account_kind(v_item->>'account_kind');
    v_native_flow := lower(btrim(coalesce(v_item->>'native_flow', '')));
    v_bureau := public.ccc_normalize_bureau_code(v_item->'bureaus'->>0);
    if v_kind not in ('collection', 'repossession', 'charge_off', 'late_payment', 'student_loan', 'bankruptcy') then
      raise exception 'Unsupported frozen account kind: %', v_kind;
    end if;
    if v_native_flow not in ('accuracy', 'collection', 'consent', 'late_pay', 'repo') then
      raise exception 'Direct/Combo cannot be supplied as a CRA-native classification';
    end if;
    if v_bureau is null then raise exception 'Unknown bureau in CCC classification'; end if;
    if (v_kind = 'repossession') is distinct from (v_native_flow = 'repo') then
      raise exception 'Repossession must use the independent Repo native flow';
    end if;

    select * into v_account from public.client_accounts
    where id = v_account_id and user_id = v_client.user_id and client_id = v_client.id;
    if not found or v_account.needs_review then
      raise exception 'Account identity is missing or requires reconciliation';
    end if;
    select count(*) into v_match_count
    from jsonb_array_elements(coalesce(v_audit.audit->'accounts', '[]'::jsonb)) source(value)
    where coalesce(source.value->>'clientAccountId', source.value->>'client_account_id') = v_account_id::text;
    if v_match_count <> 1 then
      raise exception 'Classified account is missing or duplicated in the source audit';
    end if;
    select source.value into v_audit_account
    from jsonb_array_elements(coalesce(v_audit.audit->'accounts', '[]'::jsonb)) source(value)
    where coalesce(source.value->>'clientAccountId', source.value->>'client_account_id') = v_account_id::text;
    if not exists (
      select 1 from jsonb_array_elements_text(v_audit_account->'bureaus') bureau(value)
      where public.ccc_normalize_bureau_code(bureau.value) = v_bureau
    ) then
      raise exception 'Classified bureau % is not active in the frozen audit account', v_bureau;
    end if;
    v_routing := v_audit_account->'routingFacts';
    if coalesce(jsonb_typeof(v_routing), 'null') <> 'object'
      or v_routing->>'status' is distinct from 'confirmed'
      or v_routing->>'source' is distinct from 'staff_review'
      or public.ccc_normalize_account_kind(v_routing->>'accountKind') is distinct from v_kind
      or v_routing->>'reviewedBy' is distinct from v_review->>'reviewedBy'
      or v_routing->>'reviewedAt' is distinct from v_review->>'reviewedAt'
      or coalesce((v_routing->>'staffAttested')::boolean, false) is not true
      or jsonb_array_length(coalesce(v_routing->'blockingCodes', '[]'::jsonb)) <> 0 then
      raise exception 'The frozen account route is not a confirmed staff-attested fact';
    end if;
    v_bureau_fact := v_routing->'bureauFacts'->v_bureau;
    if v_kind = 'late_payment' then
      if coalesce(jsonb_typeof(v_bureau_fact), 'null') <> 'object'
        or v_bureau_fact->>'accountKind' is distinct from 'late_payment'
        or v_bureau_fact->>'latePaymentStatus' is distinct from 'confirmed'
        or v_bureau_fact->>'latePaymentBand' not in ('two_or_fewer', 'three_or_more', 'mixed')
        or coalesce(v_bureau_fact->>'latePaymentCount', '') !~ '^\d{1,3}$' then
        raise exception 'Late-payment route lacks confirmed non-zero facts for bureau %', v_bureau;
      end if;
      if (v_bureau_fact->>'latePaymentCount')::integer not between 1 and 500
        or (v_bureau_fact->>'latePaymentBand' = 'two_or_fewer' and (v_bureau_fact->>'latePaymentCount')::integer not between 1 and 2)
        or (v_bureau_fact->>'latePaymentBand' = 'three_or_more' and (v_bureau_fact->>'latePaymentCount')::integer < 3)
        or (v_bureau_fact->>'latePaymentBand' = 'mixed' and (v_bureau_fact->>'latePaymentCount')::integer < 3) then
        raise exception 'Late-payment count/pattern is inconsistent for bureau %', v_bureau;
      end if;
    end if;

    select exists (
      select 1 from jsonb_array_elements(p_classifications) peer(value)
      where lower(peer.value->>'native_flow') = 'repo'
        and public.ccc_normalize_bureau_code(peer.value->'bureaus'->>0) = v_bureau
    ) into v_has_repo;
    select exists (
      select 1 from jsonb_array_elements(p_classifications) peer(value)
      where lower(peer.value->>'native_flow') = 'accuracy'
        and public.ccc_normalize_bureau_code(peer.value->'bureaus'->>0) = v_bureau
    ) into v_has_accuracy;
    select exists (
      select 1 from jsonb_array_elements(p_classifications) peer(value)
      where lower(peer.value->>'native_flow') = 'collection'
        and public.ccc_normalize_bureau_code(peer.value->'bureaus'->>0) = v_bureau
    ) into v_has_collection;

    if v_native_flow = 'repo' then
      v_current_flow := 'repo'; v_path_role := 'repo_primary';
    elsif v_native_flow = 'collection' and v_has_repo then
      v_current_flow := 'repo'; v_path_role := 'repo_companion';
    elsif v_native_flow in ('accuracy', 'collection') and not v_has_repo and v_has_accuracy and v_has_collection then
      v_current_flow := 'combo'; v_path_role := 'standard';
    else
      v_current_flow := v_native_flow; v_path_role := 'standard';
    end if;

    insert into public.ccc_account_tracks (
      user_id, client_id, client_account_id, track_scope, bureau_code,
      method_version, account_kind, native_flow, current_flow, current_round,
      path_role, status, cycle, revision, used_native_rounds, source_audit_id,
      source_audit_snapshot, classification_snapshot, initialized_by
    ) values (
      v_client.user_id, v_client.id, v_account.id, 'cra', v_bureau,
      p_method_version, v_kind, v_native_flow, v_current_flow, 1,
      v_path_role, 'active', 1, 0, '{}'::jsonb, v_audit.id,
      v_audit_account,
      v_item || jsonb_build_object(
        'reviewVersion', p_review_version,
        'reviewRoutesSha256', v_review_hash,
        'reviewSnapshotSha256', v_snapshot_hash
      ),
      v_caller
    )
    on conflict (user_id, client_account_id, bureau_code, method_version) where track_scope = 'cra'
    do nothing
    returning * into v_track;

    if found then
      insert into public.ccc_account_track_events (
        track_id, user_id, client_id, client_account_id, bureau_code, method_version,
        event_type, transition_code, from_revision, to_revision, after_state, event_context, actor_id
      ) values (
        v_track.id, v_track.user_id, v_track.client_id, v_track.client_account_id, v_track.bureau_code, v_track.method_version,
        'initialized', 'fresh_classification_r1', null, 0, to_jsonb(v_track),
        jsonb_build_object(
          'source_audit_id', v_audit.id,
          'review_version', p_review_version,
          'review_routes_sha256', v_review_hash,
          'review_snapshot_sha256', v_snapshot_hash
        ),
        v_caller
      );
    else
      select * into v_track from public.ccc_account_tracks
      where user_id = v_client.user_id and client_account_id = v_account.id
        and bureau_code = v_bureau and method_version = p_method_version and track_scope = 'cra';
      if not found
        or v_track.client_id is distinct from v_client.id
        or v_track.source_audit_id is distinct from v_audit.id
        or v_track.account_kind is distinct from v_kind
        or v_track.native_flow is distinct from v_native_flow
        or coalesce((v_track.classification_snapshot->>'reviewVersion')::integer, 0) is distinct from p_review_version
        or v_track.classification_snapshot->>'reviewRoutesSha256' is distinct from v_review_hash
        or v_track.classification_snapshot->>'reviewSnapshotSha256' is distinct from v_snapshot_hash then
        raise exception 'Existing CCC track does not match this exact immutable classification review';
      end if;
    end if;
  end loop;

  return query
  select track.*
  from public.ccc_account_tracks track
  where track.user_id = v_client.user_id
    and track.client_id = v_client.id
    and track.method_version = p_method_version
    and track.track_scope = 'cra'
    and exists (
      select 1 from jsonb_array_elements(p_classifications) requested(value)
      where requested.value->>'client_account_id' = track.client_account_id::text
        and public.ccc_normalize_bureau_code(requested.value->'bureaus'->>0) = track.bureau_code
    )
  order by track.bureau_code, track.current_flow, track.client_account_id;
end;
$$;

revoke all on function public.ccc_normalize_bureau_code(text) from public;
revoke all on function public.ccc_normalize_account_kind(text) from public;
revoke all on function public.ccc_canonical_bureau_array(jsonb) from public;
revoke all on function public.ccc_canonical_classification_routes(jsonb) from public;
revoke all on function public.ccc_classification_routes_sha256(jsonb) from public;
revoke all on function public.initialize_ccc_account_tracks(uuid, text, jsonb, integer, text, text) from public;
grant execute on function public.initialize_ccc_account_tracks(uuid, text, jsonb, integer, text, text) to authenticated;
