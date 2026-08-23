-- Resumable, source-bound forensic audit execution.
--
-- The legacy audit worker could hold three report extractions plus the final
-- deterministic merge in one Netlify background invocation. Netlify ends a
-- background invocation after 15 minutes, which could leave a paid provider
-- call complete but the audit_jobs row permanently "running". This additive
-- migration turns the row into a logical job and stores every PDF
-- chunk/bureau extraction as a durable checkpoint with a reclaimable lease.
--
-- Mixed-version rollout:
--   1. Freeze new audits and outbound mail.
--   2. Deploy the fail-closed resumable worker/browser/watchdog bundle.
--   3. Apply 5100 -> 5200 -> this migration immediately.
--   4. Verify one audit in each mode before reopening the audit queue.
-- A cached pre-cutover browser is rejected with an explicit reload-required
-- terminal row and its upload is cleaned after a two-hour grace period.
-- Rollback is forward-compatible only: do not redeploy the prior worker while
-- any resumable-audit-v1 job is active. Freeze starts, drain/recover v1 jobs
-- with this worker, then roll back UI-only code if needed. Never drop the
-- additive evidence tables/columns.

begin;

alter table public.audit_jobs
  add column if not exists logical_key text,
  -- Add without a default first: a DEFAULT on ADD COLUMN would falsely
  -- label every pre-cutover queued/running row as a resumable job even though
  -- those rows have no source digests or durable checkpoint plan.
  add column if not exists workflow_version text,
  add column if not exists source_manifest jsonb not null default '[]'::jsonb,
  add column if not exists source_manifest_sha256 text,
  add column if not exists expected_checkpoint_count integer not null default 0,
  add column if not exists completed_checkpoint_count integer not null default 0,
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists next_retry_at timestamptz,
  add column if not exists retryable boolean not null default false,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists retry_count integer not null default 0,
  add column if not exists final_audit_id text,
  add column if not exists expires_at timestamptz not null default (timezone('utc', now()) + interval '30 days'),
  add column if not exists source_cleanup_at timestamptz,
  add column if not exists source_cleanup_error text;

-- A forensic job contains source-bound checkpoint output and private report
-- paths. Never let deleting the CRM row silently detach that evidence via the
-- baseline ON DELETE SET NULL behavior; staff must retain/archive the client
-- while its audit history exists.
alter table public.audit_jobs drop constraint if exists audit_jobs_selected_client_id_fkey;
alter table public.audit_jobs
  add constraint audit_jobs_selected_client_id_fkey
  foreign key (selected_client_id) references public.clients(id) on delete restrict;

-- Explicitly quarantine pre-migration jobs. Their original report uploads are
-- preserved for operator recovery; neither the watchdog nor the new worker
-- may dispatch or clean them automatically.
update public.audit_jobs
set workflow_version = 'legacy'
where workflow_version is null;

update public.audit_jobs
set status = 'error', stage = 'Legacy audit requires a deliberate rerun',
    error = 'This audit began before resumable checkpoints were available. Start one new audit from the original report; the prior source upload was preserved.',
    retryable = false, next_retry_at = null, finished_at = coalesce(finished_at, timezone('utc', now())),
    updated_at = timezone('utc', now())
where workflow_version = 'legacy'
  and status in ('queued', 'running', 'waiting', 'retryable', 'finalizing');

alter table public.audit_jobs
  -- Keep the expand/rollback window compatible with the old browser bundle.
  -- Only the new validated RPC writes resumable-audit-v1 explicitly.
  alter column workflow_version set default 'legacy',
  alter column workflow_version set not null;

alter table public.audit_jobs drop constraint if exists audit_jobs_status_check;
alter table public.audit_jobs add constraint audit_jobs_status_check check (
  status = any (array[
    'queued'::text, 'running'::text, 'waiting'::text,
    'retryable'::text, 'finalizing'::text,
    'done'::text, 'error'::text, 'expired'::text
  ])
);

alter table public.audit_jobs drop constraint if exists audit_jobs_manifest_shape_check;
alter table public.audit_jobs add constraint audit_jobs_manifest_shape_check check (
  pg_catalog.jsonb_typeof(source_manifest) = 'array'
  and expected_checkpoint_count >= 0
  and completed_checkpoint_count >= 0
  and completed_checkpoint_count <= expected_checkpoint_count
  and attempt_count >= 0
  and retry_count >= 0
  and (logical_key is null or logical_key ~ '^[0-9a-f]{64}$')
  and (source_manifest_sha256 is null or source_manifest_sha256 ~ '^[0-9a-f]{64}$')
);

drop index if exists public.audit_jobs_user_logical_key_uidx;
create unique index audit_jobs_user_logical_key_uidx
  on public.audit_jobs (user_id, logical_key)
  -- A successful or in-flight logical job remains idempotent. Terminal
  -- error/expired evidence is retained, but no longer prevents a deliberate
  -- new generation after a code/data correction or source-retention expiry.
  where logical_key is not null and status not in ('error', 'expired');

create index if not exists audit_jobs_resumable_dispatch_idx
  on public.audit_jobs (status, next_retry_at, lease_expires_at, updated_at)
  where status in ('queued', 'running', 'waiting', 'retryable', 'finalizing');

