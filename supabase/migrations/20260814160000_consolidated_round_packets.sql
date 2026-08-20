-- Consolidated round packets are additive. Legacy and already-started campaigns
-- remain packet_version 1 and keep the one-account-per-letter workflow.

alter table public.client_campaigns
  add column if not exists packet_version smallint not null default 1;

alter table public.client_campaigns
  drop constraint if exists client_campaigns_packet_version_check,
  add constraint client_campaigns_packet_version_check check (packet_version in (1, 2));

alter table public.campaign_letter_routes
  add column if not exists dispute_basis text,
  add column if not exists recipient_key text;

alter table public.campaign_items
  add column if not exists route_review jsonb not null default '{}'::jsonb;

alter table public.campaign_items
  drop constraint if exists campaign_items_route_review_object_check,
  add constraint campaign_items_route_review_object_check check (jsonb_typeof(route_review) = 'object');

alter table public.campaign_letter_routes
  drop constraint if exists campaign_letter_routes_dispute_basis_check,
  add constraint campaign_letter_routes_dispute_basis_check check (
    dispute_basis is null or dispute_basis in ('FCRA_DIRECT', 'FDCPA')
  );

drop index if exists public.campaign_letter_routes_nonbureau_uidx;
create unique index if not exists campaign_letter_routes_nonbureau_uidx
  on public.campaign_letter_routes (campaign_id, item_id, target_type, coalesce(dispute_basis, ''))
  where target_type <> 'bureau';

alter table public.letters
  add column if not exists packet_version smallint not null default 1;

alter table public.letters
  drop constraint if exists letters_packet_version_check,
  add constraint letters_packet_version_check check (packet_version in (1, 2));

-- Existing source links remain the compatibility source. The item id array
-- scopes a shared prior packet/response to the accounts that may use it.
alter table public.letter_source_links
  add column if not exists campaign_item_ids uuid[] not null default '{}';

alter table public.response_evidence
  add column if not exists packet_upload boolean not null default false;

create unique index if not exists response_evidence_one_packet_upload_uidx
  on public.response_evidence (letter_id)
  where packet_upload and upload_status in ('uploading', 'received');

create table if not exists public.letter_account_coverage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  campaign_id uuid not null references public.client_campaigns(id) on delete restrict,
  campaign_route_id uuid not null references public.campaign_letter_routes(id) on delete restrict,
  campaign_item_id uuid not null references public.campaign_items(id) on delete restrict,
  letter_id text not null,
  client_account_id uuid not null references public.client_accounts(id) on delete restrict,
  dispute_round_id uuid not null references public.dispute_rounds(id) on delete restrict,
  coverage_order smallint not null check (coverage_order between 1 and 5),
  frozen_findings jsonb not null default '[]'::jsonb,
  expected_recipient jsonb not null default '{}'::jsonb,
  mail_status text not null default 'not_sent' check (mail_status in (
    'not_sent', 'queued', 'processing', 'in_transit', 'delivered', 'returned', 'failed', 'cancelled'
  )),
  tracking_status text,
  delivered_at timestamptz,
  response_status text not null default 'not_received' check (response_status in (
    'not_received', 'received', 'analyzing', 'review_ready', 'reviewed'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, letter_id) references public.letters(user_id, id) on delete cascade,
  unique (letter_id, campaign_item_id),
  unique (letter_id, coverage_order),
  unique (letter_id, dispute_round_id),
  check (jsonb_typeof(frozen_findings) = 'array'),
  check (jsonb_typeof(expected_recipient) = 'object')
);

create index if not exists letter_account_coverage_account_idx
  on public.letter_account_coverage (client_account_id, created_at desc);
create index if not exists letter_account_coverage_route_idx
  on public.letter_account_coverage (campaign_route_id, coverage_order);
create index if not exists letter_account_coverage_letter_idx
  on public.letter_account_coverage (user_id, letter_id, coverage_order);

