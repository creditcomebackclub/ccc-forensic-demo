-- Resume deterministic finalization without repeating paid extraction.
--
-- A resumable audit can hit a retry-safe coordinator/database failure after
-- every source-bound provider checkpoint is already immutable and complete.
-- This service-only transition lets the worker claim the exact logical job
-- and run finalization again. Data/attribution/integrity errors are excluded;
-- the transition never creates, clones, or changes a checkpoint.
--
-- Mixed-version rollout is additive: older workers ignore this RPC. Rollback
-- is `drop function public.ccc_resume_audit_finalization(uuid)` after callers
-- have been rolled back; retained jobs/checkpoints need no data rollback.

begin;

-- Retire the exact legacy side-by-side failure before exposing the narrower
-- coordinator retry below. Those immutable outputs discarded horizontal
-- bureau-column identity, so replaying finalization could only fail again (or
-- encourage unsafe attribution). `expired` removes the logical-key barrier;
-- the watchdog retains ownership of bounded source cleanup.
update public.audit_jobs job set
  status = 'expired',
  stage = 'Parser upgrade requires one fresh audit',
  error = 'This saved audit used a retired side-by-side bureau parser. Upload the report again so CCC can rebuild it with verified bureau-column attribution.',
  retryable = false,
  next_retry_at = null,
  lease_token = null,
  lease_expires_at = null,
  updated_at = timezone('utc', now()),
  finished_at = timezone('utc', now())
where job.workflow_version = 'resumable-audit-v1'
  and job.status = 'error'
  and job.error = 'A combined-report chunk contains data without a visible bureau identity.'
  and job.final_audit_id is null
  and (job.lease_token is null or job.lease_expires_at <= timezone('utc', now()))
  and job.source_cleanup_at is null
  and exists (
    select 1 from public.audit_job_checkpoints checkpoint
    where checkpoint.job_id = job.id and checkpoint.status <> 'superseded'
  )
  and not exists (
    select 1 from public.audit_job_checkpoints checkpoint
    where checkpoint.job_id = job.id
      and checkpoint.status <> 'superseded'
      and checkpoint.status <> 'done'
  );