create table if not exists public.audit_job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.audit_jobs(id) on delete cascade,
  attempt_no integer not null check (attempt_no > 0),
  lease_token uuid not null,
  status text not null check (status in ('running', 'yielded', 'retryable', 'completed', 'failed', 'expired')),
  invoked_by text not null check (invoked_by in ('staff', 'chain', 'watchdog')),
  started_at timestamptz not null default timezone('utc', now()),
  heartbeat_at timestamptz not null default timezone('utc', now()),
  lease_expires_at timestamptz not null,
  finished_at timestamptz,
  checkpoint_id uuid,
  error_type text,
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (job_id, attempt_no),
  unique (job_id, lease_token)
);

create table if not exists public.audit_job_checkpoints (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.audit_jobs(id) on delete cascade,
  checkpoint_key text not null,
  sequence integer not null check (sequence >= 0),
  kind text not null check (kind in ('combined_chunk', 'bureau_chunk', 'merge')),
  bureau text check (bureau is null or bureau in ('equifax', 'experian', 'transunion')),
  source_index integer check (source_index is null or source_index >= 0),
  source_path text,
  source_sha256 text,
  source_bytes bigint,
  source_media_type text,
  input_sha256 text,
  start_page integer,
  end_page integer,
  total_pages integer,
  chunk_index integer,
  chunk_count integer,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'retryable', 'done', 'superseded', 'error')),
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_retry_at timestamptz,
  output jsonb,
  output_sha256 text,
  usage jsonb,
  error_type text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (job_id, checkpoint_key),
  check (
    kind = 'merge'
    or (
      source_index is not null
      and nullif(source_path, '') is not null
      and source_sha256 ~ '^[0-9a-f]{64}$'
      and source_bytes > 0
      and nullif(source_media_type, '') is not null
      and input_sha256 ~ '^[0-9a-f]{64}$'
      and start_page > 0
      and end_page >= start_page
      and total_pages >= end_page
      and chunk_index >= 0
      and chunk_count > 0
    )
  ),
  check (output_sha256 is null or output_sha256 ~ '^[0-9a-f]{64}$'),
  check (
    (status = 'done' and output is not null and output_sha256 is not null and finished_at is not null)
    or status <> 'done'
  )
);

alter table public.audit_job_attempts
  drop constraint if exists audit_job_attempts_checkpoint_id_fkey;
alter table public.audit_job_attempts
  add constraint audit_job_attempts_checkpoint_id_fkey
  foreign key (checkpoint_id) references public.audit_job_checkpoints(id) on delete set null;

create index if not exists audit_job_checkpoints_claim_idx
  on public.audit_job_checkpoints (job_id, status, next_retry_at, sequence)
  where status in ('pending', 'running', 'retryable');

create table if not exists public.audit_provider_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.audit_jobs(id) on delete cascade,
  checkpoint_id uuid not null references public.audit_job_checkpoints(id) on delete cascade,
  job_attempt_id uuid references public.audit_job_attempts(id) on delete set null,
  provider text not null default 'anthropic',
  model text not null,
  operation text not null,
  attempt_no integer not null check (attempt_no > 0),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('started', 'completed', 'failed', 'output_limit')),
  provider_request_id text,
  stop_reason text,
  response_sha256 text,
  usage jsonb,
  error_type text,
  error_message text,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (checkpoint_id, attempt_no),
  check (response_sha256 is null or response_sha256 ~ '^[0-9a-f]{64}$')
);

-- Tombstones serialize cleanup of abandoned pre-RPC uploads with late job
-- creation. A claim is retained after deletion so a days-old suspended tab
-- can never turn a deleted source into a new durable audit job.
create table if not exists public.audit_upload_cleanup_claims (
  candidate_job_id uuid primary key,
  user_id uuid not null,
  paths text[] not null check (pg_catalog.array_length(paths, 1) between 1 and 10),
  claimed_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  cleanup_error text
);

alter table public.audit_upload_cleanup_claims enable row level security;
revoke all on public.audit_upload_cleanup_claims from anon, authenticated;
grant all on public.audit_upload_cleanup_claims to service_role;

-- Completed/superseded checkpoint evidence is immutable. Operational retry
-- fields may change only while the checkpoint is nonterminal.
create or replace function public.prevent_terminal_audit_checkpoint_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('done', 'superseded') and new is distinct from old then
    raise exception 'Terminal audit checkpoint % is immutable', old.id using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists audit_job_checkpoints_terminal_immutable on public.audit_job_checkpoints;
create trigger audit_job_checkpoints_terminal_immutable
before update on public.audit_job_checkpoints
for each row execute function public.prevent_terminal_audit_checkpoint_mutation();

alter table public.audit_job_attempts enable row level security;
alter table public.audit_job_checkpoints enable row level security;
alter table public.audit_provider_attempts enable row level security;

revoke all on public.audit_job_attempts from anon, authenticated;
revoke all on public.audit_job_checkpoints from anon, authenticated;
revoke all on public.audit_provider_attempts from anon, authenticated;
grant all on public.audit_job_attempts to service_role;
grant all on public.audit_job_checkpoints to service_role;
grant all on public.audit_provider_attempts to service_role;