create table if not exists public.response_evidence_account_assessment (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  response_evidence_id uuid not null references public.response_evidence(id) on delete cascade,
  coverage_id uuid not null references public.letter_account_coverage(id) on delete cascade,
  client_account_id uuid not null references public.client_accounts(id) on delete restrict,
  disposition text check (disposition is null or disposition in (
    'corrected_deleted', 'verified', 'partial', 'needs_documents',
    'no_response', 'follow_up_eligible', 'resolved'
  )),
  cited_pages jsonb not null default '[]'::jsonb,
  analysis jsonb,
  review_status text not null default 'not_reviewed' check (review_status in ('not_reviewed', 'reviewed')),
  next_action text check (next_action is null or next_action in (
    'resolved', 'next_round', 'needs_documents', 'escalate'
  )),
  staff_notes text,
  client_document_request text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (response_evidence_id, coverage_id),
  check (jsonb_typeof(cited_pages) = 'array')
);

create index if not exists response_account_assessment_evidence_idx
  on public.response_evidence_account_assessment (response_evidence_id, review_status);
create index if not exists response_account_assessment_account_idx
  on public.response_evidence_account_assessment (client_account_id, created_at desc);

alter table public.letter_account_coverage enable row level security;
alter table public.response_evidence_account_assessment enable row level security;

drop policy if exists "staff_manage_letter_account_coverage" on public.letter_account_coverage;
create policy "staff_manage_letter_account_coverage" on public.letter_account_coverage
for all to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
      and (p.role = 'admin' or letter_account_coverage.user_id = p.id)
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
      and (p.role = 'admin' or letter_account_coverage.user_id = p.id)
  )
);

drop policy if exists "staff_manage_response_account_assessment" on public.response_evidence_account_assessment;
create policy "staff_manage_response_account_assessment" on public.response_evidence_account_assessment
for all to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
      and (p.role = 'admin' or response_evidence_account_assessment.user_id = p.id)
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
      and (p.role = 'admin' or response_evidence_account_assessment.user_id = p.id)
  )
);

grant select, insert, update, delete on public.letter_account_coverage,
  public.response_evidence_account_assessment to authenticated;
grant all on public.letter_account_coverage,
  public.response_evidence_account_assessment to service_role;

-- Clients receive packet-safe status only. Findings, analysis, and staff notes
-- intentionally stay behind the staff-only table policies above.
create or replace view public.client_packet_account_status
with (security_barrier = true)
as
select
  coverage.id as coverage_id,
  coverage.client_id,
  coverage.letter_id,
  coverage.campaign_id,
  coverage.campaign_route_id,
  coverage.campaign_item_id,
  coverage.dispute_round_id,
  coverage.coverage_order,
  item.label as account_label,
  coalesce(item.snapshot ->> 'accountNumberMasked', '') as masked_account,
  letter.target_type,
  letter.target_bureau,
  letter.round_number,
  coverage.mail_status,
  coverage.tracking_status,
  coverage.delivered_at,
  coverage.response_status,
  assessment.client_progress,
  assessment.documents_requested,
  assessment.document_request
from public.letter_account_coverage coverage
join public.campaign_items item on item.id = coverage.campaign_item_id
join public.letters letter on letter.id = coverage.letter_id and letter.user_id = coverage.user_id
left join lateral (
  select
    case
      when a.next_action = 'resolved' then 'resolved'
      when a.next_action = 'needs_documents' then 'documents_requested'
      else 'next_step_being_prepared'
    end as client_progress,
    (a.next_action = 'needs_documents') as documents_requested,
    case when a.next_action = 'needs_documents' then a.client_document_request else null end as document_request
  from public.response_evidence_account_assessment a
  where a.coverage_id = coverage.id and a.review_status = 'reviewed'
  order by a.reviewed_at desc nulls last, a.created_at desc
  limit 1
) assessment on true
where exists (
  select 1 from public.client_profiles cp
  where cp.client_id = coverage.client_id and cp.user_id = auth.uid()
);

grant select on public.client_packet_account_status to authenticated;

create or replace function public.review_campaign_item_eligibility(
  p_item_id uuid,
  p_fdcpa_eligible boolean,
  p_notes text
)
returns public.campaign_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_item public.campaign_items%rowtype;
  v_campaign public.client_campaigns%rowtype;
