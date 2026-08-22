-- Client portal privacy boundary.
--
-- Portal browsers receive an explicit, client-facing JSON projection instead
-- of direct row access to CRM/audit/letter/legal tables. Staff retain their
-- existing owner/admin RLS policies and service-role workflows are unchanged.
-- Historical LPOA/signature objects remain preserved for internal evidence,
-- but portal JWTs cannot read or mutate those paths.
--
-- Rollback: restore the former client SELECT policies only after restoring a
-- browser reader that uses an explicit column allowlist. Never restore the
-- retired client-docs INSERT policy or LPOA/signature storage reads.

begin;

-- A one-to-one UUID link is not sufficient authorization. The runtime gate
-- also enforces the canonical linker's role and normalized-email invariants
-- so a stale/corrupt legacy row fails closed instead of exposing another
-- client's portal.
create or replace function public.ccc_client_portal_identity_is_canonical(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.client_profiles portal_profile
    join public.clients client on client.id = portal_profile.client_id
    join auth.users portal_user on portal_user.id = portal_profile.user_id
    join public.profiles identity_profile on identity_profile.id = portal_profile.user_id
    where portal_profile.id = p_profile_id
      and portal_profile.user_id = auth.uid()
      and identity_profile.role = 'client'
      and nullif(lower(btrim(portal_profile.email)), '') is not null
      and lower(btrim(portal_profile.email)) = lower(btrim(coalesce(portal_user.email, '')))
      and lower(btrim(portal_profile.email)) = lower(btrim(coalesce(identity_profile.email, '')))
      and lower(btrim(portal_profile.email)) = lower(btrim(coalesce(client.email, '')))
      and (select count(*) from public.client_profiles p where p.user_id = auth.uid()) = 1
      and (select count(*) from public.client_profiles p where p.client_id = portal_profile.client_id) = 1
      and (
        select count(*) from public.client_profiles p
        where lower(btrim(p.email)) = lower(btrim(portal_profile.email))
      ) = 1
      and not exists (
        select 1 from public.affiliates affiliate
        where affiliate.user_id = auth.uid()
      )
  );
$$;

revoke all on function public.ccc_client_portal_identity_is_canonical(uuid)
  from public, anon, authenticated;
grant execute on function public.ccc_client_portal_identity_is_canonical(uuid)
  to service_role;

-- -------------------------------------------------------------------------
-- Exact-auth bootstrap used by App before the portal itself is mounted.
-- -------------------------------------------------------------------------
create or replace function public.get_my_client_portal_bootstrap()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_profile public.client_profiles%rowtype;
  v_profile_count integer;
  v_client_profile_count integer;
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select count(*)::integer
  into v_profile_count
  from public.client_profiles profile
  where profile.user_id = v_caller;

  if v_profile_count = 0 then
    return null;
  end if;
  if v_profile_count <> 1 then
    raise exception using errcode = '42501', message = 'The client portal identity is ambiguous';
  end if;

  select profile.*
  into strict v_profile
  from public.client_profiles profile
  where profile.user_id = v_caller;

  if v_profile.client_id is null then
    raise exception using errcode = '42501', message = 'The client portal profile is not linked';
  end if;

  select count(*)::integer
  into v_client_profile_count
  from public.client_profiles peer
  where peer.client_id = v_profile.client_id;

  if v_client_profile_count <> 1 or not exists (
    select 1 from public.clients client where client.id = v_profile.client_id
  ) then
    raise exception using errcode = '42501', message = 'The client portal mapping is ambiguous';
  end if;
  if not public.ccc_client_portal_identity_is_canonical(v_profile.id) then
    raise exception using errcode = '42501', message = 'The client portal identity failed its integrity check';
  end if;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'full_name', v_profile.full_name,
      'email', v_profile.email,
      'onboarding_complete', coalesce(v_profile.onboarding_complete, false),
      'agreement_signed_at', v_profile.agreement_signed_at
    ),
    'has_portal_access', public.ccc_current_client_has_portal_access(v_profile.id)
  );
end
$$;

revoke all on function public.get_my_client_portal_bootstrap()
  from public, anon;
grant execute on function public.get_my_client_portal_bootstrap()
  to authenticated;

comment on function public.get_my_client_portal_bootstrap() is
  'Exact Auth-user to one client-profile bootstrap. Exposes only portal identity and the authoritative portal-access result.';

