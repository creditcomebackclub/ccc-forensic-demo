-- One-time, fail-closed preservation of clients who signed the retired LPOA
-- onboarding packet before the service-agreement-only cutover.  Some legacy
-- portal writes did not populate the newer agreement/profile timestamps even
-- though the signed LPOA artifact and signature reference exist.  The owner
-- explicitly approved those signed legacy clients for grandfathering; missing
-- mutable portal metadata is preserved in the evidence snapshot, not invented.
--
-- This is an additive snapshot, not a compatibility reader over mutable
-- clients.lpoa_signed/client_profiles.onboarding_complete flags.  Only this
-- migration may populate the table.  Future clients must complete a signed v2
-- service-agreement-only packet and can never become grandfathered by changing
-- legacy columns.

-- Persist the first application time so even an accidental replay of this
-- migration cannot extend the grandfather window to clients signed later.
create table if not exists public.legacy_service_grandfathering_cutover (
  singleton boolean primary key default true check (singleton),
  cutoff_at timestamptz not null,
  migration_version text not null
    check (migration_version = '20260820280000_legacy_service_grandfathering')
);

insert into public.legacy_service_grandfathering_cutover (
  singleton, cutoff_at, migration_version
)
values (
  true, statement_timestamp(), '20260820280000_legacy_service_grandfathering'
)
on conflict (singleton) do nothing;

create table if not exists public.legacy_service_grandfathering (
  client_id uuid primary key references public.clients(id) on delete restrict,
  profile_id uuid unique references public.client_profiles(id) on delete restrict,
  firm_user_id_at_cutoff uuid not null,
  portal_user_id_at_cutoff uuid,
  basis text not null,
  source_agreement_signed_at timestamptz,
  source_profile_signature_signed_at timestamptz,
  source_lpoa_signed_at timestamptz not null,
  evidence_snapshot jsonb not null,
  evidence_sha256 text not null,
  migration_cutoff timestamptz not null,
  grandfathered_at timestamptz not null,
  constraint legacy_service_grandfathering_basis_check
    check (basis in (
      'legacy_completed_signed_onboarding',
      'owner_approved_legacy_signed_lpoa'
    )),
  constraint legacy_service_grandfathering_evidence_sha256_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint legacy_service_grandfathering_cutoff_check
    check (
      grandfathered_at = migration_cutoff
      and (source_agreement_signed_at is null
        or source_agreement_signed_at <= migration_cutoff)
      and (source_profile_signature_signed_at is null
        or source_profile_signature_signed_at <= migration_cutoff)
      and source_lpoa_signed_at <= migration_cutoff
    )
);

create table if not exists public.legacy_service_grandfathering_exceptions (
  client_id uuid not null,
  profile_id uuid not null,
  firm_user_id_at_cutoff uuid not null,
  portal_user_id_at_cutoff uuid,
  reason_codes text[] not null check (cardinality(reason_codes) > 0),
  evidence_snapshot jsonb not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  migration_cutoff timestamptz not null,
  captured_at timestamptz not null,
  primary key (client_id, profile_id),
  constraint legacy_service_grandfathering_exceptions_cutoff_check
    check (captured_at = migration_cutoff)
);

comment on table public.legacy_service_grandfathering is
  'Immutable one-time snapshot of clients with a pre-cutover signed legacy LPOA artifact and signature reference. Includes owner-approved legacy rows whose newer portal metadata was not populated. Never populated by runtime flags after cutover.';
comment on column public.legacy_service_grandfathering.evidence_snapshot is
  'Non-secret source facts captured at cutover; raw signature metadata is represented only by its SHA-256.';
comment on column public.legacy_service_grandfathering.migration_cutoff is
  'The exact transaction timestamp of the one-time backfill. All qualifying signing evidence must predate or equal it.';
comment on table public.legacy_service_grandfathering_exceptions is
  'Immutable cutover-time review queue for profiles with some legacy completion/signing evidence that failed one or more grandfathering requirements.';

do $grandfather_backfill$
declare
  v_cutoff timestamptz;
