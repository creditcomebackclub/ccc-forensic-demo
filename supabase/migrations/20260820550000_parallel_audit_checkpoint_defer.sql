-- Permit one exclusively leased audit worker to settle several independently
-- claimed checkpoints before releasing the job lease. This is additive and
-- remains compatible with the serial resumable-audit-v1 worker.

create or replace function public.ccc_defer_audit_checkpoint(
  p_job_id uuid,
  p_checkpoint_id uuid,
  p_lease_token uuid,
  p_status text,
  p_error_type text default null,
  p_error_message text default null,
  p_next_retry_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := timezone('utc', now());
begin
  if p_status not in ('retryable', 'error') then
    raise exception 'Invalid checkpoint defer status' using errcode = '22023';
  end if;

  -- Serialize against job release/finalization and require the exact live
  -- service worker that owns both the job and checkpoint leases.
  perform 1
  from public.audit_jobs job
  where job.id = p_job_id
    and job.workflow_version = 'resumable-audit-v1'
    and job.status = 'running'
    and job.lease_token = p_lease_token
    and job.lease_expires_at > v_now
  for update;
  if not found then return false; end if;

  update public.audit_job_checkpoints checkpoint set
    status = p_status,
    lease_token = null,
    lease_expires_at = null,
    next_retry_at = case
      when p_status = 'retryable' then coalesce(p_next_retry_at, v_now)
      else null
    end,
    error_type = p_error_type,
    error_message = left(coalesce(p_error_message, 'Audit checkpoint deferred.'), 1000),
    updated_at = v_now,
    finished_at = case when p_status = 'error' then v_now else null end
  where checkpoint.id = p_checkpoint_id
    and checkpoint.job_id = p_job_id
    and checkpoint.status = 'running'
    and checkpoint.lease_token = p_lease_token;
  if not found then return false; end if;

  update public.audit_jobs job set
    last_heartbeat_at = v_now,
    updated_at = v_now
  where job.id = p_job_id and job.lease_token = p_lease_token;

  return true;
end;
$$;

revoke all on function public.ccc_defer_audit_checkpoint(uuid, uuid, uuid, text, text, text, timestamptz) from public;
revoke all on function public.ccc_defer_audit_checkpoint(uuid, uuid, uuid, text, text, text, timestamptz) from anon;
revoke all on function public.ccc_defer_audit_checkpoint(uuid, uuid, uuid, text, text, text, timestamptz) from authenticated;
grant execute on function public.ccc_defer_audit_checkpoint(uuid, uuid, uuid, text, text, text, timestamptz) to service_role;

do $$
declare
  v_public boolean;
  v_anon boolean;
  v_authenticated boolean;
  v_service boolean;
begin
  select
    has_function_privilege('public', 'public.ccc_defer_audit_checkpoint(uuid,uuid,uuid,text,text,text,timestamptz)', 'EXECUTE'),
    has_function_privilege('anon', 'public.ccc_defer_audit_checkpoint(uuid,uuid,uuid,text,text,text,timestamptz)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.ccc_defer_audit_checkpoint(uuid,uuid,uuid,text,text,text,timestamptz)', 'EXECUTE'),
    has_function_privilege('service_role', 'public.ccc_defer_audit_checkpoint(uuid,uuid,uuid,text,text,text,timestamptz)', 'EXECUTE')
  into v_public, v_anon, v_authenticated, v_service;

  if v_public or v_anon or v_authenticated or not v_service then
    raise exception 'Parallel audit checkpoint defer ACL verification failed';
  end if;
end;
$$;

-- Preserve the original four-argument splitter for a frozen old worker during
-- cutover. New workers use this reason-aware variant so timeout telemetry is
-- truthful and a three-page range can be reduced without recreating itself.
create or replace function public.ccc_split_audit_checkpoint_v2(
  p_checkpoint_id uuid,
  p_lease_token uuid,
  p_left_input_sha256 text,
  p_right_input_sha256 text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.audit_job_checkpoints%rowtype;
  v_mid integer;
  v_left_end integer;
  v_right_start integer;
  v_now timestamptz := timezone('utc', now());
begin
  if p_reason not in ('output_limit', 'provider_timeout', 'native_fallback') then
    raise exception 'Invalid checkpoint split reason' using errcode = '22023';
  end if;
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
    and checkpoint.end_page - checkpoint.start_page + 1 >= 3
    and job.workflow_version = 'resumable-audit-v1'
    and job.status = 'running' and job.lease_token = p_lease_token
    and job.lease_expires_at > v_now
  for update of checkpoint;
  if not found then return false; end if;

  v_mid := pg_catalog.floor((v_parent.start_page + v_parent.end_page)::numeric / 2)::integer;
  if v_parent.end_page - v_parent.start_page + 1 = 3 then
    v_left_end := v_mid;
    v_right_start := v_mid;
  else
    v_left_end := v_mid + 1;
    v_right_start := v_mid;
  end if;

  insert into public.audit_job_checkpoints (
    job_id, checkpoint_key, sequence, kind, bureau, source_index, source_path,
    source_sha256, source_bytes, source_media_type, input_sha256,
    start_page, end_page, total_pages, chunk_index, chunk_count, status
  ) values
  (
    v_parent.job_id,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      v_parent.checkpoint_key || '|v2-left|' || v_parent.start_page || '|' || v_left_end, 'UTF8'), 'sha256'), 'hex'),
    (v_parent.source_index * 1000000) + (v_parent.start_page * 100),
    v_parent.kind, v_parent.bureau, v_parent.source_index,
    v_parent.source_path, v_parent.source_sha256, v_parent.source_bytes,
    v_parent.source_media_type, p_left_input_sha256,
    v_parent.start_page, v_left_end, v_parent.total_pages,
    v_parent.chunk_index * 10 + 1, v_parent.chunk_count + 1, 'pending'
  ),
  (
    v_parent.job_id,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      v_parent.checkpoint_key || '|v2-right|' || v_right_start || '|' || v_parent.end_page, 'UTF8'), 'sha256'), 'hex'),
    (v_parent.source_index * 1000000) + (v_right_start * 100),
    v_parent.kind, v_parent.bureau, v_parent.source_index,
    v_parent.source_path, v_parent.source_sha256, v_parent.source_bytes,
    v_parent.source_media_type, p_right_input_sha256,
    v_right_start, v_parent.end_page, v_parent.total_pages,
    v_parent.chunk_index * 10 + 2, v_parent.chunk_count + 1, 'pending'
  );

  update public.audit_job_checkpoints set
    status = 'superseded', lease_token = null, lease_expires_at = null,
    error_type = p_reason || '_split',
    error_message = case p_reason
      when 'provider_timeout' then 'Provider deadline observed; replaced by smaller durable page checkpoints.'
      when 'native_fallback' then 'Native text eligibility changed before dispatch; replaced by smaller source-PDF checkpoints.'
      when 'output_limit' then 'Provider output limit observed; replaced by smaller durable page checkpoints.'
    end,
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
    stage = case p_reason
      when 'provider_timeout' then 'Slow page range split into smaller saved checkpoints'
      when 'native_fallback' then 'Native text range split before provider dispatch'
      when 'output_limit' then 'Dense page range split into smaller saved checkpoints'
    end,
    last_heartbeat_at = v_now, updated_at = v_now
  where job.id = v_parent.job_id and job.lease_token = p_lease_token;
  return true;