begin
  if v_caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select role into v_role from public.profiles where id = v_caller;
  if v_role not in ('admin', 'auditor') then raise exception 'Staff access required' using errcode = '42501'; end if;
  select * into v_item from public.campaign_items where id = p_item_id for update;
  if not found or v_item.item_kind <> 'account' then raise exception 'Campaign account item not found'; end if;
  if v_role <> 'admin' and v_item.user_id <> v_caller then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into v_campaign from public.client_campaigns where id = v_item.campaign_id;
  if v_campaign.packet_version <> 2 then raise exception 'Eligibility review is available only for packet campaigns'; end if;
  if exists (
    select 1 from public.campaign_letter_routes route
    where route.campaign_id = v_item.campaign_id and coalesce(array_length(route.letter_ids, 1), 0) > 0
  ) then
    raise exception 'Eligibility cannot change after packet generation has started';
  end if;
  if p_fdcpa_eligible and upper(coalesce(v_item.snapshot ->> 'type', '')) <> 'C' then
    raise exception 'FDCPA review requires a collector/debt-purchaser account classification';
  end if;
  if p_fdcpa_eligible and nullif(btrim(p_notes), '') is null then
    raise exception 'Document the facts supporting FDCPA eligibility; account type alone is not sufficient';
  end if;
  update public.campaign_items
  set route_review = jsonb_build_object(
        'fdcpaValidationEligible', p_fdcpa_eligible,
        'notes', nullif(btrim(p_notes), ''),
        'reviewedBy', v_caller,
        'reviewedAt', now()
      ),
      updated_at = now()
  where id = v_item.id
  returning * into v_item;
  return v_item;
end;
$$;

revoke all on function public.review_campaign_item_eligibility(uuid, boolean, text) from public;
grant execute on function public.review_campaign_item_eligibility(uuid, boolean, text) to authenticated;

