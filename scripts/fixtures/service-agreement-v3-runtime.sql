\set ON_ERROR_STOP on

begin;

do $test$
declare
  v_admin uuid := 'a1000000-0000-4000-8000-000000000001';
  v_portal uuid := 'a2000000-0000-4000-8000-000000000002';
  v_client uuid := 'a3000000-0000-4000-8000-000000000003';
  v_profile uuid := 'a4000000-0000-4000-8000-000000000004';
  v_agreement uuid := 'a5000000-0000-4000-8000-000000000005';
  v_template public.service_agreement_templates%rowtype;
  v_snapshot jsonb;
  v_identity jsonb;
  v_signed_at timestamptz;
  v_deadline timestamptz;
  v_finalized uuid;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
     'owner-v3-test@example.com', '', current_timestamp, '{}'::jsonb, '{}'::jsonb,
     current_timestamp, current_timestamp),
    ('00000000-0000-0000-0000-000000000000', v_portal, 'authenticated', 'authenticated',
     'portal-v3-test@example.com', '', current_timestamp, '{}'::jsonb, '{}'::jsonb,
     current_timestamp, current_timestamp);

  insert into public.profiles (id, full_name, email, role) values
    (v_admin, 'Fixture Owner', 'owner-v3-test@example.com', 'admin'),
    (v_portal, 'Fixture Client', 'portal-v3-test@example.com', 'client');

  begin
    perform public.ccc_approve_service_agreement_template(
      'ccc-service-agreement-v2-service-only', v_admin, 'fixture-v2-must-fail',
      'weekdays_only_counsel_approved'
    );
    raise exception 'Retired v2 approval unexpectedly succeeded';
  exception when others then
    if sqlerrm not like 'Only the exact current v3%' then raise; end if;
  end;

  perform public.ccc_approve_service_agreement_template(
    'ccc-service-agreement-v3-no-first-work', v_admin, 'fixture-counsel-approval-record',
    'weekdays_only_counsel_approved'
  );

  select * into strict v_template
  from public.service_agreement_templates
  where version = 'ccc-service-agreement-v3-no-first-work'
    and legal_status = 'approved';

  insert into public.clients (id, user_id, name, email)
  values (v_client, v_admin, 'Fixture Client', 'portal-v3-test@example.com');
  insert into public.client_profiles (id, user_id, client_id, full_name, email, created_by)
  values (v_profile, v_portal, v_client, 'Fixture Client', 'portal-v3-test@example.com', v_admin);

  v_snapshot := jsonb_build_object(
    'templateVersion', v_template.version,
    'packetKind', v_template.packet_kind,
    'agreementBodyHtml', v_template.body_html,
    'consumerDisclosureHtml', v_template.consumer_disclosure_html,
    'cancellationNoticeHtml', v_template.cancellation_notice_html,
    'cancellationCalendarKind', v_template.cancellation_calendar_kind
  );

  insert into public.client_service_agreements (
    id, user_id, client_id, template_id, template_version, status,
    plan_snapshot, client_snapshot, document_snapshot,
    sent_at, signing_expires_at, created_by
  ) values (
    v_agreement, v_admin, v_client, v_template.id, v_template.version, 'sent',
    jsonb_build_object('mode', 'tier', 'billingTier', 'Standard', 'firstMonthlyPayment', 149),
    jsonb_build_object('name', 'Fixture Client', 'email', 'portal-v3-test@example.com'),
    v_snapshot,
    current_timestamp - interval '1 minute', current_timestamp + interval '1 day', v_admin
  );

  insert into public.documents (
    user_id, client_id, client_name, doc_type, file_name, storage_path,
    content_type, byte_size, sha256
  ) values
    (v_admin, v_client, 'Fixture Client', 'id', 'id.png',
     v_admin::text || '/' || v_client::text || '/identity/id-aaaaaaaaaaaaaaaa.png',
     'image/png', 100, repeat('a', 64)),
    (v_admin, v_client, 'Fixture Client', 'address', 'address.pdf',
     v_admin::text || '/' || v_client::text || '/identity/address-bbbbbbbbbbbbbbbb.pdf',
     'application/pdf', 100, repeat('b', 64));

  v_identity := public.ccc_resolve_canonical_portal_identity(v_portal, 'canonical');
  if (v_identity ->> 'profileId')::uuid is distinct from v_profile
     or (v_identity ->> 'clientId')::uuid is distinct from v_client
     or (v_identity ->> 'firmUserId')::uuid is distinct from v_admin then
    raise exception 'Canonical identity returned the wrong ownership tuple';
  end if;
  perform public.ccc_resolve_canonical_portal_identity(v_portal, 'pre_sign_v3');

  v_signed_at := public.ccc_claim_portal_service_agreement_signing(
    v_portal, v_profile, v_client, v_agreement, repeat('c', 64)
  );
  if v_signed_at is null then raise exception 'v3 signing claim was not established'; end if;

  begin
    perform public.ccc_finalize_portal_service_agreement(
      v_portal, v_profile, v_client, v_agreement, v_template.id,
      'ccc-service-agreement-v2-service-only',
      '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
      v_signed_at, public.ccc_weekday_service_eligible_at(v_signed_at),
      'x', repeat('d', 64), 'y', repeat('e', 64), 'z', repeat('f', 64),
      '{}'::jsonb, null, null
    );
    raise exception 'Retired v2 finalization unexpectedly succeeded';
  exception when others then
    if sqlerrm not like 'Only the exact current v3%' then raise; end if;
  end;

  v_deadline := public.ccc_weekday_service_eligible_at(v_signed_at);
  v_finalized := public.ccc_finalize_portal_service_agreement(
    v_portal, v_profile, v_client, v_agreement, v_template.id, v_template.version,
    (select plan_snapshot from public.client_service_agreements where id = v_agreement),
    (select client_snapshot from public.client_service_agreements where id = v_agreement),
    v_snapshot,
    v_signed_at,
    v_deadline,
    v_admin::text || '/' || v_client::text || '/agreements/' || v_agreement::text || '/signed-packet.html',
    repeat('d', 64),
    v_admin::text || '/' || v_client::text || '/agreements/' || v_agreement::text || '/consumer-rights-disclosure.html',
    repeat('e', 64),
    v_admin::text || '/' || v_client::text || '/agreements/' || v_agreement::text || '/notice-of-cancellation-two-copies.pdf',
    repeat('f', 64),
    jsonb_build_object('acknowledgements', jsonb_build_object(
      'service_agreement', true,
      'consumer_rights_disclosure', true,
      'cancellation_notices_received', true,
      'electronic_records', true
    )),
    '198.51.100.7', 'CCC fixture'
  );
  if v_finalized is distinct from v_agreement then
    raise exception 'v3 finalization did not return the exact packet';
  end if;
  perform public.ccc_resolve_canonical_portal_identity(v_portal, 'active');

  update public.profiles set role = 'auditor' where id = v_portal;
  begin
    perform public.ccc_resolve_canonical_portal_identity(v_portal, 'active');
    raise exception 'Non-client public profile unexpectedly passed the portal gate';
  exception when sqlstate '42501' then
    null;
  end;

  raise notice 'service agreement v3 runtime fixture passed';
end;
$test$;

rollback;