end;
$$;

revoke all on function public.ccc_split_audit_checkpoint_v2(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ccc_split_audit_checkpoint_v2(uuid, uuid, text, text, text)
  to service_role;

-- Recover a provider-timeout job without re-uploading or repeating its saved
-- checkpoints. Failed parents remain immutable history; fresh attempt-zero
-- children reuse only their exact source-bound page ranges.
create or replace function public.ccc_resume_failed_audit_job(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.audit_jobs%rowtype;
  v_now timestamptz := timezone('utc', now());
  v_recovered integer := 0;
begin
  select * into v_job from public.audit_jobs job
  where job.id = p_job_id
    and job.workflow_version = 'resumable-audit-v1'
    and job.status = 'error'
    and job.source_cleanup_at is null
    and job.expires_at > v_now
  for update;
  if not found then return false; end if;
  if exists (
    select 1 from public.audit_jobs other
    where other.id <> v_job.id and other.logical_key = v_job.logical_key
      and other.user_id = v_job.user_id
      and other.status in ('queued', 'waiting', 'retryable', 'running', 'finalizing', 'done')
  ) then return false; end if;
  if exists (
    select 1 from public.audit_job_checkpoints checkpoint
    where checkpoint.job_id = v_job.id and checkpoint.status = 'running'
  ) then return false; end if;
  if exists (
    select 1 from public.audit_job_checkpoints checkpoint
    where checkpoint.job_id = v_job.id
      and checkpoint.status = 'error'
      and checkpoint.error_type is distinct from 'provider_timeout'
  ) then return false; end if;

  insert into public.audit_job_checkpoints (
    job_id, checkpoint_key, sequence, kind, bureau, source_index, source_path,
    source_sha256, source_bytes, source_media_type, input_sha256,
    start_page, end_page, total_pages, chunk_index, chunk_count, status
  )
  select
    parent.job_id,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      parent.checkpoint_key || '|compact-medium-recovery-v1', 'UTF8'), 'sha256'), 'hex'),
    parent.sequence, parent.kind, parent.bureau, parent.source_index,
    parent.source_path, parent.source_sha256, parent.source_bytes,
    parent.source_media_type, parent.input_sha256,
    parent.start_page, parent.end_page, parent.total_pages,
    parent.chunk_index, parent.chunk_count, 'pending'
  from public.audit_job_checkpoints parent
  where parent.job_id = v_job.id
    and parent.status = 'error'
    and parent.error_type = 'provider_timeout';
  get diagnostics v_recovered = row_count;
  if v_recovered = 0 then return false; end if;

  update public.audit_job_checkpoints parent set
    status = 'superseded',
    error_type = 'provider_timeout_recovered',
    error_message = 'Retained as failed-attempt history; replaced by compact medium-effort recovery checkpoint.',
    updated_at = v_now
  where parent.job_id = v_job.id
    and parent.status = 'error'
    and parent.error_type = 'provider_timeout';

  update public.audit_jobs job set
    status = 'waiting', retryable = true, next_retry_at = v_now,
    stage = 'Resuming from saved checkpoints with optimized extraction',
    error = null, finished_at = null, retry_count = 0,
    expected_checkpoint_count = (
      select count(*) from public.audit_job_checkpoints checkpoint
      where checkpoint.job_id = v_job.id and checkpoint.status <> 'superseded'
    ),
    completed_checkpoint_count = (
      select count(*) from public.audit_job_checkpoints checkpoint
      where checkpoint.job_id = v_job.id and checkpoint.status = 'done'
    ),
    updated_at = v_now, last_heartbeat_at = v_now
  where job.id = v_job.id;
  return true;