-- During the expand/rollback window the old browser may still insert a
-- legacy job. Force every direct insert to legacy even if a caller supplies
-- the v1 label; only the security-definer RPC below can mark a row resumable.
create or replace function public.force_direct_audit_job_legacy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_rpc_owner name;
begin
  select pg_catalog.pg_get_userbyid(proc.proowner)
  into v_rpc_owner
  from pg_catalog.pg_proc proc
  join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.proname = 'ccc_create_or_resume_audit_job'
    and pg_catalog.pg_get_function_identity_arguments(proc.oid)
      = 'p_candidate_id uuid, p_mode text, p_files jsonb, p_selected_client_id uuid, p_merge_selection jsonb'
  limit 1;

  if current_user is distinct from v_rpc_owner
     or coalesce(pg_catalog.current_setting('ccc.resumable_audit_rpc', true), '') <> 'on'
  then
    new.workflow_version := 'legacy-browser-blocked';
    new.logical_key := null;
    new.source_manifest := '[]'::jsonb;
    new.source_manifest_sha256 := null;
    new.expected_checkpoint_count := 0;
    new.completed_checkpoint_count := 0;
    new.retryable := false;
    new.next_retry_at := null;
    new.status := 'error';
    new.stage := 'Reload required before starting this audit';
    new.error := 'This browser tab is running the retired audit uploader. Reload CCC, then start the audit once; this unused upload will be removed automatically.';
    new.finished_at := timezone('utc', now());
    new.expires_at := timezone('utc', now()) + interval '2 hours';
    new.updated_at := timezone('utc', now());
  end if;
  return new;
end;
$$;

drop trigger if exists audit_jobs_force_direct_legacy on public.audit_jobs;
create trigger audit_jobs_force_direct_legacy
before insert on public.audit_jobs
for each row execute function public.force_direct_audit_job_legacy();

-- Browser updates remain service-owned. Existing staff-only insert/select RLS
-- stays in place so a prior bundle remains rollback-compatible.
revoke update on public.audit_jobs from anon, authenticated;

