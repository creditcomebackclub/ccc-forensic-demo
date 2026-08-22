-- Additive service-agreement-only v2 candidate.
--
-- Compatibility contract:
--   * Existing v1 templates, packets, signed documents, and legacy LPOA
--     metadata are left unchanged and remain readable.
--   * V2 never writes an LPOA. It stores the service agreement and the
--     separately acknowledged consumer-rights disclosure as distinct files.
--   * V2 begins in counsel_review and cannot be used until counsel explicitly
--     changes legal_status after completing the remaining contract review.

alter table public.service_agreement_templates
  add column if not exists packet_kind text not null default 'legacy_service_agreement_lpoa',
  add column if not exists consumer_disclosure_html text,
  add column if not exists cancellation_notice_html text,
  add column if not exists cancellation_calendar_kind text not null default 'pending_counsel',
  add column if not exists approved_by uuid references auth.users(id) on delete restrict,
  add column if not exists approved_at timestamptz,
  add column if not exists approval_reference text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'service_agreement_templates_packet_kind_check'
      and conrelid = 'public.service_agreement_templates'::regclass
  ) then
    alter table public.service_agreement_templates
      add constraint service_agreement_templates_packet_kind_check
      check (packet_kind in ('legacy_service_agreement_lpoa', 'service_agreement_only'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'service_agreement_templates_cancellation_calendar_check'
      and conrelid = 'public.service_agreement_templates'::regclass
  ) then
    alter table public.service_agreement_templates
      add constraint service_agreement_templates_cancellation_calendar_check
      check (cancellation_calendar_kind in ('pending_counsel', 'weekdays_only_counsel_approved'));
  end if;
end $$;

alter table public.client_service_agreements
  add column if not exists document_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists signing_started_at timestamptz,
  add column if not exists signing_signature_sha256 text,
  add column if not exists signed_disclosure_path text,
  add column if not exists signed_disclosure_hash text,
  add column if not exists signed_cancellation_path text,
  add column if not exists signed_cancellation_hash text,
  add column if not exists cancellation_deadline timestamptz,
  add column if not exists service_eligible_at timestamptz,
  add column if not exists cancellation_calendar_kind text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_service_agreements_signing_claim_check'
      and conrelid = 'public.client_service_agreements'::regclass
  ) then
    alter table public.client_service_agreements
      add constraint client_service_agreements_signing_claim_check
      check (
        (signing_started_at is null and signing_signature_sha256 is null)
        or (
          signing_started_at is not null
          and signing_signature_sha256 is not null
          and signing_signature_sha256 ~ '^[0-9a-f]{64}$'
        )
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_service_agreements_v2_signed_artifacts_check'
      and conrelid = 'public.client_service_agreements'::regclass
  ) then
    alter table public.client_service_agreements
      add constraint client_service_agreements_v2_signed_artifacts_check
      check (
        template_version <> 'ccc-service-agreement-v2-service-only'
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
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_service_agreements_eligibility_order_check'
      and conrelid = 'public.client_service_agreements'::regclass
  ) then
    alter table public.client_service_agreements
      add constraint client_service_agreements_eligibility_order_check
      check (service_eligible_at is null or (signed_at is not null and service_eligible_at > signed_at));
  end if;
end $$;

comment on column public.service_agreement_templates.packet_kind is
  'Versioned packet behavior. Legacy packets retain LPOA compatibility; service_agreement_only packets never create or update LPOA data.';
comment on column public.service_agreement_templates.consumer_disclosure_html is
  'Separate CROA consumer-rights disclosure content. It is never embedded in the service-agreement document.';
comment on column public.client_service_agreements.document_snapshot is
  'Immutable agreement/disclosure source snapshot captured before signing.';
comment on column public.client_service_agreements.signing_started_at is
  'Server-frozen signing instant claimed before immutable artifact rendering; reused for exact retries.';
comment on column public.client_service_agreements.signing_signature_sha256 is
  'Lowercase SHA-256 of the client signature bytes bound to the frozen signing instant.';
comment on column public.client_service_agreements.signed_disclosure_path is
  'Private storage path for the separately signed consumer-rights disclosure.';
comment on column public.client_service_agreements.signed_cancellation_path is
  'Private storage path for one PDF containing both completed copies of the Notice of Cancellation.';
comment on column public.client_service_agreements.service_eligible_at is
  'Earliest server-calculated instant service work may begin after the cancellation period; independent from immediate portal access.';
comment on column public.service_agreement_templates.approval_reference is
  'Immutable owner/counsel approval record reference captured by the privileged approval RPC.';