-- Packet mode only: atomically validates the complete recipient-compatible
-- group, opens one round per account, and creates one packet placeholder.
create or replace function public.start_campaign_packet(
  p_route_id uuid,
  p_sources jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_route public.campaign_letter_routes%rowtype;
  v_campaign public.client_campaigns%rowtype;
  v_client public.clients%rowtype;
  v_item public.campaign_items%rowtype;
  v_account public.client_accounts%rowtype;
  v_round public.dispute_rounds%rowtype;
  v_source jsonb;
  v_source_letter public.letters%rowtype;
  v_evidence public.response_evidence%rowtype;
  v_item_ids uuid[];
  v_round_ids uuid[] := '{}';
  v_round_number integer;
  v_first_round_id uuid;
  v_first_round_number integer;
  v_first_item_id uuid;
  v_first_account_id uuid;
  v_first_account_label text;
  v_first_masked_account text;
  v_letter_id text := gen_random_uuid()::text;
  v_expected_recipient jsonb;
  v_expected_recipient_key text;
  v_current_recipient_key text;
  v_bureau_code text;
  v_coverage_order integer := 0;
  v_has_prior boolean;
  v_source_count integer;
  v_existing_link_id uuid;
  v_furnishers jsonb := '[]'::jsonb;
begin
  if v_caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = v_caller;
  if v_role not in ('admin', 'auditor') then
    raise exception 'Staff access required' using errcode = '42501';
  end if;

  select * into v_route from public.campaign_letter_routes where id = p_route_id for update;
  if not found or v_route.target_type not in ('furnisher', 'bureau') then
    raise exception 'Campaign packet route not found';
  end if;
  if v_role <> 'admin' and v_route.user_id <> v_caller then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_campaign from public.client_campaigns where id = v_route.campaign_id for update;
  select * into v_client from public.clients where id = v_campaign.client_id;
  if v_campaign.packet_version <> 2 then
    raise exception 'Consolidated packets are not enabled for this campaign';
  end if;
  if v_campaign.stage not in ('configure_letters', 'letter_review') then
    raise exception 'Campaign is not ready to build letters';
  end if;
  if coalesce(v_client.engagement_status, 'pending_onboarding') <> 'active' then
    raise exception 'New letters require an Active engagement';
  end if;
  if coalesce(array_length(v_route.letter_ids, 1), 0) > 0 then
    return jsonb_build_object(
      'round_id', v_route.dispute_round_id,
      'letter_ids', to_jsonb(v_route.letter_ids),
      'already_started', true
    );
  end if;

  v_item_ids := case
    when coalesce(array_length(v_route.item_ids, 1), 0) > 0 then v_route.item_ids
    else array[v_route.item_id]
  end;
  if array_length(v_item_ids, 1) < 1 or array_length(v_item_ids, 1) > 5 then
    raise exception 'An account packet must contain between one and five accounts';
  end if;
  if (select count(distinct id) from unnest(v_item_ids) as ids(id)) <> array_length(v_item_ids, 1) then
    raise exception 'Packet item ids must be unique';
  end if;
  if v_route.target_type = 'bureau' and v_route.target_bureau is null then
    raise exception 'Bureau packet requires a bureau';
  end if;
  if v_route.target_type = 'furnisher' and coalesce(v_route.dispute_basis, '') not in ('FCRA_DIRECT', 'FDCPA') then
    raise exception 'Direct packet requires an explicit validated legal path';
  end if;

  for v_item in
    select item.*
    from unnest(v_item_ids) with ordinality selected(id, position)
    join public.campaign_items item on item.id = selected.id
    order by selected.position
  loop
    v_coverage_order := v_coverage_order + 1;
    if v_item.campaign_id <> v_campaign.id or v_item.user_id <> v_campaign.user_id
       or v_item.item_kind <> 'account' or v_item.selection_state <> 'selected' then
      raise exception 'Packet includes an invalid or unselected account item';
    end if;
    if not exists (
      select 1
      from jsonb_array_elements(coalesce(v_item.snapshot -> 'findings', '[]'::jsonb)) finding
      where finding ->> 'outcome' = 'FLAG'
    ) then
      raise exception 'Packet includes an account without an authorized frozen finding';
    end if;

    select * into v_account from public.client_accounts where id = v_item.client_account_id;
    if not found or v_account.user_id <> v_campaign.user_id or v_account.client_id <> v_campaign.client_id then
      raise exception 'Packet account link is invalid';
    end if;

    if v_route.target_type = 'bureau' then
      v_bureau_code := case v_route.target_bureau
        when 'equifax' then 'EQ' when 'experian' then 'EXP' when 'transunion' then 'TU'
      end;
      if not (coalesce(v_item.snapshot -> 'bureaus', '[]'::jsonb) ? v_bureau_code) then
        raise exception 'Selected bureau is not active for every packet account';
      end if;
      v_current_recipient_key := 'bureau:' || v_route.target_bureau;
      v_expected_recipient := jsonb_build_object(
        'type', 'bureau', 'bureau', v_route.target_bureau
      );
    else
      if upper(coalesce(v_item.snapshot ->> 'addressStatus', '')) <> 'YES'
         or nullif(btrim(v_item.snapshot ->> 'furnisherAddress'), '') is null then
        raise exception 'Every direct packet account requires a verified dispute address';
      end if;
      if v_route.dispute_basis = 'FDCPA'
         and lower(coalesce(
           v_item.route_review ->> 'fdcpaValidationEligible',
           v_item.snapshot ->> 'fdcpaValidationEligible',
           'false'
         )) <> 'true' then
        raise exception 'FDCPA eligibility must be explicitly verified for every packet account';
      end if;
      v_current_recipient_key := 'furnisher:' || regexp_replace(
        lower(coalesce(v_item.snapshot ->> 'furnisher', v_item.label)), '[^a-z0-9]+', '', 'g'
      ) || ':' || regexp_replace(
        lower(v_item.snapshot ->> 'furnisherAddress'), '[^a-z0-9]+', '', 'g'
      ) || ':' || v_route.dispute_basis;
      v_expected_recipient := jsonb_build_object(
        'type', 'furnisher',
        'name', coalesce(v_item.snapshot ->> 'furnisher', v_item.label),
        'address', v_item.snapshot ->> 'furnisherAddress',
        'basis', v_route.dispute_basis
      );
    end if;

    if v_expected_recipient_key is null then
      v_expected_recipient_key := v_current_recipient_key;
    elsif v_expected_recipient_key <> v_current_recipient_key then
      raise exception 'Packet accounts do not share the same validated recipient and legal path';
    end if;
    if nullif(v_route.recipient_key, '') is not null
       and v_route.recipient_key <> v_current_recipient_key then
      raise exception 'Packet recipient no longer matches the reviewed Blueprint';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_account.id::text || ':' || v_route.target_type, 0));
    select exists (
      select 1 from public.dispute_rounds
      where user_id = v_campaign.user_id and client_account_id = v_account.id and status = 'closed'
    ) into v_has_prior;
    select count(*) into v_source_count
    from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) source
    where source ->> 'campaign_item_id' = v_item.id::text;
    if v_has_prior and v_source_count < 1 then
      raise exception 'Every later-round packet account requires reviewed prior evidence';
    end if;

    select * into v_round
    from public.dispute_rounds
    where campaign_id = v_campaign.id
      and client_account_id = v_account.id
      and target_type = v_route.target_type
    limit 1;
    if not found then
      select coalesce(max(round_number), 0) + 1 into v_round_number
      from public.dispute_rounds
      where user_id = v_campaign.user_id and client_account_id = v_account.id;
      insert into public.dispute_rounds (
        user_id, client_id, client_account_id, round_number, target_type,
        opened_by, campaign_id
      ) values (
        v_campaign.user_id, v_campaign.client_id, v_account.id, v_round_number,
        v_route.target_type, v_caller, v_campaign.id
      ) returning * into v_round;
    end if;

    if v_coverage_order = 1 then
      v_first_round_id := v_round.id;
      v_first_round_number := v_round.round_number;
      v_first_item_id := v_item.id;
      v_first_account_id := v_account.id;
      v_first_account_label := coalesce(v_account.display_furnisher, v_item.label);
      v_first_masked_account := coalesce(v_item.snapshot ->> 'accountNumberMasked', '');
    end if;
    v_round_ids := array_append(v_round_ids, v_round.id);
    if v_route.target_type = 'bureau' then
      v_furnishers := v_furnishers || jsonb_build_array(coalesce(v_account.display_furnisher, v_item.label));
    end if;
  end loop;

  if v_coverage_order <> array_length(v_item_ids, 1) then
    raise exception 'One or more packet items could not be loaded';
  end if;

  insert into public.letters (
    id, user_id, created_by, client_id, client_name, furnisher, account_id,
    client_account_id, phase, type, saved_at, date, html, dispute_basis,
    round_id, round_number, letter_kind, target_type, target_bureau,
    round_review_status, covered_furnishers, campaign_id, campaign_item_id,
    campaign_route_id, generation_style, packet_version
  ) values (
    v_letter_id, v_campaign.user_id, v_caller, v_campaign.client_id, v_client.name,
    v_first_account_label, v_first_masked_account, v_first_account_id,
    'Round ' || v_first_round_number::text || ' — ' ||
      case when v_route.target_type = 'bureau' then initcap(v_route.target_bureau) else 'Furnisher' end,
    case when v_route.dispute_basis = 'FDCPA' then 'Type C' else null end,
    now(), current_date::text, 'GENERATING...', v_route.dispute_basis,
    v_first_round_id, v_first_round_number, 'dispute', v_route.target_type,
    v_route.target_bureau, 'not_reviewed',
    case when v_route.target_type = 'bureau' then v_furnishers else '[]'::jsonb end,
    v_campaign.id, v_first_item_id, v_route.id, v_route.letter_style, 2
  );

  v_coverage_order := 0;
  for v_item in
    select item.*
    from unnest(v_item_ids) with ordinality selected(id, position)
    join public.campaign_items item on item.id = selected.id
    order by selected.position
  loop
    v_coverage_order := v_coverage_order + 1;
    select * into v_round
    from public.dispute_rounds
    where id = v_round_ids[v_coverage_order];
    if v_route.target_type = 'bureau' then
      v_expected_recipient := jsonb_build_object('type', 'bureau', 'bureau', v_route.target_bureau);
    else
      v_expected_recipient := jsonb_build_object(
        'type', 'furnisher',
        'name', coalesce(v_item.snapshot ->> 'furnisher', v_item.label),
        'address', v_item.snapshot ->> 'furnisherAddress',
        'basis', v_route.dispute_basis
      );
    end if;
    insert into public.letter_account_coverage (
      user_id, client_id, campaign_id, campaign_route_id, campaign_item_id,
      letter_id, client_account_id, dispute_round_id, coverage_order,
      frozen_findings, expected_recipient
    ) values (
      v_campaign.user_id, v_campaign.client_id, v_campaign.id, v_route.id, v_item.id,
      v_letter_id, v_item.client_account_id, v_round.id, v_coverage_order,
      coalesce(v_item.snapshot -> 'findings', '[]'::jsonb), v_expected_recipient
    );
  end loop;

  for v_source in select value from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) loop
    if not (v_item_ids @> array[(v_source ->> 'campaign_item_id')::uuid]) then
      raise exception 'Prior source is not scoped to a covered packet account';
    end if;
    select * into v_item from public.campaign_items
    where id = (v_source ->> 'campaign_item_id')::uuid and campaign_id = v_campaign.id;
    select * into v_source_letter from public.letters
    where user_id = v_campaign.user_id and id = v_source ->> 'source_letter_id';
    if not found or v_source_letter.mailed_date is null or not (
      v_source_letter.client_account_id = v_item.client_account_id
      or exists (
        select 1 from public.letter_account_coverage source_coverage
        where source_coverage.letter_id = v_source_letter.id
          and source_coverage.client_account_id = v_item.client_account_id
      )
    ) then
      raise exception 'Invalid prior source letter for a covered account';
    end if;
    select * into v_evidence from public.response_evidence
    where id = (v_source ->> 'response_evidence_id')::uuid
      and firm_user_id = v_campaign.user_id and letter_id = v_source_letter.id;
    if not found or v_evidence.analysis_status <> 'analyzed'
       or coalesce(v_evidence.review_status, 'not_reviewed') = 'not_reviewed' then
      raise exception 'Prior evidence is not analyzed and reviewed';
    end if;
    if v_source_letter.packet_version = 2 and not exists (
      select 1
      from public.letter_account_coverage source_coverage
      join public.response_evidence_account_assessment source_assessment
        on source_assessment.coverage_id = source_coverage.id
       and source_assessment.response_evidence_id = v_evidence.id
      where source_coverage.letter_id = v_source_letter.id
        and source_coverage.client_account_id = v_item.client_account_id
        and source_assessment.review_status = 'reviewed'
        and source_assessment.next_action in ('next_round', 'escalate')
    ) then
      raise exception 'Packet prior evidence is not reviewed and follow-up eligible for this account';
    end if;

    select id into v_existing_link_id from public.letter_source_links
    where user_id = v_campaign.user_id and letter_id = v_letter_id
      and source_letter_id = v_source_letter.id and response_evidence_id = v_evidence.id;
    if v_existing_link_id is null then
      insert into public.letter_source_links (
        user_id, letter_id, source_letter_id, response_evidence_id,
        apply_to_bureau, source_order, created_by, campaign_item_ids
      ) values (
        v_campaign.user_id, v_letter_id, v_source_letter.id, v_evidence.id,
        v_route.target_bureau, coalesce((v_source ->> 'source_order')::integer, 0),
        v_caller, array[v_item.id]
      );
    else
      update public.letter_source_links
      set campaign_item_ids = case
        when campaign_item_ids @> array[v_item.id] then campaign_item_ids
        else array_append(campaign_item_ids, v_item.id)
      end
      where id = v_existing_link_id;
    end if;
    v_existing_link_id := null;
  end loop;

  update public.campaign_letter_routes
  set status = 'generating', dispute_round_id = v_first_round_id,
      letter_ids = array[v_letter_id], generation_error = null,
      recipient_key = v_expected_recipient_key, updated_at = now()
  where id = v_route.id;
  update public.client_campaigns set stage = 'letter_review', updated_at = now()
  where id = v_campaign.id;

  return jsonb_build_object(
    'round_id', v_first_round_id,
    'round_ids', to_jsonb(v_round_ids),
    'letter_ids', jsonb_build_array(v_letter_id),
    'coverage_count', array_length(v_item_ids, 1)
  );
