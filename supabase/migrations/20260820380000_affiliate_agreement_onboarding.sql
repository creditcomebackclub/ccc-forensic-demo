-- Affiliate onboarding is a fail-closed, versioned workflow:
-- application -> owner terms snapshot -> agreement sent -> signed -> owner activation.
-- Existing affiliate records are explicitly grandfathered so this additive
-- migration does not remove access from partners who were already live.

alter table public.affiliates
  add column if not exists owner_user_id uuid references auth.users(id) on delete restrict,
  add column if not exists program_status text,
  add column if not exists current_agreement_id uuid,
  add column if not exists legacy_access_granted_at timestamptz,
  add column if not exists activated_at timestamptz,
  add column if not exists activated_by uuid references auth.users(id) on delete set null,
  add column if not exists status_changed_at timestamptz not null default now();

-- Backfill ownership only where it is deterministic. Application ownership is
-- authoritative; a single-admin installation is the safe compatibility
-- fallback for older manually-created partner records.
update public.affiliates a
set owner_user_id = aa.user_id
from public.affiliate_applications aa
where aa.affiliate_id = a.id and a.owner_user_id is null;

do $$
declare
  v_admin uuid;
begin
  select (array_agg(id order by id::text))[1] into v_admin
  from public.profiles
  where role = 'admin'
  having count(*) = 1;
  if v_admin is not null then
    update public.affiliates set owner_user_id = v_admin where owner_user_id is null;
  end if;
end;
$$;

update public.affiliates
set program_status = 'legacy_active',
    legacy_access_granted_at = coalesce(legacy_access_granted_at, created_at, now()),
    status_changed_at = coalesce(status_changed_at, created_at, now())
where program_status is null;

alter table public.affiliates
  alter column program_status set default 'agreement_pending',
  alter column program_status set not null;

alter table public.affiliates drop constraint if exists affiliates_program_status_check;
alter table public.affiliates add constraint affiliates_program_status_check check (
  program_status in (
    'legacy_active', 'agreement_pending', 'agreement_sent',
    'agreement_signed', 'active', 'suspended', 'terminated'
  )
);

create table if not exists public.affiliate_agreement_templates (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null,
  legal_status text not null default 'counsel_review'
    check (legal_status in ('counsel_review', 'approved', 'retired')),
  body_html text,
  content_sha256 text,
  approval_reference text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (legal_status = 'counsel_review' and approved_by is null and approved_at is null)
    or (legal_status in ('approved', 'retired') and approved_by is not null
        and approved_at is not null and approval_reference is not null
        and body_html is not null and length(btrim(body_html)) > 0
        and content_sha256 ~ '^[0-9a-f]{64}$')
  )
);

insert into public.affiliate_agreement_templates (version, title, legal_status, body_html)
values (
  'ccc-affiliate-agreement-v1-draft',
  'Credit Comeback Club Affiliate Partner Agreement',
  'counsel_review',
  null
)
on conflict (version) do nothing;

create table if not exists public.affiliate_agreements (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete restrict,
  application_id uuid references public.affiliate_applications(id) on delete restrict,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  portal_user_id uuid references auth.users(id) on delete restrict,
  template_id uuid not null references public.affiliate_agreement_templates(id) on delete restrict,
  template_version text not null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'signed', 'activated', 'superseded', 'expired', 'cancelled')),
  applicant_snapshot jsonb not null,
  compensation_snapshot jsonb not null,
  document_snapshot jsonb not null,
  signing_expires_at timestamptz,
  sent_at timestamptz,
  viewed_at timestamptz,
  signed_at timestamptz,
  signer_name text,
  signer_ip inet,
  signer_user_agent text,
  signature_sha256 text,
  signed_document_path text,
  signed_document_hash text,
  activated_at timestamptz,
  activated_by uuid references auth.users(id) on delete set null,
  superseded_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(applicant_snapshot) = 'object'),
  check (jsonb_typeof(compensation_snapshot) = 'object'),
  check (jsonb_typeof(document_snapshot) = 'object'),
  check (signature_sha256 is null or signature_sha256 ~ '^[0-9a-f]{64}$'),
  check (signed_document_hash is null or signed_document_hash ~ '^[0-9a-f]{64}$'),
  check (
    status not in ('sent', 'signed', 'activated')
    or (sent_at is not null and portal_user_id is not null and signing_expires_at is not null)
  ),
  check (
    status not in ('signed', 'activated')
    or (signed_at is not null and signer_name is not null and signature_sha256 is not null
        and signed_document_path is not null and signed_document_hash is not null)
  ),
  check (
    status <> 'activated'
    or (activated_at is not null and activated_by is not null)
  )
);