-- Agreement source and evidence are server-owned. Authenticated staff may
-- review them, but browser sessions cannot publish legal copy, rewrite packet
-- ownership, or delete retained signed evidence.
drop policy if exists "staff_manage_service_agreement_templates" on public.service_agreement_templates;
drop policy if exists "staff_read_service_agreement_templates" on public.service_agreement_templates;
create policy "staff_read_service_agreement_templates"
on public.service_agreement_templates for select to authenticated
using (public.is_staff());

drop policy if exists "staff_manage_client_service_agreements" on public.client_service_agreements;
drop policy if exists "staff_read_client_service_agreements" on public.client_service_agreements;
create policy "staff_read_client_service_agreements"
on public.client_service_agreements for select to authenticated
using (public.is_staff());

create or replace function public.ccc_validate_service_agreement_template()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_combined text := coalesce(new.body_html, '') || E'\n' || coalesce(new.consumer_disclosure_html, '') || E'\n' || coalesce(new.cancellation_notice_html, '');
begin
  if tg_op = 'UPDATE' then
    if old.legal_status in ('approved', 'retired')
       and (new.version is distinct from old.version
            or new.title is distinct from old.title
            or new.packet_kind is distinct from old.packet_kind
            or new.body_html is distinct from old.body_html
            or new.consumer_disclosure_html is distinct from old.consumer_disclosure_html
            or new.cancellation_notice_html is distinct from old.cancellation_notice_html
            or new.cancellation_calendar_kind is distinct from old.cancellation_calendar_kind
            or new.effective_at is distinct from old.effective_at
            or new.approved_by is distinct from old.approved_by
            or new.approved_at is distinct from old.approved_at
            or new.approval_reference is distinct from old.approval_reference) then
      raise exception 'Approved agreement templates are immutable; create a new template version.';
    end if;
    if old.legal_status = 'retired' and new.legal_status <> 'retired' then
      raise exception 'Retired agreement templates cannot be reactivated.';
    end if;
    if old.legal_status = 'approved' and new.legal_status not in ('approved', 'retired') then
      raise exception 'Approved agreement templates may only remain approved or be retired.';
    end if;
  end if;
  if new.packet_kind = 'service_agreement_only' then
    if lower(v_combined) like '%limited power of attorney%'
       or lower(v_combined) like '%certified mail%'
       or v_combined like '%480-913-9172%' then
      raise exception 'Service-agreement-only templates cannot contain legacy LPOA, certified-mail, or retired-phone wording.';
    end if;

    if new.legal_status = 'approved' then
      if nullif(btrim(coalesce(new.body_html, '')), '') is null then
        raise exception 'Approved service-agreement-only templates require agreement text.';
      end if;
      if nullif(btrim(coalesce(new.consumer_disclosure_html, '')), '') is null then
        raise exception 'Approved service-agreement-only templates require a separate consumer-rights disclosure.';
      end if;
      if nullif(btrim(coalesce(new.cancellation_notice_html, '')), '') is null
         or position('{{cancellation_date}}' in new.cancellation_notice_html) = 0 then
        raise exception 'Approved service-agreement-only templates require a date-completable Notice of Cancellation.';
      end if;
      if new.cancellation_calendar_kind <> 'weekdays_only_counsel_approved' then
        raise exception 'Counsel must approve the cancellation-calendar policy before template approval.';
      end if;
      if new.approved_by is null or new.approved_at is null
         or nullif(btrim(coalesce(new.approval_reference, '')), '') is null then
        raise exception 'Approved templates require immutable approver, timestamp, and approval-reference evidence.';
      end if;
      if position('[PRINCIPAL BUSINESS ADDRESS REQUIRED BEFORE APPROVAL]' in v_combined) > 0 then
        raise exception 'Principal business address must be resolved before agreement approval.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ccc_validate_service_agreement_template_trigger
  on public.service_agreement_templates;
create trigger ccc_validate_service_agreement_template_trigger
before insert or update on public.service_agreement_templates
for each row execute function public.ccc_validate_service_agreement_template();

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
  if p_version <> 'ccc-service-agreement-v2-service-only' then
    raise exception 'Only the exact service-agreement-only v2 candidate may use this approval path.';
  end if;
  if p_cancellation_calendar_kind <> 'weekdays_only_counsel_approved' then
    raise exception 'Counsel-approved cancellation-calendar policy is required.';
  end if;
  if nullif(btrim(coalesce(p_approval_reference, '')), '') is null then
    raise exception 'A durable owner/counsel approval reference is required.';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_approved_by and p.role = 'admin'
  ) then
    raise exception 'Approval must be recorded by an authorized administrator.';
  end if;

  update public.service_agreement_templates
  set legal_status = 'approved',
      cancellation_calendar_kind = p_cancellation_calendar_kind,
      approved_by = p_approved_by,
      approved_at = now(),
      approval_reference = btrim(p_approval_reference),
      effective_at = coalesce(effective_at, now()),
      updated_at = now()
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

