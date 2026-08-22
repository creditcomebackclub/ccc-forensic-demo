-- Give affiliate e-signing one server-claimed timestamp and immutable signing
-- material. The PDF, final signature hash, agreement row, and append-only event
-- must all use that exact timestamp.
--
-- Compatibility: already-signed agreements remain valid historical evidence.
-- New sent packets must claim before completion. No existing row is deleted.
-- Rollback: restore the 20260820380000 completion RPC and packet trigger, drop
-- the claim RPC, then drop the two nullable signing-claim columns/constraint.

begin;

alter table public.affiliate_agreements
  add column if not exists signing_started_at timestamptz,
  add column if not exists signing_material_sha256 text;

alter table public.affiliate_agreements
  drop constraint if exists affiliate_agreements_signing_claim_complete,
  add constraint affiliate_agreements_signing_claim_complete check (
    (signing_started_at is null and signing_material_sha256 is null)
    or (
      signing_started_at is not null
      and signing_material_sha256 ~ '^[0-9a-f]{64}$'
    )
  );

create or replace function public.protect_affiliate_agreement_packet()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.affiliate_id is distinct from old.affiliate_id
     or new.application_id is distinct from old.application_id
     or new.owner_user_id is distinct from old.owner_user_id
     or new.template_id is distinct from old.template_id
     or new.template_version is distinct from old.template_version
     or new.applicant_snapshot is distinct from old.applicant_snapshot
     or new.compensation_snapshot is distinct from old.compensation_snapshot
     or new.document_snapshot is distinct from old.document_snapshot
     or new.created_by is distinct from old.created_by then
    raise exception 'Affiliate agreement source snapshots are immutable.';
  end if;
  if old.signing_started_at is not null and (
     new.signing_started_at is distinct from old.signing_started_at
     or new.signing_material_sha256 is distinct from old.signing_material_sha256) then
    raise exception 'Affiliate signing claim is immutable.';
  end if;
  if old.signed_at is not null and (
     new.signed_at is distinct from old.signed_at
     or new.signer_name is distinct from old.signer_name
     or new.signer_ip is distinct from old.signer_ip
     or new.signer_user_agent is distinct from old.signer_user_agent
     or new.signature_sha256 is distinct from old.signature_sha256
     or new.signed_document_path is distinct from old.signed_document_path
     or new.signed_document_hash is distinct from old.signed_document_hash) then
    raise exception 'Signed affiliate agreement evidence is immutable.';
  end if;
  new.updated_at := current_timestamp;
  return new;
end;
$$;

drop function if exists public.ccc_claim_affiliate_agreement_signing(uuid, uuid, text);

