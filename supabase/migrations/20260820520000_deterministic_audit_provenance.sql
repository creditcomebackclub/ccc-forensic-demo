-- Expand the deterministic audit pipeline with immutable/versioned bureau
-- parse provenance and exact merge selection. Existing audit/parse rows stay
-- readable. Provenance-less audits may continue an already-initialized CRA
-- lifecycle, but they cannot initialize a new R1 lifecycle.
--
-- Forward order: apply this additive migration, deploy the new worker/UI,
-- verify new source-bound audits, then (in a separately authorized release)
-- consider retiring legacy staging rows.
-- Rollback: redeploy the prior worker/UI and restore the validator definition
-- from 20260820290000. Keep the additive columns/rows; dropping them would
-- destroy forensic evidence and is intentionally not part of rollback.

begin;

alter table public.audit_jobs
  add column if not exists merge_selection jsonb;

-- Audit creation and the only legitimate audit-content mutation
-- (classification review) already run through service-role Netlify
-- functions. Remove broad browser DML so a staff session cannot fabricate a
-- self-hashed provenance object or rewrite source facts directly through the
-- baseline FOR ALL policy. Existing read/delete workflows remain available.
revoke insert, update on public.audits from anon, authenticated;

alter table public.audit_bureau_parses
  add column if not exists source_path text,
  add column if not exists source_sha256 text,
  add column if not exists source_bytes bigint,
  add column if not exists source_media_type text,
  add column if not exists parse_sha256 text,
  add column if not exists cohort_key text,
  add column if not exists provenance jsonb;

-- Old rows remain as historical staging records. New v1 provenance rows must
-- carry complete source digests; NOT VALID keeps the expansion compatible
-- with legacy data while validating every new/changed row immediately.
alter table public.audit_bureau_parses
  drop constraint if exists audit_bureau_parses_provenance_shape_check;
alter table public.audit_bureau_parses
  add constraint audit_bureau_parses_provenance_shape_check check (
    provenance is null
    or (
      provenance->>'version' = 'audit-provenance-v1'
      and source_path is not null
      and source_sha256 ~ '^[0-9a-f]{64}$'
      and parse_sha256 ~ '^[0-9a-f]{64}$'
      and cohort_key ~ '^[0-9a-f]{64}$'
      and source_bytes > 0
      and source_job_id is not null
      and provenance->>'cohortKey' = cohort_key
      and provenance->>'reportDate' = report_date::text
      and provenance->>'sourceJobId' = source_job_id::text
      and provenance->>'exactThreeBureau' = 'false'
      and provenance->>'provenanceSha256' ~ '^[0-9a-f]{64}$'
      and nullif(provenance->>'provenanceCanonical', '') is not null
      and (provenance->>'provenanceCanonical')::jsonb
        = (provenance - 'provenanceCanonical' - 'provenanceSha256')
      and pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(provenance->>'provenanceCanonical', 'UTF8'), 'sha256'),
        'hex'
      ) = provenance->>'provenanceSha256'
      and coalesce(pg_catalog.jsonb_typeof(provenance->'sources'), 'null') = 'array'
      and pg_catalog.jsonb_array_length(provenance->'sources') = 1
      and provenance->'sources'->0->>'parseId' = id::text
      and provenance->'sources'->0->>'sourceJobId' = source_job_id::text
      and provenance->'sources'->0->>'bureau' = bureau
      and provenance->'sources'->0->>'reportDate' = report_date::text
      and provenance->'sources'->0->>'filePath' = source_path
      and provenance->'sources'->0->>'fileSha256' = source_sha256
      and provenance->'sources'->0->>'parseSha256' = parse_sha256
      and provenance->'sources'->0->>'mediaType' = source_media_type
      and (provenance->'sources'->0->>'fileBytes')::bigint = source_bytes
      and (provenance->'sources'->0->>'pageCount')::integer = page_count
      and (provenance->'sources'->0->>'chunkCount')::integer = chunk_count
      and (provenance->'sources'->0->>'bureauEvidencePage')::integer
        = (parse->>'bureauEvidencePage')::integer
      and (provenance->'sources'->0->>'reportDateEvidencePage')::integer
        = (parse->>'reportDateEvidencePage')::integer
      and (provenance->'sources'->0->>'reportSectionStartEvidencePage')::integer
        = (parse->>'reportSectionStartEvidencePage')::integer
      and provenance->'sources'->0->>'clientName' = parse->'client'->>'name'
      and (provenance->'sources'->0->>'clientNameEvidencePage')::integer
        = (parse->'client'->>'nameEvidencePage')::integer
      and (parse->>'bureauEvidencePage')::integer between 1 and page_count
      and (parse->>'reportDateEvidencePage')::integer between 1 and page_count
      and parse->>'reportSectionStart' = 'true'
      and (parse->>'reportSectionStartEvidencePage')::integer between 1 and page_count
      and (parse->'client'->>'nameEvidencePage')::integer between 1 and page_count
      and (
        nullif(parse->'personalInfo'->>'dateOfBirth', '') is null
        or (
          (parse->'personalInfo'->>'dateOfBirthEvidencePage')::integer between 1 and page_count
          and provenance->'sources'->0->>'dateOfBirth' = parse->'personalInfo'->>'dateOfBirth'
          and (provenance->'sources'->0->>'dateOfBirthEvidencePage')::integer
            = (parse->'personalInfo'->>'dateOfBirthEvidencePage')::integer
        )
      )
    )
  ) not valid;

