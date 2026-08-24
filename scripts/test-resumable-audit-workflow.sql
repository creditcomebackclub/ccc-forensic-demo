\set ON_ERROR_STOP on
begin;

insert into auth.users (id, aud, role, email, created_at, updated_at)
values ('53000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'audit-resume@example.test', now(), now());
insert into public.profiles (id, full_name, email, role)
values ('53000000-0000-4000-8000-000000000001', 'Audit Resume', 'audit-resume@example.test', 'admin');
insert into public.clients (id, user_id, name, address, date_of_birth)
values (
  '53000000-0000-4000-8000-000000000010',
  '53000000-0000-4000-8000-000000000001',
  'Exact Audit Client', '123 Exact St, Phoenix, AZ 85001', '1990-01-01'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '53000000-0000-4000-8000-000000000001', true);

do $$
declare
  v_first uuid;
  v_second uuid;
begin
  select job_id into v_first from public.ccc_create_or_resume_audit_job(
    '53000000-0000-4000-8000-000000000101', 'combined',
    '[{"path":"53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000101/report.pdf","bureau":null,"type":"application/pdf","bytes":1024,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]'::jsonb,
    '53000000-0000-4000-8000-000000000010', null
  );
  select job_id into v_second from public.ccc_create_or_resume_audit_job(
    '53000000-0000-4000-8000-000000000102', 'combined',
    '[{"path":"53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000102/another-name.pdf","bureau":null,"type":"application/pdf","bytes":1024,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]'::jsonb,
    '53000000-0000-4000-8000-000000000010', null
  );
  if v_first is distinct from v_second then
    raise exception 'Logical source idempotency failed: % vs %', v_first, v_second;
  end if;

  perform public.ccc_create_or_resume_audit_job(
    '53000000-0000-4000-8000-000000000104', 'combined',
    '[{"path":"53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000104/dense.pdf","bureau":null,"type":"application/pdf","bytes":2048,"sha256":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}]'::jsonb,
    '53000000-0000-4000-8000-000000000010', null
  );
  perform public.ccc_create_or_resume_audit_job(
    '53000000-0000-4000-8000-000000000105', 'combined',
    '[{"path":"53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000105/terminal.pdf","bureau":null,"type":"application/pdf","bytes":512,"sha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}]'::jsonb,
    '53000000-0000-4000-8000-000000000010', null
  );
  perform public.ccc_create_or_resume_audit_job(
    '53000000-0000-4000-8000-000000000106', 'combined',
    '[{"path":"53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000106/live.pdf","bureau":null,"type":"application/pdf","bytes":768,"sha256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}]'::jsonb,
    '53000000-0000-4000-8000-000000000010', null
  );
  perform public.ccc_create_or_resume_audit_job(
    '53000000-0000-4000-8000-000000000107', 'combined',
    '[{"path":"53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000107/parallel.pdf","bureau":null,"type":"application/pdf","bytes":1536,"sha256":"7777777777777777777777777777777777777777777777777777777777777777"}]'::jsonb,
    '53000000-0000-4000-8000-000000000010', null
  );
  perform public.ccc_create_or_resume_audit_job(
    '53000000-0000-4000-8000-000000000108', 'combined',
    '[{"path":"53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000108/timeout-split.pdf","bureau":null,"type":"application/pdf","bytes":640,"sha256":"8888888888888888888888888888888888888888888888888888888888888888"}]'::jsonb,
    '53000000-0000-4000-8000-000000000010', null
  );
  perform public.ccc_create_or_resume_audit_job(
    '53000000-0000-4000-8000-000000000109', 'combined',
    '[{"path":"53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000109/resume.pdf","bureau":null,"type":"application/pdf","bytes":896,"sha256":"6666666666666666666666666666666666666666666666666666666666666666"}]'::jsonb,
    '53000000-0000-4000-8000-000000000010', null
  );

  insert into public.audit_jobs (id, user_id, mode, files, workflow_version)
  values (
    '53000000-0000-4000-8000-000000000103',
    '53000000-0000-4000-8000-000000000001', 'combined',
    '[{"path":"53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000103/legacy.pdf"}]'::jsonb,
    'resumable-audit-v1'
  );
  if (select workflow_version <> 'legacy-browser-blocked'
        or logical_key is not null
        or status <> 'error'
        or retryable
        or expires_at > now() + interval '2 hours 1 minute'
      from public.audit_jobs where id = '53000000-0000-4000-8000-000000000103') then
    raise exception 'Retired browser insert escaped explicit reload-required quarantine';
  end if;

  begin
    insert into public.audit_job_checkpoints (job_id, checkpoint_key, sequence, kind)
    values (v_first, repeat('x', 64), 0, 'merge');
    raise exception 'Authenticated checkpoint insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;

insert into storage.objects (bucket_id, name, created_at)
values
  (
    'documents',
    '53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000101/report.pdf',
    now() - interval '3 hours'
  ),
  (
    'documents',
    '53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000199/orphan.pdf',
    now() - interval '3 hours'
  );

do $$
begin
  if not exists (
    select 1 from public.ccc_claim_orphan_audit_upload_cleanup(100)
    where candidate_job_id = '53000000-0000-4000-8000-000000000199'
      and pg_catalog.array_to_string(paths, ',') like '%/53000000-0000-4000-8000-000000000199/orphan.pdf'
  ) then raise exception 'Unreferenced pre-RPC source was not eligible for bounded cleanup'; end if;
  if exists (
    select 1 from public.ccc_claim_orphan_audit_upload_cleanup(100)
    where candidate_job_id = '53000000-0000-4000-8000-000000000101'
  ) then raise exception 'Durable audit source was incorrectly classified as orphaned'; end if;
end;
$$;

-- A completed tombstone must reopen when a suspended tab writes a later
-- object under the same candidate. The retained tombstone continues to block
-- job creation while the newly aged path becomes eligible for deletion.
update public.audit_upload_cleanup_claims
set completed_at = now(), cleanup_error = null
where candidate_job_id = '53000000-0000-4000-8000-000000000199';
insert into storage.objects (bucket_id, name, created_at)
values (
  'documents',
  '53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000199/late.pdf',
  now() - interval '3 hours'
);

do $$
begin
  if not exists (
    select 1 from public.ccc_claim_orphan_audit_upload_cleanup(100)
    where candidate_job_id = '53000000-0000-4000-8000-000000000199'
      and '53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000199/late.pdf' = any(paths)
  ) then raise exception 'Completed cleanup tombstone did not reopen for a later aged upload'; end if;
  if not exists (
    select 1 from public.audit_upload_cleanup_claims
    where candidate_job_id = '53000000-0000-4000-8000-000000000199'
      and completed_at is null
      and '53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000199/late.pdf' = any(paths)
  ) then raise exception 'Reopened cleanup claim was not durably bound to the late path'; end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '53000000-0000-4000-8000-000000000001', true);