create or replace function public.ccc_create_or_resume_audit_job(
  p_candidate_id uuid,
  p_mode text,
  p_files jsonb,
  p_selected_client_id uuid,
  p_merge_selection jsonb default null
)
returns table (job_id uuid, job_status text, reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_manifest jsonb := '[]'::jsonb;
  v_identity_manifest jsonb := '[]'::jsonb;
  v_merge jsonb := null;
  v_logical_key text;
  v_existing public.audit_jobs%rowtype;
  v_count integer := 0;
  v_bureau_count integer := 0;
  v_previous_rpc_setting text := coalesce(pg_catalog.current_setting('ccc.resumable_audit_rpc', true), '');
begin
  if v_user_id is null or not exists (
    select 1 from public.profiles p
    where p.id = v_user_id and p.role in ('admin', 'auditor')
  ) then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  if p_mode not in ('combined', 'individual', 'single', 'merge') then
    raise exception 'Unsupported audit mode' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.clients c
    where c.id = p_selected_client_id and c.user_id = v_user_id
  ) then
    raise exception 'Exact owned client selection required' using errcode = '42501';
  end if;

  -- Serialize against orphan cleanup for this exact upload candidate. If the
  -- two-hour cleanup claim won, the browser must re-upload rather than bind a
  -- durable job to bytes that are already being removed.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('audit-upload:' || p_candidate_id::text, 0)
  );
  if exists (
    select 1 from public.audit_upload_cleanup_claims cleanup
    where cleanup.candidate_job_id = p_candidate_id
  ) then
    raise exception 'This audit upload expired before job creation. Reload and upload the report again.' using errcode = '55000';
  end if;

  if p_mode = 'merge' then
    if coalesce(pg_catalog.jsonb_typeof(p_files), 'null') <> 'array'
       or pg_catalog.jsonb_array_length(p_files) <> 0
       or coalesce(pg_catalog.jsonb_typeof(p_merge_selection), 'null') <> 'object'
       or coalesce(pg_catalog.jsonb_typeof(p_merge_selection->'parseIds'), 'null') <> 'array'
       or pg_catalog.jsonb_array_length(p_merge_selection->'parseIds') <> 3
       or coalesce(p_merge_selection->>'cohortKey', '') !~ '^[0-9a-f]{64}$'
    then
      raise exception 'Merge requires an exact three-parse cohort' using errcode = '22023';
    end if;
    select pg_catalog.jsonb_build_object(
      'cohortKey', pg_catalog.lower(p_merge_selection->>'cohortKey'),
      'parseIds', pg_catalog.jsonb_agg(value order by value)
    ) into v_merge
    from pg_catalog.jsonb_array_elements_text(p_merge_selection->'parseIds');
    if (
      select count(distinct value)
      from pg_catalog.jsonb_array_elements_text(v_merge->'parseIds')
      where value ~ '^[0-9a-f-]{36}$'
    ) <> 3 then
      raise exception 'Merge parse ids must be three distinct UUIDs' using errcode = '22023';
    end if;
  else
    if coalesce(pg_catalog.jsonb_typeof(p_files), 'null') <> 'array' then
      raise exception 'Audit files must be an array' using errcode = '22023';
    end if;

    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'index', ordinality - 1,
        'path', item->>'path',
        'bureau', case when nullif(item->>'bureau', '') is null then null else pg_catalog.lower(item->>'bureau') end,
        'sha256', pg_catalog.lower(item->>'sha256'),
        'bytes', (item->>'bytes')::bigint,
        'mediaType', pg_catalog.lower(pg_catalog.split_part(item->>'type', ';', 1))
      ) order by ordinality
    ), '[]'::jsonb), count(*)::integer,
    count(distinct pg_catalog.lower(item->>'bureau')) filter (where nullif(item->>'bureau', '') is not null)::integer
    into v_manifest, v_count, v_bureau_count
    from pg_catalog.jsonb_array_elements(p_files) with ordinality as f(item, ordinality)
    where pg_catalog.jsonb_typeof(item) = 'object'
      and item->>'path' like v_user_id::text || '/audit-jobs/' || p_candidate_id::text || '/%'
      and position('..' in item->>'path') = 0
      and item->>'sha256' ~ '^[0-9a-fA-F]{64}$'
      and (item->>'bytes') ~ '^[0-9]+$'
      and (item->>'bytes')::bigint between 1 and (15 * 1024 * 1024)
      and pg_catalog.lower(pg_catalog.split_part(item->>'type', ';', 1)) in (
        'application/pdf', 'application/x-pdf', 'text/plain', 'text/html', 'application/xhtml+xml'
      );

    if (p_mode in ('combined', 'single') and v_count <> 1)
       or (p_mode = 'individual' and (v_count <> 3 or v_bureau_count <> 3))
    then
      raise exception 'Audit file manifest does not match its mode' using errcode = '22023';
    end if;
    if p_mode = 'individual' and not (
      v_manifest @> '[{"bureau":"equifax"}]'::jsonb
      and v_manifest @> '[{"bureau":"experian"}]'::jsonb
      and v_manifest @> '[{"bureau":"transunion"}]'::jsonb
    ) then
      raise exception 'Individual mode requires Equifax, Experian, and TransUnion' using errcode = '22023';
    end if;
    if p_mode = 'single' and not (
      v_manifest @> '[{"bureau":"equifax"}]'::jsonb
      or v_manifest @> '[{"bureau":"experian"}]'::jsonb
      or v_manifest @> '[{"bureau":"transunion"}]'::jsonb
    ) then
      raise exception 'Single mode requires an explicit bureau' using errcode = '22023';
    end if;

    -- Storage paths contain the caller's random candidate UUID. Exclude
    -- those paths from logical identity so re-uploading the exact same bytes
    -- resolves to the original logical job rather than creating a duplicate.
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'bureau', item->'bureau',
        'sha256', item->'sha256',
        'bytes', item->'bytes',
        'mediaType', item->'mediaType'
      ) order by (item->>'index')::integer
    ), '[]'::jsonb)
    into v_identity_manifest
    from pg_catalog.jsonb_array_elements(v_manifest) as identity_source(item);
  end if;

  v_logical_key := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'version', 'resumable-audit-v1',
      'mode', p_mode,
      'clientId', p_selected_client_id,
      'sources', v_identity_manifest,
      'mergeSelection', v_merge
    )::text, 'UTF8'), 'sha256'), 'hex');

  -- SELECT ... FOR UPDATE cannot lock an absent row. Serialize the short
  -- create/reselect section by caller + logical key so simultaneous uploads
  -- cannot race into a unique violation and leave an unreferenced PII file.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || v_logical_key, 0)
  );

  select * into v_existing
  from public.audit_jobs j
  where j.user_id = v_user_id and j.logical_key = v_logical_key
    and j.workflow_version = 'resumable-audit-v1'
    and j.status not in ('error', 'expired')
  order by j.created_at desc
  limit 1
  for update;

  if found then
    if v_existing.status = 'retryable' then
      update public.audit_jobs set
        status = 'queued', stage = 'Resuming saved audit checkpoints', error = null,
        retryable = true, retry_count = retry_count + 1,
        next_retry_at = timezone('utc', now()),
        expires_at = timezone('utc', now()) + interval '30 days',
        updated_at = timezone('utc', now()), finished_at = null
      where id = v_existing.id;
      v_existing.status := 'queued';
    end if;
    return query select v_existing.id, v_existing.status, true;
    return;
  end if;

  perform pg_catalog.set_config('ccc.resumable_audit_rpc', 'on', true);
  insert into public.audit_jobs (
    id, user_id, status, mode, files, selected_client_id,
    selected_client_is_new, merge_selection, logical_key, workflow_version,
    source_manifest, source_manifest_sha256, stage, retryable, next_retry_at
  ) values (
    p_candidate_id, v_user_id, 'queued', p_mode, p_files, p_selected_client_id,
    false, v_merge, v_logical_key, 'resumable-audit-v1', v_manifest,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_manifest::text, 'UTF8'), 'sha256'), 'hex'),
    'Queued for resumable analysis', true, timezone('utc', now())
  );
  perform pg_catalog.set_config('ccc.resumable_audit_rpc', v_previous_rpc_setting, true);

  return query select p_candidate_id, 'queued'::text, false;
end;
$$;

revoke all on function public.ccc_create_or_resume_audit_job(uuid, text, jsonb, uuid, jsonb) from public;
grant execute on function public.ccc_create_or_resume_audit_job(uuid, text, jsonb, uuid, jsonb) to authenticated;

create or replace function public.ccc_claim_audit_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_invoked_by text default 'chain',
  p_lease_seconds integer default 780
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt integer;
  v_now timestamptz := timezone('utc', now());
  v_lease timestamptz;