create or replace function public.ccc_retire_incompatible_combined_audit_job(
  p_job_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.audit_jobs%rowtype;
  v_now timestamptz := timezone('utc', now());
begin
  select * into v_job
  from public.audit_jobs job
  where job.id = p_job_id
    and job.workflow_version = 'resumable-audit-v1'
    and job.mode = 'combined'
    and job.status = 'running'
    and job.final_audit_id is null
    and job.source_cleanup_at is null
    and job.lease_token = p_lease_token
    and job.lease_expires_at > v_now
  for update;
  if not found then return false; end if;

  if exists (
    select 1 from public.audit_provider_attempts provider
    where provider.job_id = v_job.id and provider.status = 'started'
  ) then return false; end if;

  update public.audit_job_attempts attempt set
    status = 'failed',
    error_type = 'parser_policy_retired',
    error_message = 'Saved combined-report plan predates verified bureau-column context.',
    finished_at = v_now
  where attempt.job_id = v_job.id
    and attempt.lease_token = p_lease_token
    and attempt.status = 'running';

  update public.audit_jobs job set
    status = 'expired',
    stage = 'Parser upgrade requires one fresh audit',
    error = 'This saved combined audit predates verified bureau-column attribution. Upload the report again; completed history is retained and no provider request was repeated.',
    retryable = false,
    next_retry_at = null,
    lease_token = null,
    lease_expires_at = null,
    updated_at = v_now,
    finished_at = v_now
  where job.id = v_job.id and job.lease_token = p_lease_token;

  return found;
end;
$$;

revoke all on function public.ccc_retire_incompatible_combined_audit_job(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.ccc_retire_incompatible_combined_audit_job(uuid, uuid)
  to service_role;

create or replace function public.ccc_resume_audit_finalization(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.audit_jobs%rowtype;
  v_user_id uuid;
  v_logical_key text;
  v_active_checkpoint_count integer := 0;
  v_done_checkpoint_count integer := 0;
  v_now timestamptz := timezone('utc', now());
begin
  -- Read only the serialization identity first. The logical-key advisory lock
  -- must be acquired before the row lock to preserve the create RPC's lock
  -- ordering and avoid a resume/new-upload deadlock.
  select job.user_id, job.logical_key
  into v_user_id, v_logical_key
  from public.audit_jobs job
  where job.id = p_job_id
    and job.workflow_version = 'resumable-audit-v1'
    and job.status = 'error'
    and job.logical_key is not null
    and job.error is distinct from 'A combined-report chunk contains data without a visible bureau identity.'
    and (
      job.error like 'Could not load completed audit checkpoints:%'
      or job.error like 'Could not verify final audit idempotency:%'
      or job.error like 'Audit ran but could not be saved:%'
      or job.error like 'Could not atomically finish logical audit job:%'
    )
    and job.source_cleanup_at is null
    and job.expires_at > v_now
    and (job.lease_token is null or job.lease_expires_at <= v_now);
  if not found then return false; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || v_logical_key, 0)
  );

  -- Re-read and lock the exact row after serialization. Every predicate is
  -- repeated because cleanup, expiry, or another recovery may have won while
  -- this transaction waited for the advisory lock.
  select * into v_job
  from public.audit_jobs job
  where job.id = p_job_id
    and job.user_id = v_user_id
    and job.logical_key = v_logical_key
    and job.workflow_version = 'resumable-audit-v1'
    and job.status = 'error'
    and job.error is distinct from 'A combined-report chunk contains data without a visible bureau identity.'
    and (
      job.error like 'Could not load completed audit checkpoints:%'
      or job.error like 'Could not verify final audit idempotency:%'
      or job.error like 'Audit ran but could not be saved:%'
      or job.error like 'Could not atomically finish logical audit job:%'
    )
    and job.source_cleanup_at is null
    and job.expires_at > v_now
    and (job.lease_token is null or job.lease_expires_at <= v_now)
  for update;
  if not found then return false; end if;

  -- A second active or completed generation owns this logical source. Never
  -- revive the retained error beside it and bypass the duplicate-spend guard.
  if exists (
    select 1 from public.audit_jobs other
    where other.id <> v_job.id
      and other.user_id = v_job.user_id
      and other.logical_key = v_job.logical_key
      and other.status in ('queued', 'waiting', 'retryable', 'running', 'finalizing', 'done')
  ) then return false; end if;

  -- Job-level finalization recovery is valid only when the entire active plan
  -- is already done. Superseded parents are immutable history, not plan work.
  select
    count(*) filter (where checkpoint.status <> 'superseded'),
    count(*) filter (where checkpoint.status = 'done')
  into v_active_checkpoint_count, v_done_checkpoint_count
  from public.audit_job_checkpoints checkpoint
  where checkpoint.job_id = v_job.id;

  if v_active_checkpoint_count = 0
     or v_done_checkpoint_count <> v_active_checkpoint_count
  then return false; end if;

  -- A terminal job should not own an attempt. Treat contradictory state as
  -- Operations-only instead of taking work away from a live worker.
  if exists (
    select 1 from public.audit_job_attempts attempt
    where attempt.job_id = v_job.id and attempt.status = 'running'
  ) then return false; end if;

  update public.audit_jobs job set
    status = 'waiting',
    stage = 'Resuming deterministic finalization from completed checkpoints',
    retryable = true,
    next_retry_at = v_now,
    error = null,
    finished_at = null,
    retry_count = 0,
    lease_token = null,
    lease_expires_at = null,
    expected_checkpoint_count = v_active_checkpoint_count,
    completed_checkpoint_count = v_done_checkpoint_count,
    last_heartbeat_at = v_now,
    updated_at = v_now
  where job.id = v_job.id;

  return true;
end;
$$;

revoke all on function public.ccc_resume_audit_finalization(uuid)
  from public, anon, authenticated;
grant execute on function public.ccc_resume_audit_finalization(uuid)
  to service_role;

do $$
begin
  if has_function_privilege('public', 'public.ccc_retire_incompatible_combined_audit_job(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.ccc_retire_incompatible_combined_audit_job(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ccc_retire_incompatible_combined_audit_job(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.ccc_retire_incompatible_combined_audit_job(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('public', 'public.ccc_resume_audit_finalization(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.ccc_resume_audit_finalization(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ccc_resume_audit_finalization(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.ccc_resume_audit_finalization(uuid)', 'EXECUTE')
  then
    raise exception 'Audit finalization-only resume ACL verification failed';
  end if;
end;
$$;

commit;