begin
  select cutoff_at into strict v_cutoff
  from public.legacy_service_grandfathering_cutover
  where singleton is true;

  with candidates as (
    select
      c.id as client_id,
      cp.id as profile_id,
      c.user_id as firm_user_id_at_cutoff,
      cp.user_id as portal_user_id_at_cutoff,
      cp.agreement_signed_at as source_agreement_signed_at,
      cp.signature_signed_at as source_profile_signature_signed_at,
      c.lpoa_signed_at as source_lpoa_signed_at,
      jsonb_build_object(
        'clientId', c.id,
        'profileId', cp.id,
        'firmUserId', c.user_id,
        'portalUserId', cp.user_id,
        'profileOnboardingComplete', cp.onboarding_complete,
        'profileAgreementSignedAt', cp.agreement_signed_at,
        'profileSignatureSignedAt', cp.signature_signed_at,
        'legacyLpoaSigned', c.lpoa_signed,
        'legacyLpoaSignedAt', c.lpoa_signed_at,
        'legacyLpoaDocumentHash', c.lpoa_document_hash,
        'linkedClientProfileCount', (
          select count(*) from public.client_profiles peer
          where peer.client_id = c.id
        ),
        'linkedPortalUserProfileCount', case
          when cp.user_id is null then 0
          else (
            select count(*) from public.client_profiles peer
            where peer.user_id = cp.user_id
          )
        end,
        'legacySignatureMetadataSha256', encode(
          extensions.digest(convert_to(c.lpoa_signature_data::text, 'UTF8'), 'sha256'),
          'hex'
        ),
        'matchingLpoaAuditRows', (
          select count(*)
          from public.lpoa_audit_log audit
          where audit.client_id = c.id
            and audit.signed_at <= v_cutoff
        )
      ) as evidence_snapshot
    from public.clients c
    -- Preserve an exact portal profile only when the legacy client link is
    -- unique. A zero-profile client remains service-authorized and can later
    -- receive a profile through the canonical provisioning path. Ambiguous
    -- multi-profile links never receive portal access through this snapshot.
    left join public.client_profiles cp
      on cp.client_id = c.id
     and 1 = (
       select count(*) from public.client_profiles peer
       where peer.client_id = c.id
     )
    where c.user_id is not null
      and c.lpoa_signed is true
      and c.lpoa_signed_at is not null
      and jsonb_typeof(c.lpoa_signature_data) = 'object'
      and (
        nullif(btrim(c.lpoa_signature_data ->> 'signaturePath'), '') is not null
        or nullif(btrim(c.lpoa_signature_data ->> 'signatureUrl'), '') is not null
      )
      and c.lpoa_signed_at <= v_cutoff
  )
  insert into public.legacy_service_grandfathering (
    client_id,
    profile_id,
    firm_user_id_at_cutoff,
    portal_user_id_at_cutoff,
    basis,
    source_agreement_signed_at,
    source_profile_signature_signed_at,
    source_lpoa_signed_at,
    evidence_snapshot,
    evidence_sha256,
    migration_cutoff,
    grandfathered_at
  )
  select
    client_id,
    profile_id,
    firm_user_id_at_cutoff,
    portal_user_id_at_cutoff,
    case
      when portal_user_id_at_cutoff is not null
       and (evidence_snapshot ->> 'profileOnboardingComplete')::boolean is true
       and source_agreement_signed_at is not null
       and source_profile_signature_signed_at is not null
       and (evidence_snapshot ->> 'linkedClientProfileCount')::integer = 1
       and (evidence_snapshot ->> 'linkedPortalUserProfileCount')::integer = 1
        then 'legacy_completed_signed_onboarding'
      else 'owner_approved_legacy_signed_lpoa'
    end,
    source_agreement_signed_at,
    source_profile_signature_signed_at,
    source_lpoa_signed_at,
    evidence_snapshot,
    encode(
      extensions.digest(convert_to(evidence_snapshot::text, 'UTF8'), 'sha256'),
      'hex'
    ),
    v_cutoff,
    v_cutoff
  from candidates
  on conflict (client_id) do nothing;

  -- Make fail-closed exclusions observable. This is a cutover snapshot only;
  -- it never participates in portal or service authorization decisions.
  with review_candidates as (
    select
      c.id as client_id,
      cp.id as profile_id,
      c.user_id as firm_user_id_at_cutoff,
      cp.user_id as portal_user_id_at_cutoff,
      array_remove(array[
        case when cp.user_id is null then 'MISSING_PORTAL_USER_LINK' end,
        case when cp.onboarding_complete is not true then 'PROFILE_ONBOARDING_NOT_COMPLETE' end,
        case when cp.agreement_signed_at is null then 'MISSING_AGREEMENT_SIGNED_AT' end,
        case when cp.signature_signed_at is null then 'MISSING_PROFILE_SIGNATURE_SIGNED_AT' end,
        case when c.lpoa_signed is not true then 'LEGACY_LPOA_NOT_SIGNED' end,
        case when c.lpoa_signed_at is null then 'MISSING_LEGACY_LPOA_SIGNED_AT' end,
        case when not (
          jsonb_typeof(c.lpoa_signature_data) = 'object'
          and (
            nullif(btrim(c.lpoa_signature_data ->> 'signaturePath'), '') is not null
            or nullif(btrim(c.lpoa_signature_data ->> 'signatureUrl'), '') is not null
          )
        ) then 'MISSING_LEGACY_SIGNATURE_REFERENCE' end,
        case when cp.agreement_signed_at > v_cutoff
               or cp.signature_signed_at > v_cutoff
               or c.lpoa_signed_at > v_cutoff
          then 'EVIDENCE_AFTER_CUTOVER' end,
        case when 1 <> (
          select count(*) from public.client_profiles peer
          where peer.client_id = c.id
        ) then 'AMBIGUOUS_CLIENT_PROFILE_LINK' end,
        case when cp.user_id is not null and 1 <> (
          select count(*) from public.client_profiles peer
          where peer.user_id = cp.user_id
        ) then 'AMBIGUOUS_PORTAL_USER_LINK' end
      ], null) as reason_codes,
      jsonb_build_object(
        'clientId', c.id,
        'profileId', cp.id,
        'firmUserId', c.user_id,
        'portalUserId', cp.user_id,
        'profileOnboardingComplete', cp.onboarding_complete,
        'profileAgreementSignedAt', cp.agreement_signed_at,
        'profileSignatureSignedAt', cp.signature_signed_at,
        'legacyLpoaSigned', c.lpoa_signed,
        'legacyLpoaSignedAt', c.lpoa_signed_at,
        'legacyLpoaDocumentHash', c.lpoa_document_hash,
        'legacySignatureMetadataSha256', case
          when c.lpoa_signature_data is null then null
          else encode(
            extensions.digest(convert_to(c.lpoa_signature_data::text, 'UTF8'), 'sha256'),
            'hex'
          )
        end
      ) as evidence_snapshot
    from public.clients c
    join public.client_profiles cp on cp.client_id = c.id
    where coalesce(cp.created_at, v_cutoff) <= v_cutoff
      and (
        cp.onboarding_complete is true
        or cp.agreement_signed_at is not null
        or cp.signature_signed_at is not null
        or c.lpoa_signed is true
        or c.lpoa_signed_at is not null
        or c.lpoa_signature_data is not null
      )
      and not exists (
        select 1 from public.legacy_service_grandfathering grandfather
        where grandfather.client_id = c.id
      )
  )
  insert into public.legacy_service_grandfathering_exceptions (
    client_id,
    profile_id,
    firm_user_id_at_cutoff,
    portal_user_id_at_cutoff,
    reason_codes,
    evidence_snapshot,
    evidence_sha256,
    migration_cutoff,
    captured_at
  )
  select
    client_id,
    profile_id,
    firm_user_id_at_cutoff,
    portal_user_id_at_cutoff,
    reason_codes,
    evidence_snapshot,
    encode(
      extensions.digest(convert_to(evidence_snapshot::text, 'UTF8'), 'sha256'),
      'hex'
    ),
    v_cutoff,
    v_cutoff
  from review_candidates
  where cardinality(reason_codes) > 0
  on conflict (client_id, profile_id) do nothing;