end;
$$;

revoke all on function public.start_campaign_packet(uuid, jsonb) from public;
grant execute on function public.start_campaign_packet(uuid, jsonb) to authenticated;

-- Staff review remains per covered account. Resolved accounts close now;
-- document requests stay open until the requested material is received.
create or replace function public.review_packet_account_assessment(
  p_assessment_id uuid,
  p_disposition text,
  p_next_action text,
  p_notes text default null,
  p_document_request text default null
)
returns public.response_evidence_account_assessment
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_assessment public.response_evidence_account_assessment%rowtype;
  v_coverage public.letter_account_coverage%rowtype;
begin
  if v_caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select role into v_role from public.profiles where id = v_caller;
  if v_role not in ('admin', 'auditor') then raise exception 'Staff access required' using errcode = '42501'; end if;
  if p_disposition not in ('corrected_deleted', 'verified', 'partial', 'needs_documents', 'no_response', 'follow_up_eligible', 'resolved') then
    raise exception 'Invalid account disposition';
  end if;
  if p_next_action not in ('resolved', 'next_round', 'needs_documents', 'escalate') then
    raise exception 'Invalid next action';
  end if;
  if p_disposition in ('corrected_deleted', 'resolved') and p_next_action <> 'resolved' then
    raise exception 'A resolved disposition must use the resolved next action';
  end if;
  if p_disposition = 'needs_documents' and p_next_action <> 'needs_documents' then
    raise exception 'A document request must use the needs_documents next action';
  end if;
  if p_next_action = 'needs_documents' and nullif(btrim(p_document_request), '') is null then
    raise exception 'Enter the client-facing document request before approval';
  end if;
  if length(coalesce(p_document_request, '')) > 1000 or length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Packet review notes exceed the allowed length';
  end if;

  select * into v_assessment from public.response_evidence_account_assessment
  where id = p_assessment_id for update;
  if not found then raise exception 'Packet account assessment not found'; end if;
  if v_role <> 'admin' and v_assessment.user_id <> v_caller then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_coverage from public.letter_account_coverage where id = v_assessment.coverage_id;

  update public.response_evidence_account_assessment
  set disposition = p_disposition, next_action = p_next_action,
      staff_notes = nullif(btrim(p_notes), ''), review_status = 'reviewed',
      client_document_request = case when p_next_action = 'needs_documents' then btrim(p_document_request) else null end,
      reviewed_by = v_caller, reviewed_at = now(), updated_at = now()
  where id = p_assessment_id
  returning * into v_assessment;

  update public.letter_account_coverage
  set response_status = 'reviewed', updated_at = now()
  where id = v_coverage.id;

  if p_next_action <> 'needs_documents' then
    update public.dispute_rounds
    set status = 'closed', final_disposition = case p_next_action
          when 'resolved' then 'resolved' when 'escalate' then 'escalate' else 'next_round' end,
        final_notes = nullif(btrim(p_notes), ''), closed_at = now(), closed_by = v_caller,
        updated_at = now()
    where id = v_coverage.dispute_round_id and status = 'open';
  end if;

  if not exists (
    select 1 from public.response_evidence_account_assessment sibling
    where sibling.response_evidence_id = v_assessment.response_evidence_id
      and sibling.review_status = 'not_reviewed'
  ) then
    update public.response_evidence
    set review_status = case
          when exists (
            select 1 from public.response_evidence_account_assessment sibling
            where sibling.response_evidence_id = v_assessment.response_evidence_id
              and sibling.next_action = 'needs_documents'
          ) then 'needs_documents'
          when exists (
            select 1 from public.response_evidence_account_assessment sibling
            where sibling.response_evidence_id = v_assessment.response_evidence_id
              and sibling.next_action = 'escalate'
          ) then 'escalated'
          when exists (
            select 1 from public.response_evidence_account_assessment sibling
            where sibling.response_evidence_id = v_assessment.response_evidence_id
              and sibling.next_action = 'next_round'
          ) then 'follow_up'
          else 'resolved'
        end,
        reviewed_by = v_caller, reviewed_at = now(), updated_at = now()
    where id = v_assessment.response_evidence_id;
  end if;
  return v_assessment;
end;
$$;

revoke all on function public.review_packet_account_assessment(uuid, text, text, text, text) from public;
grant execute on function public.review_packet_account_assessment(uuid, text, text, text, text) to authenticated;
