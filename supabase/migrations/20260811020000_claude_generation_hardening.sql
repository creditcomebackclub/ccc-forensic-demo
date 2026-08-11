-- Claude call telemetry intentionally stores no prompts, model responses, or
-- document contents. It is operational metadata only, so we can diagnose
-- truncation, retries, latency, and cost without duplicating client PII.
create table if not exists public.claude_call_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  operation text not null,
  entity_type text,
  entity_id text,
  model text not null,
  effort text,
  prompt_version text,
  attempt integer not null default 1 check (attempt > 0),
  status text not null check (status in ('completed', 'error', 'rejected')),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  latency_ms integer not null check (latency_ms >= 0),
  request_id text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  thinking_tokens integer not null default 0,
  cache_read_input_tokens integer not null default 0,
  cache_creation_input_tokens integer not null default 0,
  stop_reason text,
  error_type text,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists claude_call_logs_user_created_idx
  on public.claude_call_logs (user_id, created_at desc);
create index if not exists claude_call_logs_operation_created_idx
  on public.claude_call_logs (operation, created_at desc);
create index if not exists claude_call_logs_entity_idx
  on public.claude_call_logs (entity_type, entity_id, created_at desc);

alter table public.claude_call_logs enable row level security;
drop policy if exists "staff_read_claude_call_logs" on public.claude_call_logs;
create policy "staff_read_claude_call_logs" on public.claude_call_logs
for select to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = auth.uid()
    and p.role in ('admin', 'auditor')
    and (p.role = 'admin' or claude_call_logs.user_id = p.id)
));

grant select on public.claude_call_logs to authenticated;
grant all on public.claude_call_logs to service_role;

alter table public.letters
  add column if not exists generation_context jsonb;

-- A generated draft can be safely regenerated only while it has no physical
-- mail evidence. The RPC serializes the reset and validates ownership so the
-- UI never races a Lob submission or overwrites an already-mailed document.
create or replace function public.reset_unmailed_round_drafts(
  p_round_id uuid,
  p_failed_only boolean default false
)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_round public.dispute_rounds%rowtype;
  v_ids text[];
begin
  if v_caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select role into v_role from public.profiles where id = v_caller;
  if v_role not in ('admin', 'auditor') then raise exception 'Staff access required' using errcode = '42501'; end if;

  select * into v_round from public.dispute_rounds where id = p_round_id for update;
  if not found or (v_role <> 'admin' and v_round.user_id <> v_caller) then
    raise exception 'Round not found' using errcode = '42501';
  end if;
  if v_round.status <> 'open' then raise exception 'Only an open round can be regenerated'; end if;
  if exists (
    select 1 from public.letters
    where round_id = p_round_id
      and (mailed_date is not null or lob_id is not null or tracking_number is not null)
  ) then raise exception 'A mailed round cannot be regenerated'; end if;

  select coalesce(array_agg(id order by id), '{}') into v_ids
  from public.letters
  where round_id = p_round_id
    and mailed_date is null and lob_id is null and tracking_number is null
    and (not p_failed_only or html like 'ERROR:%');

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'No safe drafts are available to regenerate';
  end if;

  update public.letters
  set html = 'GENERATING...', summary = null, saved_at = now()
  where id = any(v_ids);

  return v_ids;
end;
$$;

revoke all on function public.reset_unmailed_round_drafts(uuid, boolean) from public;
grant execute on function public.reset_unmailed_round_drafts(uuid, boolean) to authenticated;