begin
  if p_invoked_by not in ('staff', 'chain', 'watchdog') then
    raise exception 'Invalid audit invocation source' using errcode = '22023';
  end if;
  v_lease := v_now + pg_catalog.make_interval(secs => greatest(60, least(p_lease_seconds, 840)));

  update public.audit_job_attempts
  set status = 'expired', finished_at = v_now,
      error_type = 'lease_expired', error_message = 'Worker lease expired before a terminal write.'
  where job_id = p_job_id and status = 'running' and lease_expires_at <= v_now;

  update public.audit_provider_attempts provider set
    status = 'failed', error_type = 'worker_lease_expired',
    error_message = 'Provider outcome was not durably observed before the worker lease expired.',
    finished_at = v_now
  where provider.job_id = p_job_id and provider.status = 'started'
    and exists (
      select 1 from public.audit_job_attempts attempt
      where attempt.id = provider.job_attempt_id and attempt.status = 'expired'
    );

  update public.audit_job_checkpoints
  set status = 'retryable', lease_token = null, lease_expires_at = null,
      next_retry_at = v_now, error_type = 'lease_expired',
      error_message = 'Checkpoint worker lease expired; safe resume is available.', updated_at = v_now
  where job_id = p_job_id and status = 'running' and lease_expires_at <= v_now;

  update public.audit_jobs
  set status = 'running', lease_token = p_lease_token, lease_expires_at = v_lease,
      last_heartbeat_at = v_now, updated_at = v_now,
      started_at = coalesce(started_at, v_now),
      attempt_count = attempt_count + 1,
      stage = case when attempt_count = 0 then 'Preparing resumable audit' else 'Resuming saved audit checkpoints' end,
      error = null
  where id = p_job_id and workflow_version = 'resumable-audit-v1'
    and status in ('queued', 'running', 'waiting', 'retryable', 'finalizing')
    and (next_retry_at is null or next_retry_at <= v_now)
    and (lease_token is null or lease_expires_at <= v_now or lease_token = p_lease_token)
  returning attempt_count into v_attempt;

  if v_attempt is null then return false; end if;

  insert into public.audit_job_attempts (
    job_id, attempt_no, lease_token, status, invoked_by, lease_expires_at
  ) values (p_job_id, v_attempt, p_lease_token, 'running', p_invoked_by, v_lease)
  on conflict (job_id, lease_token) do nothing;
  return true;
end;
$$;

revoke all on function public.ccc_claim_audit_job(uuid, uuid, text, integer) from public;
grant execute on function public.ccc_claim_audit_job(uuid, uuid, text, integer) to service_role;

create or replace function public.ccc_claim_next_audit_checkpoint(p_job_id uuid, p_lease_token uuid)
returns setof public.audit_job_checkpoints
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checkpoint_id uuid;
  v_now timestamptz := timezone('utc', now());
  v_lease timestamptz;
begin
  select j.lease_expires_at into v_lease
  from public.audit_jobs j
  where j.id = p_job_id and j.status = 'running' and j.lease_token = p_lease_token
    and j.lease_expires_at > v_now
  for update;
  if v_lease is null then return; end if;

  select c.id into v_checkpoint_id
  from public.audit_job_checkpoints c
  where c.job_id = p_job_id
    and c.status in ('pending', 'retryable')
    and (c.next_retry_at is null or c.next_retry_at <= v_now)
  order by c.sequence, c.created_at, c.id
  for update skip locked
  limit 1;
  if v_checkpoint_id is null then return; end if;

  update public.audit_job_checkpoints c set
    status = 'running', lease_token = p_lease_token, lease_expires_at = v_lease,
    attempt_count = attempt_count + 1, started_at = coalesce(started_at, v_now),
    updated_at = v_now, error_type = null, error_message = null
  where c.id = v_checkpoint_id;

  update public.audit_job_attempts set checkpoint_id = v_checkpoint_id, heartbeat_at = v_now
  where job_id = p_job_id and lease_token = p_lease_token and status = 'running';

  return query select * from public.audit_job_checkpoints c where c.id = v_checkpoint_id;
end;
$$;

revoke all on function public.ccc_claim_next_audit_checkpoint(uuid, uuid) from public;
grant execute on function public.ccc_claim_next_audit_checkpoint(uuid, uuid) to service_role;