do $$
begin
  begin
    perform public.ccc_create_or_resume_audit_job(
      '53000000-0000-4000-8000-000000000199', 'combined',
      '[{"path":"53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000199/orphan.pdf","bureau":null,"type":"application/pdf","bytes":768,"sha256":"9999999999999999999999999999999999999999999999999999999999999999"}]'::jsonb,
      '53000000-0000-4000-8000-000000000010', null
    );
    raise exception 'Late job creation reused a cleanup-claimed source';
  exception when sqlstate '55000' then null;
  end;
end;
$$;
reset role;

do $$
begin
  begin
    delete from public.clients where id = '53000000-0000-4000-8000-000000000010';
    raise exception 'Client deletion unexpectedly detached retained audit evidence';
  exception when foreign_key_violation then null;
  end;
  if not exists (select 1 from public.clients where id = '53000000-0000-4000-8000-000000000010') then
    raise exception 'Client deletion retention guard did not roll back safely';
  end if;

  update public.audit_jobs set
    status = 'error', retryable = false, expires_at = now() - interval '1 second'
  where id = '53000000-0000-4000-8000-000000000105';
  perform * from public.ccc_reclaim_stale_audit_jobs(100);
  if not exists (
    select 1 from public.audit_jobs
    where id = '53000000-0000-4000-8000-000000000105' and status = 'expired'
  ) then raise exception 'Terminal resumable error did not enter bounded source cleanup state'; end if;

  update public.audit_jobs set
    status = 'running', expires_at = now() - interval '1 second',
    lease_token = '53000000-0000-4000-8000-000000000206',
    lease_expires_at = now() + interval '5 minutes'
  where id = '53000000-0000-4000-8000-000000000106';
  perform * from public.ccc_reclaim_stale_audit_jobs(100);
  if not exists (
    select 1 from public.audit_jobs
    where id = '53000000-0000-4000-8000-000000000106'
      and status = 'running'
      and lease_token = '53000000-0000-4000-8000-000000000206'
  ) then raise exception 'Live worker was expired before its active lease ended'; end if;