-- Reduce a staff-reviewed report comparison to the exact values used by the
-- client progress cards. Raw account UUIDs, masked account numbers, violation
-- arrays, statutes, field-level changes, model metadata, and ambiguous match
-- buckets never cross the portal boundary.
create or replace function public.ccc_client_portal_safe_progress_diff(p_diff jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_source jsonb := case when jsonb_typeof(p_diff) = 'object' then p_diff else '{}'::jsonb end;
  v_item jsonb;
  v_deleted jsonb := '[]'::jsonb;
  v_added jsonb := '[]'::jsonb;
  v_changed jsonb := '[]'::jsonb;
  v_added_source jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(v_source -> 'deleted') = 'array' then
    for v_item in select item.value from jsonb_array_elements(v_source -> 'deleted') item(value) limit 100 loop
      v_deleted := v_deleted || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'furnisher', case when jsonb_typeof(v_item -> 'furnisher') = 'string' then left(v_item ->> 'furnisher', 120) else 'Account' end,
        'balance', case when jsonb_typeof(v_item -> 'balance') = 'number' then (v_item ->> 'balance')::numeric else null end,
        'status', case when jsonb_typeof(v_item -> 'status') = 'string' then left(v_item ->> 'status', 80) else null end
      )));
    end loop;
  end if;

  v_added_source := case
    when jsonb_typeof(v_source -> 'new') = 'array' then v_source -> 'new'
    when jsonb_typeof(v_source -> 'added') = 'array' then v_source -> 'added'
    else '[]'::jsonb
  end;
  for v_item in select item.value from jsonb_array_elements(v_added_source) item(value) limit 100 loop
    v_added := v_added || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'furnisher', case when jsonb_typeof(v_item -> 'furnisher') = 'string' then left(v_item ->> 'furnisher', 120) else 'Account' end,
      'balance', case when jsonb_typeof(v_item -> 'balance') = 'number' then (v_item ->> 'balance')::numeric else null end,
      'status', case when jsonb_typeof(v_item -> 'status') = 'string' then left(v_item ->> 'status', 80) else null end
    )));
  end loop;

  if jsonb_typeof(v_source -> 'changed') = 'array' then
    for v_item in select item.value from jsonb_array_elements(v_source -> 'changed') item(value) limit 100 loop
      v_changed := v_changed || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'furnisher', case when jsonb_typeof(v_item -> 'furnisher') = 'string' then left(v_item ->> 'furnisher', 120) else 'Account' end,
        'oldStatus', case when jsonb_typeof(v_item -> 'oldStatus') = 'string' then left(v_item ->> 'oldStatus', 80) else null end,
        'newStatus', case when jsonb_typeof(v_item -> 'newStatus') = 'string' then left(v_item ->> 'newStatus', 80) else null end,
        'oldBalance', case when jsonb_typeof(v_item -> 'oldBalance') = 'number' then (v_item ->> 'oldBalance')::numeric else null end,
        'newBalance', case when jsonb_typeof(v_item -> 'newBalance') = 'number' then (v_item ->> 'newBalance')::numeric else null end
      )));
    end loop;
  end if;

  return jsonb_build_object(
    'deleted', v_deleted,
    'new', v_added,
    'changed', v_changed,
    'scoreDeltas', jsonb_build_object(
      'equifax', jsonb_build_object(
        'old', case when jsonb_typeof(v_source #> '{scoreDeltas,equifax,old}') = 'number' then (v_source #>> '{scoreDeltas,equifax,old}')::numeric else null end,
        'new', case when jsonb_typeof(v_source #> '{scoreDeltas,equifax,new}') = 'number' then (v_source #>> '{scoreDeltas,equifax,new}')::numeric else null end,
        'delta', case when jsonb_typeof(v_source #> '{scoreDeltas,equifax,delta}') = 'number' then (v_source #>> '{scoreDeltas,equifax,delta}')::numeric else null end
      ),
      'experian', jsonb_build_object(
        'old', case when jsonb_typeof(v_source #> '{scoreDeltas,experian,old}') = 'number' then (v_source #>> '{scoreDeltas,experian,old}')::numeric else null end,
        'new', case when jsonb_typeof(v_source #> '{scoreDeltas,experian,new}') = 'number' then (v_source #>> '{scoreDeltas,experian,new}')::numeric else null end,
        'delta', case when jsonb_typeof(v_source #> '{scoreDeltas,experian,delta}') = 'number' then (v_source #>> '{scoreDeltas,experian,delta}')::numeric else null end
      ),
      'transunion', jsonb_build_object(
        'old', case when jsonb_typeof(v_source #> '{scoreDeltas,transunion,old}') = 'number' then (v_source #>> '{scoreDeltas,transunion,old}')::numeric else null end,
        'new', case when jsonb_typeof(v_source #> '{scoreDeltas,transunion,new}') = 'number' then (v_source #>> '{scoreDeltas,transunion,new}')::numeric else null end,
        'delta', case when jsonb_typeof(v_source #> '{scoreDeltas,transunion,delta}') = 'number' then (v_source #>> '{scoreDeltas,transunion,delta}')::numeric else null end
      )
    ),
    'negativeCounts', jsonb_build_object(
      'before', case when jsonb_typeof(v_source #> '{negativeCounts,before}') = 'number' then (v_source #>> '{negativeCounts,before}')::integer else null end,
      'after', case when jsonb_typeof(v_source #> '{negativeCounts,after}') = 'number' then (v_source #>> '{negativeCounts,after}')::integer else null end
    ),
    'totalDebtRemoved', case when jsonb_typeof(v_source -> 'totalDebtRemoved') = 'number' then (v_source ->> 'totalDebtRemoved')::numeric else 0 end
  );
end
$$;

revoke all on function public.ccc_client_portal_safe_progress_diff(jsonb)
  from public, anon, authenticated;
grant execute on function public.ccc_client_portal_safe_progress_diff(jsonb)
  to service_role;

comment on function public.ccc_client_portal_safe_progress_diff(jsonb) is
  'Internal allowlist projection for client-visible score and account-movement summaries.';

-- -------------------------------------------------------------------------
-- Full client-facing snapshot. Every field is intentionally enumerated.
-- -------------------------------------------------------------------------
create or replace function public.get_my_client_portal_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bootstrap jsonb;
  v_profile_id uuid;
  v_client_id uuid;
  v_profile jsonb;
  v_client jsonb;
  v_documents jsonb := '[]'::jsonb;
  v_letters jsonb := '[]'::jsonb;
  v_rounds jsonb := '[]'::jsonb;
  v_campaigns jsonb := '[]'::jsonb;
  v_packet_coverage jsonb := '[]'::jsonb;
  v_progress jsonb := '[]'::jsonb;
  v_blueprints jsonb := '[]'::jsonb;
  v_ccc jsonb := '{}'::jsonb;
begin
  v_bootstrap := public.get_my_client_portal_bootstrap();
  if v_bootstrap is null then
    raise exception using errcode = '42501', message = 'An exact client portal profile is required';
  end if;
  if coalesce((v_bootstrap ->> 'has_portal_access')::boolean, false) is not true then
    raise exception using errcode = '42501', message = 'Client portal access is not active';
  end if;

  v_profile_id := (v_bootstrap #>> '{profile,id}')::uuid;
  select profile.client_id
  into strict v_client_id
  from public.client_profiles profile
  where profile.id = v_profile_id
    and profile.user_id = auth.uid();

  v_profile := v_bootstrap -> 'profile';

  select jsonb_build_object(
    'id', client.id,
    'name', client.name,
    'is_vip', coalesce(client.is_vip, false),
    'created_at', client.created_at,
    'monitoring_service', client.monitoring_service,
    'monitoring_email', client.monitoring_email,
    'monitoring_enrolled', coalesce(client.monitoring_enrolled, false),
    'monitoring_portal_url', client.monitoring_portal_url,
    'monitoring_not_required', coalesce(client.monitoring_not_required, false),
    'score_eq_start', client.score_eq_start,
    'score_exp_start', client.score_exp_start,
    'score_tu_start', client.score_tu_start,
    'ledger', coalesce((
      select jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'id', entry.value -> 'id',
          'date', entry.value -> 'date',
          'type', entry.value -> 'type',
          'description', entry.value -> 'description',
          'status', entry.value -> 'status',
          'amount', entry.value -> 'amount'
        ))
        order by entry.ordinality
      )
      from jsonb_array_elements(
        case when jsonb_typeof(client.ledger) = 'array' then client.ledger else '[]'::jsonb end
      ) with ordinality as entry(value, ordinality)
    ), '[]'::jsonb)
  )
  into strict v_client
  from public.clients client
  where client.id = v_client_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', document.id,
    'doc_type', document.doc_type,
    'label', document.label,
    'file_name', document.file_name,
    'storage_path', document.storage_path,
    'uploaded_at', document.uploaded_at
  ) order by document.uploaded_at desc, document.id), '[]'::jsonb)
  into v_documents
  from public.documents document
  where document.client_id = v_client_id
    and (
      document.doc_type in ('id', 'address')
      or document.doc_type like 'other-%'
    )
    and lower(coalesce(document.storage_path, '')) not like '%/agreements/%'
    and lower(coalesce(document.storage_path, '')) not like '%/lpoa/%'
    and lower(coalesce(document.storage_path, '')) not like '%/signature/%'
    and lower(coalesce(document.storage_path, '')) not like '%/signatures/%';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', letter.id,
    'furnisher', letter.furnisher,
    'phase', case
      when letter.phase ilike 'CCC Dispute —%' then 'CCC Dispute — Account Case'
      else letter.phase
    end,
    'saved_at', letter.saved_at,
    'date', letter.date,
    'summary', null,
    'mailed_date', letter.mailed_date,
    'response_outcome', letter.response_outcome,
    'response_date', letter.response_date,
    'lob_id', case
      when letter.mail_service = 'usps_first_class_certified_return_receipt' then letter.lob_id
      else null
    end,
    'tracking_number', case
      when letter.mail_service = 'usps_first_class_certified_return_receipt' then letter.tracking_number
      else null
    end,
    'tracking_status', case
      when letter.mail_service = 'usps_first_class_certified_return_receipt' then letter.tracking_status
      when letter.tracking_status in ('Returned to Sender', 'Failed', 'Cancelled') then letter.tracking_status
      when letter.mailed_date is not null then 'Mailed First Class'
      else null
    end,
    'delivered_at', case
      when letter.mail_service = 'usps_first_class_certified_return_receipt' then letter.delivered_at
      else null
    end,
    'mail_service', letter.mail_service,
    'expected_delivery_date', case
      when letter.mail_service in (
        'usps_first_class', 'usps_first_class_certified_return_receipt'
      ) then letter.expected_delivery_date
      else null
    end,
    'return_receipt_url', case
      when letter.mail_service = 'usps_first_class_certified_return_receipt' then letter.return_receipt_url
      else null
    end,
    'bureau_response_status', letter.bureau_response_status,
    'bureau_response_received_at', letter.bureau_response_received_at,
    'bureau_response_analyzed_at', letter.bureau_response_analyzed_at,
    'bureau_review_status', letter.bureau_review_status,
    'round_id', letter.round_id,
    'round_number', letter.round_number,
    'letter_kind', letter.letter_kind,
    'target_type', letter.target_type,
    'target_bureau', letter.target_bureau,
    'response_due_at', case
      when letter.mail_service = 'usps_first_class_certified_return_receipt' then letter.response_due_at
      else null
    end,
    'response_window_extension_days', case
      when letter.mail_service = 'usps_first_class_certified_return_receipt' then letter.response_window_extension_days
      else 0
    end,
    'round_review_status', letter.round_review_status,
    'campaign_id', letter.campaign_id,
    'packet_version', letter.packet_version
  ) order by letter.saved_at, letter.id), '[]'::jsonb)
  into v_letters
  from public.letters letter
  where letter.client_id = v_client_id;

  select coalesce(jsonb_agg(to_jsonb(round_row) order by round_row.round_number desc, round_row.round_id), '[]'::jsonb)
  into v_rounds
  from (
    select
      status.round_id,
      status.round_number,
      status.target_type,
      status.status,
      status.final_disposition,
      status.opened_at,
      status.closed_at,
      status.cancelled_at,
      status.letter_count,
      status.mailed_count,
      status.reviewed_count,
      status.campaign_id
    from public.client_dispute_round_status status
    where status.client_id = v_client_id
  ) round_row;

  select coalesce(jsonb_agg(to_jsonb(campaign_row) order by campaign_row.round_number desc, campaign_row.campaign_id), '[]'::jsonb)
  into v_campaigns
  from (
    select
      status.campaign_id,
      status.round_number,
      status.stage,
      status.opened_at,
      status.closed_at,
      status.selected_cleanup_count,
      status.selected_account_count
    from public.client_campaign_status status
    where status.client_id = v_client_id
  ) campaign_row;

  select coalesce(jsonb_agg(to_jsonb(coverage_row) order by coverage_row.coverage_order, coverage_row.coverage_id), '[]'::jsonb)
  into v_packet_coverage
  from (
    select
      status.coverage_id,
      status.letter_id,
      status.coverage_order,
      status.account_label,
      status.masked_account,
      status.target_type,
      status.target_bureau,
      status.round_number,
      case
        when letter.mail_service = 'usps_first_class_certified_return_receipt' then status.mail_status
        when letter.tracking_status = 'Failed' then 'failed'
        when letter.tracking_status = 'Cancelled' then 'cancelled'
        when letter.tracking_status = 'Returned to Sender' then 'returned'
        when letter.mailed_date is not null then 'mailed'
        else 'not_sent'
      end as mail_status,
      case
        when letter.mail_service = 'usps_first_class_certified_return_receipt' then status.tracking_status
        when letter.tracking_status in ('Returned to Sender', 'Failed', 'Cancelled') then letter.tracking_status
        when letter.mailed_date is not null then 'Mailed First Class'
        else null
      end as tracking_status,
      status.response_status,
      status.client_progress,
      status.documents_requested,
      status.document_request
    from public.client_packet_account_status status
    join public.letters letter
      on letter.id = status.letter_id
     and letter.client_id = status.client_id
    where status.client_id = v_client_id
  ) coverage_row;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', progress.id,
    'client_name', progress.client_name,
    'from_report_date', progress.from_report_date,
    'to_report_date', progress.to_report_date,
    'diff', public.ccc_client_portal_safe_progress_diff(progress.diff),
    -- A sent progress update already delivered this exact staff-reviewed
    -- client narrative by email. Draft/model metadata is never projected.
    'narrative', left(coalesce(progress.narrative, ''), 12000),
    'status', progress.status,
    'emailed_at', progress.emailed_at
  ) order by progress.to_report_date desc, progress.id), '[]'::jsonb)
  into v_progress
  from public.progress_updates progress
  where progress.client_id = v_client_id
    and (progress.status = 'sent' or progress.emailed_at is not null);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', blueprint.id,
    'status', blueprint.status,
    'version', blueprint.version,
    'template_version', blueprint.template_version,
    'file_name', blueprint.file_name,
    'approved_at', blueprint.approved_at,
    'sent_at', blueprint.sent_at,
    'report_date', blueprint.report_date
  ) order by blueprint.approved_at desc, blueprint.id), '[]'::jsonb)
  into v_blueprints
  from public.recovery_blueprints blueprint
  where blueprint.client_id = v_client_id
    and blueprint.status in ('approved', 'sent');

  v_ccc := public.get_my_ccc_portal_projection();

  return jsonb_build_object(
    'profile', v_profile,
    'has_portal_access', v_bootstrap -> 'has_portal_access',
    'client', v_client,
    'documents', v_documents,
    'letters', v_letters,
    'rounds', v_rounds,
    'campaigns', v_campaigns,
    'packet_coverage', v_packet_coverage,
    'progress_updates', v_progress,
    'recovery_blueprints', v_blueprints,
    'ccc', v_ccc
  );
