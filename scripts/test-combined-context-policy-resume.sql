\set ON_ERROR_STOP on
begin;

insert into auth.users (id, aud, role, email, created_at, updated_at)
values ('57000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'context-freeze@example.test', now(), now());
insert into public.profiles (id, full_name, email, role)
values ('57000000-0000-4000-8000-000000000001', 'Context Freeze', 'context-freeze@example.test', 'admin');
insert into public.clients (id, user_id, name, address, date_of_birth)
values (
  '57000000-0000-4000-8000-000000000010',
  '57000000-0000-4000-8000-000000000001',
  'Frozen Context Client', '1 Source Bound Way', '1990-01-01'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '57000000-0000-4000-8000-000000000001', true);
select * from public.ccc_create_or_resume_audit_job(
  '57000000-0000-4000-8000-000000000101', 'combined',
  '[{"path":"57000000-0000-4000-8000-000000000001/audit-jobs/57000000-0000-4000-8000-000000000101/report.pdf","bureau":null,"type":"application/pdf","bytes":1024,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]'::jsonb,
  '57000000-0000-4000-8000-000000000010', null
);
reset role;

do $$
declare
  v_job uuid := '57000000-0000-4000-8000-000000000101';
  v_lease uuid := '57000000-0000-4000-8000-000000000201';
  v_checkpoint uuid := '57000000-0000-4000-8000-000000000301';
  v_claim public.audit_job_checkpoints%rowtype;
begin
  if not public.ccc_claim_audit_job(v_job, v_lease, 'staff', 300) then
    raise exception 'Could not claim context-policy test job';
  end if;
  insert into public.audit_job_checkpoints (
    id, job_id, checkpoint_key, sequence, kind, source_index, source_path,
    source_sha256, source_bytes, source_media_type,
    context_policy_state, context_policy, context_source_page, input_sha256,
    start_page, end_page, total_pages, chunk_index, chunk_count
  ) values (
    v_checkpoint, v_job, repeat('b', 64), 100, 'combined_chunk', 0,
    '57000000-0000-4000-8000-000000000001/audit-jobs/57000000-0000-4000-8000-000000000101/report.pdf',
    repeat('a', 64), 1024, 'application/pdf',
    'matched', 'combined-visible-column-context-v1', 1, repeat('c', 64),
    1, 8, 29, 0, 5
  );
  update public.audit_jobs set expected_checkpoint_count = 1 where id = v_job;
  select * into v_claim from public.ccc_claim_next_audit_checkpoint(v_job, v_lease);
  if v_claim.id is distinct from v_checkpoint then raise exception 'Could not claim context checkpoint'; end if;

  -- Emulate the already-deployed pre-5700 splitter, which does not name the
  -- new policy columns. The additive trigger must preserve the parent choice.
  insert into public.audit_job_checkpoints (
    id, job_id, checkpoint_key, sequence, kind, source_index, source_path,
    source_sha256, source_bytes, source_media_type, input_sha256,
    start_page, end_page, total_pages, chunk_index, chunk_count
  ) values (
    '57000000-0000-4000-8000-000000000399', v_job, repeat('f', 64), 101,
    'combined_chunk', 0,
    '57000000-0000-4000-8000-000000000001/audit-jobs/57000000-0000-4000-8000-000000000101/report.pdf',
    repeat('a', 64), 1024, 'application/pdf', repeat('9', 64),
    1, 4, 29, 91, 6
  );
  if not exists (
    select 1 from public.audit_job_checkpoints
    where id = '57000000-0000-4000-8000-000000000399'
      and context_policy_state = 'matched'
      and context_policy = 'combined-visible-column-context-v1'
      and context_source_page = 1
  ) then raise exception 'Additive 5700 trigger did not preserve old-RPC child policy'; end if;
  delete from public.audit_job_checkpoints
  where id = '57000000-0000-4000-8000-000000000399';

  if not public.ccc_split_audit_checkpoint_v2(
    v_checkpoint, v_lease, repeat('d', 64), repeat('e', 64), 'output_limit'
  ) then raise exception 'Context checkpoint split failed'; end if;

  if (select count(*) from public.audit_job_checkpoints
      where job_id = v_job and status = 'pending'
        and context_policy_state = 'matched'
        and context_policy = 'combined-visible-column-context-v1'
        and context_source_page = 1) <> 2 then
    raise exception 'Frozen context policy did not survive durable split';
  end if;
  if not exists (
    select 1 from public.audit_job_checkpoints
    where id = v_checkpoint and status = 'superseded'
      and context_policy_state = 'matched'
  ) then raise exception 'Superseded parent lost its frozen policy evidence'; end if;
end;
$$;

rollback;
\echo 'Combined context policy persistence/split regression passed.'