create or replace function public.ccc_complete_audit_checkpoint(
  p_checkpoint_id uuid,
  p_lease_token uuid,
  p_output jsonb,
  p_output_sha256 text,
  p_usage jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_now timestamptz := timezone('utc', now());
begin
  if p_output is null or p_output_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Checkpoint output and digest are required' using errcode = '22023';
  end if;
  update public.audit_job_checkpoints c set
    status = 'done', output = p_output, output_sha256 = p_output_sha256,
    usage = p_usage, lease_token = null, lease_expires_at = null,
    finished_at = v_now, updated_at = v_now, next_retry_at = null,
    error_type = null, error_message = null
  where c.id = p_checkpoint_id and c.status = 'running' and c.lease_token = p_lease_token
  returning c.job_id into v_job_id;
  if v_job_id is null then return false; end if;

  update public.audit_jobs j set
    completed_checkpoint_count = (
      select count(*) from public.audit_job_checkpoints c
      where c.job_id = v_job_id and c.status = 'done'
    ),
    retry_count = 0,
    last_heartbeat_at = v_now, updated_at = v_now
  where j.id = v_job_id and j.lease_token = p_lease_token;
  return true;
end;
$$;

revoke all on function public.ccc_complete_audit_checkpoint(uuid, uuid, jsonb, text, jsonb) from public;
grant execute on function public.ccc_complete_audit_checkpoint(uuid, uuid, jsonb, text, jsonb) to service_role;

-- Replace one dense PDF checkpoint with two smaller, overlapping, immutable
-- page-range children after an observed provider output limit. The parent is
-- retained as superseded evidence, and only the worker holding both leases
-- may alter the active plan.
create or replace function public.ccc_split_audit_checkpoint(
  p_checkpoint_id uuid,
  p_lease_token uuid,
  p_left_input_sha256 text,
  p_right_input_sha256 text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.audit_job_checkpoints%rowtype;
  v_mid integer;
  v_now timestamptz := timezone('utc', now());
begin
  if p_left_input_sha256 !~ '^[0-9a-f]{64}$' or p_right_input_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Split checkpoint input digests are invalid' using errcode = '22023';
  end if;
  select checkpoint.* into v_parent
  from public.audit_job_checkpoints checkpoint
  join public.audit_jobs job on job.id = checkpoint.job_id
  where checkpoint.id = p_checkpoint_id
    and checkpoint.status = 'running' and checkpoint.lease_token = p_lease_token
    and checkpoint.kind in ('combined_chunk', 'bureau_chunk')
    and checkpoint.source_media_type in ('application/pdf', 'application/x-pdf')
    and checkpoint.end_page - checkpoint.start_page + 1 >= 4
    and job.workflow_version = 'resumable-audit-v1'
    and job.status = 'running' and job.lease_token = p_lease_token
    and job.lease_expires_at > v_now
  for update of checkpoint;
  if not found then return false; end if;

  v_mid := pg_catalog.floor((v_parent.start_page + v_parent.end_page)::numeric / 2)::integer;
  insert into public.audit_job_checkpoints (
    job_id, checkpoint_key, sequence, kind, bureau, source_index, source_path,
    source_sha256, source_bytes, source_media_type, input_sha256,
    start_page, end_page, total_pages, chunk_index, chunk_count, status
  ) values
  (
    v_parent.job_id,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      v_parent.checkpoint_key || '|left|' || v_parent.start_page || '|' || (v_mid + 1), 'UTF8'), 'sha256'), 'hex'),
    (v_parent.source_index * 1000000) + (v_parent.start_page * 100),
    v_parent.kind, v_parent.bureau, v_parent.source_index,
    v_parent.source_path, v_parent.source_sha256, v_parent.source_bytes,
    v_parent.source_media_type, p_left_input_sha256,
    v_parent.start_page, v_mid + 1, v_parent.total_pages,
    v_parent.chunk_index * 10 + 1, v_parent.chunk_count + 1, 'pending'
  ),
  (
    v_parent.job_id,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      v_parent.checkpoint_key || '|right|' || v_mid || '|' || v_parent.end_page, 'UTF8'), 'sha256'), 'hex'),
    (v_parent.source_index * 1000000) + (v_mid * 100),
    v_parent.kind, v_parent.bureau, v_parent.source_index,
    v_parent.source_path, v_parent.source_sha256, v_parent.source_bytes,
    v_parent.source_media_type, p_right_input_sha256,
    v_mid, v_parent.end_page, v_parent.total_pages,
    v_parent.chunk_index * 10 + 2, v_parent.chunk_count + 1, 'pending'
  );

  update public.audit_job_checkpoints set
    status = 'superseded', lease_token = null, lease_expires_at = null,
    error_type = 'output_limit_split',
    error_message = 'Provider output limit observed; replaced by smaller durable page checkpoints.',
    finished_at = v_now, updated_at = v_now
  where id = v_parent.id and status = 'running' and lease_token = p_lease_token;

  update public.audit_jobs job set
    expected_checkpoint_count = (
      select count(*) from public.audit_job_checkpoints checkpoint
      where checkpoint.job_id = v_parent.job_id and checkpoint.status <> 'superseded'
    ),
    completed_checkpoint_count = (
      select count(*) from public.audit_job_checkpoints checkpoint
      where checkpoint.job_id = v_parent.job_id and checkpoint.status = 'done'
    ),
    retry_count = 0,
    stage = 'Dense page range split into smaller saved checkpoints',
    last_heartbeat_at = v_now, updated_at = v_now
  where job.id = v_parent.job_id and job.lease_token = p_lease_token;
  return true;
end;
$$;

revoke all on function public.ccc_split_audit_checkpoint(uuid, uuid, text, text) from public;
grant execute on function public.ccc_split_audit_checkpoint(uuid, uuid, text, text) to service_role;

create or replace function public.ccc_release_audit_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_status text,
  p_stage text,
  p_error_type text default null,
  p_error_message text default null,
  p_next_retry_at timestamptz default null,
  p_checkpoint_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_retryable boolean := p_status in ('waiting', 'retryable');