end;
$$;

do $$
declare
  v_job uuid := '53000000-0000-4000-8000-000000000104';
  v_lease uuid := '53000000-0000-4000-8000-000000000204';
  v_parent uuid := '53000000-0000-4000-8000-000000000304';
  v_left public.audit_job_checkpoints%rowtype;
begin
  if not public.ccc_claim_audit_job(v_job, v_lease, 'staff', 60) then
    raise exception 'Dense-range split job lease was not acquired';
  end if;
  insert into public.audit_job_checkpoints (
    id, job_id, checkpoint_key, sequence, kind, source_index, source_path,
    source_sha256, source_bytes, source_media_type, input_sha256,
    start_page, end_page, total_pages, chunk_index, chunk_count
  ) values (
    v_parent, v_job, repeat('f', 64), 100, 'combined_chunk', 0,
    '53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000104/dense.pdf',
    repeat('e', 64), 2048, 'application/pdf', repeat('1', 64), 1, 5, 5, 0, 1
  );
  update public.audit_jobs set expected_checkpoint_count = 1 where id = v_job;
  select * into v_left from public.ccc_claim_next_audit_checkpoint(v_job, v_lease);
  if v_left.id is distinct from v_parent then
    raise exception 'Dense parent checkpoint claim failed';
  end if;
  if not public.ccc_split_audit_checkpoint(
    v_parent, v_lease, repeat('2', 64), repeat('3', 64)
  ) then raise exception 'Initial output-limit split failed'; end if;

  select * into v_left
  from public.ccc_claim_next_audit_checkpoint(v_job, v_lease);
  if v_left.start_page <> 1 or v_left.end_page <> 4 then
    raise exception 'Unexpected first split child range: %-%', v_left.start_page, v_left.end_page;
  end if;
  if not public.ccc_split_audit_checkpoint(
    v_left.id, v_lease, repeat('4', 64), repeat('5', 64)
  ) then raise exception 'Recursive output-limit split failed'; end if;

  if (select expected_checkpoint_count from public.audit_jobs where id = v_job) <> 3 then
    raise exception 'Recursive split did not leave exactly three active checkpoints';
  end if;
  if exists (
    select sequence from public.audit_job_checkpoints
    where job_id = v_job and status <> 'superseded'
    group by sequence having count(*) > 1
  ) then raise exception 'Recursive split created duplicate active checkpoint ordering'; end if;
  if not exists (
    select 1
    from public.audit_job_checkpoints
    where job_id = v_job and status <> 'superseded'
    group by job_id
    having array_agg(format('%s-%s', start_page, end_page) order by sequence)
      = array['1-3', '2-4', '3-5']
  ) then raise exception 'Recursive split ranges/order are not deterministic'; end if;
end;
$$;

-- One exclusively leased worker may claim several independent provider
-- checkpoints, then settle each one without releasing the shared job lease.
do $$
declare
  v_job uuid := '53000000-0000-4000-8000-000000000107';
  v_lease uuid := '53000000-0000-4000-8000-000000000207';
  v_first uuid := '53000000-0000-4000-8000-000000000307';
  v_second uuid := '53000000-0000-4000-8000-000000000308';
  v_claim_one public.audit_job_checkpoints%rowtype;
  v_claim_two public.audit_job_checkpoints%rowtype;