create or replace function public.ccc_protect_service_agreement_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'signed' then
    raise exception 'Signed agreement evidence is immutable.';
  end if;
  if new.user_id is distinct from old.user_id
     or new.client_id is distinct from old.client_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Agreement ownership and creation evidence are immutable.';
  end if;
  if old.signing_started_at is not null
     and (new.signing_started_at is distinct from old.signing_started_at
          or new.signing_signature_sha256 is distinct from old.signing_signature_sha256) then
    raise exception 'The claimed signing time and signature hash are immutable.';
  end if;
  if old.status = 'sent' and old.signing_started_at is not null
     and new.status not in ('sent', 'signed') then
    raise exception 'A claimed signing packet cannot be replaced while completion is in progress.';
  end if;
  if new.template_id is distinct from old.template_id
     or new.template_version is distinct from old.template_version
     or new.plan_snapshot is distinct from old.plan_snapshot
     or new.client_snapshot is distinct from old.client_snapshot
     or new.document_snapshot is distinct from old.document_snapshot then
    raise exception 'Agreement source snapshots are immutable; prepare a new versioned packet instead.';
  end if;
  if old.signed_document_path is not null
     and (new.signed_document_path is distinct from old.signed_document_path
          or new.signed_document_hash is distinct from old.signed_document_hash
          or new.signed_disclosure_path is distinct from old.signed_disclosure_path
          or new.signed_disclosure_hash is distinct from old.signed_disclosure_hash
          or new.signed_cancellation_path is distinct from old.signed_cancellation_path
          or new.signed_cancellation_hash is distinct from old.signed_cancellation_hash
          or new.cancellation_deadline is distinct from old.cancellation_deadline
          or new.service_eligible_at is distinct from old.service_eligible_at
          or new.cancellation_calendar_kind is distinct from old.cancellation_calendar_kind) then
    raise exception 'Signed agreement artifacts are immutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists ccc_protect_service_agreement_snapshot_trigger
  on public.client_service_agreements;
create trigger ccc_protect_service_agreement_snapshot_trigger
before update on public.client_service_agreements
for each row execute function public.ccc_protect_service_agreement_snapshot();

create or replace function public.ccc_preserve_signed_service_agreement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'signed' then
    raise exception 'Signed agreement evidence must be retained and cannot be deleted.';
  end if;
  return old;
end;
$$;

drop trigger if exists ccc_preserve_signed_service_agreement_trigger
  on public.client_service_agreements;
create trigger ccc_preserve_signed_service_agreement_trigger
before delete on public.client_service_agreements
for each row execute function public.ccc_preserve_signed_service_agreement();

-- Link an Auth identity to exactly one client inside a database transaction.
-- This rejects staff/affiliate identities and conflicting email, user, or
-- client ownership before the portal magic link is sent.
create or replace function public.ccc_link_portal_profile_for_onboarding(
  p_portal_user_id uuid,
  p_client_id uuid,
  p_email text,
  p_full_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_full_name, ''));
  v_client public.clients%rowtype;
  v_existing public.client_profiles%rowtype;
  v_profile_id uuid;
  v_zero uuid := '00000000-0000-0000-0000-000000000000'::uuid;
