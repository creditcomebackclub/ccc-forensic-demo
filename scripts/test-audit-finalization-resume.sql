\set ON_ERROR_STOP on

-- Install the current additive definitions first so ACL checks exercise the
-- exact migration even when the disposable database recorded an earlier 5600.
\ir ../supabase/migrations/20260820560000_audit_finalization_only_resume.sql

-- Make the test rerunnable if a prior assertion stopped before cleanup.
delete from auth.users where id = '56000000-0000-4000-8000-000000000001';

insert into auth.users (id, aud, role, email, created_at, updated_at)
values ('56000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'audit-finalize@example.test', now(), now());
insert into public.profiles (id, full_name, email, role)
values ('56000000-0000-4000-8000-000000000001', 'Audit Finalize', 'audit-finalize@example.test', 'admin');
insert into public.clients (id, user_id, name, address, date_of_birth)
values (
  '56000000-0000-4000-8000-000000000010',
  '56000000-0000-4000-8000-000000000001',
  'Finalization Client', '123 Finalization St, Phoenix, AZ 85001', '1990-01-01'
);

set role authenticated;
select set_config('request.jwt.claim.sub', '56000000-0000-4000-8000-000000000001', false);

select job_id from public.ccc_create_or_resume_audit_job(
  '56000000-0000-4000-8000-000000000101', 'combined',
  '[{"path":"56000000-0000-4000-8000-000000000001/audit-jobs/56000000-0000-4000-8000-000000000101/report.pdf","bureau":null,"type":"application/pdf","bytes":1024,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]'::jsonb,
  '56000000-0000-4000-8000-000000000010', null
);
select job_id from public.ccc_create_or_resume_audit_job(
  '56000000-0000-4000-8000-000000000105', 'combined',
  '[{"path":"56000000-0000-4000-8000-000000000001/audit-jobs/56000000-0000-4000-8000-000000000105/legacy-side-by-side.pdf","bureau":null,"type":"application/pdf","bytes":1024,"sha256":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}]'::jsonb,
  '56000000-0000-4000-8000-000000000010', null
);
select job_id from public.ccc_create_or_resume_audit_job(
  '56000000-0000-4000-8000-000000000102', 'combined',
  '[{"path":"56000000-0000-4000-8000-000000000001/audit-jobs/56000000-0000-4000-8000-000000000102/mixed.pdf","bureau":null,"type":"application/pdf","bytes":1024,"sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]'::jsonb,
  '56000000-0000-4000-8000-000000000010', null
);
select job_id from public.ccc_create_or_resume_audit_job(
  '56000000-0000-4000-8000-000000000103', 'combined',
  '[{"path":"56000000-0000-4000-8000-000000000001/audit-jobs/56000000-0000-4000-8000-000000000103/sibling-source.pdf","bureau":null,"type":"application/pdf","bytes":1024,"sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}]'::jsonb,
  '56000000-0000-4000-8000-000000000010', null
);
select job_id from public.ccc_create_or_resume_audit_job(
  '56000000-0000-4000-8000-000000000104', 'combined',
  '[{"path":"56000000-0000-4000-8000-000000000001/audit-jobs/56000000-0000-4000-8000-000000000104/sibling-active.pdf","bureau":null,"type":"application/pdf","bytes":1024,"sha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}]'::jsonb,
  '56000000-0000-4000-8000-000000000010', null
);
select job_id from public.ccc_create_or_resume_audit_job(
  '56000000-0000-4000-8000-000000000106', 'combined',
  '[{"path":"56000000-0000-4000-8000-000000000001/audit-jobs/56000000-0000-4000-8000-000000000106/pre-policy.pdf","bureau":null,"type":"application/pdf","bytes":1024,"sha256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}]'::jsonb,
  '56000000-0000-4000-8000-000000000010', null
);

do $$
begin
  begin
    perform public.ccc_resume_audit_finalization('56000000-0000-4000-8000-000000000101');
    raise exception 'Authenticated caller unexpectedly executed finalization recovery';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ccc_retire_incompatible_combined_audit_job(
      '56000000-0000-4000-8000-000000000106',
      '56000000-0000-4000-8000-000000000306'
    );
    raise exception 'Authenticated caller unexpectedly executed parser-policy retirement';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

insert into public.audit_job_checkpoints (
  id, job_id, checkpoint_key, sequence, kind, source_index, source_path,
  source_sha256, source_bytes, source_media_type, input_sha256,
  start_page, end_page, total_pages, chunk_index, chunk_count,
  status, output, output_sha256, finished_at
) values
(
  '56000000-0000-4000-8000-000000000201',
  '56000000-0000-4000-8000-000000000101', repeat('1', 64), 100,
  'combined_chunk', 0,
  '56000000-0000-4000-8000-000000000001/audit-jobs/56000000-0000-4000-8000-000000000101/report.pdf',
  repeat('a', 64), 1024, 'application/pdf', repeat('2', 64),
  1, 2, 2, 0, 1, 'done', '{"reports":[]}'::jsonb, repeat('3', 64), now()
),
(
  '56000000-0000-4000-8000-000000000202',
  '56000000-0000-4000-8000-000000000102', repeat('4', 64), 100,
  'combined_chunk', 0,
  '56000000-0000-4000-8000-000000000001/audit-jobs/56000000-0000-4000-8000-000000000102/mixed.pdf',
  repeat('b', 64), 1024, 'application/pdf', repeat('5', 64),
  1, 1, 2, 0, 2, 'done', '{"reports":[]}'::jsonb, repeat('6', 64), now()
),
(
  '56000000-0000-4000-8000-000000000203',
  '56000000-0000-4000-8000-000000000102', repeat('7', 64), 200,
  'combined_chunk', 0,
  '56000000-0000-4000-8000-000000000001/audit-jobs/56000000-0000-4000-8000-000000000102/mixed.pdf',
  repeat('b', 64), 1024, 'application/pdf', repeat('8', 64),
  2, 2, 2, 1, 2, 'pending', null, null, null
),
(
  '56000000-0000-4000-8000-000000000204',
  '56000000-0000-4000-8000-000000000103', repeat('9', 64), 100,
  'combined_chunk', 0,
  '56000000-0000-4000-8000-000000000001/audit-jobs/56000000-0000-4000-8000-000000000103/sibling-source.pdf',
  repeat('c', 64), 1024, 'application/pdf', repeat('a', 64),
  1, 1, 1, 0, 1, 'done', '{"reports":[]}'::jsonb, repeat('b', 64), now()
),
(
  '56000000-0000-4000-8000-000000000205',
  '56000000-0000-4000-8000-000000000105', repeat('c', 64), 100,
  'combined_chunk', 0,
  '56000000-0000-4000-8000-000000000001/audit-jobs/56000000-0000-4000-8000-000000000105/legacy-side-by-side.pdf',
  repeat('e', 64), 1024, 'application/pdf', repeat('d', 64),
  1, 1, 1, 0, 1, 'done', '{"reports":[{"bureau":null}]}'::jsonb, repeat('e', 64), now()
),
(
  '56000000-0000-4000-8000-000000000206',
  '56000000-0000-4000-8000-000000000106', repeat('f', 64), 100,
  'combined_chunk', 0,
  '56000000-0000-4000-8000-000000000001/audit-jobs/56000000-0000-4000-8000-000000000106/pre-policy.pdf',
  repeat('f', 64), 1024, 'application/pdf', repeat('0', 64),
  1, 2, 2, 0, 1, 'pending', null, null, null
);

update public.audit_jobs set
  status = 'error', retryable = false, next_retry_at = null,
  error = 'Audit ran but could not be saved: injected database failure', finished_at = now(),
  expected_checkpoint_count = 1, completed_checkpoint_count = 1
where id = '56000000-0000-4000-8000-000000000101';

update public.audit_jobs set
  status = 'error', retryable = false, next_retry_at = null,
  error = 'mixed checkpoint state', finished_at = now(),
  expected_checkpoint_count = 2, completed_checkpoint_count = 1
where id = '56000000-0000-4000-8000-000000000102';

update public.audit_jobs set
  status = 'error', retryable = false, next_retry_at = null,
  error = 'Could not verify final audit idempotency: injected database failure', finished_at = now(),
  expected_checkpoint_count = 1, completed_checkpoint_count = 1
where id = '56000000-0000-4000-8000-000000000103';

update public.audit_jobs set
  status = 'error', retryable = false, next_retry_at = null,
  error = 'A combined-report chunk contains data without a visible bureau identity.',
  finished_at = now(), expected_checkpoint_count = 1, completed_checkpoint_count = 1
where id = '56000000-0000-4000-8000-000000000105';

-- Simulate an already-active generation for the third job's logical source.
update public.audit_jobs active set logical_key = failed.logical_key
from public.audit_jobs failed
where active.id = '56000000-0000-4000-8000-000000000104'
  and failed.id = '56000000-0000-4000-8000-000000000103';

-- Re-run the additive migration against a production-shaped legacy failure;
-- the migration is idempotent and this exercises its one-time data transition.
\ir ../supabase/migrations/20260820560000_audit_finalization_only_resume.sql

set role service_role;
do $$
begin
  if not public.ccc_claim_audit_job(
    '56000000-0000-4000-8000-000000000106',
    '56000000-0000-4000-8000-000000000306',
    'staff', 780
  ) then raise exception 'Pre-policy combined job could not be claimed for retirement'; end if;
  if not public.ccc_retire_incompatible_combined_audit_job(
    '56000000-0000-4000-8000-000000000106',
    '56000000-0000-4000-8000-000000000306'
  ) then raise exception 'Pre-policy combined plan was not retired'; end if;
  if not public.ccc_resume_audit_finalization('56000000-0000-4000-8000-000000000101') then
    raise exception 'All-done exact job did not enter finalization-only recovery';
  end if;
  if public.ccc_resume_audit_finalization('56000000-0000-4000-8000-000000000102') then
    raise exception 'Mixed checkpoint state entered finalization-only recovery';
  end if;
  if public.ccc_resume_audit_finalization('56000000-0000-4000-8000-000000000103') then
    raise exception 'Logical job with an active sibling entered recovery';
  end if;
  if public.ccc_resume_audit_finalization('56000000-0000-4000-8000-000000000105') then
    raise exception 'Retired side-by-side attribution outputs entered finalization recovery';
  end if;
end;
$$;
reset role;

do $$
begin
  if not exists (
    select 1 from public.audit_jobs
    where id = '56000000-0000-4000-8000-000000000101'
      and status = 'waiting'
      and retryable
      and error is null
      and expected_checkpoint_count = 1
      and completed_checkpoint_count = 1
  ) then raise exception 'Finalization-only job state was not reset exactly'; end if;
  if (select count(*) from public.audit_job_checkpoints
      where job_id = '56000000-0000-4000-8000-000000000101') <> 1
  then raise exception 'Finalization recovery created or removed a checkpoint'; end if;
  if exists (
    select 1 from public.audit_provider_attempts
    where job_id = '56000000-0000-4000-8000-000000000101'
  ) then raise exception 'Finalization recovery created provider work'; end if;
  if not exists (
    select 1 from public.audit_jobs
    where id = '56000000-0000-4000-8000-000000000102' and status = 'error'
  ) then raise exception 'Mixed checkpoint job did not remain fail-closed'; end if;
  if not exists (
    select 1 from public.audit_jobs
    where id = '56000000-0000-4000-8000-000000000103' and status = 'error'
  ) then raise exception 'Sibling-conflicted job did not remain fail-closed'; end if;
  if not exists (
    select 1 from public.audit_jobs
    where id = '56000000-0000-4000-8000-000000000105'
      and status = 'expired'
      and not retryable
      and source_cleanup_at is null
      and final_audit_id is null
      and stage = 'Parser upgrade requires one fresh audit'
  ) then raise exception 'Legacy side-by-side job was not retired for a fresh parser run'; end if;
  if (select count(*) from public.audit_job_checkpoints
      where job_id = '56000000-0000-4000-8000-000000000105' and status = 'done') <> 1
  then raise exception 'Legacy retirement changed immutable checkpoint history'; end if;
  if not exists (
    select 1 from public.audit_jobs
    where id = '56000000-0000-4000-8000-000000000106'
      and status = 'expired'
      and not retryable
      and source_cleanup_at is null
      and stage = 'Parser upgrade requires one fresh audit'
  ) then raise exception 'Incompatible active combined plan was not retired'; end if;
  if not exists (
    select 1 from public.audit_job_attempts
    where job_id = '56000000-0000-4000-8000-000000000106'
      and lease_token = '56000000-0000-4000-8000-000000000306'
      and status = 'failed'
      and error_type = 'parser_policy_retired'
  ) then raise exception 'Retired combined worker attempt remained active'; end if;
end;
$$;

delete from auth.users where id = '56000000-0000-4000-8000-000000000001';