create unique index if not exists affiliate_agreements_one_open_uidx
  on public.affiliate_agreements (affiliate_id)
  where status in ('draft', 'sent', 'signed');
create index if not exists affiliate_agreements_owner_status_idx
  on public.affiliate_agreements (owner_user_id, status, created_at desc);
create index if not exists affiliate_agreements_portal_user_idx
  on public.affiliate_agreements (portal_user_id, status);

alter table public.affiliates drop constraint if exists affiliates_current_agreement_id_fkey;
alter table public.affiliates add constraint affiliates_current_agreement_id_fkey
  foreign key (current_agreement_id) references public.affiliate_agreements(id) on delete set null;

create table if not exists public.affiliate_agreement_events (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.affiliate_agreements(id) on delete restrict,
  event_type text not null check (event_type in (
    'prepared', 'sent', 'viewed', 'signed', 'activated',
    'superseded', 'expired', 'cancelled', 'access_denied'
  )),
  actor_type text not null check (actor_type in ('owner', 'affiliate', 'system')),
  actor_id uuid references auth.users(id) on delete set null,
  event_data jsonb not null default '{}'::jsonb check (jsonb_typeof(event_data) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists affiliate_agreement_events_agreement_idx
  on public.affiliate_agreement_events (agreement_id, created_at);

create or replace function public.ccc_affiliate_owner(p_owner_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
    and auth.uid() = p_owner_user_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
$$;

revoke all on function public.ccc_affiliate_owner(uuid) from public;
grant execute on function public.ccc_affiliate_owner(uuid) to authenticated, service_role;

-- Immutable packet sources and append-only evidence.
create or replace function public.protect_affiliate_agreement_template()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.legal_status in ('approved', 'retired') and (
    new.version is distinct from old.version or new.title is distinct from old.title
    or new.body_html is distinct from old.body_html
    or new.content_sha256 is distinct from old.content_sha256
    or new.approval_reference is distinct from old.approval_reference
    or new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at
  ) then
    raise exception 'Approved affiliate agreement templates are immutable.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists protect_affiliate_agreement_template_trg on public.affiliate_agreement_templates;
create trigger protect_affiliate_agreement_template_trg before update on public.affiliate_agreement_templates
for each row execute function public.protect_affiliate_agreement_template();

create or replace function public.protect_affiliate_agreement_packet()
returns trigger language plpgsql set search_path = public as $$
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
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists protect_affiliate_agreement_packet_trg on public.affiliate_agreements;
create trigger protect_affiliate_agreement_packet_trg before update on public.affiliate_agreements
for each row execute function public.protect_affiliate_agreement_packet();

create or replace function public.block_affiliate_agreement_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Affiliate agreement events are append-only.';
end;
$$;
drop trigger if exists block_affiliate_agreement_event_update_trg on public.affiliate_agreement_events;
create trigger block_affiliate_agreement_event_update_trg before update or delete on public.affiliate_agreement_events
for each row execute function public.block_affiliate_agreement_event_mutation();

-- Replace broad baseline policies. Staff may read; only narrow RPCs or the
-- service role may write affiliate identity, terms, or activation state.
alter table public.affiliates enable row level security;
drop policy if exists "Admins can manage affiliates" on public.affiliates;
drop policy if exists "Affiliate select for auth lookup" on public.affiliates;
drop policy if exists "Affiliates can read own record" on public.affiliates;
drop policy if exists "Affiliates can update own user_id" on public.affiliates;
drop policy if exists "affiliate_select_own_or_matching_email" on public.affiliates;
drop policy if exists affiliate_staff_read on public.affiliates;
drop policy if exists affiliate_read_own on public.affiliates;
create policy affiliate_staff_read on public.affiliates for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor'))
);
create policy affiliate_read_own on public.affiliates for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.affiliates from anon, authenticated;
grant select on public.affiliates to authenticated;
grant all on public.affiliates to service_role;

-- Application rows are owner-scoped and cannot be approved by direct UPDATE.
drop policy if exists admin_manage_affiliate_applications on public.affiliate_applications;
drop policy if exists affiliate_application_owner_read on public.affiliate_applications;
drop policy if exists affiliate_application_owner_insert on public.affiliate_applications;
create policy affiliate_application_owner_read on public.affiliate_applications
for select to authenticated using (public.ccc_affiliate_owner(user_id));
create policy affiliate_application_owner_insert on public.affiliate_applications
for insert to authenticated with check (public.ccc_affiliate_owner(user_id) and status = 'pending');
revoke update, delete on public.affiliate_applications from authenticated;
grant select, insert on public.affiliate_applications to authenticated;

alter table public.affiliate_agreement_templates enable row level security;
alter table public.affiliate_agreements enable row level security;
alter table public.affiliate_agreement_events enable row level security;
drop policy if exists affiliate_template_staff_read on public.affiliate_agreement_templates;
drop policy if exists affiliate_template_signer_read on public.affiliate_agreement_templates;
drop policy if exists affiliate_agreement_owner_read on public.affiliate_agreements;
drop policy if exists affiliate_agreement_signer_read on public.affiliate_agreements;
drop policy if exists affiliate_agreement_event_owner_read on public.affiliate_agreement_events;
drop policy if exists affiliate_agreement_event_signer_read on public.affiliate_agreement_events;
create policy affiliate_template_staff_read on public.affiliate_agreement_templates
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor'))
);
create policy affiliate_template_signer_read on public.affiliate_agreement_templates
for select to authenticated using (
  exists (select 1 from public.affiliate_agreements a where a.template_id = affiliate_agreement_templates.id and a.portal_user_id = auth.uid())
);
create policy affiliate_agreement_owner_read on public.affiliate_agreements
for select to authenticated using (public.ccc_affiliate_owner(owner_user_id));
create policy affiliate_agreement_signer_read on public.affiliate_agreements
for select to authenticated using (portal_user_id = auth.uid());
create policy affiliate_agreement_event_owner_read on public.affiliate_agreement_events
for select to authenticated using (
  exists (select 1 from public.affiliate_agreements a where a.id = agreement_id and public.ccc_affiliate_owner(a.owner_user_id))
);
create policy affiliate_agreement_event_signer_read on public.affiliate_agreement_events
for select to authenticated using (
  exists (select 1 from public.affiliate_agreements a where a.id = agreement_id and a.portal_user_id = auth.uid())
);
revoke insert, update, delete on public.affiliate_agreement_templates from anon, authenticated;
revoke insert, update, delete on public.affiliate_agreements from anon, authenticated;
revoke insert, update, delete on public.affiliate_agreement_events from anon, authenticated;
grant select on public.affiliate_agreement_templates, public.affiliate_agreements, public.affiliate_agreement_events to authenticated;
grant all on public.affiliate_agreement_templates, public.affiliate_agreements, public.affiliate_agreement_events to service_role;

-- Auditors previously had full payout write access. They retain read access;
-- only admins can record or correct payouts.
drop policy if exists staff_all_commission_payouts on public.commission_payouts;
drop policy if exists commission_payout_staff_read on public.commission_payouts;
drop policy if exists commission_payout_owner_write on public.commission_payouts;
create policy commission_payout_staff_read on public.commission_payouts
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor'))
);
create policy commission_payout_owner_write on public.commission_payouts
for all to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
) with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- The retired two-argument approval path can no longer create immediate portal
-- access without a frozen compensation clause and agreement packet.
create or replace function public.approve_affiliate_application(
  p_application_id uuid,
  p_commission_rate numeric default 0.20
)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Use ccc_prepare_affiliate_agreement with the exact owner-approved compensation language.' using errcode = '55000';
end;
$$;