begin
  if p_status not in ('waiting', 'retryable', 'error') then
    raise exception 'Invalid audit release status' using errcode = '22023';
  end if;
  if p_checkpoint_id is not null then
    update public.audit_job_checkpoints set
      status = case when v_retryable then 'retryable' else 'error' end,
      lease_token = null, lease_expires_at = null,
      next_retry_at = case when v_retryable then coalesce(p_next_retry_at, v_now) else null end,
      error_type = p_error_type, error_message = p_error_message, updated_at = v_now,
      finished_at = case when v_retryable then null else v_now end
    where id = p_checkpoint_id and job_id = p_job_id
      and status = 'running' and lease_token = p_lease_token;
  end if;

  update public.audit_jobs set
    status = p_status, stage = p_stage, error = p_error_message,
    retryable = v_retryable,
    next_retry_at = case when v_retryable then coalesce(p_next_retry_at, v_now) else null end,
    retry_count = retry_count + case when p_status = 'retryable' then 1 else 0 end,
    lease_token = null, lease_expires_at = null, updated_at = v_now,
    finished_at = case when p_status = 'error' then v_now else null end
  where id = p_job_id and lease_token = p_lease_token;
  if not found then return false; end if;

  update public.audit_job_attempts set
    status = case when p_status = 'error' then 'failed' when p_status = 'retryable' then 'retryable' else 'yielded' end,
    error_type = p_error_type, error_message = p_error_message,
    heartbeat_at = v_now, finished_at = v_now
  where job_id = p_job_id and lease_token = p_lease_token and status = 'running';
  return true;
end;
$$;

revoke all on function public.ccc_release_audit_job(uuid, uuid, text, text, text, text, timestamptz, uuid) from public;
grant execute on function public.ccc_release_audit_job(uuid, uuid, text, text, text, text, timestamptz, uuid) to service_role;

create or replace function public.ccc_finish_audit_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_result jsonb,
  p_usage jsonb,
  p_final_audit_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_expected integer;
  v_done integer;
begin
  select
    count(*) filter (where c.status <> 'superseded'),
    count(*) filter (where c.status = 'done')
  into v_expected, v_done
  from public.audit_job_checkpoints c where c.job_id = p_job_id;
  if v_expected = 0 or v_done <> v_expected then
    raise exception 'Audit checkpoints are incomplete (% of %)', v_done, v_expected using errcode = '55000';
  end if;
  if p_final_audit_id is null
     or pg_catalog.right(p_final_audit_id, pg_catalog.length('__' || p_job_id::text)) <> '__' || p_job_id::text
     or not exists (
       select 1
       from public.audits audit
       join public.audit_jobs job on job.id = p_job_id
       where audit.id = p_final_audit_id
         and audit.user_id = job.user_id
         and audit.client_id = job.selected_client_id
     )
  then
    raise exception 'Final audit row is not bound to this logical job/client' using errcode = '55000';
  end if;
  update public.audit_jobs set
    status = 'done', stage = 'Complete', pct = 100, result = p_result,
    usage = p_usage, final_audit_id = p_final_audit_id,
    expected_checkpoint_count = v_expected, completed_checkpoint_count = v_done,
    retryable = false, next_retry_at = null, error = null,
    lease_token = null, lease_expires_at = null,
    last_heartbeat_at = v_now, updated_at = v_now, finished_at = v_now
  where id = p_job_id and lease_token = p_lease_token
    and status in ('running', 'finalizing');
  if not found then return false; end if;
  update public.audit_job_attempts set status = 'completed', heartbeat_at = v_now, finished_at = v_now
  where job_id = p_job_id and lease_token = p_lease_token and status = 'running';
  return true;
end;
$$;

revoke all on function public.ccc_finish_audit_job(uuid, uuid, jsonb, jsonb, text) from public;
grant execute on function public.ccc_finish_audit_job(uuid, uuid, jsonb, jsonb, text) to service_role;