end
$$;

revoke all on function public.get_my_client_portal_snapshot()
  from public, anon;
grant execute on function public.get_my_client_portal_snapshot()
  to authenticated;

comment on function public.get_my_client_portal_snapshot() is
  'Exact-profile client portal projection. Excludes raw audits, letter HTML/templates, laws/flow codes, staff notes, legal artifacts, identifiers, credentials, internal billing metadata, and source hashes.';

-- These older projections/views are internal implementation details now.
-- Leaving their historical authenticated grants in place would allow callers
-- to bypass the signed/grandfathered access gate enforced above.
revoke all on function public.get_my_ccc_portal_projection()
  from public, anon, authenticated;
grant execute on function public.get_my_ccc_portal_projection()
  to service_role;
revoke all on function public.get_my_deletion_outcomes()
  from public, anon, authenticated;
grant execute on function public.get_my_deletion_outcomes()
  to service_role;
revoke select on public.client_dispute_round_status,
  public.client_campaign_status,
  public.client_packet_account_status
  from public, anon, authenticated;
grant select on public.client_dispute_round_status,
  public.client_campaign_status,
  public.client_packet_account_status
  to service_role;

-- -------------------------------------------------------------------------
-- Raw tables become staff/service only. Portal writes remain narrow RPCs.
-- -------------------------------------------------------------------------
drop policy if exists "client_read_own_meta" on public.clients;
drop policy if exists "client_update_own_meta" on public.clients;
drop policy if exists "client_read_own_audits" on public.audits;
drop policy if exists "client_read_own_letters" on public.letters;
drop policy if exists "client_read_own_documents" on public.documents;
drop policy if exists "client_read_own_progress" on public.progress_updates;
drop policy if exists "client_read_own_recovery_blueprints" on public.recovery_blueprints;