create or replace function public.ccc_prepare_affiliate_agreement(
  p_application_id uuid,
  p_commission_rate numeric,
  p_compensation_terms text,
  p_template_version text default 'ccc-affiliate-agreement-v1-draft'
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_application public.affiliate_applications%rowtype;
  v_affiliate public.affiliates%rowtype;
  v_template public.affiliate_agreement_templates%rowtype;
  v_agreement public.affiliate_agreements%rowtype;
  v_now timestamptz := now();
  v_terms text := btrim(coalesce(p_compensation_terms, ''));
begin
  select * into v_application from public.affiliate_applications
  where id = p_application_id for update;
  if not found then raise exception 'Affiliate application not found'; end if;
  if not public.ccc_affiliate_owner(v_application.user_id) then
    raise exception 'Only the application owner may set partner terms' using errcode = '42501';
  end if;
  if v_application.status = 'rejected' then raise exception 'Rejected applications cannot be prepared'; end if;
  if p_commission_rate is null or p_commission_rate <= 0 or p_commission_rate > 1 then
    raise exception 'Commission rate must be greater than 0 and no more than 1';
  end if;
  if length(v_terms) < 10 or length(v_terms) > 4000 then
    raise exception 'Enter the exact owner-approved compensation terms (10-4000 characters)';
  end if;
  select * into v_template from public.affiliate_agreement_templates
  where version = p_template_version;
  if not found then raise exception 'Affiliate agreement template not found'; end if;

  perform pg_advisory_xact_lock(hashtextextended('affiliate:' || lower(v_application.email), 0));
  if v_application.affiliate_id is not null then
    select * into v_affiliate from public.affiliates where id = v_application.affiliate_id for update;
  else
    select * into v_affiliate from public.affiliates
    where lower(btrim(email)) = lower(btrim(v_application.email)) order by created_at limit 1 for update;
  end if;
  if not found then
    insert into public.affiliates (
      owner_user_id, name, email, company, commission_rate,
      brand_name, brand_color, program_status, status_changed_at
    ) values (
      v_application.user_id, v_application.name, lower(btrim(v_application.email)),
      nullif(btrim(v_application.company), ''), p_commission_rate,
      coalesce(nullif(btrim(v_application.company), ''), v_application.name), '#22C55E',
      'agreement_pending', v_now
    ) returning * into v_affiliate;
  elsif v_affiliate.owner_user_id is distinct from v_application.user_id then
    raise exception 'A partner with this email belongs to a different owner' using errcode = '23505';
  elsif v_affiliate.program_status in ('legacy_active', 'active') then
    -- The initial-onboarding workflow must never replace live compensation
    -- before a dedicated renewal packet has been signed and activated.
    raise exception 'Existing active partners require the agreement-renewal workflow; current access and compensation were not changed' using errcode = '55000';
  else
    update public.affiliates set commission_rate = p_commission_rate,
      program_status = 'agreement_pending',
      status_changed_at = v_now
    where id = v_affiliate.id returning * into v_affiliate;
  end if;

  update public.affiliate_agreements
  set status = 'superseded', superseded_at = v_now
  where affiliate_id = v_affiliate.id and status in ('draft', 'sent', 'signed');

  insert into public.affiliate_agreements (
    affiliate_id, application_id, owner_user_id, template_id, template_version,
    applicant_snapshot, compensation_snapshot, document_snapshot, created_by
  ) values (
    v_affiliate.id, v_application.id, v_application.user_id, v_template.id, v_template.version,
    jsonb_build_object(
      'name', v_application.name, 'email', v_application.email, 'phone', v_application.phone,
      'company', v_application.company, 'websiteUrl', v_application.website_url,
      'referralNotes', v_application.referral_notes
    ),
    jsonb_build_object(
      'commissionRate', p_commission_rate, 'compensationTerms', v_terms,
      'setBy', v_caller, 'setAt', v_now
    ),
    jsonb_build_object(
      'templateVersion', v_template.version, 'title', v_template.title,
      'legalStatus', v_template.legal_status, 'bodyHtml', coalesce(v_template.body_html, ''),
      'contentSha256', coalesce(v_template.content_sha256, encode(digest(coalesce(v_template.body_html, ''), 'sha256'), 'hex')),
      'approvalReference', v_template.approval_reference, 'preparedAt', v_now
    ),
    v_caller
  ) returning * into v_agreement;

  update public.affiliates set current_agreement_id = v_agreement.id where id = v_affiliate.id;
  update public.affiliate_applications set
    status = 'approved', affiliate_id = v_affiliate.id, reviewed_by = v_caller,
    reviewed_at = coalesce(reviewed_at, v_now), updated_at = v_now
  where id = v_application.id;
  insert into public.affiliate_agreement_events (agreement_id, event_type, actor_type, actor_id, event_data)
  values (v_agreement.id, 'prepared', 'owner', v_caller,
    jsonb_build_object('templateVersion', v_template.version, 'legalStatus', v_template.legal_status));

  return jsonb_build_object(
    'affiliateId', v_affiliate.id, 'agreementId', v_agreement.id,
    'status', v_agreement.status, 'templateVersion', v_template.version,
    'legalStatus', v_template.legal_status,
    'sendBlocked', v_template.legal_status <> 'approved' or coalesce(v_template.body_html, '') = '',
    'blockers', case when v_template.legal_status <> 'approved' then jsonb_build_array('COUNSEL_APPROVAL_REQUIRED') else '[]'::jsonb end
  );
end;
$$;

create or replace function public.reject_affiliate_application(
  p_application_id uuid,
  p_notes text default null
)
returns public.affiliate_applications language plpgsql security definer set search_path = public as $$
declare
  v_application public.affiliate_applications%rowtype;
begin
  select * into v_application from public.affiliate_applications where id = p_application_id for update;
  if not found then raise exception 'Affiliate application not found'; end if;
  if not public.ccc_affiliate_owner(v_application.user_id) then
    raise exception 'Only the application owner may reject it' using errcode = '42501';
  end if;
  if length(coalesce(p_notes, '')) > 1000 then raise exception 'Review notes exceed the allowed length'; end if;
  if v_application.status = 'rejected' then return v_application; end if;
  if v_application.status <> 'pending' then raise exception 'Only pending applications can be rejected'; end if;
  update public.affiliate_applications set status = 'rejected', reviewed_by = auth.uid(),
    reviewed_at = now(), review_notes = nullif(btrim(p_notes), ''), updated_at = now()
  where id = p_application_id returning * into v_application;
  return v_application;
end;
$$;

create or replace function public.ccc_update_affiliate_profile(
  p_affiliate_id uuid, p_name text, p_email text, p_company text,
  p_brand_name text, p_brand_logo_url text, p_brand_color text
)
returns public.affiliates language plpgsql security definer set search_path = public as $$
declare v_affiliate public.affiliates%rowtype;
begin
  select * into v_affiliate from public.affiliates where id = p_affiliate_id for update;
  if not found then raise exception 'Affiliate not found'; end if;
  if not public.ccc_affiliate_owner(v_affiliate.owner_user_id) then raise exception 'Owner access required' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'Affiliate name is required'; end if;
  if lower(btrim(coalesce(p_email, ''))) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Valid email required'; end if;
  if coalesce(p_brand_color, '') !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Brand color must be a six-digit hex value'; end if;
  if v_affiliate.user_id is not null and lower(btrim(p_email)) <> lower(btrim(v_affiliate.email)) then
    raise exception 'A linked portal email cannot be changed without a verified identity migration';
  end if;
  update public.affiliates set name = btrim(p_name), email = lower(btrim(p_email)),
    company = nullif(btrim(p_company), ''), brand_name = nullif(btrim(p_brand_name), ''),
    brand_logo_url = nullif(btrim(p_brand_logo_url), ''), brand_color = p_brand_color
  where id = p_affiliate_id returning * into v_affiliate;
  return v_affiliate;
end;
$$;

create or replace function public.ccc_update_legacy_affiliate_commission_rate(p_affiliate_id uuid, p_commission_rate numeric)
returns public.affiliates language plpgsql security definer set search_path = public as $$
declare v_affiliate public.affiliates%rowtype;
begin
  select * into v_affiliate from public.affiliates where id = p_affiliate_id for update;
  if not found then raise exception 'Affiliate not found'; end if;
  if not public.ccc_affiliate_owner(v_affiliate.owner_user_id) then raise exception 'Owner access required' using errcode = '42501'; end if;
  if v_affiliate.program_status <> 'legacy_active' then
    raise exception 'Agreement-based partner compensation changes require a new signed agreement';
  end if;
  if p_commission_rate is null or p_commission_rate <= 0 or p_commission_rate > 1 then raise exception 'Invalid commission rate'; end if;
  update public.affiliates set commission_rate = p_commission_rate where id = p_affiliate_id returning * into v_affiliate;
  return v_affiliate;
end;
$$;

-- Server-only identity linking and agreement lifecycle gates.
create or replace function public.ccc_link_affiliate_portal_identity(p_affiliate_id uuid, p_portal_user_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_affiliate public.affiliates%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if p_portal_user_id is null then raise exception 'Portal identity is required'; end if;
  select * into v_affiliate from public.affiliates where id = p_affiliate_id for update;
  if not found then raise exception 'Affiliate not found'; end if;
  if v_affiliate.user_id is not null and v_affiliate.user_id <> p_portal_user_id then raise exception 'Affiliate is linked to another identity'; end if;
  if exists (select 1 from public.affiliates where user_id = p_portal_user_id and id <> p_affiliate_id) then
    raise exception 'Portal identity is already linked to another affiliate';
  end if;
  if exists (select 1 from public.profiles where id = p_portal_user_id and role in ('admin','auditor','client'))
     or exists (select 1 from public.client_profiles where user_id = p_portal_user_id) then
    raise exception 'Staff and client identities cannot be linked to an affiliate portal';
  end if;
  update public.affiliates set user_id = p_portal_user_id where id = p_affiliate_id;
  return p_affiliate_id;
end;
$$;

create or replace function public.ccc_claim_legacy_affiliate_portal_identity()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_affiliate public.affiliates%rowtype; v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); v_matches integer;
begin
  if auth.uid() is null or v_email = '' then raise exception 'Authenticated email required' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','auditor','client')) then
    raise exception 'Staff and client identities cannot claim an affiliate portal' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('affiliate:' || v_email, 0));
  select count(*) into v_matches from public.affiliates
    where lower(btrim(email)) = v_email and program_status = 'legacy_active';
  if v_matches <> 1 then raise exception 'A single eligible legacy affiliate record is required' using errcode = '42501'; end if;
  select * into v_affiliate from public.affiliates
    where lower(btrim(email)) = v_email and program_status = 'legacy_active' for update;
  if not found then raise exception 'No eligible legacy affiliate record found' using errcode = '42501'; end if;
  if v_affiliate.user_id is not null and v_affiliate.user_id <> auth.uid() then raise exception 'Affiliate identity already linked' using errcode = '42501'; end if;
  if exists (select 1 from public.affiliates where user_id = auth.uid() and id <> v_affiliate.id) then
    raise exception 'Portal identity is already linked to another affiliate' using errcode = '42501';
  end if;
  if exists (select 1 from public.client_profiles where user_id = auth.uid()) then
    raise exception 'Client identities cannot claim an affiliate portal' using errcode = '42501';
  end if;
  update public.affiliates set user_id = auth.uid() where id = v_affiliate.id returning * into v_affiliate;
  return jsonb_build_object('affiliateId', v_affiliate.id, 'programStatus', v_affiliate.program_status, 'hasPortalAccess', true);