begin
  if not public.ccc_claim_audit_job(v_job, v_lease, 'staff', 60) then
    raise exception 'Parallel checkpoint job lease was not acquired';
  end if;
  insert into public.audit_job_checkpoints (
    id, job_id, checkpoint_key, sequence, kind, source_index, source_path,
    source_sha256, source_bytes, source_media_type, input_sha256,
    start_page, end_page, total_pages, chunk_index, chunk_count
  ) values
  (
    v_first, v_job, repeat('7', 64), 100, 'combined_chunk', 0,
    '53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000107/parallel.pdf',
    repeat('7', 64), 1536, 'application/pdf', repeat('8', 64), 1, 7, 12, 0, 2
  ),
  (
    v_second, v_job, repeat('9', 64), 800, 'combined_chunk', 0,
    '53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000107/parallel.pdf',
    repeat('7', 64), 1536, 'application/pdf', repeat('a', 64), 7, 12, 12, 1, 2
  );
  update public.audit_jobs set expected_checkpoint_count = 2 where id = v_job;

  select * into v_claim_one from public.ccc_claim_next_audit_checkpoint(v_job, v_lease);
  select * into v_claim_two from public.ccc_claim_next_audit_checkpoint(v_job, v_lease);
  if v_claim_one.id is distinct from v_first or v_claim_two.id is distinct from v_second then
    raise exception 'Bounded parallel claims were not distinct and deterministic';
  end if;
  if not public.ccc_complete_audit_checkpoint(
    v_first, v_lease, '{"reports":[]}'::jsonb, repeat('b', 64), '{"output":10}'::jsonb
  ) then raise exception 'First parallel checkpoint did not complete'; end if;
  if not public.ccc_defer_audit_checkpoint(
    v_job, v_second, v_lease, 'retryable', 'provider_rate_limit',
    'Provider asked the checkpoint to retry.', now() + interval '30 seconds'
  ) then raise exception 'Second parallel checkpoint did not defer independently'; end if;
  if public.ccc_defer_audit_checkpoint(
    v_job, v_second, '53000000-0000-4000-8000-000000000299', 'error',
    'wrong_lease', 'Wrong worker must not settle checkpoint.', null
  ) then raise exception 'Wrong lease settled a parallel checkpoint'; end if;
  if not exists (
    select 1 from public.audit_jobs
    where id = v_job and status = 'running' and lease_token = v_lease
  ) then raise exception 'Per-checkpoint settlement released the shared job lease'; end if;
  if not exists (
    select 1 from public.audit_job_checkpoints
    where id = v_first and status = 'done' and lease_token is null
  ) or not exists (
    select 1 from public.audit_job_checkpoints
    where id = v_second and status = 'retryable' and lease_token is null
      and next_retry_at is not null
  ) then raise exception 'Parallel checkpoint statuses were not isolated'; end if;
  if not public.ccc_release_audit_job(
    v_job, v_lease, 'waiting', 'Parallel batch settled', null, null, now(), null
  ) then raise exception 'Parallel batch job release failed'; end if;
end;
$$;

-- Timeout provenance is distinct from output-limit provenance, and a
-- three-page parent must reduce to two overlapping two-page children rather
-- than paying for the same unsplittable request again.
do $$
declare
  v_job uuid := '53000000-0000-4000-8000-000000000108';
  v_lease uuid := '53000000-0000-4000-8000-000000000208';
  v_parent uuid := '53000000-0000-4000-8000-000000000309';
  v_claimed public.audit_job_checkpoints%rowtype;
begin
  if not public.ccc_claim_audit_job(v_job, v_lease, 'staff', 60) then
    raise exception 'Timeout-split job lease was not acquired';
  end if;
  insert into public.audit_job_checkpoints (
    id, job_id, checkpoint_key, sequence, kind, source_index, source_path,
    source_sha256, source_bytes, source_media_type, input_sha256,
    start_page, end_page, total_pages, chunk_index, chunk_count
  ) values (
    v_parent, v_job, repeat('8', 64), 900, 'combined_chunk', 0,
    '53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000108/timeout-split.pdf',
    repeat('8', 64), 640, 'application/pdf', repeat('1', 64), 9, 11, 29, 4, 5
  );
  update public.audit_jobs set expected_checkpoint_count = 1 where id = v_job;
  select * into v_claimed from public.ccc_claim_next_audit_checkpoint(v_job, v_lease);
  if v_claimed.id is distinct from v_parent then
    raise exception 'Three-page timeout parent was not claimed';
  end if;
  begin
    perform public.ccc_split_audit_checkpoint_v2(
      v_parent, v_lease, repeat('2', 64), repeat('3', 64), 'unknown_reason'
    );
    raise exception 'Invalid split reason unexpectedly succeeded';
  exception when invalid_parameter_value then null;
  end;
  if not public.ccc_split_audit_checkpoint_v2(
    v_parent, v_lease, repeat('2', 64), repeat('3', 64), 'provider_timeout'
  ) then raise exception 'Three-page timeout split failed'; end if;
  if not exists (
    select 1 from public.audit_job_checkpoints
    where id = v_parent and status = 'superseded'
      and error_type = 'provider_timeout_split'
  ) then raise exception 'Timeout split provenance was not preserved'; end if;
  if not exists (
    select 1 from public.audit_job_checkpoints
    where job_id = v_job and status <> 'superseded'
    group by job_id
    having array_agg(format('%s-%s', start_page, end_page) order by sequence)
      = array['9-10', '10-11']
  ) then raise exception 'Three-page timeout split ranges were not deterministic'; end if;
  if not public.ccc_release_audit_job(
    v_job, v_lease, 'waiting', 'Timeout range split', null, null, now(), null
  ) then raise exception 'Timeout-split job release failed'; end if;