-- Replace one-live-row staging with immutable versioned rows. A new parse is
-- a new row; same-source-job replay is rejected rather than overwriting.
drop index if exists public.audit_bureau_parses_user_client_bureau_uidx;
drop index if exists public.audit_bureau_parses_user_name_bureau_uidx;

create unique index if not exists audit_bureau_parses_source_job_bureau_uidx
  on public.audit_bureau_parses (source_job_id, bureau)
  where source_job_id is not null;

create index if not exists audit_bureau_parses_client_cohort_idx
  on public.audit_bureau_parses (user_id, client_id, cohort_key, created_at desc)
  where client_id is not null and cohort_key is not null;

-- Once a provenance-bearing parse exists, its row id must forever identify
-- the same extracted JSON and source bytes. Corrections/retries create a new
-- versioned row instead of mutating forensic history. Legacy null-provenance
-- rows stay writable during the compatibility window.
create or replace function public.prevent_versioned_bureau_parse_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.provenance is not null and (
    new.user_id is distinct from old.user_id
    or new.client_id is distinct from old.client_id
    or new.client_name is distinct from old.client_name
    or new.bureau is distinct from old.bureau
    or new.report_date is distinct from old.report_date
    or new.parse is distinct from old.parse
    or new.source_job_id is distinct from old.source_job_id
    or new.source_path is distinct from old.source_path
    or new.source_sha256 is distinct from old.source_sha256
    or new.source_bytes is distinct from old.source_bytes
    or new.source_media_type is distinct from old.source_media_type
    or new.parse_sha256 is distinct from old.parse_sha256
    or new.cohort_key is distinct from old.cohort_key
    or new.provenance is distinct from old.provenance
    or new.page_count is distinct from old.page_count
    or new.chunk_count is distinct from old.chunk_count
  ) then
    raise exception 'Versioned bureau parse % is immutable; insert a new source-bound row', old.id
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists audit_bureau_parses_immutable_version on public.audit_bureau_parses;
create trigger audit_bureau_parses_immutable_version
before update on public.audit_bureau_parses
for each row execute function public.prevent_versioned_bureau_parse_mutation();

revoke all on function public.prevent_versioned_bureau_parse_mutation() from public;

-- Browser staff can read their version history but cannot erase a source row.
-- Client deletion still cascades under the database owner/service workflow.
drop policy if exists "audit_bureau_parses_delete_own_staff" on public.audit_bureau_parses;
revoke delete on public.audit_bureau_parses from authenticated;
grant select on public.audit_bureau_parses to authenticated;

create or replace function public.ccc_operations_deterministic_audit_valid(p_audit jsonb)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_provenance jsonb;
  v_source jsonb;
  v_source_count integer := 0;
  v_eq integer := 0;
  v_exp integer := 0;
  v_tu integer := 0;
  v_new_valid boolean := false;