end;
$grandfather_backfill$;

-- Historical eligibility evidence is append-never/change-never.  PostgreSQL's
-- migration owner may remove the table during an explicit rollback, but normal
-- application roles cannot insert, update, delete, or truncate its rows.
create or replace function public.ccc_preserve_legacy_service_grandfathering()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Legacy service grandfathering evidence is immutable.';
end;
$$;

drop trigger if exists ccc_preserve_legacy_service_grandfathering_cutover_trigger
  on public.legacy_service_grandfathering_cutover;
create trigger ccc_preserve_legacy_service_grandfathering_cutover_trigger
before update or delete on public.legacy_service_grandfathering_cutover
for each row execute function public.ccc_preserve_legacy_service_grandfathering();

drop trigger if exists ccc_preserve_legacy_service_grandfathering_trigger
  on public.legacy_service_grandfathering;
create trigger ccc_preserve_legacy_service_grandfathering_trigger
before update or delete on public.legacy_service_grandfathering
for each row execute function public.ccc_preserve_legacy_service_grandfathering();

drop trigger if exists ccc_preserve_legacy_service_grandfathering_exceptions_trigger
  on public.legacy_service_grandfathering_exceptions;
create trigger ccc_preserve_legacy_service_grandfathering_exceptions_trigger
before update or delete on public.legacy_service_grandfathering_exceptions
for each row execute function public.ccc_preserve_legacy_service_grandfathering();

alter table public.legacy_service_grandfathering enable row level security;
alter table public.legacy_service_grandfathering_cutover enable row level security;
alter table public.legacy_service_grandfathering_exceptions enable row level security;

drop policy if exists "staff_read_legacy_service_grandfathering"
  on public.legacy_service_grandfathering;
create policy "staff_read_legacy_service_grandfathering"
on public.legacy_service_grandfathering for select to authenticated
using (
  exists (
    select 1
    from public.profiles caller
    where caller.id = auth.uid()
      and (
        caller.role = 'admin'
        or (
          caller.role = 'auditor'
          and legacy_service_grandfathering.firm_user_id_at_cutoff = auth.uid()
        )
      )
  )
);