end;
$$;

-- A terminal provider-timeout job resumes in place. Completed checkpoints are
-- never repeated; only the exact failed source-bound range gets one new child.
do $$
declare
  v_job uuid := '53000000-0000-4000-8000-000000000109';
  v_lease uuid := '53000000-0000-4000-8000-000000000209';
  v_done uuid := '53000000-0000-4000-8000-000000000310';
  v_failed uuid := '53000000-0000-4000-8000-000000000311';
  v_other_failed uuid := '53000000-0000-4000-8000-000000000312';
  v_duplicate_candidate uuid := '53000000-0000-4000-8000-000000000159';
  v_reused_job uuid;
  v_was_reused boolean;
  v_claimed public.audit_job_checkpoints%rowtype;
begin
  if not public.ccc_claim_audit_job(v_job, v_lease, 'staff', 60) then
    raise exception 'Failed-job recovery lease was not acquired';
  end if;
  insert into public.audit_job_checkpoints (
    id, job_id, checkpoint_key, sequence, kind, source_index, source_path,
    source_sha256, source_bytes, source_media_type, input_sha256,
    start_page, end_page, total_pages, chunk_index, chunk_count
  ) values
  (
    v_done, v_job, repeat('6', 64), 100, 'combined_chunk', 0,
    '53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000109/resume.pdf',
    repeat('6', 64), 896, 'application/pdf', repeat('4', 64), 1, 7, 29, 0, 2
  ),
  (
    v_failed, v_job, repeat('5', 64), 800, 'combined_chunk', 0,
    '53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000109/resume.pdf',
    repeat('6', 64), 896, 'application/pdf', repeat('7', 64), 7, 11, 29, 1, 2
  );
  update public.audit_jobs set expected_checkpoint_count = 2 where id = v_job;
  select * into v_claimed from public.ccc_claim_next_audit_checkpoint(v_job, v_lease);
  if v_claimed.id is distinct from v_done then raise exception 'Recovery done checkpoint claim failed'; end if;
  if not public.ccc_complete_audit_checkpoint(
    v_done, v_lease, '{"reports":[]}'::jsonb, repeat('a', 64), '{"output":10}'::jsonb
  ) then raise exception 'Recovery fixture done checkpoint failed'; end if;
  select * into v_claimed from public.ccc_claim_next_audit_checkpoint(v_job, v_lease);
  if v_claimed.id is distinct from v_failed then raise exception 'Recovery failed checkpoint claim failed'; end if;
  if not public.ccc_defer_audit_checkpoint(
    v_job, v_failed, v_lease, 'error', 'provider_timeout',
    'Saved section timed out.', null
  ) then raise exception 'Recovery fixture checkpoint did not become terminal'; end if;
  if not public.ccc_release_audit_job(
    v_job, v_lease, 'error', 'Audit stopped for review', 'provider_timeout',
    'Saved section timed out.', null, null
  ) then raise exception 'Recovery fixture job did not become terminal'; end if;

  insert into public.audit_job_checkpoints (
    id, job_id, checkpoint_key, sequence, kind, source_index, source_path,
    source_sha256, source_bytes, source_media_type, input_sha256,
    start_page, end_page, total_pages, chunk_index, chunk_count,
    status, error_type, error_message
  ) values (
    v_other_failed, v_job, repeat('9', 64), 900, 'combined_chunk', 0,
    '53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000109/resume.pdf',
    repeat('6', 64), 896, 'application/pdf', repeat('9', 64), 12, 14, 29, 2, 3,
    'error', 'validation_error', 'A different terminal cause requires Operations review.'
  );
  if public.ccc_resume_failed_audit_job(v_job) then
    raise exception 'Mixed terminal checkpoint causes were incorrectly resumed';
  end if;
  update public.audit_job_checkpoints set
    status = 'superseded', error_type = 'test_fixture_retired', updated_at = now()
  where id = v_other_failed;

  select result.job_id, result.reused
  into v_reused_job, v_was_reused
  from public.ccc_create_or_resume_audit_job(
    v_duplicate_candidate, 'combined',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'path', '53000000-0000-4000-8000-000000000001/audit-jobs/' || v_duplicate_candidate::text || '/same-report.pdf',
      'bureau', null, 'type', 'application/pdf', 'bytes', 896,
      'sha256', repeat('6', 64)
    )),
    '53000000-0000-4000-8000-000000000010', null
  ) result;
  if v_reused_job is distinct from v_job or not v_was_reused then
    raise exception 'Exact provider-timeout job was not reused across tabs/devices';
  end if;
  if exists (select 1 from public.audit_jobs where id = v_duplicate_candidate) then
    raise exception 'Cross-tab recovery left a duplicate paid audit candidate';
  end if;

  if not public.ccc_resume_failed_audit_job(v_job) then
    raise exception 'Failed provider-timeout job did not resume in place';
  end if;
  if public.ccc_resume_failed_audit_job(v_job) then
    raise exception 'Second recovery call unexpectedly duplicated a checkpoint';
  end if;
  if not exists (
    select 1 from public.audit_job_checkpoints
    where id = v_done and status = 'done' and output_sha256 = repeat('a', 64)
  ) then raise exception 'Completed checkpoint was mutated during recovery'; end if;
  if not exists (
    select 1 from public.audit_job_checkpoints
    where id = v_failed and status = 'superseded'
      and error_type = 'provider_timeout_recovered'
  ) then raise exception 'Failed checkpoint history was not retained'; end if;
  if (select count(*) from public.audit_job_checkpoints
      where job_id = v_job and status = 'pending' and start_page = 7 and end_page = 11) <> 1 then
    raise exception 'Recovery did not create exactly one source-bound replacement';
  end if;
  if not exists (
    select 1 from public.audit_jobs where id = v_job
      and status = 'waiting' and retryable
      and expected_checkpoint_count = 2 and completed_checkpoint_count = 1
  ) then raise exception 'Recovered job counters/status are invalid'; end if;