begin
  if not (
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
    and coalesce(pg_catalog.jsonb_typeof(p_audit->'accounts'), 'null') = 'array'
  ) then
    return false;
  end if;

  v_provenance := p_audit->'extraction'->'provenance';
  if coalesce(pg_catalog.jsonb_typeof(v_provenance), 'null') = 'object'
    and p_audit->'extraction'->>'schemaVersion' = 'credit-extraction-v2'
    and v_provenance->>'version' = 'audit-provenance-v1'
    and v_provenance->>'coherent' = 'true'
    and v_provenance->>'exactThreeBureau' = 'true'
    and v_provenance->>'reportDate' = p_audit->'client'->>'reportDate'
    and v_provenance->>'reportDate' ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
    and v_provenance->>'cohortKey' ~ '^[0-9a-f]{64}$'
    and v_provenance->>'sourceJobId' ~ '^[0-9a-f-]{36}$'
    and nullif(v_provenance->>'evaluatedAt', '') is not null
    and v_provenance->>'provenanceSha256' ~ '^[0-9a-f]{64}$'
    and nullif(v_provenance->>'provenanceCanonical', '') is not null
    and (v_provenance->>'provenanceCanonical')::jsonb
      = (v_provenance - 'provenanceCanonical' - 'provenanceSha256')
    and pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_provenance->>'provenanceCanonical', 'UTF8'), 'sha256'),
      'hex'
    ) = v_provenance->>'provenanceSha256'
    and coalesce(pg_catalog.jsonb_typeof(v_provenance->'clientIdentity'), 'null') = 'object'
    and nullif(v_provenance->'clientIdentity'->>'canonicalName', '') is not null
    and coalesce(pg_catalog.jsonb_typeof(v_provenance->'sources'), 'null') = 'array'
    and pg_catalog.jsonb_array_length(v_provenance->'sources') = 3 then

    for v_source in select value from pg_catalog.jsonb_array_elements(v_provenance->'sources')
    loop
      v_source_count := v_source_count + 1;
      if v_source->>'reportDate' is distinct from v_provenance->>'reportDate'
        or coalesce(v_source->>'fileSha256', '') !~ '^[0-9a-f]{64}$'
        or coalesce(v_source->>'parseSha256', '') !~ '^[0-9a-f]{64}$'
        or nullif(v_source->>'clientName', '') is null
        or coalesce((v_source->>'clientNameEvidencePage')::integer, 0) < 1
        or coalesce((v_source->>'bureauEvidencePage')::integer, 0) < 1
        or coalesce((v_source->>'reportDateEvidencePage')::integer, 0) < 1
        or coalesce((v_source->>'reportSectionStartEvidencePage')::integer, 0) < 1
        or coalesce((v_source->>'pageCount')::integer, 0) < 1
        or (v_source->>'clientNameEvidencePage')::integer > (v_source->>'pageCount')::integer
        or (v_source->>'bureauEvidencePage')::integer > (v_source->>'pageCount')::integer
        or (v_source->>'reportDateEvidencePage')::integer > (v_source->>'pageCount')::integer
        or (v_source->>'reportSectionStartEvidencePage')::integer > (v_source->>'pageCount')::integer
        or (
          nullif(v_source->>'dateOfBirth', '') is not null
          and (
            coalesce((v_source->>'dateOfBirthEvidencePage')::integer, 0) < 1
            or (v_source->>'dateOfBirthEvidencePage')::integer > (v_source->>'pageCount')::integer
          )
        ) then
        return false;
      end if;
      if v_source->>'bureau' = 'equifax' then v_eq := v_eq + 1;
      elsif v_source->>'bureau' = 'experian' then v_exp := v_exp + 1;
      elsif v_source->>'bureau' = 'transunion' then v_tu := v_tu + 1;
      else return false;
      end if;
    end loop;
    v_new_valid := v_source_count = 3 and v_eq = 1 and v_exp = 1 and v_tu = 1;
  end if;

  -- This generic predicate is intentionally provenance-strict. Legacy
  -- compatibility cannot be inferred from JSON equality because an exact
  -- payload can be copied onto a different audit row or client. The
  -- row-bound lifecycle helper below is the sole compatibility boundary.
  return v_new_valid;
exception when others then
  return false;
end;
$$;

revoke all on function public.ccc_operations_deterministic_audit_valid(jsonb) from public;
grant execute on function public.ccc_operations_deterministic_audit_valid(jsonb) to service_role;

comment on function public.ccc_operations_deterministic_audit_valid(jsonb) is
  'Strict validator for complete v4 audits with exact hash-bound source provenance. It contains no legacy lifecycle exemption.';

-- Structural provenance remains historically valid, but starting a fresh R1
-- is time-sensitive. Keep that mutable policy out of the forensic validator
-- and enforce it at the two write boundaries instead.
create or replace function public.ccc_operations_fresh_r1_audit_valid(p_audit jsonb)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_report_date date;
begin
  if not public.ccc_operations_deterministic_audit_valid(p_audit) then
    return false;
  end if;
  v_report_date := (p_audit->'client'->>'reportDate')::date;
  return v_report_date between (current_date - 45) and (current_date + 1);