create or replace function public.ccc_claim_affiliate_agreement_signing(
  p_agreement_id uuid,
  p_portal_user_id uuid,
  p_signing_material_sha256 text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agreement public.affiliate_agreements%rowtype;
  v_template public.affiliate_agreement_templates%rowtype;
  v_claimed_at timestamptz := current_timestamp;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required';
  end if;
  if coalesce(p_signing_material_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid signing material hash';
  end if;

  select * into v_agreement
  from public.affiliate_agreements
  where id = p_agreement_id
  for update;
  if not found then raise exception 'Affiliate agreement not found'; end if;
  select * into v_template
  from public.affiliate_agreement_templates
  where id = v_agreement.template_id;

  if v_agreement.status = 'signed'
     and v_agreement.portal_user_id = p_portal_user_id
     and v_agreement.signing_started_at is not null
     and v_agreement.signing_material_sha256 = p_signing_material_sha256 then
    return to_char(
      v_agreement.signing_started_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    );
  end if;
  if v_agreement.status <> 'sent'
     or v_agreement.portal_user_id is distinct from p_portal_user_id then
    raise exception 'Agreement is not available to this signer';
  end if;
  if v_agreement.signing_expires_at is null
     or v_agreement.signing_expires_at <= current_timestamp then
    raise exception 'Agreement signing window expired';
  end if;
  if v_template.legal_status <> 'approved'
     or v_agreement.document_snapshot ->> 'legalStatus' <> 'approved'
     or v_agreement.document_snapshot ->> 'contentSha256' <> v_template.content_sha256
     or encode(digest(v_agreement.document_snapshot ->> 'bodyHtml', 'sha256'), 'hex') <> v_template.content_sha256 then
    raise exception 'COUNSEL_APPROVAL_REQUIRED';
  end if;

  if v_agreement.signing_started_at is not null then
    if v_agreement.signing_material_sha256 = p_signing_material_sha256 then
      return to_char(
        v_agreement.signing_started_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      );
    end if;
    raise exception 'A different signature was already claimed for this agreement';
  end if;

  update public.affiliate_agreements
  set signing_started_at = v_claimed_at,
      signing_material_sha256 = p_signing_material_sha256
  where id = p_agreement_id
    and status = 'sent'
    and signing_started_at is null;
  if not found then raise exception 'Agreement signing claim changed concurrently'; end if;
  return to_char(
    v_claimed_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
  );
end;
$$;

drop function if exists public.ccc_complete_affiliate_agreement(
  uuid, uuid, text, inet, text, text, text, text, jsonb
);

create or replace function public.ccc_complete_affiliate_agreement(
  p_agreement_id uuid,
  p_portal_user_id uuid,
  p_signed_at timestamptz,
  p_signer_name text,
  p_signer_ip inet,
  p_user_agent text,
  p_signing_material_sha256 text,
  p_signature_sha256 text,
  p_signed_document_path text,
  p_signed_document_hash text,
  p_event_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agreement public.affiliate_agreements%rowtype;
  v_template public.affiliate_agreement_templates%rowtype;
  v_event_signed_at timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required';
  end if;
  select * into v_agreement
  from public.affiliate_agreements
  where id = p_agreement_id
  for update;
  if not found then raise exception 'Affiliate agreement not found'; end if;
  select * into v_template
  from public.affiliate_agreement_templates
  where id = v_agreement.template_id;

  if v_agreement.status = 'signed' then
    if v_agreement.portal_user_id = p_portal_user_id
       and v_agreement.signed_at = p_signed_at
       and v_agreement.signing_material_sha256 = p_signing_material_sha256
       and v_agreement.signature_sha256 = p_signature_sha256
       and v_agreement.signed_document_path = p_signed_document_path
       and v_agreement.signed_document_hash = p_signed_document_hash then
      return jsonb_build_object(
        'agreementId', v_agreement.id,
        'affiliateId', v_agreement.affiliate_id,
        'status', 'signed',
        'signedAt', v_agreement.signed_at,
        'idempotent', true
      );
    end if;
    raise exception 'Signed affiliate evidence does not match the existing immutable record';
  end if;
  if v_agreement.status <> 'sent'
     or v_agreement.portal_user_id is distinct from p_portal_user_id then
    raise exception 'Agreement is not available to this signer';
  end if;
  if v_agreement.signing_expires_at is null
     or v_agreement.signing_expires_at <= current_timestamp then
    raise exception 'Agreement signing window expired';
  end if;
  if v_agreement.signing_started_at is null
     or p_signed_at is distinct from v_agreement.signing_started_at
     or p_signing_material_sha256 is distinct from v_agreement.signing_material_sha256 then
    raise exception 'Signing timestamp or material does not match the server claim';
  end if;
  if v_template.legal_status <> 'approved'
     or v_agreement.document_snapshot ->> 'legalStatus' <> 'approved'
     or v_agreement.document_snapshot ->> 'contentSha256' <> v_template.content_sha256
     or encode(digest(v_agreement.document_snapshot ->> 'bodyHtml', 'sha256'), 'hex') <> v_template.content_sha256 then
    raise exception 'COUNSEL_APPROVAL_REQUIRED';
  end if;
  if length(btrim(coalesce(p_signer_name, ''))) < 2 then
    raise exception 'Signer legal name required';
  end if;
  if coalesce(p_signing_material_sha256, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_signature_sha256, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_signed_document_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid signing evidence hash';
  end if;
  if coalesce(p_event_data #>> '{acknowledgements,affiliate_agreement}', 'false') <> 'true'
     or coalesce(p_event_data #>> '{acknowledgements,compensation_terms}', 'false') <> 'true'
     or coalesce(p_event_data #>> '{acknowledgements,electronic_records}', 'false') <> 'true' then
    raise exception 'All affiliate agreement acknowledgements are required';
  end if;
  begin
    v_event_signed_at := (p_event_data ->> 'acceptedAt')::timestamptz;
  exception when others then
    raise exception 'The signing event timestamp is invalid';
  end;
  if v_event_signed_at is distinct from p_signed_at then
    raise exception 'The signing event timestamp does not match the server claim';
  end if;
  if left(
       coalesce(p_signed_document_path, ''),
       length('affiliate-agreements/' || v_agreement.owner_user_id || '/' || v_agreement.affiliate_id || '/' || v_agreement.id || '/')
     ) <> 'affiliate-agreements/' || v_agreement.owner_user_id || '/' || v_agreement.affiliate_id || '/' || v_agreement.id || '/' then
    raise exception 'Signed document storage path is outside the agreement scope';
  end if;

  update public.affiliate_agreements
  set status = 'signed',
      signed_at = p_signed_at,
      signer_name = btrim(p_signer_name),
      signer_ip = p_signer_ip,
      signer_user_agent = left(coalesce(p_user_agent, ''), 500),
      signature_sha256 = p_signature_sha256,
      signed_document_path = p_signed_document_path,
      signed_document_hash = p_signed_document_hash
  where id = p_agreement_id
    and status = 'sent'
    and signing_started_at = p_signed_at
    and signing_material_sha256 = p_signing_material_sha256
  returning * into v_agreement;
  if not found then raise exception 'Affiliate signing state changed concurrently'; end if;

  update public.affiliates
  set program_status = 'agreement_signed',
      status_changed_at = p_signed_at
  where id = v_agreement.affiliate_id
    and program_status not in ('legacy_active', 'active');

  insert into public.affiliate_agreement_events (
    agreement_id,
    event_type,
    actor_type,
    actor_id,
    event_data,
    created_at
  ) values (
    p_agreement_id,
    'signed',
    'affiliate',
    p_portal_user_id,
    p_event_data || jsonb_build_object(
      'documentHash', p_signed_document_hash,
      'signatureHash', p_signature_sha256,
      'signingMaterialHash', p_signing_material_sha256,
      'signedAt', p_signed_at
    ),
    p_signed_at
  );

  return jsonb_build_object(
    'agreementId', v_agreement.id,
    'affiliateId', v_agreement.affiliate_id,
    'status', 'signed',
    'signedAt', p_signed_at,
    'awaitingActivation', true
  );
end;
$$;

revoke all on function public.ccc_claim_affiliate_agreement_signing(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.ccc_complete_affiliate_agreement(
  uuid, uuid, timestamptz, text, inet, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.ccc_claim_affiliate_agreement_signing(uuid, uuid, text)
  to service_role;
grant execute on function public.ccc_complete_affiliate_agreement(
  uuid, uuid, timestamptz, text, inet, text, text, text, text, text, jsonb
) to service_role;

comment on function public.ccc_claim_affiliate_agreement_signing(uuid, uuid, text) is
  'Service-only idempotent claim that freezes the authoritative affiliate signing timestamp and signature material hash, returning canonical UTC text with PostgreSQL microseconds intact.';
comment on function public.ccc_complete_affiliate_agreement(
  uuid, uuid, timestamptz, text, inet, text, text, text, text, text, jsonb
) is
  'Completes affiliate signing only when PDF, hashes, event, and row use the exact server-claimed timestamp and material.';

commit;