end;
$$;

do $$
begin
  if public.ccc_claim_audit_job(
    '53000000-0000-4000-8000-000000000103',
    '53000000-0000-4000-8000-000000000299', 'watchdog', 60
  ) then raise exception 'Legacy job was incorrectly dispatchable'; end if;
  if exists (
    select 1 from public.ccc_reclaim_stale_audit_jobs(100)
    where job_id = '53000000-0000-4000-8000-000000000103'
  ) then raise exception 'Legacy job entered watchdog dispatch queue'; end if;
  if not exists (
    select 1 from public.audit_jobs
    where id = '53000000-0000-4000-8000-000000000103'
      and workflow_version = 'legacy-browser-blocked'
      and status = 'error'
      and files->0->>'path' like '%/legacy.pdf'
      and source_cleanup_at is null
  ) then raise exception 'Blocked old-browser source grace period was not preserved'; end if;
end;
$$;

do $$
declare
  v_job uuid := '53000000-0000-4000-8000-000000000101';
  v_lease_one uuid := '53000000-0000-4000-8000-000000000201';
  v_lease_two uuid := '53000000-0000-4000-8000-000000000202';
  v_lease_three uuid := '53000000-0000-4000-8000-000000000203';
  v_checkpoint uuid := '53000000-0000-4000-8000-000000000301';
  v_claimed public.audit_job_checkpoints%rowtype;
  v_audit_id text := 'exact-audit__53000000-0000-4000-8000-000000000101';