end;
$$;

create or replace function public.ccc_mark_affiliate_agreement_sent(
  p_agreement_id uuid, p_portal_user_id uuid, p_expires_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_agreement public.affiliate_agreements%rowtype; v_template public.affiliate_agreement_templates%rowtype; v_is_resend boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  select * into v_agreement from public.affiliate_agreements where id = p_agreement_id for update;
  if not found then raise exception 'Affiliate agreement not found'; end if;
  select * into v_template from public.affiliate_agreement_templates where id = v_agreement.template_id;
  if v_agreement.status not in ('draft','sent') then raise exception 'Only a draft or previously sent agreement can be sent'; end if;
  v_is_resend := v_agreement.status = 'sent';
  if v_is_resend and v_agreement.portal_user_id <> p_portal_user_id then
    raise exception 'The agreement is linked to a different portal identity';
  end if;
  if v_template.legal_status <> 'approved' or coalesce(v_template.body_html, '') = '' then raise exception 'COUNSEL_APPROVAL_REQUIRED'; end if;
  if v_agreement.document_snapshot ->> 'legalStatus' <> 'approved'
     or v_agreement.document_snapshot ->> 'contentSha256' <> v_template.content_sha256
     or encode(digest(v_agreement.document_snapshot ->> 'bodyHtml', 'sha256'), 'hex') <> v_template.content_sha256 then
    raise exception 'Prepare a new immutable packet from the approved template';
  end if;
  if p_expires_at <= now() then raise exception 'Signing expiration must be in the future'; end if;
  perform public.ccc_link_affiliate_portal_identity(v_agreement.affiliate_id, p_portal_user_id);
  update public.affiliate_agreements set status = 'sent', portal_user_id = p_portal_user_id,
    sent_at = coalesce(sent_at, now()), signing_expires_at = p_expires_at where id = p_agreement_id returning * into v_agreement;
  update public.affiliates set program_status = 'agreement_sent', status_changed_at = now()
    where id = v_agreement.affiliate_id and program_status not in ('legacy_active', 'active');
  insert into public.affiliate_agreement_events (agreement_id,event_type,actor_type,event_data)
    values (p_agreement_id,'sent','system',jsonb_build_object('expiresAt',p_expires_at,'portalUserId',p_portal_user_id,'resend',v_is_resend));
  return jsonb_build_object('agreementId',p_agreement_id,'status','sent','expiresAt',p_expires_at,'resend',v_is_resend);
end;
$$;

create or replace function public.ccc_complete_affiliate_agreement(
  p_agreement_id uuid, p_portal_user_id uuid, p_signer_name text,
  p_signer_ip inet, p_user_agent text, p_signature_sha256 text,
  p_signed_document_path text, p_signed_document_hash text, p_event_data jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_agreement public.affiliate_agreements%rowtype; v_template public.affiliate_agreement_templates%rowtype; v_now timestamptz := now();
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  select * into v_agreement from public.affiliate_agreements where id = p_agreement_id for update;
  if not found then raise exception 'Affiliate agreement not found'; end if;
  select * into v_template from public.affiliate_agreement_templates where id = v_agreement.template_id;
  if v_agreement.status = 'signed' and v_agreement.portal_user_id = p_portal_user_id then
    return jsonb_build_object('agreementId',v_agreement.id,'affiliateId',v_agreement.affiliate_id,'status','signed','idempotent',true);
  end if;
  if v_agreement.status <> 'sent' or v_agreement.portal_user_id <> p_portal_user_id then raise exception 'Agreement is not available to this signer'; end if;
  if v_agreement.signing_expires_at <= v_now then raise exception 'Agreement signing window expired'; end if;
  if v_template.legal_status <> 'approved' or v_agreement.document_snapshot ->> 'legalStatus' <> 'approved' then raise exception 'COUNSEL_APPROVAL_REQUIRED'; end if;
  if v_agreement.document_snapshot ->> 'contentSha256' <> v_template.content_sha256
     or encode(digest(v_agreement.document_snapshot ->> 'bodyHtml', 'sha256'), 'hex') <> v_template.content_sha256 then
    raise exception 'The frozen agreement does not match the approved template';
  end if;
  if length(btrim(coalesce(p_signer_name,''))) < 2 then raise exception 'Signer legal name required'; end if;
  if coalesce(p_signature_sha256,'') !~ '^[0-9a-f]{64}$' or coalesce(p_signed_document_hash,'') !~ '^[0-9a-f]{64}$' then raise exception 'Invalid signing evidence hash'; end if;
  if coalesce(p_event_data #>> '{acknowledgements,affiliate_agreement}', 'false') <> 'true'
     or coalesce(p_event_data #>> '{acknowledgements,compensation_terms}', 'false') <> 'true'
     or coalesce(p_event_data #>> '{acknowledgements,electronic_records}', 'false') <> 'true' then
    raise exception 'All affiliate agreement acknowledgements are required';
  end if;
  if left(coalesce(p_signed_document_path,''), length('affiliate-agreements/' || v_agreement.owner_user_id || '/' || v_agreement.affiliate_id || '/' || v_agreement.id || '/'))
     <> 'affiliate-agreements/' || v_agreement.owner_user_id || '/' || v_agreement.affiliate_id || '/' || v_agreement.id || '/' then
    raise exception 'Signed document storage path is outside the agreement scope';
  end if;
  update public.affiliate_agreements set status='signed', signed_at=v_now, signer_name=btrim(p_signer_name),
    signer_ip=p_signer_ip, signer_user_agent=left(coalesce(p_user_agent,''),500), signature_sha256=p_signature_sha256,
    signed_document_path=p_signed_document_path, signed_document_hash=p_signed_document_hash
  where id=p_agreement_id returning * into v_agreement;
  update public.affiliates set program_status='agreement_signed', status_changed_at=v_now
    where id=v_agreement.affiliate_id and program_status not in ('legacy_active','active');
  insert into public.affiliate_agreement_events (agreement_id,event_type,actor_type,actor_id,event_data)
    values (p_agreement_id,'signed','affiliate',p_portal_user_id,p_event_data || jsonb_build_object('documentHash',p_signed_document_hash,'signatureHash',p_signature_sha256));
  return jsonb_build_object('agreementId',v_agreement.id,'affiliateId',v_agreement.affiliate_id,'status','signed','awaitingActivation',true);
end;
$$;

create or replace function public.ccc_mark_affiliate_agreement_viewed(
  p_agreement_id uuid, p_portal_user_id uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_agreement public.affiliate_agreements%rowtype; v_now timestamptz := now();
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  select * into v_agreement from public.affiliate_agreements where id = p_agreement_id for update;
  if not found or v_agreement.portal_user_id <> p_portal_user_id then
    raise exception 'Agreement is not available to this viewer' using errcode = '42501';
  end if;
  if v_agreement.status not in ('sent','signed','activated') then raise exception 'Agreement is not viewable'; end if;
  if v_agreement.viewed_at is null then
    update public.affiliate_agreements set viewed_at = v_now where id = p_agreement_id;
    insert into public.affiliate_agreement_events (agreement_id,event_type,actor_type,actor_id,event_data)
      values (p_agreement_id,'viewed','affiliate',p_portal_user_id,jsonb_build_object('firstViewedAt',v_now));
  else
    v_now := v_agreement.viewed_at;
  end if;
  return jsonb_build_object('agreementId',p_agreement_id,'viewedAt',v_now);
end;
$$;

create or replace function public.ccc_activate_affiliate(p_affiliate_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_affiliate public.affiliates%rowtype; v_agreement public.affiliate_agreements%rowtype; v_template public.affiliate_agreement_templates%rowtype; v_now timestamptz:=now(); v_rate numeric;
begin
  select * into v_affiliate from public.affiliates where id=p_affiliate_id for update;
  if not found then raise exception 'Affiliate not found'; end if;
  if not public.ccc_affiliate_owner(v_affiliate.owner_user_id) then raise exception 'Owner access required' using errcode='42501'; end if;
  select * into v_agreement from public.affiliate_agreements where id=v_affiliate.current_agreement_id for update;
  if not found then raise exception 'A signed current agreement is required before activation'; end if;
  if v_affiliate.program_status='active' and v_agreement.status='activated' then
    return jsonb_build_object('affiliateId',v_affiliate.id,'agreementId',v_agreement.id,'status','active','idempotent',true);
  end if;
  if v_agreement.status <> 'signed' then raise exception 'A signed current agreement is required before activation'; end if;
  if v_agreement.affiliate_id <> v_affiliate.id or v_agreement.owner_user_id <> v_affiliate.owner_user_id then
    raise exception 'Current agreement ownership does not match the affiliate';
  end if;
  select * into v_template from public.affiliate_agreement_templates where id=v_agreement.template_id;
  if v_template.legal_status <> 'approved' or v_agreement.signed_document_hash is null
     or v_agreement.document_snapshot ->> 'contentSha256' <> v_template.content_sha256
     or encode(digest(v_agreement.document_snapshot ->> 'bodyHtml', 'sha256'), 'hex') <> v_template.content_sha256 then
    raise exception 'Approved immutable agreement evidence is required';
  end if;
  v_rate := (v_agreement.compensation_snapshot ->> 'commissionRate')::numeric;
  if v_rate is null or v_rate <= 0 or v_rate > 1 then raise exception 'Signed agreement contains an invalid commission rate'; end if;
  update public.affiliate_agreements set status='activated',activated_at=v_now,activated_by=auth.uid() where id=v_agreement.id;
  update public.affiliates set program_status='active',commission_rate=v_rate,activated_at=v_now,activated_by=auth.uid(),status_changed_at=v_now where id=v_affiliate.id;
  insert into public.affiliate_agreement_events(agreement_id,event_type,actor_type,actor_id,event_data)
    values(v_agreement.id,'activated','owner',auth.uid(),jsonb_build_object('portalAccessGranted',true));
  return jsonb_build_object('affiliateId',v_affiliate.id,'agreementId',v_agreement.id,'status','active');
end;
$$;

create or replace function public.ccc_current_affiliate_access_state()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'affiliateId', a.id, 'name', a.name, 'email', a.email,
    'programStatus', a.program_status,
    'hasPortalAccess', a.program_status in ('legacy_active','active'),
    'agreement', case when ag.id is null then null else jsonb_build_object(
      'id', ag.id, 'status', ag.status, 'templateVersion', ag.template_version,
      'applicantSnapshot', ag.applicant_snapshot,
      'compensationSnapshot', ag.compensation_snapshot,
      'documentSnapshot', ag.document_snapshot,
      'sentAt', ag.sent_at, 'signingExpiresAt', ag.signing_expires_at,
      'signedAt', ag.signed_at, 'activatedAt', ag.activated_at
    ) end
  )
  from public.affiliates a
  left join public.affiliate_agreements ag on ag.id=a.current_agreement_id
  where a.user_id=auth.uid()
    and (select count(*) from public.affiliates linked where linked.user_id=auth.uid()) = 1
  limit 1
$$;

revoke all on function public.approve_affiliate_application(uuid,numeric) from public;
revoke all on function public.reject_affiliate_application(uuid,text) from public;
revoke all on function public.ccc_prepare_affiliate_agreement(uuid,numeric,text,text) from public;
revoke all on function public.ccc_update_affiliate_profile(uuid,text,text,text,text,text,text) from public;
revoke all on function public.ccc_update_legacy_affiliate_commission_rate(uuid,numeric) from public;
revoke all on function public.ccc_link_affiliate_portal_identity(uuid,uuid) from public;
revoke all on function public.ccc_claim_legacy_affiliate_portal_identity() from public;
revoke all on function public.ccc_mark_affiliate_agreement_sent(uuid,uuid,timestamptz) from public;
revoke all on function public.ccc_complete_affiliate_agreement(uuid,uuid,text,inet,text,text,text,text,jsonb) from public;
revoke all on function public.ccc_mark_affiliate_agreement_viewed(uuid,uuid) from public;
revoke all on function public.ccc_activate_affiliate(uuid) from public;
revoke all on function public.ccc_current_affiliate_access_state() from public;
grant execute on function public.approve_affiliate_application(uuid,numeric) to authenticated;
grant execute on function public.reject_affiliate_application(uuid,text) to authenticated;
grant execute on function public.ccc_prepare_affiliate_agreement(uuid,numeric,text,text) to authenticated;
grant execute on function public.ccc_update_affiliate_profile(uuid,text,text,text,text,text,text) to authenticated;
grant execute on function public.ccc_update_legacy_affiliate_commission_rate(uuid,numeric) to authenticated;
grant execute on function public.ccc_claim_legacy_affiliate_portal_identity() to authenticated;
grant execute on function public.ccc_activate_affiliate(uuid) to authenticated;
grant execute on function public.ccc_current_affiliate_access_state() to authenticated;
grant execute on function public.ccc_link_affiliate_portal_identity(uuid,uuid) to service_role;
grant execute on function public.ccc_mark_affiliate_agreement_sent(uuid,uuid,timestamptz) to service_role;
grant execute on function public.ccc_complete_affiliate_agreement(uuid,uuid,text,inet,text,text,text,text,jsonb) to service_role;
grant execute on function public.ccc_mark_affiliate_agreement_viewed(uuid,uuid) to service_role;

-- Rollback: point the app back to the legacy invite route, restore the prior
-- policies/functions from their migrations, then drop the new functions,
-- event/agreement/template tables, FK, and additive affiliate columns. Existing
-- affiliate/application/client records remain untouched.