drop policy if exists "client_profiles_select_own_or_staff" on public.client_profiles;
drop policy if exists "client_profiles_staff_read" on public.client_profiles;
create policy "client_profiles_staff_read"
on public.client_profiles for select to authenticated
using (
  exists (
    select 1
    from public.profiles staff
    where staff.id = auth.uid()
      and (
        staff.role = 'admin'
        or (
          staff.role = 'auditor'
          and (
            client_profiles.created_by = auth.uid()
            or exists (
              select 1 from public.clients client
              where client.id = client_profiles.client_id
                and client.user_id = auth.uid()
            )
          )
        )
      )
  )
);

-- The old browser upload path predates the server-owned onboarding uploader
-- and contradicts client-docs' current firm-assets-only purpose.
drop policy if exists "client_insert_own_client_docs" on storage.objects;

-- Portal reads are limited to an exact registry row under the canonical
-- identity path. A prefix/denylist is not sufficient: that would expose raw
-- dispute screenshots and other private mail evidence stored beside the
-- client's documents.
create or replace function public.ccc_client_portal_can_read_document_path(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.client_profiles portal_profile
    join public.clients client on client.id = portal_profile.client_id
    join public.documents document on document.client_id = portal_profile.client_id
    where portal_profile.user_id = auth.uid()
      and public.ccc_client_portal_identity_is_canonical(portal_profile.id)
      and public.ccc_current_client_has_portal_access(portal_profile.id)
      and document.storage_path = object_name
      and (
        document.doc_type in ('id', 'address')
        or document.doc_type like 'other-%'
      )
      and (storage.foldername(object_name))[1] = client.user_id::text
      and (storage.foldername(object_name))[2] = portal_profile.client_id::text
      and (storage.foldername(object_name))[3] = 'identity'
  );