begin
  if not public.ccc_claim_audit_job(v_job, v_lease_one, 'staff', 60) then
    raise exception 'Initial job lease was not acquired';
  end if;
  insert into public.audit_job_checkpoints (
    id, job_id, checkpoint_key, sequence, kind, source_index, source_path,
    source_sha256, source_bytes, source_media_type, input_sha256,
    start_page, end_page, total_pages, chunk_index, chunk_count
  ) values (
    v_checkpoint, v_job, repeat('b', 64), 0, 'combined_chunk', 0,
    '53000000-0000-4000-8000-000000000001/audit-jobs/53000000-0000-4000-8000-000000000101/report.pdf',
    repeat('a', 64), 1024, 'application/pdf', repeat('c', 64), 1, 20, 20, 0, 1
  );
  update public.audit_jobs set expected_checkpoint_count = 1 where id = v_job;
  select * into v_claimed from public.ccc_claim_next_audit_checkpoint(v_job, v_lease_one);
  if v_claimed.id is distinct from v_checkpoint then raise exception 'Checkpoint claim failed'; end if;

  -- Simulate Netlify killing the process without a terminal write. The next
  -- lease safely expires/reclaims both the attempt and running checkpoint.
  update public.audit_jobs set lease_expires_at = now() - interval '1 second' where id = v_job;
  update public.audit_job_attempts set lease_expires_at = now() - interval '1 second' where job_id = v_job;
  update public.audit_job_checkpoints set lease_expires_at = now() - interval '1 second' where id = v_checkpoint;
  if not public.ccc_claim_audit_job(v_job, v_lease_two, 'watchdog', 60) then
    raise exception 'Expired lease was not reclaimable';
  end if;
  if not exists (select 1 from public.audit_job_attempts where job_id = v_job and lease_token = v_lease_one and status = 'expired') then
    raise exception 'Killed attempt was not recorded as expired';
  end if;
  select * into v_claimed from public.ccc_claim_next_audit_checkpoint(v_job, v_lease_two);

  -- A delayed provider failure remains the same logical job and cannot be
  -- reclaimed until its next_retry_at.
  if not public.ccc_release_audit_job(
    v_job, v_lease_two, 'retryable', 'Delayed provider retry', 'provider_timeout',
    'provider delayed', now() + interval '1 minute', v_checkpoint
  ) then raise exception 'Retryable release failed'; end if;
  if public.ccc_claim_audit_job(v_job, v_lease_three, 'chain', 60) then
    raise exception 'Future delayed retry was claimed too early';
  end if;
  update public.audit_jobs set next_retry_at = now() - interval '1 second' where id = v_job;
  update public.audit_job_checkpoints set next_retry_at = now() - interval '1 second' where id = v_checkpoint;
  if not public.ccc_claim_audit_job(v_job, v_lease_three, 'watchdog', 60) then
    raise exception 'Due delayed retry was not reclaimable';
  end if;
  select * into v_claimed from public.ccc_claim_next_audit_checkpoint(v_job, v_lease_three);
  if not public.ccc_complete_audit_checkpoint(v_checkpoint, v_lease_three, '{"reports":[]}'::jsonb, repeat('d', 64), '{}'::jsonb) then
    raise exception 'Checkpoint completion failed';
  end if;
  if (select retry_count from public.audit_jobs where id = v_job) <> 0 then
    raise exception 'Successful checkpoint did not reset the consecutive job retry budget';
  end if;

  insert into public.audits (
    id, user_id, created_by, client_id, client_name, client_address, report_date, audit
  ) values (
    v_audit_id, '53000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000001',
    '53000000-0000-4000-8000-000000000010', 'Exact Audit Client', '123 Exact St', '2026-08-20',
    '{"evaluationMode":"deterministic"}'::jsonb
  );
  if not public.ccc_finish_audit_job(v_job, v_lease_three, '{"auditId":"exact-audit__53000000-0000-4000-8000-000000000101"}'::jsonb, '{}'::jsonb, v_audit_id) then
    raise exception 'Final job completion failed';
  end if;
  if public.ccc_finish_audit_job(v_job, v_lease_three, '{}'::jsonb, '{}'::jsonb, v_audit_id) then
    raise exception 'Second finalization unexpectedly mutated a done job';
  end if;
  if (select count(*) from public.audits where id = v_audit_id) <> 1 then
    raise exception 'Logical finalization created duplicate audit rows';
  end if;
end;
$$;

rollback;
\echo 'Resumable audit SQL lease/delay/kill/idempotency/security regressions passed.'