end;
$$;

revoke all on function public.ccc_resume_failed_audit_job(uuid)
  from public, anon, authenticated;
grant execute on function public.ccc_resume_failed_audit_job(uuid) to service_role;

-- Close the cross-tab/device gap in the v1 create RPC without rewriting its
-- validated manifest construction. The original function still owns input
-- validation and the transaction-scoped user/logical-key advisory lock. This
-- wrapper runs before that lock is released: if the base inserted a fresh
-- candidate while an exact retained error job exists, delete the unused
-- candidate and return the retained job instead. Pure provider-timeout jobs
-- can resume; mixed/other terminal causes return the same retained id and the
-- browser/endpoint fail closed to Operations. In neither case can a second
-- paid logical job start.
alter function public.ccc_create_or_resume_audit_job(uuid, text, jsonb, uuid, jsonb)
  rename to ccc_create_or_resume_audit_job_v1_base;

revoke all on function public.ccc_create_or_resume_audit_job_v1_base(uuid, text, jsonb, uuid, jsonb)
  from public, anon, authenticated;

create function public.ccc_create_or_resume_audit_job(
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
  v_created_job_id uuid;
  v_created_status text;
  v_created_reused boolean;
  v_candidate public.audit_jobs%rowtype;
  v_retained public.audit_jobs%rowtype;
begin
  select base.job_id, base.job_status, base.reused
  into v_created_job_id, v_created_status, v_created_reused
  from public.ccc_create_or_resume_audit_job_v1_base(
    p_candidate_id, p_mode, p_files, p_selected_client_id, p_merge_selection
  ) base;

  if v_created_job_id is distinct from p_candidate_id or v_created_reused then
    return query select v_created_job_id, v_created_status, v_created_reused;
    return;
  end if;

  select * into v_candidate
  from public.audit_jobs candidate
  where candidate.id = p_candidate_id and candidate.user_id = auth.uid()
  for update;
  if not found or v_candidate.logical_key is null then
    raise exception 'Created audit candidate could not be reconciled' using errcode = '55000';
  end if;

  select * into v_retained
  from public.audit_jobs retained
  where retained.id <> v_candidate.id
    and retained.user_id = v_candidate.user_id
    and retained.logical_key = v_candidate.logical_key
    and retained.workflow_version = 'resumable-audit-v1'
    and retained.status = 'error'
    and retained.source_cleanup_at is null
    and retained.expires_at > timezone('utc', now())
  order by retained.updated_at desc, retained.created_at desc
  limit 1
  for update;

  if found then
    delete from public.audit_jobs candidate
    where candidate.id = v_candidate.id
      and candidate.user_id = v_candidate.user_id
      and candidate.status = 'queued'
      and candidate.attempt_count = 0
      and candidate.expected_checkpoint_count = 0;
    if not found then
      raise exception 'Unused duplicate audit candidate changed before reconciliation' using errcode = '55000';
    end if;
    return query select v_retained.id, v_retained.status, true;
    return;
  end if;

  return query select v_created_job_id, v_created_status, v_created_reused;
end;
$$;

revoke all on function public.ccc_create_or_resume_audit_job(uuid, text, jsonb, uuid, jsonb)
  from public, anon;
grant execute on function public.ccc_create_or_resume_audit_job(uuid, text, jsonb, uuid, jsonb)
  to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.ccc_split_audit_checkpoint_v2(uuid,uuid,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ccc_split_audit_checkpoint_v2(uuid,uuid,text,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.ccc_split_audit_checkpoint_v2(uuid,uuid,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.ccc_resume_failed_audit_job(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ccc_resume_failed_audit_job(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.ccc_resume_failed_audit_job(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ccc_create_or_resume_audit_job_v1_base(uuid,text,jsonb,uuid,jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.ccc_create_or_resume_audit_job(uuid,text,jsonb,uuid,jsonb)', 'EXECUTE') then
    raise exception 'Optimized audit recovery ACL verification failed';
  end if;
end;
$$;
