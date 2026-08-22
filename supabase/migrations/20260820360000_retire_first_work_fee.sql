-- Forward-only retirement of First Work Fee for all new CCC agreements.
--
-- Compatibility contract:
--   * Existing v1/v2 templates, signed packets, invoice commands, ledger rows,
--     and mailed artifacts are immutable and are never rewritten.
--   * V3 starts in counsel_review. This migration does not approve or activate
--     it; the current legal-status gate continues to block sending/signing.
--   * An opening invoice made from an immutable v2 snapshot retains the exact
--     First Work + first-month terms that client signed. V3 monthly snapshots
--     create only the first monthly payment; Paid In Full uses its flat price.

do $$
declare
  v_source public.service_agreement_templates%rowtype;
  v_body text;
begin
  select * into v_source
  from public.service_agreement_templates
  where version = 'ccc-service-agreement-v2-service-only';
  if not found then
    raise exception 'The v2 service-agreement source is required before installing v3.';
  end if;

  v_body := replace(
    replace(
      replace(
        v_source.body_html,
        'That summary identifies only this Client''s saved plan name, service term, monthly or flat service price, First Work Fee, and exact fee terms.',
        'That summary identifies only this Client''s saved plan name, service term, monthly or flat service price, and exact fee terms.'
      ),
      'The credit-report audit and Recovery Blueprint provided before enrollment are a free pre-client assessment. They are not paid First Work and do not trigger any fee.',
      'The credit-report audit and Recovery Blueprint provided before enrollment are a free pre-client assessment and do not trigger any fee.'
    ),
    '<p><strong>Selected prices:</strong> The versioned selected-plan summary states this Client''s exact First Work Fee and monthly or flat service price. The free pre-client assessment is not included in the First Work Fee.</p>',
    '<p><strong>Selected prices:</strong> The versioned selected-plan summary states this Client''s exact monthly or flat service price.</p><p><strong>Opening invoice:</strong> For Standard and VIP, any owner-created opening invoice is limited to the first monthly service payment shown in the summary. For Paid In Full, it is limited to the flat service price shown in the summary. Signing and onboarding do not create an invoice or charge automatically.</p>'
  );

  if v_body is not distinct from v_source.body_html
     or position('First Work' in v_body) > 0 then
    raise exception 'The v2 agreement text no longer matches the reviewed v3 replacement contract.';
  end if;

  insert into public.service_agreement_templates (
    version,
    title,
    legal_status,
    packet_kind,
    body_html,
    consumer_disclosure_html,
    cancellation_notice_html,
    cancellation_calendar_kind
  ) values (
    'ccc-service-agreement-v3-no-first-work',
    'CCC Client Service Agreement v3',
    'counsel_review',
    'service_agreement_only',
    v_body,
    v_source.consumer_disclosure_html,
    v_source.cancellation_notice_html,
    'pending_counsel'
  )
  on conflict (version) do nothing;

  if not exists (
    select 1
    from public.service_agreement_templates t
    where t.version = 'ccc-service-agreement-v3-no-first-work'
      and t.packet_kind = 'service_agreement_only'
      and position('First Work' in coalesce(t.body_html, '')) = 0
  ) then
    raise exception 'The installed v3 agreement source failed its no-First-Work integrity check.';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_service_agreements_v3_signed_artifacts_check'
      and conrelid = 'public.client_service_agreements'::regclass
  ) then
    alter table public.client_service_agreements
      add constraint client_service_agreements_v3_signed_artifacts_check
      check (
        template_version <> 'ccc-service-agreement-v3-no-first-work'
        or status <> 'signed'
        or (
          signed_document_path is not null and signed_document_hash is not null
          and signing_started_at is not null and signing_started_at = signed_at
          and signing_signature_sha256 is not null
          and signed_disclosure_path is not null and signed_disclosure_hash is not null
          and signed_cancellation_path is not null and signed_cancellation_hash is not null
          and cancellation_deadline is not null and service_eligible_at is not null
          and cancellation_calendar_kind = 'weekdays_only_counsel_approved'
        )
      );
  end if;
end $$;

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

  if v_mode = 'tier' and v_tier in ('Standard', 'VIP') then
    if coalesce(v_plan ->> 'firstMonthlyPayment', '') !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception 'Agreement first monthly payment is incomplete';
    end if;
    v_first_month := round((v_plan ->> 'firstMonthlyPayment')::numeric, 2);
    if v_first_month <= 0 then
      raise exception 'Agreement first monthly payment is invalid';
    end if;

    if v_agreement.template_version = 'ccc-service-agreement-v2-service-only' then
      if v_agreement.status <> 'signed' then
        raise exception 'Unsigned legacy agreements use retired pricing; prepare the current agreement before invoicing';
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
    if coalesce(v_plan ->> 'flatFee', '') !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception 'Paid-in-full agreement amount is incomplete';
    end if;
    v_flat_fee := round((v_plan ->> 'flatFee')::numeric, 2);
    if v_flat_fee <= 0 then raise exception 'Paid-in-full agreement amount is invalid'; end if;
    v_line_items := jsonb_build_array(
      jsonb_build_object('code', 'paid_in_full_service', 'description', 'Paid In Full Service', 'amount', v_flat_fee)
    );
    v_description := v_label || ' - Paid In Full Service';
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
  'Owner-only, idempotent opening invoice from an immutable agreement snapshot. V2 signed terms remain intact; V3 monthly plans invoice only the first monthly payment. Never charges, emails, pauses, or authorizes service.';
