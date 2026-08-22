-- Activate the v3 service-agreement runtime contract without rewriting any
-- historical v1/v2 packet or signed artifact.
--
-- Compatibility contract:
--   * v3 remains counsel_review until the service-role approval RPC records
--     the required approver, durable approval reference, and counsel-approved
--     cancellation calendar.
--   * new signing claims and finalization accept v3 only. Retired v2 packets
--     remain immutable internal evidence and cannot be newly signed.
--   * every service-role portal reader resolves the same exact Auth/profile/
--     client identity and may additionally require a sent v3 packet or active
--     signed/grandfathered portal authorization.

begin;

create or replace function public.ccc_resolve_canonical_portal_identity(
  p_portal_user_id uuid,
  p_access_mode text default 'canonical'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.client_profiles%rowtype;
  v_client public.clients%rowtype;
  v_auth_email text;
  v_identity_email text;
  v_profile_count integer;
  v_client_profile_count integer;
  v_email_profile_count integer;
  v_sent_v3_count integer;
  v_active boolean;
begin
  if p_portal_user_id is null then
    raise exception using errcode = '42501', message = 'A verified client portal identity is required';
  end if;
  if p_access_mode not in ('canonical', 'pre_sign_v3', 'active') then
    raise exception 'Unknown portal access mode';
  end if;

  select count(*)::integer
  into v_profile_count
  from public.client_profiles profile
  where profile.user_id = p_portal_user_id;
  if v_profile_count <> 1 then
    raise exception using errcode = '42501', message = 'The client portal identity is ambiguous';
  end if;

  select profile.*
  into strict v_profile
  from public.client_profiles profile
  where profile.user_id = p_portal_user_id;
  if v_profile.client_id is null
     or nullif(lower(btrim(coalesce(v_profile.email, ''))), '') is null then
    raise exception using errcode = '42501', message = 'The client portal identity is incomplete';
  end if;

  select count(*)::integer
  into v_client_profile_count
  from public.client_profiles peer
  where peer.client_id = v_profile.client_id;
  select count(*)::integer
  into v_email_profile_count
  from public.client_profiles peer
  where lower(btrim(coalesce(peer.email, ''))) = lower(btrim(v_profile.email));
  if v_client_profile_count <> 1 or v_email_profile_count <> 1 then
    raise exception using errcode = '42501', message = 'The client portal mapping is ambiguous';
  end if;

  select client.*
  into strict v_client
  from public.clients client
  where client.id = v_profile.client_id;
  select lower(btrim(coalesce(portal_user.email, '')))
  into strict v_auth_email
  from auth.users portal_user
  where portal_user.id = p_portal_user_id;
  select lower(btrim(coalesce(identity_profile.email, '')))
  into strict v_identity_email
  from public.profiles identity_profile
  where identity_profile.id = p_portal_user_id
    and identity_profile.role = 'client';

  if v_auth_email = ''
     or v_identity_email = ''
     or lower(btrim(v_profile.email)) <> v_auth_email
     or lower(btrim(v_profile.email)) <> v_identity_email
     or lower(btrim(v_profile.email)) <> lower(btrim(coalesce(v_client.email, '')))
     or exists (
       select 1 from public.affiliates affiliate
       where affiliate.user_id = p_portal_user_id
     ) then
    raise exception using errcode = '42501', message = 'The client portal identity failed its integrity check';
  end if;

  if p_access_mode = 'pre_sign_v3' then
    select count(*)::integer
    into v_sent_v3_count
    from public.client_service_agreements agreement
    join public.service_agreement_templates template
      on template.id = agreement.template_id
     and template.version = agreement.template_version
    where agreement.client_id = v_client.id
      and agreement.user_id = v_client.user_id
      and agreement.template_version = 'ccc-service-agreement-v3-no-first-work'
      and agreement.status = 'sent'
      and agreement.sent_at is not null
      and agreement.sent_at <= current_timestamp
      and (agreement.signing_expires_at is null or agreement.signing_expires_at > current_timestamp)
      and template.version = 'ccc-service-agreement-v3-no-first-work'
      and template.packet_kind = 'service_agreement_only'
      and template.legal_status = 'approved'
      and template.approved_by is not null
      and template.approved_at is not null
      and nullif(btrim(coalesce(template.approval_reference, '')), '') is not null
      and template.cancellation_calendar_kind = 'weekdays_only_counsel_approved';
    if v_sent_v3_count <> 1 then
      raise exception using errcode = '42501', message = 'One exact sent v3 service agreement is required';
    end if;
  elsif p_access_mode = 'active' then
    v_active := exists (
      select 1
      from public.client_service_agreements agreement
      join public.service_agreement_templates template
        on template.id = agreement.template_id
       and template.version = agreement.template_version
      where agreement.client_id = v_client.id
        and agreement.user_id = v_client.user_id
        and agreement.status = 'signed'
        and agreement.signed_at is not null
        and template.packet_kind = 'service_agreement_only'
    ) or exists (
      select 1
      from public.legacy_service_grandfathering grandfather
      where grandfather.client_id = v_client.id
        and (
          grandfather.profile_id = v_profile.id
          or (
            grandfather.profile_id is null
            and (grandfather.evidence_snapshot ->> 'linkedClientProfileCount')::integer = 0
          )
        )
    );
    if not v_active then
      raise exception using errcode = '42501', message = 'Client portal access is not active';
    end if;
  end if;

  return jsonb_build_object(
    'profileId', v_profile.id,
    'clientId', v_client.id,
    'firmUserId', v_client.user_id
  );
exception
  when no_data_found or too_many_rows then
    raise exception using errcode = '42501', message = 'The client portal identity failed its integrity check';
end;
$$;

revoke all on function public.ccc_resolve_canonical_portal_identity(uuid, text)
  from public, anon, authenticated;
grant execute on function public.ccc_resolve_canonical_portal_identity(uuid, text)
  to service_role;

create or replace function public.ccc_approve_service_agreement_template(
  p_version text,
  p_approved_by uuid,
  p_approval_reference text,
  p_cancellation_calendar_kind text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template_id uuid;
begin
  if p_version <> 'ccc-service-agreement-v3-no-first-work' then
    raise exception 'Only the exact current v3 service agreement may use this approval path.';
  end if;
  if p_cancellation_calendar_kind <> 'weekdays_only_counsel_approved' then
    raise exception 'Counsel-approved cancellation-calendar policy is required.';
  end if;
  if nullif(btrim(coalesce(p_approval_reference, '')), '') is null then
    raise exception 'A durable owner/counsel approval reference is required.';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_approved_by and profile.role = 'admin'
  ) then
    raise exception 'Approval must be recorded by an authorized administrator.';
  end if;

  update public.service_agreement_templates
  set legal_status = 'approved',
      cancellation_calendar_kind = p_cancellation_calendar_kind,
      approved_by = p_approved_by,
      approved_at = current_timestamp,
      approval_reference = btrim(p_approval_reference),
      effective_at = coalesce(effective_at, current_timestamp),
      updated_at = current_timestamp
  where version = p_version
    and legal_status = 'counsel_review'
  returning id into v_template_id;
  if v_template_id is null then
    raise exception 'Template is missing, already approved, or no longer eligible for approval.';
  end if;
  return v_template_id;
end;
$$;

revoke all on function public.ccc_approve_service_agreement_template(text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.ccc_approve_service_agreement_template(text, uuid, text, text)
  to service_role;

create or replace function public.ccc_claim_portal_service_agreement_signing(
  p_portal_user_id uuid,
  p_profile_id uuid,
  p_client_id uuid,
  p_agreement_id uuid,
  p_signature_sha256 text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity jsonb;
  v_agreement public.client_service_agreements%rowtype;
  v_template public.service_agreement_templates%rowtype;
  v_firm_user_id uuid;
  v_claimed_at timestamptz;
begin
  if coalesce(p_signature_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Signature hash must be a lowercase SHA-256 value.';
  end if;

  v_identity := public.ccc_resolve_canonical_portal_identity(p_portal_user_id, 'pre_sign_v3');
  if (v_identity ->> 'profileId')::uuid is distinct from p_profile_id
     or (v_identity ->> 'clientId')::uuid is distinct from p_client_id then
    raise exception using errcode = '42501', message = 'Portal identity does not match this client';
  end if;

  select * into v_agreement
  from public.client_service_agreements
  where id = p_agreement_id
  for update;
  if not found then
    raise exception 'Prepared agreement packet was not found.';
  end if;
  if v_agreement.status <> 'sent'
     or v_agreement.client_id <> p_client_id
     or v_agreement.template_version <> 'ccc-service-agreement-v3-no-first-work' then
    raise exception 'Exact current v3 service-agreement packet is not available for signing.';
  end if;
  if v_agreement.sent_at is null or v_agreement.sent_at > current_timestamp then
    raise exception 'Prepared agreement packet has not been delivered.';
  end if;
  if v_agreement.signing_expires_at is not null
     and v_agreement.signing_expires_at <= current_timestamp then
    raise exception 'Prepared agreement packet has expired.';
  end if;

  v_firm_user_id := (v_identity ->> 'firmUserId')::uuid;
  if v_agreement.user_id <> v_firm_user_id then
    raise exception 'Agreement packet ownership does not match this client.';
  end if;
  if not exists (
    select 1 from public.documents document
    where document.user_id = v_firm_user_id
      and document.client_id = p_client_id
      and document.doc_type = 'id'
  ) or not exists (
    select 1 from public.documents document
    where document.user_id = v_firm_user_id
      and document.client_id = p_client_id
      and document.doc_type = 'address'
  ) then
    raise exception 'Government ID and proof of address are required before signing.';
  end if;

  select * into v_template
  from public.service_agreement_templates template
  where template.id = v_agreement.template_id
    and template.version = 'ccc-service-agreement-v3-no-first-work'
    and template.version = v_agreement.template_version
    and template.packet_kind = 'service_agreement_only'
    and template.legal_status = 'approved'
    and template.approved_by is not null
    and template.approved_at is not null
    and nullif(btrim(coalesce(template.approval_reference, '')), '') is not null
    and template.cancellation_calendar_kind = 'weekdays_only_counsel_approved';
  if not found then
    raise exception 'The exact current v3 service agreement is not approved.';
  end if;
  if jsonb_typeof(v_agreement.plan_snapshot) is distinct from 'object'
     or jsonb_typeof(v_agreement.client_snapshot) is distinct from 'object'
     or jsonb_typeof(v_agreement.document_snapshot) is distinct from 'object'
     or nullif(btrim(v_agreement.client_snapshot ->> 'name'), '') is null
     or v_agreement.document_snapshot ->> 'templateVersion' is distinct from v_template.version
     or v_agreement.document_snapshot ->> 'packetKind' is distinct from v_template.packet_kind
     or v_agreement.document_snapshot ->> 'agreementBodyHtml' is distinct from v_template.body_html
     or v_agreement.document_snapshot ->> 'consumerDisclosureHtml' is distinct from v_template.consumer_disclosure_html
     or v_agreement.document_snapshot ->> 'cancellationNoticeHtml' is distinct from v_template.cancellation_notice_html
     or v_agreement.document_snapshot ->> 'cancellationCalendarKind' is distinct from v_template.cancellation_calendar_kind then
    raise exception 'Prepared agreement snapshots do not match the approved source.';
  end if;

  if v_agreement.signing_started_at is not null then
    if v_agreement.signing_signature_sha256 = p_signature_sha256 then
      return v_agreement.signing_started_at;
    end if;
    raise exception 'A different signature is already bound to this signing packet.';
  end if;

  v_claimed_at := clock_timestamp();
  update public.client_service_agreements
  set signing_started_at = v_claimed_at,
      signing_signature_sha256 = p_signature_sha256
  where id = p_agreement_id
    and status = 'sent'
    and signing_started_at is null;
  if not found then
    raise exception 'Signing packet changed before its signature could be claimed.';
  end if;
  return v_claimed_at;
end;
$$;

revoke all on function public.ccc_claim_portal_service_agreement_signing(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.ccc_claim_portal_service_agreement_signing(uuid, uuid, uuid, uuid, text)
  to service_role;

create or replace function public.ccc_finalize_portal_service_agreement(
  p_portal_user_id uuid,
  p_profile_id uuid,
  p_client_id uuid,
  p_agreement_id uuid,
  p_template_id uuid,
  p_template_version text,
  p_plan_snapshot jsonb,
  p_client_snapshot jsonb,
  p_document_snapshot jsonb,
  p_signed_at timestamptz,
  p_cancellation_deadline timestamptz,
  p_signed_document_path text,
  p_signed_document_hash text,
  p_signed_disclosure_path text,
  p_signed_disclosure_hash text,
  p_signed_cancellation_path text,
  p_signed_cancellation_hash text,
  p_event_data jsonb,
  p_ip_address text,
  p_user_agent text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity jsonb;
  v_template public.service_agreement_templates%rowtype;
  v_agreement public.client_service_agreements%rowtype;
  v_firm_user_id uuid;
  v_expected_prefix text;
  v_service_eligible_at timestamptz;
begin
  if p_template_version <> 'ccc-service-agreement-v3-no-first-work' then
    raise exception 'Only the exact current v3 service agreement can complete portal onboarding.';
  end if;
  if p_signed_at is null or p_signed_at > current_timestamp + interval '5 minutes' then
    raise exception 'A valid signing time is required.';
  end if;
  if coalesce(p_signed_document_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_signed_disclosure_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_signed_cancellation_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Signed document hashes must be lowercase SHA-256 values.';
  end if;

  v_identity := public.ccc_resolve_canonical_portal_identity(p_portal_user_id, 'canonical');
  if (v_identity ->> 'profileId')::uuid is distinct from p_profile_id
     or (v_identity ->> 'clientId')::uuid is distinct from p_client_id then
    raise exception using errcode = '42501', message = 'Portal identity does not match this client';
  end if;
  v_firm_user_id := (v_identity ->> 'firmUserId')::uuid;

  select * into v_agreement
  from public.client_service_agreements
  where id = p_agreement_id
  for update;
  if not found then
    raise exception 'Prepared agreement packet was not found.';
  end if;
  if v_agreement.status not in ('sent', 'signed')
     or v_agreement.template_version <> 'ccc-service-agreement-v3-no-first-work' then
    raise exception 'Prepared current v3 agreement packet is not available for signing.';
  end if;
  if v_agreement.signing_started_at is null
     or v_agreement.signing_signature_sha256 is null
     or p_signed_at is distinct from v_agreement.signing_started_at then
    raise exception 'Signing must use the server-claimed timestamp and signature.';
  end if;
  if v_agreement.sent_at is null or p_signed_at < v_agreement.sent_at then
    raise exception 'Signing time cannot precede delivery of the prepared packet.';
  end if;
  if v_agreement.status = 'sent'
     and v_agreement.signing_expires_at is not null
     and v_agreement.signing_expires_at <= p_signed_at then
    raise exception 'Prepared agreement packet has expired.';
  end if;

  if v_agreement.user_id <> v_firm_user_id
     or v_agreement.client_id <> p_client_id then
    raise exception 'Agreement packet ownership does not match this client.';
  end if;
  if not exists (
    select 1 from public.documents document
    where document.user_id = v_firm_user_id
      and document.client_id = p_client_id
      and document.doc_type = 'id'
  ) or not exists (
    select 1 from public.documents document
    where document.user_id = v_firm_user_id
      and document.client_id = p_client_id
      and document.doc_type = 'address'
  ) then
    raise exception 'Government ID and proof of address are required before onboarding can be completed.';
  end if;

  select * into v_template
  from public.service_agreement_templates template
  where template.id = p_template_id
    and template.version = 'ccc-service-agreement-v3-no-first-work'
    and template.version = p_template_version
    and template.packet_kind = 'service_agreement_only'
    and template.legal_status = 'approved'
    and template.approved_by is not null
    and template.approved_at is not null
    and nullif(btrim(coalesce(template.approval_reference, '')), '') is not null
    and template.cancellation_calendar_kind = 'weekdays_only_counsel_approved';
  if not found then
    raise exception 'The exact current v3 service agreement is not approved.';
  end if;
  if position('[PRINCIPAL BUSINESS ADDRESS REQUIRED BEFORE APPROVAL]' in coalesce(v_template.body_html, '')) > 0 then
    raise exception 'Principal business address must be resolved before signing.';
  end if;
  if p_document_snapshot ->> 'templateVersion' is distinct from v_template.version
     or p_document_snapshot ->> 'packetKind' is distinct from v_template.packet_kind
     or p_document_snapshot ->> 'agreementBodyHtml' is distinct from v_template.body_html
     or p_document_snapshot ->> 'consumerDisclosureHtml' is distinct from v_template.consumer_disclosure_html
     or p_document_snapshot ->> 'cancellationNoticeHtml' is distinct from v_template.cancellation_notice_html
     or p_document_snapshot ->> 'cancellationCalendarKind' is distinct from v_template.cancellation_calendar_kind then
    raise exception 'Agreement source snapshot does not match the approved template.';
  end if;
  if v_agreement.template_id <> p_template_id
     or v_agreement.plan_snapshot is distinct from p_plan_snapshot
     or v_agreement.client_snapshot is distinct from p_client_snapshot
     or v_agreement.document_snapshot is distinct from p_document_snapshot then
    raise exception 'Signing payload does not match the immutable prepared packet.';
  end if;
  if coalesce(p_event_data #>> '{acknowledgements,service_agreement}', 'false') <> 'true'
     or coalesce(p_event_data #>> '{acknowledgements,consumer_rights_disclosure}', 'false') <> 'true'
     or coalesce(p_event_data #>> '{acknowledgements,cancellation_notices_received}', 'false') <> 'true'
     or coalesce(p_event_data #>> '{acknowledgements,electronic_records}', 'false') <> 'true' then
    raise exception 'All service-agreement-only acknowledgements are required.';
  end if;

  v_expected_prefix := v_firm_user_id::text || '/' || p_client_id::text || '/agreements/' || p_agreement_id::text || '/';
  if left(coalesce(p_signed_document_path, ''), length(v_expected_prefix)) <> v_expected_prefix
     or left(coalesce(p_signed_disclosure_path, ''), length(v_expected_prefix)) <> v_expected_prefix
     or left(coalesce(p_signed_cancellation_path, ''), length(v_expected_prefix)) <> v_expected_prefix
     or p_signed_document_path = p_signed_disclosure_path
     or p_signed_document_path = p_signed_cancellation_path
     or p_signed_disclosure_path = p_signed_cancellation_path then
    raise exception 'Signed artifact paths do not match this immutable agreement packet.';
  end if;

  v_service_eligible_at := public.ccc_weekday_service_eligible_at(p_signed_at);
  if p_cancellation_deadline is distinct from v_service_eligible_at then
    raise exception 'Cancellation deadline does not match the server-calculated service eligibility time.';
  end if;

  if v_agreement.status = 'signed' then
    if v_agreement.signed_at is not distinct from p_signed_at
       and v_agreement.signed_document_path is not distinct from p_signed_document_path
       and v_agreement.signed_document_hash is not distinct from p_signed_document_hash
       and v_agreement.signed_disclosure_path is not distinct from p_signed_disclosure_path
       and v_agreement.signed_disclosure_hash is not distinct from p_signed_disclosure_hash
       and v_agreement.signed_cancellation_path is not distinct from p_signed_cancellation_path
       and v_agreement.signed_cancellation_hash is not distinct from p_signed_cancellation_hash
       and v_agreement.cancellation_deadline is not distinct from v_service_eligible_at
       and v_agreement.service_eligible_at is not distinct from v_service_eligible_at
       and v_agreement.cancellation_calendar_kind is not distinct from v_template.cancellation_calendar_kind then
      return v_agreement.id;
    end if;
    raise exception 'Signed agreement retry does not match the retained immutable evidence.';
  end if;

  update public.client_service_agreements
  set status = 'signed',
      signed_at = p_signed_at,
      signed_document_path = p_signed_document_path,
      signed_document_hash = p_signed_document_hash,
      signed_disclosure_path = p_signed_disclosure_path,
      signed_disclosure_hash = p_signed_disclosure_hash,
      signed_cancellation_path = p_signed_cancellation_path,
      signed_cancellation_hash = p_signed_cancellation_hash,
      cancellation_deadline = v_service_eligible_at,
      service_eligible_at = v_service_eligible_at,
      cancellation_calendar_kind = v_template.cancellation_calendar_kind,
      signing_token_hash = null
  where id = p_agreement_id and status = 'sent';
  if not found then
    raise exception 'Prepared agreement packet changed before signing completed.';
  end if;

  insert into public.client_service_agreement_events (
    agreement_id, event_type, actor_type, actor_id, event_data, ip_address, user_agent
  ) values (
    p_agreement_id,
    'signed',
    'client',
    p_portal_user_id,
    coalesce(p_event_data, '{}'::jsonb) || jsonb_build_object(
      'documentHash', p_signed_document_hash,
      'disclosureHash', p_signed_disclosure_hash,
      'disclosurePath', p_signed_disclosure_path,
      'cancellationHash', p_signed_cancellation_hash,
      'cancellationPath', p_signed_cancellation_path,
      'cancellationCopiesDelivered', 2,
      'cancellationDeadline', v_service_eligible_at,
      'serviceEligibleAt', v_service_eligible_at,
      'cancellationCalendarKind', v_template.cancellation_calendar_kind,
      'signatureHash', v_agreement.signing_signature_sha256,
      'signingStartedAt', v_agreement.signing_started_at,
      'templateVersion', p_template_version
    ),
    nullif(p_ip_address, ''),
    nullif(p_user_agent, '')
  );

  update public.client_profiles
  set onboarding_complete = true,
      onboarding_step = greatest(coalesce(onboarding_step, 0), 4),
      agreement_signed_at = p_signed_at,
      agreement_pdf_path = p_signed_document_path
  where id = p_profile_id
    and user_id = p_portal_user_id
    and client_id = p_client_id;
  if not found then
    raise exception 'Portal profile changed before onboarding completed.';
  end if;

  return p_agreement_id;
end;
$$;

revoke all on function public.ccc_finalize_portal_service_agreement(
  uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb, jsonb, timestamptz,
  timestamptz, text, text, text, text, text, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.ccc_finalize_portal_service_agreement(
  uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb, jsonb, timestamptz,
  timestamptz, text, text, text, text, text, text, jsonb, text, text
) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.ccc_resolve_canonical_portal_identity(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ccc_resolve_canonical_portal_identity(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ccc_approve_service_agreement_template(text,uuid,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ccc_claim_portal_service_agreement_signing(uuid,uuid,uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege(
       'authenticated',
       'public.ccc_finalize_portal_service_agreement(uuid,uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,timestamptz,timestamptz,text,text,text,text,text,text,jsonb,text,text)',
       'EXECUTE'
     ) then
    raise exception 'Service-agreement v3 privileged RPCs must remain server-only';
  end if;
end $$;

comment on function public.ccc_resolve_canonical_portal_identity(uuid, text) is
  'Service-role-only exact Auth/profile/client identity gate. Optional modes require one sent approved v3 packet or immediate signed/grandfathered portal access.';
comment on function public.ccc_approve_service_agreement_template(text, uuid, text, text) is
  'Approves only the exact current v3 candidate after external counsel approval evidence and cancellation-calendar approval are recorded.';

commit;