$$;

revoke all on function public.ccc_client_portal_can_read_document_path(text)
  from public, anon;
grant execute on function public.ccc_client_portal_can_read_document_path(text)
  to authenticated;
revoke all on function public.client_owns_documents_path(text)
  from authenticated;

drop policy if exists "client_select_documents_storage" on storage.objects;
create policy "client_select_documents_storage"
on storage.objects for select to authenticated
using (
  bucket_id = 'documents'
  and public.ccc_client_portal_can_read_document_path(name)
);

-- Recovery Blueprint bytes are served by the exact-auth Netlify endpoint;
-- direct storage reads remain staff-only.
drop policy if exists "authorized_read_recovery_blueprint_files" on storage.objects;
create policy "authorized_read_recovery_blueprint_files"
on storage.objects for select to authenticated
using (
  bucket_id = 'recovery-blueprints'
  and exists (
    select 1
    from public.recovery_blueprints blueprint
    join public.profiles staff on staff.id = auth.uid()
    where blueprint.storage_path = storage.objects.name
      and (
        staff.role = 'admin'
        or (staff.role = 'auditor' and blueprint.user_id = auth.uid())
      )
  )
);

-- Preserve the sole legitimate portal edit while requiring a one-to-one
-- identity mapping. A second profile/client mapping fails closed.
create or replace function public.update_own_client_monitoring(
  p_client_id uuid,
  p_monitoring_service text,
  p_monitoring_email text,
  p_monitoring_portal_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
begin
  select profile.id
  into v_profile_id
  from public.client_profiles profile
  where profile.user_id = auth.uid()
    and profile.client_id = p_client_id;

  if auth.uid() is null
    or p_client_id is null
    or v_profile_id is null
    or not public.ccc_client_portal_identity_is_canonical(v_profile_id)
    or not public.ccc_current_client_has_portal_access(v_profile_id)
    or (
      select count(*) from public.client_profiles profile
      where profile.user_id = auth.uid()
        and profile.client_id = p_client_id
    ) <> 1
    or (
      select count(*) from public.client_profiles profile
      where profile.user_id = auth.uid()
    ) <> 1
    or (
      select count(*) from public.client_profiles profile
      where profile.client_id = p_client_id
    ) <> 1 then
    raise exception using errcode = '42501', message = 'Exact client portal access required';
  end if;

  update public.clients
  set monitoring_service = nullif(btrim(p_monitoring_service), ''),
      monitoring_email = nullif(btrim(p_monitoring_email), ''),
      monitoring_portal_url = nullif(btrim(p_monitoring_portal_url), ''),
      monitoring_enrolled = true
  where id = p_client_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Client record not found';
  end if;
end
$$;

revoke all on function public.update_own_client_monitoring(uuid, text, text, text)
  from public, anon;
grant execute on function public.update_own_client_monitoring(uuid, text, text, text)
  to authenticated;

-- Blueprint view tracking is exact-client only; legacy name matching is not
-- an authorization mechanism.
create or replace function public.mark_recovery_blueprint_viewed(p_blueprint_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid;
  v_profile_id uuid;
begin
  if auth.uid() is null or p_blueprint_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select profile.client_id, profile.id
  into v_client_id, v_profile_id
  from public.client_profiles profile
  where profile.user_id = auth.uid();

  if v_client_id is null
    or (select count(*) from public.client_profiles profile where profile.user_id = auth.uid()) <> 1
    or (select count(*) from public.client_profiles profile where profile.client_id = v_client_id) <> 1
    or not public.ccc_client_portal_identity_is_canonical(v_profile_id)
    or not public.ccc_current_client_has_portal_access(v_profile_id) then
    raise exception using errcode = '42501', message = 'Exact client portal access required';
  end if;

  update public.recovery_blueprints blueprint
  set viewed_at = coalesce(blueprint.viewed_at, now()),
      updated_at = now()
  where blueprint.id = p_blueprint_id
    and blueprint.client_id = v_client_id
    and blueprint.status in ('approved', 'sent');

  if not found then
    raise exception using errcode = 'P0002', message = 'Blueprint not found';
  end if;
end
$$;

revoke all on function public.mark_recovery_blueprint_viewed(uuid)
  from public, anon;
grant execute on function public.mark_recovery_blueprint_viewed(uuid)
  to authenticated;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and policyname in (
        'client_read_own_meta',
        'client_read_own_audits',
        'client_read_own_letters',
        'client_read_own_documents',
        'client_read_own_progress',
        'client_read_own_recovery_blueprints',
        'client_profiles_select_own_or_staff'
      )
  ) then
    raise exception 'A retired client raw-table policy still exists';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'client_insert_own_client_docs'
  ) then
    raise exception 'The retired client-docs browser upload policy still exists';
  end if;

  if pg_catalog.has_function_privilege(
      'authenticated', 'public.get_my_ccc_portal_projection()', 'EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'authenticated', 'public.get_my_deletion_outcomes()', 'EXECUTE'
    ) then
    raise exception 'An internal portal sub-projection remains browser-callable';
  end if;

  if pg_catalog.has_table_privilege('authenticated', 'public.client_dispute_round_status', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.client_campaign_status', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'public.client_packet_account_status', 'SELECT') then
    raise exception 'A retired client status view remains browser-readable';
  end if;

  if not pg_catalog.has_function_privilege(
      'authenticated', 'public.get_my_client_portal_snapshot()', 'EXECUTE'
    ) or not pg_catalog.has_function_privilege(
      'authenticated', 'public.ccc_client_portal_can_read_document_path(text)', 'EXECUTE'
    ) then
    raise exception 'The guarded portal projection or document policy helper is unavailable';
  end if;
end
$$;

commit;
