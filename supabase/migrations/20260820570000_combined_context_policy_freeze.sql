-- Freeze the combined-report context policy selected at checkpoint planning.
--
-- Production is already through 20260820560000, so this migration is the
-- additive remote cutover. Existing checkpoints remain nullable and are
-- retired as pre-policy plans by the worker; every new plan writes an explicit
-- state. The trigger preserves that state when either the
-- old or current service-only split/recovery RPC copies a checkpoint.

begin;

alter table public.audit_job_checkpoints
  add column if not exists context_policy_state text,
  add column if not exists context_policy text,
  add column if not exists context_source_page integer;

alter table public.audit_job_checkpoints
  drop constraint if exists audit_job_checkpoints_context_policy_state_check,
  add constraint audit_job_checkpoints_context_policy_state_check check (
    context_policy_state is null
    or context_policy_state in ('matched', 'proven_no_match')
  ),
  drop constraint if exists audit_job_checkpoints_context_policy_binding_check,
  add constraint audit_job_checkpoints_context_policy_binding_check check (
    context_policy_state is null
    or (
      kind = 'combined_chunk'
      and (
        (context_policy_state = 'matched'
          and context_policy = 'combined-visible-column-context-v1'
          and context_source_page = 1)
        or
        (context_policy_state = 'proven_no_match'
          and context_policy is null
          and context_source_page is null)
      )
    )
  );

create or replace function public.inherit_combined_checkpoint_context_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.audit_job_checkpoints%rowtype;
begin
  if new.kind <> 'combined_chunk' or new.context_policy_state is not null then
    return new;
  end if;

  -- Split/recovery RPCs insert children while the exact parent is still
  -- running/error. Select only a same-job/source range that encloses the new
  -- child; unrelated checkpoints can never donate parsing policy.
  select parent.* into v_parent
  from public.audit_job_checkpoints parent
  where parent.job_id = new.job_id
    and parent.kind = 'combined_chunk'
    and parent.source_index = new.source_index
    and parent.source_path = new.source_path
    and parent.source_sha256 = new.source_sha256
    and parent.context_policy_state in ('matched', 'proven_no_match')
    and parent.start_page <= new.start_page
    and parent.end_page >= new.end_page
    and parent.status in ('running', 'error', 'superseded')
  order by (parent.end_page - parent.start_page) asc, parent.created_at desc
  limit 1;

  if found then
    new.context_policy_state := v_parent.context_policy_state;
    new.context_policy := v_parent.context_policy;
    new.context_source_page := v_parent.context_source_page;
  end if;
  return new;
end;
$$;

drop trigger if exists audit_checkpoint_inherit_context_policy
  on public.audit_job_checkpoints;
create trigger audit_checkpoint_inherit_context_policy
before insert on public.audit_job_checkpoints
for each row execute function public.inherit_combined_checkpoint_context_policy();

revoke all on function public.inherit_combined_checkpoint_context_policy()
  from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'audit_job_checkpoints'
      and column_name = 'context_policy_state'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'audit_job_checkpoints'
      and column_name = 'context_policy'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'audit_job_checkpoints'
      and column_name = 'context_source_page'
  ) then
    raise exception 'Combined context policy freeze columns are incomplete';
  end if;
  if has_function_privilege(
    'authenticated', 'public.inherit_combined_checkpoint_context_policy()', 'EXECUTE'
  ) then
    raise exception 'Combined context policy trigger function leaked to browser role';
  end if;
end;
$$;

commit;