exception when others then
  return false;
end;
$$;

revoke all on function public.ccc_operations_fresh_r1_audit_valid(jsonb) from public;
grant execute on function public.ccc_operations_fresh_r1_audit_valid(jsonb) to service_role;

comment on function public.ccc_operations_fresh_r1_audit_valid(jsonb) is
  'Fresh-R1 write gate: strict source provenance plus a source report date no older than 45 days; existing exact-row lifecycles use the separate compatibility helper.';

-- Compatibility for an already-initialized lifecycle must bind all three
-- row identifiers: audit id, client id, and exact source JSON. A cloned JSON
-- payload on another audit/client can therefore never inherit grandfathered
-- status. Strict new audits also pass only when the supplied row is exact.
create or replace function public.ccc_operations_lifecycle_audit_valid(
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
begin
  if nullif(pg_catalog.btrim(coalesce(p_audit_id, '')), '') is null
    or p_client_id is null
    or coalesce(pg_catalog.jsonb_typeof(p_audit), 'null') <> 'object' then
    return false;
  end if;

  return exists (
    select 1
    from public.audits audit_row
    where audit_row.id = p_audit_id
      and audit_row.client_id = p_client_id
      and audit_row.audit = p_audit
      and (
        public.ccc_operations_deterministic_audit_valid(audit_row.audit)
        or exists (
          select 1
          from public.ccc_account_tracks track
          where track.source_audit_id = audit_row.id
            and track.client_id = audit_row.client_id
            and track.user_id = audit_row.user_id
            and track.track_scope = 'cra'
        )
      )
  );
exception when others then
  return false;
end;
$$;

revoke all on function public.ccc_operations_lifecycle_audit_valid(text, uuid, jsonb) from public;
grant execute on function public.ccc_operations_lifecycle_audit_valid(text, uuid, jsonb) to service_role;

comment on function public.ccc_operations_lifecycle_audit_valid(text, uuid, jsonb) is
  'Row/client-bound validator used only for the immutable source audit of an existing CRA lifecycle; prevents copied legacy JSON from qualifying another row or client.';

-- The track initializer is the final R1 write boundary. A fresh lifecycle
-- must use strict source provenance. A grandfathered audit may only replay
-- classifications whose exact tracks already exist; it may never expand a
-- provenance-less audit into a new account/bureau track.
do $migration$
declare
  v_definition text;
  v_rebound text;
  v_old text := 'if not found then raise exception ''The source audit does not belong to this client''; end if;

  v_review := v_audit.audit->''classificationReview'';';
  v_new text := 'if not found then raise exception ''The source audit does not belong to this client''; end if;

  if not public.ccc_operations_fresh_r1_audit_valid(v_audit.audit) then
    if not public.ccc_operations_lifecycle_audit_valid(v_audit.id, v_client.id, v_audit.audit) then
      raise exception ''Fresh R1 initialization requires a source-bound deterministic 3B audit'';
    end if;
    if not exists (
      select 1
      from public.ccc_account_tracks initialized_track
      where initialized_track.user_id = v_client.user_id
        and initialized_track.client_id = v_client.id
        and initialized_track.source_audit_id = v_audit.id
        and initialized_track.track_scope = ''cra''
    ) then
      raise exception ''Fresh R1 initialization requires a source report dated within the last 45 days'';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_classifications) requested(value)
      where not exists (
        select 1
        from public.ccc_account_tracks existing_track
        where existing_track.user_id = v_client.user_id
          and existing_track.client_id = v_client.id
          and existing_track.source_audit_id = v_audit.id
          and existing_track.track_scope = ''cra''
          and existing_track.method_version = p_method_version
          and existing_track.client_account_id::text = requested.value->>''client_account_id''
          and existing_track.bureau_code = public.ccc_normalize_bureau_code(requested.value->''bureaus''->>0)
      )
    ) then
      raise exception ''A grandfathered provenance-less lifecycle cannot initialize new account/bureau tracks'';
    end if;
  end if;

  v_review := v_audit.audit->''classificationReview'';';
begin
  select pg_catalog.pg_get_functiondef(
    'public.initialize_ccc_account_tracks(uuid,text,jsonb,integer,text,text)'::pg_catalog.regprocedure
  ) into v_definition;
  v_rebound := pg_catalog.replace(v_definition, v_old, v_new);
  if v_definition is null or v_rebound = v_definition then
    raise exception 'Could not add strict source-provenance gate to R1 initializer';
  end if;
  execute v_rebound;