-- Reclaims only expired leases. A live worker's lease remains exclusive.
-- Very old unfinished jobs become visible terminal rows rather than being
-- re-dispatched forever after their upload retention window.
create or replace function public.ccc_reclaim_stale_audit_jobs(p_limit integer default 25)
returns table (job_id uuid, user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := timezone('utc', now());
begin
  update public.audit_job_attempts set
    status = 'expired', finished_at = v_now,
    error_type = 'lease_expired', error_message = 'Worker lease expired before completion.'
  where status = 'running' and lease_expires_at <= v_now;

  update public.audit_provider_attempts provider set
    status = 'failed', error_type = 'worker_lease_expired',
    error_message = 'Provider outcome was not durably observed before the worker lease expired.',
    finished_at = v_now
  where provider.status = 'started'
    and exists (
      select 1 from public.audit_job_attempts attempt
      where attempt.id = provider.job_attempt_id and attempt.status = 'expired'
    );

  update public.audit_job_checkpoints set
    status = 'retryable', lease_token = null, lease_expires_at = null,
    next_retry_at = v_now, error_type = 'lease_expired',
    error_message = 'Checkpoint lease expired; the same logical audit will resume.', updated_at = v_now
  where status = 'running' and lease_expires_at <= v_now;

  update public.audit_jobs set
    status = 'retryable', stage = 'Interrupted — resuming from saved checkpoint',
    error = 'A worker reached its execution limit. Saved checkpoints are intact and the same audit will resume.',
    retryable = true, next_retry_at = v_now,
    lease_token = null, lease_expires_at = null, updated_at = v_now
  where workflow_version = 'resumable-audit-v1'
    and status in ('running', 'finalizing') and lease_expires_at <= v_now and expires_at > v_now;

  update public.audit_jobs set
    status = 'expired', stage = 'Audit source retention expired',
    error = 'This unfinished logical audit expired after 30 days. Its attempt history remains available for review.',
    retryable = false, next_retry_at = null,
    lease_token = null, lease_expires_at = null, updated_at = v_now, finished_at = v_now
  where workflow_version = 'resumable-audit-v1'
    and status in ('queued', 'running', 'waiting', 'retryable', 'finalizing', 'error')
    and expires_at <= v_now
    and (lease_token is null or lease_expires_at <= v_now);

  update public.audit_jobs set
    status = 'expired', stage = 'Retired browser upload expired',
    error = 'The retired browser upload grace period ended. Reload CCC before starting a new audit.',
    retryable = false, next_retry_at = null,
    lease_token = null, lease_expires_at = null, updated_at = v_now, finished_at = v_now
  where workflow_version = 'legacy-browser-blocked'
    and status = 'error'
    and expires_at <= v_now;

  return query
  select j.id, j.user_id
  from public.audit_jobs j
  where j.workflow_version = 'resumable-audit-v1'
    and j.status in ('queued', 'waiting', 'retryable')
    and j.expires_at > v_now
    and (j.next_retry_at is null or j.next_retry_at <= v_now)
    and (j.lease_token is null or j.lease_expires_at <= v_now)
  order by j.updated_at, j.created_at
  limit greatest(1, least(p_limit, 100));
end;
$$;

revoke all on function public.ccc_reclaim_stale_audit_jobs(integer) from public;
grant execute on function public.ccc_reclaim_stale_audit_jobs(integer) to service_role;

-- A browser can disappear after uploading a source but before the job-creation
-- RPC reaches (or returns from) PostgreSQL. Atomically tombstone exact stale
-- candidates under the same advisory lock used by job creation, then return
-- the paths to the service worker for Storage API deletion.
create or replace function public.ccc_claim_orphan_audit_upload_cleanup(p_limit integer default 25)
returns table(candidate_job_id uuid, user_id uuid, paths text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate record;
  v_paths text[];
  v_claimed_id uuid;
  v_returned integer := 0;
  v_limit integer := greatest(1, least(p_limit, 100));
begin
  -- Retry service-side deletions that failed after a cleanup claim committed.
  for v_candidate in
    select claim.candidate_job_id, claim.user_id, claim.paths
    from public.audit_upload_cleanup_claims claim
    where claim.completed_at is null
    order by claim.claimed_at, claim.candidate_job_id
    limit v_limit
  loop
    candidate_job_id := v_candidate.candidate_job_id;
    user_id := v_candidate.user_id;
    paths := v_candidate.paths;
    v_returned := v_returned + 1;
    return next;
  end loop;
  if v_returned >= v_limit then return; end if;

  for v_candidate in
    select
      split_part(object.name, '/', 3)::uuid as candidate_id,
      split_part(object.name, '/', 1)::uuid as owner_id,
      max(object.created_at) as newest_object_at
    from storage.objects object
    where object.bucket_id = 'documents'
      and object.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/audit-jobs/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
    group by split_part(object.name, '/', 3), split_part(object.name, '/', 1)
    having max(object.created_at) <= timezone('utc', now()) - interval '2 hours'
    order by max(object.created_at), split_part(object.name, '/', 3)
    limit v_limit * 2
  loop
    exit when v_returned >= v_limit;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('audit-upload:' || v_candidate.candidate_id::text, 0)
    );
    if exists (
      select 1 from public.audit_jobs job
      where job.id = v_candidate.candidate_id and job.user_id = v_candidate.owner_id
    ) or exists (
      select 1 from public.audit_upload_cleanup_claims claim
      where claim.candidate_job_id = v_candidate.candidate_id
        and claim.completed_at is null
    ) then
      continue;
    end if;

    select pg_catalog.array_agg(object.name order by object.name)
    into v_paths
    from storage.objects object
    where object.bucket_id = 'documents'
      and split_part(object.name, '/', 1) = v_candidate.owner_id::text
      and split_part(object.name, '/', 2) = 'audit-jobs'
      and split_part(object.name, '/', 3) = v_candidate.candidate_id::text
      and object.created_at <= timezone('utc', now()) - interval '2 hours';
    if coalesce(pg_catalog.array_length(v_paths, 1), 0) = 0 then continue; end if;

    -- A suspended uploader can write another object after an earlier cleanup
    -- completed. Keep the tombstone (so job creation remains blocked), but
    -- reopen it for the newly aged exact paths instead of stranding PII.
    v_claimed_id := null;
    insert into public.audit_upload_cleanup_claims (
      candidate_job_id, user_id, paths
    ) values (
      v_candidate.candidate_id, v_candidate.owner_id, v_paths
    )
    on conflict on constraint audit_upload_cleanup_claims_pkey do update set
      paths = excluded.paths,
      claimed_at = timezone('utc', now()),
      completed_at = null,
      cleanup_error = null
    where public.audit_upload_cleanup_claims.user_id = excluded.user_id
      and public.audit_upload_cleanup_claims.completed_at is not null
    returning public.audit_upload_cleanup_claims.candidate_job_id into v_claimed_id;
    if v_claimed_id is null then continue; end if;
    candidate_job_id := v_candidate.candidate_id;
    user_id := v_candidate.owner_id;
    paths := v_paths;
    v_returned := v_returned + 1;
    return next;
  end loop;
end;
$$;

revoke all on function public.ccc_claim_orphan_audit_upload_cleanup(integer) from public;
grant execute on function public.ccc_claim_orphan_audit_upload_cleanup(integer) to service_role;

revoke all on function public.prevent_terminal_audit_checkpoint_mutation() from public;
revoke all on function public.force_direct_audit_job_legacy() from public;

commit;