begin
  if p_portal_user_id is null or p_client_id is null or v_email = '' or v_name = '' then
    raise exception 'Portal user, client, email, and legal name are required.';
  end if;

  -- Serialize every candidate identity dimension so parallel onboarding
  -- requests cannot create split ownership across otherwise unique fields.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ccc-portal-user:' || p_portal_user_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ccc-portal-client:' || p_client_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ccc-portal-email:' || v_email, 0));

  select * into v_client
  from public.clients
  where id = p_client_id
  for update;
  if not found or lower(btrim(coalesce(v_client.email, ''))) <> v_email then
    raise exception 'Portal identity does not match the saved client email.';
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = p_portal_user_id and lower(btrim(coalesce(u.email, ''))) = v_email
  ) then
    raise exception 'Auth identity does not match the saved client email.';
  end if;
  if exists (
    select 1 from public.profiles p
    where p.id = p_portal_user_id and p.role <> 'client'
  ) or exists (
    select 1 from public.affiliates a where a.user_id = p_portal_user_id
  ) then
    raise exception 'A staff or affiliate identity cannot be linked to a client portal.';
  end if;

  for v_existing in
    select * from public.client_profiles cp
    where cp.user_id = p_portal_user_id
       or lower(btrim(cp.email)) = v_email
       or cp.client_id = p_client_id
    order by cp.id
    for update
  loop
    if v_profile_id is not null and v_profile_id <> v_existing.id then
      raise exception 'Conflicting client portal profile records require staff resolution.';
    end if;
    if v_existing.user_id is not null
       and v_existing.user_id <> v_zero
       and v_existing.user_id <> p_portal_user_id then
      raise exception 'This client portal is already linked to another Auth identity.';
    end if;
    if v_existing.client_id is not null and v_existing.client_id <> p_client_id then
      raise exception 'This email or Auth identity is already linked to another client.';
    end if;
    if lower(btrim(v_existing.email)) <> v_email then
      raise exception 'This client already has a different portal email.';
    end if;
    v_profile_id := v_existing.id;
  end loop;

  if v_profile_id is null then
    insert into public.client_profiles (
      user_id, client_id, full_name, email, onboarding_complete, onboarding_step
    ) values (
      p_portal_user_id, p_client_id, v_name, v_email, false, 0
    ) returning id into v_profile_id;
  else
    update public.client_profiles
    set user_id = p_portal_user_id,
        client_id = p_client_id,
        full_name = v_name,
        email = v_email
    where id = v_profile_id;
  end if;

  insert into public.profiles (id, full_name, email, role)
  values (p_portal_user_id, v_name, v_email, 'client')
  on conflict (id) do update
  set full_name = excluded.full_name,
      email = excluded.email
  where public.profiles.role = 'client';

  return v_profile_id;
end;
$$;

