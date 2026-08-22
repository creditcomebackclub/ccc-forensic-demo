-- Owner-controlled billing cutover.
--
-- Compatibility:
--   * Existing ledger entries and payment history remain unchanged.
--   * Billing setup and onboarding continue to save/snapshot pricing only.
--   * The retired cron RPC is preserved for rollback but can no longer be
--     executed by the service role during a mixed-version deploy.
--   * The owner may explicitly create one opening ledger invoice from an
--     exact immutable service-agreement plan snapshot. This records an invoice
--     only; it never charges a payment method or changes service status.

revoke execute on function public.claim_billing_invoice(uuid, date, numeric, text)
  from service_role;

comment on function public.claim_billing_invoice(uuid, date, numeric, text) is
  'Retired automated-cron invoice writer. Execute permission was removed by 20260820300000; retained only for rollback/history.';

create table if not exists public.manual_agreement_invoice_commands (
  id uuid primary key default gen_random_uuid(),
  request_key uuid not null unique,
  agreement_id uuid not null unique
    references public.client_service_agreements(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  firm_user_id uuid not null references auth.users(id) on delete restrict,
  invoice_id uuid not null unique,
  invoice_snapshot jsonb not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint manual_agreement_invoice_snapshot_check check (
    jsonb_typeof(invoice_snapshot) = 'object'
    and invoice_snapshot ->> 'source' = 'manual_agreement_opening_invoice'
    and invoice_snapshot ->> 'agreement_id' = agreement_id::text
    and invoice_snapshot ->> 'id' = invoice_id::text
    and jsonb_typeof(invoice_snapshot -> 'line_items') = 'array'
    and jsonb_array_length(invoice_snapshot -> 'line_items') > 0
  )
);

comment on table public.manual_agreement_invoice_commands is
  'Immutable audit receipts for owner-triggered opening ledger invoices derived from exact agreement plan snapshots. No payment charge is performed.';

create index if not exists manual_agreement_invoice_client_created_idx
  on public.manual_agreement_invoice_commands (client_id, created_at desc);

create or replace function public.ccc_preserve_manual_agreement_invoice_command()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Manual agreement invoice receipts are immutable.';
end;
$$;

drop trigger if exists ccc_preserve_manual_agreement_invoice_command_trigger
  on public.manual_agreement_invoice_commands;
create trigger ccc_preserve_manual_agreement_invoice_command_trigger
before update or delete on public.manual_agreement_invoice_commands
for each row execute function public.ccc_preserve_manual_agreement_invoice_command();

alter table public.manual_agreement_invoice_commands enable row level security;

drop policy if exists "staff_read_manual_agreement_invoice_commands"
  on public.manual_agreement_invoice_commands;
create policy "staff_read_manual_agreement_invoice_commands"
on public.manual_agreement_invoice_commands for select to authenticated
using (
  exists (
    select 1
    from public.profiles caller
    join public.clients client
      on client.id = manual_agreement_invoice_commands.client_id
    where caller.id = auth.uid()
      and caller.role in ('admin', 'auditor')
      and (caller.role = 'admin' or client.user_id = auth.uid())
  )
);

revoke all on table public.manual_agreement_invoice_commands
  from public, anon, authenticated, service_role;
grant select on table public.manual_agreement_invoice_commands
  to authenticated, service_role;

-- Financial history is mutable only through an owner-authenticated, row-locked
-- command.  This keeps a stale browser tab from replacing the JSON ledger and
-- silently dropping an immutable agreement invoice receipt.
create table if not exists public.client_ledger_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  transaction_id text not null,
  operation text not null check (operation in ('add', 'edit', 'mark_paid', 'delete')),
  before_transaction jsonb,
  after_transaction jsonb,
  before_ledger_sha256 text not null check (before_ledger_sha256 ~ '^[0-9a-f]{64}$'),
  after_ledger_sha256 text not null check (after_ledger_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists client_ledger_events_client_created_idx
  on public.client_ledger_events (client_id, created_at desc);

create or replace function public.ccc_preserve_client_ledger_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Client ledger audit events are immutable.';
end;
$$;

drop trigger if exists ccc_preserve_client_ledger_event_trigger
  on public.client_ledger_events;
create trigger ccc_preserve_client_ledger_event_trigger
before update or delete on public.client_ledger_events
for each row execute function public.ccc_preserve_client_ledger_event();

alter table public.client_ledger_events enable row level security;
drop policy if exists "admin_read_client_ledger_events" on public.client_ledger_events;
create policy "admin_read_client_ledger_events"
on public.client_ledger_events for select to authenticated
using (
  exists (
    select 1 from public.profiles caller
    where caller.id = auth.uid() and caller.role = 'admin'
  )
);

revoke all on table public.client_ledger_events
  from public, anon, authenticated, service_role;
grant select on table public.client_ledger_events to authenticated, service_role;

create or replace function public.ccc_guard_client_ledger_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.ledger is distinct from new.ledger
     and current_setting('ccc.ledger_write_authorized', true) is distinct from 'on' then
    raise exception 'Client ledger changes require the owner ledger command.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists ccc_guard_client_ledger_update_trigger on public.clients;
create trigger ccc_guard_client_ledger_update_trigger
before update of ledger on public.clients
for each row execute function public.ccc_guard_client_ledger_update();

revoke all on function public.ccc_guard_client_ledger_update()
  from public, anon, authenticated, service_role;

create or replace function public.ccc_create_manual_agreement_invoice(
  p_client_id uuid,
  p_agreement_id uuid,
  p_request_key uuid,
  p_invoice_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_client public.clients%rowtype;
  v_agreement public.client_service_agreements%rowtype;
  v_template public.service_agreement_templates%rowtype;
  v_existing public.manual_agreement_invoice_commands%rowtype;
  v_plan jsonb;
  v_line_items jsonb := '[]'::jsonb;
  v_invoice jsonb;
  v_invoice_id uuid := gen_random_uuid();
  v_command_id uuid := gen_random_uuid();
  v_mode text;
  v_tier text;
  v_label text;
  v_first_work numeric;
  v_first_month numeric;
  v_flat_fee numeric;
  v_custom_amount numeric;
  v_total numeric;
  v_description text;
  v_ledger jsonb;
begin
  if v_caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_client_id is null or p_agreement_id is null or p_request_key is null
     or p_invoice_date is null then
    raise exception 'Client, agreement, request key, and invoice date are required';
  end if;

  select role into v_role
  from public.profiles
  where id = v_caller;
  if v_role is distinct from 'admin' then
    raise exception 'Owner access required' using errcode = '42501';
  end if;

  select * into v_client
  from public.clients
  where id = p_client_id
  for update;
  if not found then
    raise exception 'Client not found' using errcode = '42501';
  end if;

  -- A repeated authorized browser request receives the exact prior receipt
  -- and can never append a second invoice.
  select * into v_existing
  from public.manual_agreement_invoice_commands
  where request_key = p_request_key;
  if found then
    if v_existing.client_id is distinct from p_client_id
       or v_existing.agreement_id is distinct from p_agreement_id then
      raise exception 'Invoice request key is already bound to another agreement';
    end if;
    return jsonb_build_object(
      'created', false,
      'alreadyCreated', true,
      'commandId', v_existing.id,
      'invoice', v_existing.invoice_snapshot
    );
  end if;

  select * into v_agreement
  from public.client_service_agreements
  where id = p_agreement_id
    and client_id = p_client_id
    and user_id = v_client.user_id;
  if not found then
    raise exception 'Agreement snapshot not found';
  end if;

  select * into v_template
  from public.service_agreement_templates
  where id = v_agreement.template_id;
  if not found or v_template.packet_kind is distinct from 'service_agreement_only' then
    raise exception 'Opening invoice requires a service-agreement-only snapshot';
  end if;
  if v_agreement.status not in ('draft', 'sent', 'signed') then
    raise exception 'This agreement snapshot is no longer current for billing';
  end if;

  -- Serialize concurrent clicks for the same agreement/client, then return the
  -- existing immutable receipt if another request won the race.
  select * into v_existing
  from public.manual_agreement_invoice_commands
  where agreement_id = p_agreement_id;
  if found then
    return jsonb_build_object(
      'created', false,
      'alreadyCreated', true,
      'commandId', v_existing.id,
      'invoice', v_existing.invoice_snapshot
    );
  end if;

  v_plan := v_agreement.plan_snapshot;
  if jsonb_typeof(v_plan) is distinct from 'object' then
    raise exception 'Agreement pricing snapshot is malformed';
  end if;
  v_mode := nullif(btrim(v_plan ->> 'mode'), '');
  v_tier := nullif(btrim(v_plan ->> 'billingTier'), '');
  v_label := coalesce(nullif(btrim(v_plan ->> 'label'), ''), v_tier, 'Service package');

  if v_mode = 'tier' and v_tier in ('Standard', 'VIP') then
    if coalesce(v_plan ->> 'firstWorkFee', '') !~ '^[0-9]+([.][0-9]+)?$'
       or coalesce(v_plan ->> 'firstMonthlyPayment', '') !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception 'Agreement opening-payment amounts are incomplete';
    end if;
    v_first_work := round((v_plan ->> 'firstWorkFee')::numeric, 2);
    v_first_month := round((v_plan ->> 'firstMonthlyPayment')::numeric, 2);
    if v_first_work < 0 or v_first_month <= 0 then
      raise exception 'Agreement opening-payment amounts are invalid';
    end if;
    v_line_items := jsonb_build_array(
      jsonb_build_object('code', 'first_work_fee', 'description', 'First Work Fee', 'amount', v_first_work),
      jsonb_build_object('code', 'first_monthly_payment', 'description', 'First Monthly Payment', 'amount', v_first_month)
    );
    v_description := v_label || ' — First Work Fee + First Monthly Payment';
    v_total := round(v_first_work + v_first_month, 2);
  elsif v_mode = 'tier' and v_tier = 'Paid In Full' then
    if coalesce(v_plan ->> 'flatFee', '') !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception 'Paid-in-full agreement amount is incomplete';
    end if;
    v_flat_fee := round((v_plan ->> 'flatFee')::numeric, 2);
    if v_flat_fee <= 0 then raise exception 'Paid-in-full agreement amount is invalid'; end if;
    v_line_items := jsonb_build_array(
      jsonb_build_object('code', 'paid_in_full_service', 'description', 'Paid In Full Service', 'amount', v_flat_fee)
    );
    v_description := v_label || ' — Paid In Full Service';
    v_total := v_flat_fee;
  elsif v_mode = 'custom' then
    if coalesce(v_plan ->> 'amount', '') !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception 'This custom agreement has no fixed invoice amount; use the manual ledger entry instead';
    end if;
    v_custom_amount := round((v_plan ->> 'amount')::numeric, 2);
    if v_custom_amount <= 0 then raise exception 'Custom agreement amount is invalid'; end if;
    v_line_items := jsonb_build_array(
      jsonb_build_object('code', 'custom_service_package', 'description', v_label, 'amount', v_custom_amount)
    );
    v_description := v_label;
    v_total := v_custom_amount;
  else
    raise exception 'Agreement plan type is unsupported for an opening invoice';
  end if;

  v_invoice := jsonb_build_object(
    'id', v_invoice_id,
    'date', p_invoice_date,
    'type', 'Invoice',
    'amount', v_total,
    'description', v_description,
    'status', 'Due',
    'source', 'manual_agreement_opening_invoice',
    'agreement_id', v_agreement.id,
    'agreement_version', v_agreement.template_version,
    'line_items', v_line_items,
    'created_at', current_timestamp,
    'created_by', v_caller
  );

  v_ledger := coalesce(v_client.ledger, '[]'::jsonb);
  if jsonb_typeof(v_ledger) is distinct from 'array' then
    raise exception 'Client ledger is malformed; repair it before invoicing';
  end if;

  insert into public.manual_agreement_invoice_commands (
    id, request_key, agreement_id, client_id, firm_user_id,
    invoice_id, invoice_snapshot, created_by
  ) values (
    v_command_id, p_request_key, v_agreement.id, v_client.id, v_client.user_id,
    v_invoice_id, v_invoice, v_caller
  );

  perform pg_catalog.set_config('ccc.ledger_write_authorized', 'on', true);
  update public.clients
  set ledger = v_ledger || jsonb_build_array(v_invoice)
  where id = v_client.id;

  return jsonb_build_object(
    'created', true,
    'alreadyCreated', false,
    'commandId', v_command_id,
    'invoice', v_invoice
  );
end;
$$;

revoke all on function public.ccc_create_manual_agreement_invoice(uuid, uuid, uuid, date)
  from public, anon, authenticated, service_role;
grant execute on function public.ccc_create_manual_agreement_invoice(uuid, uuid, uuid, date)
  to authenticated;

comment on function public.ccc_create_manual_agreement_invoice(uuid, uuid, uuid, date) is
  'Explicit owner-only action: atomically append one opening invoice from an exact service-agreement plan snapshot. Never charges, emails, pauses, or authorizes service.';

create or replace function public.ccc_mutate_client_ledger(
  p_client_id uuid,
  p_expected_ledger jsonb,
  p_operation text,
  p_transaction_id text,
  p_changes jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_client public.clients%rowtype;
  v_current jsonb;
  v_next jsonb;
  v_target jsonb;
  v_after jsonb;
  v_operation text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_operation, '')));
  v_transaction_id text := pg_catalog.btrim(coalesce(p_transaction_id, ''));
  v_type text;
  v_status text;
  v_date date;
  v_amount numeric;
  v_description text;
  v_paid_at timestamptz;
  v_match_count integer;
  v_command_backed boolean := false;
  v_event_id uuid := gen_random_uuid();
  v_before_hash text;
  v_after_hash text;
begin
  if v_caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = v_caller;
  if v_role is distinct from 'admin' then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  if p_client_id is null
     or v_operation not in ('add', 'edit', 'mark_paid', 'delete')
     or v_transaction_id = '' or length(v_transaction_id) > 100
     or jsonb_typeof(coalesce(p_changes, '{}'::jsonb)) is distinct from 'object'
     or jsonb_typeof(coalesce(p_expected_ledger, 'null'::jsonb)) is distinct from 'array'
     or pg_column_size(p_expected_ledger) > 1048576 then
    raise exception 'A valid bounded ledger command is required';
  end if;

  select * into v_client from public.clients where id = p_client_id for update;
  if not found then raise exception 'Client not found' using errcode = 'P0002'; end if;
  v_current := coalesce(v_client.ledger, '[]'::jsonb);
  if jsonb_typeof(v_current) is distinct from 'array' then
    raise exception 'Client ledger is malformed; repair it before continuing';
  end if;
  if v_current is distinct from p_expected_ledger then
    raise exception 'The ledger changed in another session. Reload before trying again.'
      using errcode = '40001';
  end if;

  select count(*)
  into v_match_count
  from jsonb_array_elements(v_current) item(value)
  where item.value->>'id' = v_transaction_id;
  select item.value
  into v_target
  from jsonb_array_elements(v_current) item(value)
  where item.value->>'id' = v_transaction_id
  limit 1;
  if v_match_count > 1 then raise exception 'Ledger contains duplicate transaction ids'; end if;

  if v_operation = 'add' then
    if v_match_count <> 0 then raise exception 'Transaction id already exists'; end if;
  else
    if v_match_count <> 1 then raise exception 'Transaction not found' using errcode = 'P0002'; end if;
    v_command_backed := coalesce(v_target->>'source', '') = 'manual_agreement_opening_invoice'
      or exists (
        select 1 from public.manual_agreement_invoice_commands command
        where command.client_id = p_client_id
          and command.invoice_id::text = v_transaction_id
      );
    if v_command_backed and v_operation in ('edit', 'delete') then
      raise exception 'Agreement opening invoices cannot be edited or deleted; record payment status instead';
    end if;
  end if;

  if v_operation in ('add', 'edit') then
    if exists (
      select 1 from jsonb_object_keys(p_changes) key(name)
      where key.name not in ('date', 'type', 'amount', 'description', 'status', 'paid_at')
    ) then
      raise exception 'Ledger command contains unsupported fields';
    end if;
    v_type := pg_catalog.btrim(coalesce(p_changes->>'type', ''));
    v_status := pg_catalog.btrim(coalesce(p_changes->>'status', ''));
    v_description := pg_catalog.btrim(coalesce(p_changes->>'description', ''));
    if coalesce(p_changes->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or coalesce(p_changes->>'amount', '') !~ '^[0-9]+([.][0-9]{1,2})?$'
       or v_type not in ('Invoice', 'Payment')
       or v_description = '' or length(v_description) > 500 then
      raise exception 'Ledger transaction fields are invalid';
    end if;
    v_date := (p_changes->>'date')::date;
    v_amount := round((p_changes->>'amount')::numeric, 2);
    if v_amount <= 0 or v_amount > 1000000 then raise exception 'Ledger amount is invalid'; end if;
    if v_type = 'Payment' then
      v_status := 'Paid';
    elsif v_status not in ('Due', 'Paid') then
      raise exception 'Invoice status must be Due or Paid';
    end if;
    if nullif(p_changes->>'paid_at', '') is not null then
      v_paid_at := (p_changes->>'paid_at')::timestamptz;
    end if;
    if v_status = 'Paid' and v_paid_at is null then
      raise exception 'Paid transactions require the actual paid date';
    end if;
    if v_status = 'Due' then v_paid_at := null; end if;

    if v_operation = 'add' then
      v_after := jsonb_strip_nulls(jsonb_build_object(
        'id', v_transaction_id,
        'date', v_date::text,
        'type', v_type,
        'amount', v_amount,
        'description', v_description,
        'status', v_status,
        'paid_at', case when v_paid_at is null then null else v_paid_at::text end,
        'source', 'manual_ledger_entry',
        'created_at', current_timestamp,
        'created_by', v_caller
      ));
      v_next := v_current || jsonb_build_array(v_after);
    else
      v_after := v_target || jsonb_strip_nulls(jsonb_build_object(
        'date', v_date::text,
        'type', v_type,
        'amount', v_amount,
        'description', v_description,
        'status', v_status,
        'paid_at', case when v_paid_at is null then null else v_paid_at::text end
      ));
      if v_paid_at is null then v_after := v_after - 'paid_at'; end if;
      select coalesce(jsonb_agg(
        case when item.value->>'id' = v_transaction_id then v_after else item.value end
        order by item.ordinality
      ), '[]'::jsonb)
      into v_next
      from jsonb_array_elements(v_current) with ordinality item(value, ordinality);
    end if;
  elsif v_operation = 'mark_paid' then
    if nullif(p_changes->>'paid_at', '') is null then
      raise exception 'The actual paid date is required';
    end if;
    v_paid_at := (p_changes->>'paid_at')::timestamptz;
    v_after := v_target || jsonb_build_object('status', 'Paid', 'paid_at', v_paid_at::text);
    select coalesce(jsonb_agg(
      case when item.value->>'id' = v_transaction_id then v_after else item.value end
      order by item.ordinality
    ), '[]'::jsonb)
    into v_next
    from jsonb_array_elements(v_current) with ordinality item(value, ordinality);
  else
    select coalesce(jsonb_agg(item.value order by item.ordinality), '[]'::jsonb)
    into v_next
    from jsonb_array_elements(v_current) with ordinality item(value, ordinality)
    where item.value->>'id' is distinct from v_transaction_id;
    v_after := null;
  end if;

  v_before_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_current::text, 'UTF8'), 'sha256'), 'hex'
  );
  v_after_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_next::text, 'UTF8'), 'sha256'), 'hex'
  );
  perform pg_catalog.set_config('ccc.ledger_write_authorized', 'on', true);
  update public.clients set ledger = v_next where id = p_client_id;
  insert into public.client_ledger_events (
    id, client_id, transaction_id, operation,
    before_transaction, after_transaction,
    before_ledger_sha256, after_ledger_sha256, created_by
  ) values (
    v_event_id, p_client_id, v_transaction_id, v_operation,
    v_target, v_after, v_before_hash, v_after_hash, v_caller
  );

  return jsonb_build_object(
    'eventId', v_event_id,
    'ledger', v_next,
    'transaction', v_after
  );
end;
$$;

revoke all on function public.ccc_mutate_client_ledger(uuid, jsonb, text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.ccc_mutate_client_ledger(uuid, jsonb, text, text, jsonb)
  to authenticated;

comment on function public.ccc_mutate_client_ledger(uuid, jsonb, text, text, jsonb) is
  'Owner-only optimistic ledger command. Row-locks the client, rejects stale snapshots, protects agreement invoices, and appends an immutable audit event.';

-- Rollback: deploy the prior cron first, re-grant claim_billing_invoice to
-- service_role, then explicitly drop the new RPC/table. Existing ledger rows
-- created by an owner action are historical financial records and must remain.
