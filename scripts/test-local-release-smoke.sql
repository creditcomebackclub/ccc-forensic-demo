\set ON_ERROR_STOP on

begin;

do $smoke$
declare
  v_admin uuid := '11111111-1111-4111-8111-111111111111';
  v_monthly_client uuid := '22222222-2222-4222-8222-222222222221';
  v_once_client uuid := '22222222-2222-4222-8222-222222222222';
  v_monthly_agreement uuid := '33333333-3333-4333-8333-333333333331';
  v_once_agreement uuid := '33333333-3333-4333-8333-333333333332';
  v_template uuid;
  v_first jsonb;
  v_second jsonb;
  v_result jsonb;
  v_allowed boolean;
  v_index integer;
begin
  insert into auth.users (
    id, email, aud, role, is_sso_user, is_anonymous, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) values (
    v_admin, 'owner-smoke@example.test', 'authenticated', 'authenticated',
    false, false, pg_catalog.now(), pg_catalog.now(), '{}'::jsonb, '{}'::jsonb
  );

  insert into public.profiles (id, full_name, email, role)
  values (v_admin, 'Local Smoke Owner', 'owner-smoke@example.test', 'admin')
  on conflict (id) do update set role = 'admin';

  if pg_catalog.has_function_privilege('anon', 'public.consume_public_intake_rate_limit(text,integer,integer,integer)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.consume_public_intake_rate_limit(text,integer,integer,integer)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', 'public.consume_public_intake_rate_limit(text,integer,integer,integer)', 'EXECUTE') then
    raise exception 'Public intake limiter grants are unsafe';
  end if;

  if pg_catalog.has_function_privilege('anon', 'public.create_or_reuse_public_intake_lead(uuid,text,text,text,text,text,text)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.create_or_reuse_public_intake_lead(uuid,text,text,text,text,text,text)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', 'public.create_or_reuse_public_intake_lead(uuid,text,text,text,text,text,text)', 'EXECUTE') then
    raise exception 'Public intake writer grants are unsafe';
  end if;

  for v_index in 1..6 loop
    v_result := public.consume_public_intake_rate_limit(
      'intake:' || pg_catalog.repeat('a', 64), 900, 5, 86400
    );
    v_allowed := (v_result ->> 'allowed')::boolean;
    if (v_index <= 5 and not v_allowed) or (v_index = 6 and v_allowed) then
      raise exception 'Public intake limiter failed at attempt %', v_index;
    end if;
  end loop;

  v_first := public.create_or_reuse_public_intake_lead(
    v_admin, 'Local Lead', 'LOCAL.LEAD@example.test', '970-555-0100',
    'VIP', null, 'consultation'
  );
  v_second := public.create_or_reuse_public_intake_lead(
    v_admin, 'Changed Name', 'local.lead@example.test', '970-555-9999',
    'Standard', null, 'consultation'
  );
  if v_first #>> '{lead,id}' is distinct from v_second #>> '{lead,id}'
     or (select count(*) from public.clients
         where user_id = v_admin and status = 'lead'
           and lower(btrim(email)) = 'local.lead@example.test') <> 1 then
    raise exception 'Public intake did not reuse one owner/email open lead';
  end if;
  if v_second #>> '{lead,name}' is distinct from 'Local Lead'
     or v_second #>> '{lead,lead_phone}' is distinct from '970-555-0100' then
    raise exception 'Public intake retry overwrote immutable lead identity/contact';
  end if;
  if (select count(*) from pg_catalog.jsonb_object_keys(v_second -> 'lead')) <> 5
     or not ((v_second -> 'lead') ?& array['id','name','email','lead_phone','referred_by']) then
    raise exception 'Public intake RPC returned more than the minimized lead contract';
  end if;

  select id into strict v_template
  from public.service_agreement_templates
  where version = 'ccc-service-agreement-v3-no-first-work'
    and packet_kind = 'service_agreement_only';

  insert into public.clients (id, user_id, name, email, ledger)
  values
    (v_monthly_client, v_admin, 'Monthly Custom', 'monthly@example.test', '[]'::jsonb),
    (v_once_client, v_admin, 'One Time Custom', 'once@example.test', '[]'::jsonb);

  insert into public.client_service_agreements (
    id, user_id, client_id, template_id, template_version, status,
    plan_snapshot, client_snapshot, created_by
  ) values
    (
      v_monthly_agreement, v_admin, v_monthly_client, v_template,
      'ccc-service-agreement-v3-no-first-work', 'draft',
      jsonb_build_object(
        'mode', 'custom', 'label', 'Custom Monthly Package', 'amount', 275.50,
        'monthlyFee', 275.50, 'flatFee', null,
        'billingType', 'Automated Recurring'
      ),
      jsonb_build_object('name', 'Monthly Custom'), v_admin
    ),
    (
      v_once_agreement, v_admin, v_once_client, v_template,
      'ccc-service-agreement-v3-no-first-work', 'draft',
      jsonb_build_object(
        'mode', 'custom', 'label', 'Custom One-Time Package', 'amount', 825,
        'monthlyFee', null, 'flatFee', 825,
        'billingType', 'Paid in Full'
      ),
      jsonb_build_object('name', 'One Time Custom'), v_admin
    );

  perform pg_catalog.set_config('request.jwt.claim.sub', v_admin::text, true);

  v_result := public.ccc_create_manual_agreement_invoice(
    v_monthly_client, v_monthly_agreement,
    '44444444-4444-4444-8444-444444444441', current_date
  );
  if v_result #>> '{invoice,line_items,0,code}' is distinct from 'custom_first_monthly_payment'
     or (v_result #>> '{invoice,amount}')::numeric is distinct from 275.50::numeric then
    raise exception 'Custom monthly invoice did not match its frozen agreement';
  end if;

  v_result := public.ccc_create_manual_agreement_invoice(
    v_once_client, v_once_agreement,
    '44444444-4444-4444-8444-444444444442', current_date
  );
  if v_result #>> '{invoice,line_items,0,code}' is distinct from 'custom_paid_in_full_service'
     or (v_result #>> '{invoice,amount}')::numeric is distinct from 825::numeric then
    raise exception 'Custom one-time invoice did not match its frozen agreement';
  end if;

  v_result := public.ccc_create_manual_agreement_invoice(
    v_once_client, v_once_agreement,
    '44444444-4444-4444-8444-444444444443', current_date
  );
  if not (v_result ->> 'alreadyCreated')::boolean
     or (select count(*) from public.manual_agreement_invoice_commands
         where agreement_id = v_once_agreement) <> 1 then
    raise exception 'Agreement invoice retry was not idempotent';
  end if;
end;
$smoke$;

rollback;

select 'Local release SQL smoke checks passed.' as result;