revoke all on function public.ccc_link_portal_profile_for_onboarding(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.ccc_link_portal_profile_for_onboarding(uuid, uuid, text, text)
  to service_role;

-- Claim one deterministic signing instant and signature before any immutable
-- PDF upload. Exact retries receive the same timestamp; a competing or redrawn
-- signature cannot replace the first claim.
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
  v_agreement public.client_service_agreements%rowtype;
  v_template public.service_agreement_templates%rowtype;
  v_firm_user_id uuid;
  v_claimed_at timestamptz;
begin
  if coalesce(p_signature_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Signature hash must be a lowercase SHA-256 value.';
  end if;
  if not exists (
    select 1 from public.client_profiles cp
    where cp.id = p_profile_id
      and cp.user_id = p_portal_user_id
      and cp.client_id = p_client_id
  ) then
    raise exception 'Portal profile is not linked to this client.';
  end if;

  select * into v_agreement
  from public.client_service_agreements
  where id = p_agreement_id
  for update;
  if not found then
    raise exception 'Prepared agreement packet was not found.';
  end if;
  if v_agreement.status not in ('sent', 'signed')
     or v_agreement.client_id <> p_client_id
     or v_agreement.template_version <> 'ccc-service-agreement-v2-service-only' then
    raise exception 'Exact prepared service-agreement packet is not available for signing.';
  end if;
  if v_agreement.sent_at is null or v_agreement.sent_at > now() then
    raise exception 'Prepared agreement packet has not been delivered.';
  end if;
  if v_agreement.status = 'sent'
     and v_agreement.signing_expires_at is not null
     and v_agreement.signing_expires_at <= now() then
    raise exception 'Prepared agreement packet has expired.';
  end if;

  select c.user_id into v_firm_user_id
  from public.clients c
  where c.id = p_client_id
  for update;
  if v_firm_user_id is null or v_agreement.user_id <> v_firm_user_id then
    raise exception 'Agreement packet ownership does not match this client.';
  end if;
  if not exists (
    select 1 from public.documents d
    where d.user_id = v_firm_user_id and d.client_id = p_client_id and d.doc_type = 'id'
  ) or not exists (
    select 1 from public.documents d
    where d.user_id = v_firm_user_id and d.client_id = p_client_id and d.doc_type = 'address'
  ) then
    raise exception 'Government ID and proof of address are required before signing.';
  end if;

  select * into v_template
  from public.service_agreement_templates t
  where t.id = v_agreement.template_id
    and t.version = v_agreement.template_version
    and t.packet_kind = 'service_agreement_only'
    and t.legal_status = 'approved'
    and t.approved_by is not null
    and t.approved_at is not null
    and nullif(btrim(coalesce(t.approval_reference, '')), '') is not null
    and t.cancellation_calendar_kind = 'weekdays_only_counsel_approved';
  if not found then
    raise exception 'The exact service-agreement-only template is not approved.';
  end if;
  if jsonb_typeof(v_agreement.plan_snapshot) is distinct from 'object'
     or jsonb_typeof(v_agreement.client_snapshot) is distinct from 'object'
     or jsonb_typeof(v_agreement.document_snapshot) is distinct from 'object'
     or nullif(btrim(v_agreement.client_snapshot->>'name'), '') is null
     or v_agreement.document_snapshot->>'templateVersion' is distinct from v_template.version
     or v_agreement.document_snapshot->>'packetKind' is distinct from v_template.packet_kind
     or v_agreement.document_snapshot->>'agreementBodyHtml' is distinct from v_template.body_html
     or v_agreement.document_snapshot->>'consumerDisclosureHtml' is distinct from v_template.consumer_disclosure_html
     or v_agreement.document_snapshot->>'cancellationNoticeHtml' is distinct from v_template.cancellation_notice_html
     or v_agreement.document_snapshot->>'cancellationCalendarKind' is distinct from v_template.cancellation_calendar_kind then
    raise exception 'Prepared agreement snapshots do not match the approved source.';
  end if;

  if v_agreement.signing_started_at is not null then
    if v_agreement.signing_signature_sha256 = p_signature_sha256 then
      return v_agreement.signing_started_at;
    end if;
    raise exception 'A different signature is already bound to this signing packet.';
  end if;
  if v_agreement.status = 'signed' then
    raise exception 'Signed agreement is missing its immutable signing claim.';
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

insert into public.service_agreement_templates (
  version,
  title,
  legal_status,
  packet_kind,
  body_html,
  consumer_disclosure_html,
  cancellation_notice_html,
  cancellation_calendar_kind
)
values (
  'ccc-service-agreement-v2-service-only',
  'CCC Client Service Agreement',
  'counsel_review',
  'service_agreement_only',
  $agreement$
<h3>1. PARTIES &amp; EFFECTIVE DATE</h3>
<p>This Credit Repair Services Agreement ("Agreement") is entered into as of the date signed between:</p>
<p><strong>Service Provider:</strong> Credit Comeback Club<br>
<strong>Principal business address:</strong> 3088 Colorado Ave, Grand Junction, CO 81504<br>
<strong>Phone:</strong> 970-644-0063<br>
<strong>Web:</strong> creditcomebackclub.com</p>
<p><strong>Client:</strong> The client identified in this versioned agreement packet.</p>
<p>Together referred to as the "Parties."</p>

<h3>2. SEPARATE CONSUMER RIGHTS DISCLOSURE</h3>
<p>Before executing this Agreement, Client receives a separate document titled <em>Consumer Credit File Rights Under State and Federal Law</em>. Client's acknowledgment of receipt is signed and retained separately from this Agreement.</p>

<h3>3. SELECTED SERVICE PLAN</h3>
<p>The Client's selected plan appears in the versioned summary immediately before these terms. That summary identifies only this Client's saved plan name, service term, monthly or flat service price, First Work Fee, and exact fee terms. The summary is part of this Agreement and cannot be changed after the packet is prepared; later billing changes require a new agreement packet.</p>

<h3>4. SCOPE OF SERVICES</h3>
<p>Credit Comeback Club agrees to provide the following services based on the Client's reviewed file:</p>
<ul>
  <li>Review Client-provided credit-file materials as needed to prepare dispute correspondence concerning information the Client identifies in good faith as inaccurate, incomplete, unverifiable, or otherwise lawfully disputable.</li>
  <li>Prepare and send dispute correspondence to consumer reporting agencies and, when appropriate, directly to furnishers or debt collectors as required by the reviewed file.</li>
  <li>Provide status updates through the client portal.</li>
</ul>
<p>The recipient, timing, and sequence of dispute correspondence may vary by account, bureau, furnisher, debt collector, and the circumstances of the Client's file. Credit Comeback Club does not guarantee any deletion, correction, credit-score increase, response time, or other specific result.</p>

<h3>5. SERVICES NOT PROVIDED</h3>
<p>Credit Comeback Club does not provide the following, and Client agrees not to request them:</p>
<ul>
  <li>Legal representation or legal advice.</li>
  <li>Guaranteed removal of any specific account or derogatory item.</li>
  <li>Creation of a new credit identity or use of alternate identification numbers.</li>
  <li>Disputes of information the Client knows to be accurate, current, complete, and verifiable.</li>
</ul>

<h3>6. CLIENT OBLIGATIONS</h3>
<p>Client agrees to:</p>
<ul>
  <li>Provide accurate and complete personal information, including legal name, address, Social Security Number, and date of birth, for identity-verification purposes.</li>
  <li>Promptly provide copies of credit reports, correspondence from creditors, debt collectors, furnishers, or bureaus, and any other documents requested by Credit Comeback Club.</li>
  <li>Forward all written responses from creditors, debt collectors, furnishers, or bureaus to Credit Comeback Club within 5 business days of receipt.</li>
  <li>Refrain from independently disputing accounts being actively worked under this Agreement without prior written notice, as this may interfere with the dispute process.</li>
  <li>Maintain a valid email address and login access to the client portal.</li>
  <li>Notify Credit Comeback Club of material changes that may affect the dispute process.</li>
</ul>

<h3>7. FEES, PAYMENT &amp; BILLING</h3>
<p><strong>Free pre-client assessment:</strong> The credit-report audit and Recovery Blueprint provided before enrollment are a free pre-client assessment. They are not paid First Work and do not trigger any fee.</p>
<p><strong>Selected prices:</strong> The versioned selected-plan summary states this Client's exact First Work Fee and monthly or flat service price. The free pre-client assessment is not included in the First Work Fee.</p>
<p>Completing onboarding, signing this Agreement, or accessing the client portal does not itself initiate an automatic charge. Invoices, payment authorizations, and completed-service records are handled separately through Credit Comeback Club's billing process. A $25 returned payment fee applies to declined or reversed transactions. Accounts more than 7 days past due may be suspended.</p>

<h3>8. CROA ADVANCE FEE COMPLIANCE</h3>
<p>The free pre-client audit and Recovery Blueprint do not trigger a fee. Credit Comeback Club will maintain billing and completed-service records and will charge or receive fees only as permitted by applicable law. The selected-plan prices in this Agreement do not replace the separate billing record for a particular completed service.</p>

<h3>9. RIGHT TO CANCEL &amp; CANCELLATION POLICY</h3>
<p><strong>3-Day Right to Cancel:</strong> Client may cancel this Agreement without penalty within three (3) business days of signing by submitting written notice to Credit Comeback Club by email to info@creditcomebackclub.com or by mail to Credit Comeback Club, 3088 Colorado Ave, Grand Junction, CO 81504. A full refund of any fees paid will be issued within 10 business days of receipt of cancellation notice.</p>
<p><strong>Cancellation After 3-Day Period:</strong></p>
<ul>
  <li><strong>Standard &amp; VIP Plans:</strong> Client may cancel at any time with written notice. No refund of the current month's fee is issued once that service period has begun. Cancellation takes effect at the end of the current billing period.</li>
  <li><strong>Paid in Full:</strong> Non-refundable after the 3-day cancellation window once dispute work has commenced. Unused months are forfeited upon cancellation.</li>
</ul>
<p>To cancel, email info@creditcomebackclub.com with subject line "SERVICE CANCELLATION - [Your Full Name]."</p>

<h3>10. NO GUARANTEE OF RESULTS</h3>
<p>Credit Comeback Club makes no guarantee, warranty, or representation that Client's credit score will improve by any specific amount or that any specific account will be removed from Client's credit report. Results depend on individual credit profiles, recipient responses, investigation processes, and factors outside Credit Comeback Club's control.</p>

<h3>11. TERM OF AGREEMENT</h3>
<p>This Agreement continues for the service term stated in the Client's immutable selected-plan summary unless cancelled under Section 9. Services cease when that stated term ends unless Client enrolls under a new agreement.</p>

<h3>12. DISPUTE PROCESS ACKNOWLEDGMENT</h3>
<p>Client understands that Credit Comeback Club may dispute information with one or more consumer reporting agencies and may also communicate directly with furnishers or debt collectors when appropriate. Different accounts may require different dispute sequences, and separate correspondence may be prepared for different accounts, bureaus, furnishers, or debt collectors.</p>
<p>Client acknowledges that:</p>
<ul>
  <li>Credit Comeback Club disputes only information the Client identifies in good faith as inaccurate, incomplete, unverifiable, or otherwise lawfully disputable.</li>
  <li>Accurate, current, and verifiable information is not required to be removed solely because it is disputed.</li>
  <li>Recipients control their investigation and response timing, and Credit Comeback Club cannot guarantee a particular response or result.</li>
  <li>Unresolved items may require additional correspondence or review.</li>
</ul>

<h3>13. CONFIDENTIALITY</h3>
<p>Credit Comeback Club agrees to maintain the confidentiality of all personally identifiable information provided by Client, including Social Security Numbers, financial account data, and credit report contents. Such information will not be sold, rented, or disclosed to third parties except as required to perform dispute services or as required by law.</p>

<h3>14. LIMITATION OF LIABILITY</h3>
<p>Credit Comeback Club's total liability under this Agreement shall not exceed the total fees paid by Client in the 90 days preceding the claim. Credit Comeback Club shall not be liable for indirect, incidental, or consequential damages, including loss of credit opportunity, loan denials, or reputational harm arising from the credit repair process or third-party responses to disputes.</p>

<h3>15. GOVERNING LAW &amp; DISPUTE RESOLUTION</h3>
<p>This Agreement is governed by the laws of the State of Colorado and applicable federal law, including the Credit Repair Organizations Act (15 U.S.C. § 1679 et seq.) and the Fair Credit Reporting Act (15 U.S.C. § 1681 et seq.). Any dispute arising from this Agreement shall first be submitted to good-faith negotiation. If unresolved, disputes shall be submitted to binding arbitration in Mesa County, Colorado under the rules of the American Arbitration Association. Nothing in this section limits Client's right to file a complaint with the Consumer Financial Protection Bureau or applicable state regulators.</p>

<h3>16. ENTIRE AGREEMENT &amp; AMENDMENTS</h3>
<p>This Agreement constitutes the entire agreement between the Parties with respect to credit repair services and supersedes all prior representations, discussions, or agreements. Any amendment must be in writing and signed by both Parties. Oral modifications are not binding.</p>

<h3>17. SEVERABILITY</h3>
<p>If any provision of this Agreement is found invalid or unenforceable by a court of competent jurisdiction, the remaining provisions shall continue in full force and effect.</p>

<h3>18. SIGNATURE</h3>
<p>By signing, Client acknowledges that Client has read, understood, and agrees to the terms of this Agreement, including the selected plan, No Guarantee provision, and Right to Cancel.</p>
<p><strong>You may cancel this contract without penalty or obligation at any time before midnight of the 3rd business day after the date on which you signed the contract. See the attached notice of cancellation form for an explanation of this right.</strong></p>
  $agreement$,
  $disclosure$
<h2>Consumer Credit File Rights Under State and Federal Law</h2>
<p>You have a right to dispute inaccurate information in your credit report by contacting the credit bureau directly. However, neither you nor any "credit repair" company or credit repair organization has the right to have accurate, current, and verifiable information removed from your credit report. The credit bureau must remove accurate, negative information from your report only if it is over 7 years old. Bankruptcy information can be reported for 10 years.</p>
<p>You have a right to obtain a copy of your credit report from a credit bureau. You may be charged a reasonable fee. There is no fee, however, if you have been turned down for credit, employment, insurance, or a rental dwelling because of information in your credit report within the preceding 60 days. The credit bureau must provide someone to help you interpret the information in your credit file.</p>
<p>You are entitled to receive a free copy of your credit report if you are unemployed and intend to apply for employment in the next 60 days, if you are a recipient of public welfare assistance, or if you have reason to believe that there is inaccurate information in your credit report due to fraud.</p>
<p>You have a right to sue a credit repair organization that violates the Credit Repair Organization Act. This law prohibits deceptive practices by credit repair organizations.</p>
<p>You have the right to cancel your contract with any credit repair organization for any reason within 3 business days from the date you signed it.</p>
<p>Credit bureaus are required to follow reasonable procedures to ensure that the information they report is accurate. However, mistakes may occur.</p>
<p>You may, on your own, notify a credit bureau in writing that you dispute the accuracy of information in your credit file. The credit bureau must then reinvestigate and modify or remove inaccurate or incomplete information. The credit bureau may not charge any fee for this service. Any pertinent information and copies of all documents you have concerning an error should be given to the credit bureau.</p>
<p>If the credit bureau's reinvestigation does not resolve the dispute to your satisfaction, you may send a brief statement to the credit bureau, to be kept in your file, explaining why you think the record is inaccurate. The credit bureau must include a summary of your statement about disputed information with any report it issues about you.</p>
<p>The Federal Trade Commission regulates credit bureaus and credit repair organizations. For more information contact:</p>
<p>The Public Reference Branch<br>Federal Trade Commission<br>Washington, D.C. 20580</p>
  $disclosure$,
  $cancellation$
<h2>Notice of Cancellation</h2>
<p><strong>You may cancel this contract, without any penalty or obligation, at any time before midnight of the 3rd day which begins after the date the contract is signed by you.</strong></p>
<p><strong>To cancel this contract, mail or deliver a signed, dated copy of this cancellation notice, or any other written notice to Credit Comeback Club at 3088 Colorado Ave, Grand Junction, CO 81504 before midnight on {{cancellation_date}}.</strong></p>
<p><strong>I hereby cancel this transaction,</strong></p>
<p><strong>Date: ______________________________</strong></p>
<p><strong>Purchaser's signature: ______________________________</strong></p>
  $cancellation$,
  'pending_counsel'
)
on conflict (version) do nothing;

create or replace function public.ccc_weekday_service_eligible_at(p_signed_at timestamptz)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_day date;
  v_count integer := 0;
begin
  if p_signed_at is null then
    raise exception 'Signing time is required.';
  end if;
  v_day := (p_signed_at at time zone 'America/Phoenix')::date;
  while v_count < 3 loop
    v_day := v_day + 1;
    if extract(isodow from v_day) between 1 and 5 then
      v_count := v_count + 1;
    end if;
  end loop;
  return ((v_day + 1)::timestamp at time zone 'America/Phoenix');
end;
$$;

revoke all on function public.ccc_weekday_service_eligible_at(timestamptz)
  from public, anon, authenticated;
grant execute on function public.ccc_weekday_service_eligible_at(timestamptz)
  to service_role;

-- Atomic portal finalization. The staff path creates and snapshots the sent
-- packet first; this service-role-only RPC can sign only that exact row.
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
  v_template public.service_agreement_templates%rowtype;
  v_profile public.client_profiles%rowtype;
  v_agreement public.client_service_agreements%rowtype;
  v_firm_user_id uuid;
  v_expected_prefix text;
  v_service_eligible_at timestamptz;
begin
  if p_template_version <> 'ccc-service-agreement-v2-service-only' then
    raise exception 'Only the exact service-agreement-only v2 template can complete portal onboarding.';
  end if;
  if p_signed_at is null or p_signed_at > now() + interval '5 minutes' then
    raise exception 'A valid signing time is required.';
  end if;
  if coalesce(p_signed_document_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_signed_disclosure_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_signed_cancellation_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Signed document hashes must be lowercase SHA-256 values.';
  end if;

  select * into v_profile
  from public.client_profiles
  where id = p_profile_id
    and user_id = p_portal_user_id
    and client_id = p_client_id
  for update;
  if not found then
    raise exception 'Portal profile is not linked to this client.';
  end if;

  select * into v_agreement
  from public.client_service_agreements
  where id = p_agreement_id
  for update;
  if not found then
    raise exception 'Prepared agreement packet was not found.';
  end if;
  if v_agreement.status not in ('sent', 'signed') then
    raise exception 'Prepared agreement packet is not available for signing.';
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

  select c.user_id into v_firm_user_id
  from public.clients c
  where c.id = p_client_id
  for update;
  if v_firm_user_id is null then
    raise exception 'Client is not linked to a firm account.';
  end if;

  if not exists (
    select 1 from public.documents d
    where d.user_id = v_firm_user_id and d.client_id = p_client_id and d.doc_type = 'id'
  ) or not exists (
    select 1 from public.documents d
    where d.user_id = v_firm_user_id and d.client_id = p_client_id and d.doc_type = 'address'
  ) then
    raise exception 'Government ID and proof of address are required before onboarding can be completed.';
  end if;

  select * into v_template
  from public.service_agreement_templates
  where id = p_template_id
    and version = p_template_version
    and packet_kind = 'service_agreement_only'
    and legal_status = 'approved'
    and cancellation_calendar_kind = 'weekdays_only_counsel_approved';
  if not found then
    raise exception 'The exact service-agreement-only template is not approved.';
  end if;
  if position('[PRINCIPAL BUSINESS ADDRESS REQUIRED BEFORE APPROVAL]' in coalesce(v_template.body_html, '')) > 0 then
    raise exception 'Principal business address must be resolved before signing.';
  end if;
  if p_document_snapshot->>'templateVersion' is distinct from v_template.version
     or p_document_snapshot->>'packetKind' is distinct from v_template.packet_kind
     or p_document_snapshot->>'agreementBodyHtml' is distinct from v_template.body_html
     or p_document_snapshot->>'consumerDisclosureHtml' is distinct from v_template.consumer_disclosure_html
     or p_document_snapshot->>'cancellationNoticeHtml' is distinct from v_template.cancellation_notice_html
     or p_document_snapshot->>'cancellationCalendarKind' is distinct from v_template.cancellation_calendar_kind then
    raise exception 'Agreement source snapshot does not match the approved template.';
  end if;
  if v_agreement.user_id <> v_firm_user_id
     or v_agreement.client_id <> p_client_id
     or v_agreement.template_id <> p_template_id
     or v_agreement.template_version <> p_template_version
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

-- Rollback is intentionally non-destructive: switch application readers back
-- to v1 and retire this v2 row. Drop the v2 row only when no packet references
-- it; keep additive columns, snapshots, events, and signed files for audit.