end;
$migration$;

-- Rebind the existing full classification validator at its narrowest gate.
-- Keeping the mature account/route/snapshot validation body avoids a second
-- divergent implementation while ensuring legacy compatibility is exact-row
-- only. Raise if the expected prior definition is not present so migration
-- drift fails loudly rather than leaving the broad validator in place.
do $migration$
declare
  v_definition text;
  v_rebound text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.ccc_operations_classification_review_valid(text,uuid,jsonb)'::pg_catalog.regprocedure
  ) into v_definition;
  v_rebound := pg_catalog.replace(
    v_definition,
    'or not public.ccc_operations_deterministic_audit_valid(p_audit) then',
    'or not public.ccc_operations_lifecycle_audit_valid(p_audit_id, p_client_id, p_audit) then'
  );
  if v_definition is null or v_rebound = v_definition then
    raise exception 'Could not rebind classification review to row-bound lifecycle validation';
  end if;
  execute v_rebound;
end;
$migration$;

-- The readiness RPC intentionally has two different validity policies:
-- `deterministic_audit` selects only strict new provenance for fresh/outcome
-- evidence, while `lifecycle_audit` may retain the exact grandfathered source
-- audit already bound to tracks. Patch only that lifecycle CTE.
do $migration$
declare
  v_definition text;
  v_rebound text;
  v_old text := 'where audit_row.client_id = p_client_id
      and public.ccc_operations_deterministic_audit_valid(audit_row.audit)
      and (
        (source.track_count > 0 and source.source_count = 1 and audit_row.id = source.audit_id)';
  v_new text := 'where audit_row.client_id = p_client_id
      and public.ccc_operations_lifecycle_audit_valid(audit_row.id, p_client_id, audit_row.audit)
      and (
        (source.track_count > 0 and source.source_count = 1 and audit_row.id = source.audit_id)';
begin
  select pg_catalog.pg_get_functiondef(
    'public.get_client_production_readiness(uuid)'::pg_catalog.regprocedure
  ) into v_definition;
  v_rebound := pg_catalog.replace(v_definition, v_old, v_new);
  if v_definition is null or v_rebound = v_definition then
    raise exception 'Could not rebind production readiness lifecycle audit validation';
  end if;
  execute v_rebound;
end;
$migration$;

-- Client summary cards must not let a newer immutable single-bureau staging
-- result replace the latest complete 3B operating baseline. Preserve every
-- audit in the history/count, but rank complete/legacy operating audits first
-- and attach the compact audit payload only to that preferred row.
do $migration$
declare
  v_definition text;
  v_ranked text;
  v_rebound text;
  v_old_rank text := $old$select
        a.*,
        row_number() over (order by a.saved_at desc nulls last, a.id desc) as row_number
      from public.audits a$old$;
  v_new_rank text := $new$select
        a.*,
        not (
          coalesce(a.audit ->> 'kind', '') = 'single_bureau_audit'
          or coalesce(a.audit #>> '{reportCoverage,complete}', 'true') = 'false'
        ) as is_operational,
        row_number() over (
          order by
            not (
              coalesce(a.audit ->> 'kind', '') = 'single_bureau_audit'
              or coalesce(a.audit #>> '{reportCoverage,complete}', 'true') = 'false'
            ) desc,
            a.saved_at desc nulls last,
            a.id desc
        ) as row_number
      from public.audits a$new$;
  v_old_output_order text := $old$order by a.saved_at desc nulls last, a.id desc
      ) as audits$old$;
  v_new_output_order text := $new$order by a.is_operational desc, a.saved_at desc nulls last, a.id desc
      ) as audits$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.list_client_summaries(integer,timestamptz,uuid,text)'::pg_catalog.regprocedure
  ) into v_definition;
  v_ranked := pg_catalog.replace(v_definition, v_old_rank, v_new_rank);
  if v_definition is null or v_ranked = v_definition then
    raise exception 'Could not rank complete 3B audits in client summaries';
  end if;
  v_rebound := pg_catalog.replace(v_ranked, v_old_output_order, v_new_output_order);
  if v_rebound = v_ranked then
    raise exception 'Could not preserve operational audit ordering in client summaries';
  end if;
  execute v_rebound;
end;
$migration$;

commit;