drop policy if exists "staff_read_legacy_service_grandfathering_exceptions"
  on public.legacy_service_grandfathering_exceptions;
create policy "staff_read_legacy_service_grandfathering_exceptions"
on public.legacy_service_grandfathering_exceptions for select to authenticated
using (
  exists (
    select 1
    from public.profiles caller
    where caller.id = auth.uid()
      and (
        caller.role = 'admin'
        or (
          caller.role = 'auditor'
          and legacy_service_grandfathering_exceptions.firm_user_id_at_cutoff = auth.uid()
        )
      )
  )
);

drop policy if exists "staff_read_legacy_service_grandfathering_cutover"
  on public.legacy_service_grandfathering_cutover;
create policy "staff_read_legacy_service_grandfathering_cutover"
on public.legacy_service_grandfathering_cutover for select to authenticated
using (
  exists (
    select 1
    from public.profiles caller
    where caller.id = auth.uid()
      and caller.role = 'admin'
  )
);

revoke all on table public.legacy_service_grandfathering
  from public, anon, authenticated, service_role;
grant select on table public.legacy_service_grandfathering
  to authenticated, service_role;

revoke all on table public.legacy_service_grandfathering_cutover
  from public, anon, authenticated, service_role;
grant select on table public.legacy_service_grandfathering_cutover
  to authenticated, service_role;

revoke all on table public.legacy_service_grandfathering_exceptions
  from public, anon, authenticated, service_role;
grant select on table public.legacy_service_grandfathering_exceptions
  to authenticated, service_role;

revoke all on function public.ccc_preserve_legacy_service_grandfathering()
  from public, anon, authenticated, service_role;

-- The single authoritative service-work predicate.  Runtime callers never
-- inspect legacy flags: service is authorized only after the v2 eligibility
-- instant, or by a row frozen in the one-time grandfather snapshot above.
create or replace function public.ccc_has_service_authorization(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.client_service_agreements agreement
      join public.service_agreement_templates template
        on template.id = agreement.template_id
      where agreement.client_id = p_client_id
        and agreement.status = 'signed'
        and agreement.signed_at is not null
        and agreement.service_eligible_at is not null
        and agreement.service_eligible_at <= current_timestamp
        and template.packet_kind = 'service_agreement_only'
    )
    or exists (
      select 1
      from public.legacy_service_grandfathering grandfather
      where grandfather.client_id = p_client_id
    );
$$;

revoke all on function public.ccc_has_service_authorization(uuid)
  from public, anon, authenticated;
grant execute on function public.ccc_has_service_authorization(uuid)
  to service_role;

comment on function public.ccc_has_service_authorization(uuid) is
  'Authoritative service-work predicate: eligible signed v2 agreement OR immutable one-time legacy grandfather evidence. Never reads mutable LPOA/onboarding flags.';

-- Portal access begins immediately after atomic v2 signing, independent of
-- the later service-eligibility instant.  Existing completed legacy clients
-- enter through the immutable snapshot, not through raw LPOA/onboarding flags.
create or replace function public.ccc_current_client_has_portal_access(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.client_profiles profile
    where profile.id = p_profile_id
      and profile.user_id = auth.uid()
      and profile.client_id is not null
      and 1 = (
        select count(*)
        from public.client_profiles client_peer
        where client_peer.client_id = profile.client_id
      )
      and 1 = (
        select count(*)
        from public.client_profiles user_peer
        where user_peer.user_id = auth.uid()
      )
      and (
        exists (
          select 1
          from public.legacy_service_grandfathering grandfather
          where grandfather.client_id = profile.client_id
            and (
              grandfather.profile_id = profile.id
              or (
                grandfather.profile_id is null
                and (grandfather.evidence_snapshot ->> 'linkedClientProfileCount')::integer = 0
              )
            )
        )
        or exists (
          select 1
          from public.client_service_agreements agreement
          join public.service_agreement_templates template
            on template.id = agreement.template_id
          where agreement.client_id = profile.client_id
            and agreement.status = 'signed'
            and agreement.signed_at is not null
            and template.packet_kind = 'service_agreement_only'
        )
      )
  );
$$;

revoke all on function public.ccc_current_client_has_portal_access(uuid)
  from public, anon, authenticated;
grant execute on function public.ccc_current_client_has_portal_access(uuid)
  to authenticated;

comment on function public.ccc_current_client_has_portal_access(uuid) is
  'Auth-bound portal gate: atomic signed v2 onboarding OR immutable grandfather evidence for the caller''s exact client profile.';

-- Rollback path: restore the previous App reader first, then explicitly drop
-- the two helper functions, trigger/function, and table.  Do not alter or
-- delete any historical LPOA/profile rows; this migration never mutates them.
