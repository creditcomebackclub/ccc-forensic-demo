-- Make custom opening invoices derive only from the immutable agreement
-- snapshot and retain the custom billing schedule in their line-item identity.
--
-- Compatibility:
--   * Existing invoice commands and ledger entries are never rewritten.
--   * V2 signed First Work snapshots retain their exact historical behavior.
--   * V3 Standard/VIP and Paid In Full behavior is unchanged.
--   * This function only appends a Due ledger invoice after an owner action;
--     it never charges, emails, activates service, or changes billing status.

begin;

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
  v_billing_type text;
  v_first_work numeric;
  v_first_month numeric;
  v_flat_fee numeric;
  v_custom_amount numeric;
  v_custom_schedule_amount numeric;
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
  v_billing_type := nullif(btrim(v_plan ->> 'billingType'), '');

  if v_mode = 'tier' and v_tier in ('Standard', 'VIP') then
    if v_agreement.template_version = 'ccc-service-agreement-v2-service-only' then
      if v_agreement.status <> 'signed' then
        raise exception 'Unsigned legacy agreements use retired pricing; prepare the current agreement before invoicing';
      end if;
      if coalesce(v_plan ->> 'firstMonthlyPayment', '') !~ '^[0-9]+([.][0-9]+)?$' then
        raise exception 'Legacy agreement first monthly payment is incomplete';
      end if;
      v_first_month := round((v_plan ->> 'firstMonthlyPayment')::numeric, 2);
      if v_first_month <= 0 then
        raise exception 'Legacy agreement first monthly payment is invalid';
      end if;
      if coalesce(v_plan ->> 'firstWorkFee', '') !~ '^[0-9]+([.][0-9]+)?$' then
        raise exception 'Legacy agreement First Work amount is incomplete';
      end if;
      v_first_work := round((v_plan ->> 'firstWorkFee')::numeric, 2);
      if v_first_work < 0 then
        raise exception 'Legacy agreement First Work amount is invalid';
      end if;
      v_line_items := jsonb_build_array(
        jsonb_build_object('code', 'first_work_fee', 'description', 'First Work Fee', 'amount', v_first_work),
        jsonb_build_object('code', 'first_monthly_payment', 'description', 'First Monthly Payment', 'amount', v_first_month)
      );
      v_description := v_label || ' - First Work Fee + First Monthly Payment';
      v_total := round(v_first_work + v_first_month, 2);
    else
      if v_billing_type is distinct from 'Automated Recurring' then
        raise exception 'Standard and VIP opening invoices require an Automated Recurring snapshot';
      end if;
      if coalesce(v_plan ->> 'firstMonthlyPayment', '') !~ '^[0-9]+([.][0-9]{1,2})?$' then
        raise exception 'Agreement first monthly payment must be positive and cent-exact';
      end if;
      v_first_month := (v_plan ->> 'firstMonthlyPayment')::numeric;
      if v_first_month <= 0 then
        raise exception 'Agreement first monthly payment is invalid';
      end if;
      if v_plan ? 'firstWorkFee' and v_plan ->> 'firstWorkFee' is not null then
        raise exception 'New agreement snapshots cannot contain a retired First Work Fee';
      end if;
      v_line_items := jsonb_build_array(
        jsonb_build_object('code', 'first_monthly_payment', 'description', 'First Monthly Payment', 'amount', v_first_month)
      );
      v_description := v_label || ' - First Monthly Payment';
      v_total := v_first_month;
    end if;
  elsif v_mode = 'tier' and v_tier = 'Paid In Full' then
    if v_agreement.template_version = 'ccc-service-agreement-v2-service-only' then
      if v_agreement.status <> 'signed' then
        raise exception 'Unsigned legacy agreements use retired pricing; prepare the current agreement before invoicing';
      end if;
      if coalesce(v_plan ->> 'flatFee', '') !~ '^[0-9]+([.][0-9]+)?$' then
        raise exception 'Legacy paid-in-full agreement amount is incomplete';
      end if;
      v_flat_fee := round((v_plan ->> 'flatFee')::numeric, 2);
    else
      if v_billing_type is distinct from 'Paid in Full' then
        raise exception 'Paid In Full opening invoices require a Paid in Full snapshot';
      end if;
      if coalesce(v_plan ->> 'flatFee', '') !~ '^[0-9]+([.][0-9]{1,2})?$' then
        raise exception 'Paid-in-full agreement amount must be positive and cent-exact';
      end if;
      if coalesce(v_plan ->> 'flatMonths', '') !~ '^6([.]0+)?$' then
        raise exception 'Paid In Full must cover exactly 6 months of Standard service';
      end if;
      if (v_plan ->> 'flatMonths')::numeric is distinct from 6::numeric then
        raise exception 'Paid In Full must cover exactly 6 months of Standard service';
      end if;
      if v_plan #>> '{serviceScope,scopeBasis}' is distinct from 'Standard' then
        raise exception 'Paid In Full must freeze the Standard service scope';
      end if;
      v_flat_fee := (v_plan ->> 'flatFee')::numeric;
    end if;
    if v_flat_fee <= 0 then raise exception 'Paid-in-full agreement amount is invalid'; end if;
    v_line_items := jsonb_build_array(
      jsonb_build_object('code', 'paid_in_full_service', 'description', 'Paid In Full Service', 'amount', v_flat_fee)
    );
    v_description := v_label || ' - Paid In Full Service';
    v_total := v_flat_fee;
  elsif v_mode = 'custom' then
    if coalesce(v_plan ->> 'amount', '') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception 'Custom agreement amount must be fixed and cent-exact';
    end if;
    v_custom_amount := (v_plan ->> 'amount')::numeric;
    if v_custom_amount <= 0 then raise exception 'Custom agreement amount is invalid'; end if;

    if v_billing_type = 'Automated Recurring' then
      if coalesce(v_plan ->> 'monthlyFee', '') !~ '^[0-9]+([.][0-9]{1,2})?$' then
        raise exception 'Custom monthly agreement amount is incomplete';
      end if;
      v_custom_schedule_amount := (v_plan ->> 'monthlyFee')::numeric;
      if v_custom_schedule_amount <= 0
         or v_custom_schedule_amount is distinct from v_custom_amount then
        raise exception 'Custom monthlyFee must match the frozen agreement amount';
      end if;
      if v_plan ->> 'flatFee' is not null then
        raise exception 'Custom monthly agreements cannot contain a flatFee';
      end if;
      v_line_items := jsonb_build_array(
        jsonb_build_object(
          'code', 'custom_first_monthly_payment',
          'description', v_label || ' — First Monthly Payment',
          'amount', v_custom_amount
        )
      );
      v_description := v_label || ' — First Monthly Payment';
    elsif v_billing_type = 'Paid in Full' then
      if coalesce(v_plan ->> 'flatFee', '') !~ '^[0-9]+([.][0-9]{1,2})?$' then
        raise exception 'Custom one-time agreement amount is incomplete';
      end if;
      v_custom_schedule_amount := (v_plan ->> 'flatFee')::numeric;
      if v_custom_schedule_amount <= 0
         or v_custom_schedule_amount is distinct from v_custom_amount then
        raise exception 'Custom flatFee must match the frozen agreement amount';
      end if;
      if v_plan ->> 'monthlyFee' is not null then
        raise exception 'Custom one-time agreements cannot contain a monthlyFee';
      end if;
      v_line_items := jsonb_build_array(
        jsonb_build_object(
          'code', 'custom_paid_in_full_service',
          'description', v_label || ' — One-Time Service',
          'amount', v_custom_amount
        )
      );
      v_description := v_label || ' — One-Time Service';
    else
      raise exception 'Custom agreement billingType is unsupported for an opening invoice';
    end if;
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
  'Owner-only, idempotent opening invoice from an immutable agreement snapshot. Custom monthly and one-time schedules have distinct immutable line items. V2 signed terms remain intact. Never charges, emails, activates, pauses, or authorizes service.';

commit;

-- Rollback: restore the function definition and exact privilege statements
-- from 20260820360000. Existing commands and ledger entries remain immutable.
