-- Client-level campaign orchestration. The existing forensic audit, adaptive
-- account rounds, generated letters, evidence, and mail records remain the
-- authoritative work product; these tables group them into one staff workflow.

create table if not exists public.client_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  audit_id text,
  round_number integer not null check (round_number > 0),
  stage text not null default 'select_disputes' check (stage in (
    'select_disputes', 'configure_letters', 'letter_review', 'mailing',
    'awaiting_responses', 'response_review', 'closed', 'cancelled', 'legacy'
  )),
  builder_mode text check (builder_mode is null or builder_mode in ('guided', 'custom', 'interim')),
  opened_by uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, client_id, round_number),
  foreign key (user_id, audit_id) references public.audits(user_id, id) on delete restrict
);

create unique index if not exists client_campaigns_one_active_idx
  on public.client_campaigns (user_id, client_id)
  where stage not in ('closed', 'cancelled', 'legacy');
create index if not exists client_campaigns_client_round_idx
  on public.client_campaigns (client_id, round_number desc);

create table if not exists public.campaign_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.client_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  item_kind text not null check (item_kind in ('account', 'personal_info', 'inquiry')),
  source_key text not null,
  client_account_id uuid references public.client_accounts(id) on delete restrict,
  label text not null,
  snapshot jsonb not null,
  selection_state text not null default 'candidate' check (selection_state in ('candidate', 'selected', 'later')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, source_key),
  check ((item_kind = 'account' and client_account_id is not null) or item_kind <> 'account')
);

create index if not exists campaign_items_campaign_state_idx
  on public.campaign_items (campaign_id, selection_state, sort_order);

create table if not exists public.campaign_letter_routes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.client_campaigns(id) on delete cascade,
  item_id uuid not null references public.campaign_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  target_type text not null check (target_type in ('furnisher', 'bureau', 'interim')),
  target_bureau text check (target_bureau is null or target_bureau in ('equifax', 'experian', 'transunion')),
  letter_style text not null default 'forensic' check (letter_style in (
    'forensic', 'metro2_accuracy', 'direct_furnisher', 'debt_validation',
    'personal_information', 'inquiry', 'procedural_request', 'custom'
  )),
  custom_instructions text,
  status text not null default 'configured' check (status in ('configured', 'generating', 'generated', 'failed')),
  dispute_round_id uuid references public.dispute_rounds(id) on delete restrict,
  letter_ids text[] not null default '{}',
  approved_letter_ids text[] not null default '{}',
  generation_error text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((target_type = 'bureau' and target_bureau is not null) or (target_type <> 'bureau' and target_bureau is null))
);

create index if not exists campaign_letter_routes_campaign_idx
  on public.campaign_letter_routes (campaign_id, status, created_at);
create unique index if not exists campaign_letter_routes_bureau_uidx
  on public.campaign_letter_routes (campaign_id,item_id,target_type,target_bureau)
  where target_type='bureau';
create unique index if not exists campaign_letter_routes_nonbureau_uidx
  on public.campaign_letter_routes (campaign_id,item_id,target_type)
  where target_type<>'bureau';

alter table public.client_campaigns enable row level security;
alter table public.campaign_items enable row level security;
alter table public.campaign_letter_routes enable row level security;

drop policy if exists "staff_manage_client_campaigns" on public.client_campaigns;
create policy "staff_manage_client_campaigns" on public.client_campaigns for all to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor') and (p.role = 'admin' or client_campaigns.user_id = p.id)))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor') and (p.role = 'admin' or client_campaigns.user_id = p.id)));

drop policy if exists "staff_manage_campaign_items" on public.campaign_items;
create policy "staff_manage_campaign_items" on public.campaign_items for all to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor') and (p.role = 'admin' or campaign_items.user_id = p.id)))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor') and (p.role = 'admin' or campaign_items.user_id = p.id)));

drop policy if exists "staff_manage_campaign_letter_routes" on public.campaign_letter_routes;
create policy "staff_manage_campaign_letter_routes" on public.campaign_letter_routes for all to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor') and (p.role = 'admin' or campaign_letter_routes.user_id = p.id)))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor') and (p.role = 'admin' or campaign_letter_routes.user_id = p.id)));

alter table public.dispute_rounds
  add column if not exists campaign_id uuid references public.client_campaigns(id) on delete restrict;

alter table public.dispute_rounds
  drop constraint if exists dispute_rounds_user_id_client_account_id_round_number_key;
drop index if exists public.dispute_rounds_one_open_per_account_idx;
create unique index if not exists dispute_rounds_legacy_round_number_uidx
  on public.dispute_rounds (user_id, client_account_id, round_number)
  where campaign_id is null;
create unique index if not exists dispute_rounds_campaign_target_uidx
  on public.dispute_rounds (campaign_id, client_account_id, target_type)
  where campaign_id is not null;
create unique index if not exists dispute_rounds_one_open_per_account_target_idx
  on public.dispute_rounds (user_id, client_account_id, target_type)
  where status = 'open';

alter table public.letters
  add column if not exists campaign_id uuid references public.client_campaigns(id) on delete restrict,
  add column if not exists campaign_item_id uuid references public.campaign_items(id) on delete restrict,
  add column if not exists campaign_route_id uuid references public.campaign_letter_routes(id) on delete restrict,
  add column if not exists generation_style text,
  add column if not exists draft_approved_at timestamptz,
  add column if not exists draft_approved_by uuid references auth.users(id) on delete set null;

create index if not exists letters_campaign_idx on public.letters (campaign_id, saved_at);

create or replace function public.create_client_campaign(p_client_id uuid, p_audit_id text, p_items jsonb)
returns public.client_campaigns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid(); v_role text; v_client public.clients%rowtype;
  v_campaign public.client_campaigns%rowtype; v_item jsonb; v_round_number integer;
begin
  if v_caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select role into v_role from public.profiles where id = v_caller;
  if v_role not in ('admin', 'auditor') then raise exception 'Staff access required' using errcode = '42501'; end if;
  select * into v_client from public.clients where id = p_client_id;
  if not found or (v_role <> 'admin' and v_client.user_id <> v_caller) then raise exception 'Client not found' using errcode = '42501'; end if;
  if coalesce(v_client.engagement_status, 'pending_onboarding') <> 'active' then raise exception 'New rounds require an Active service engagement'; end if;
  if not exists (select 1 from public.audits where user_id = v_client.user_id and id = p_audit_id and client_id = p_client_id) then raise exception 'The selected audit does not belong to this client'; end if;
  if coalesce(jsonb_typeof(p_items), 'null') <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'The audit has no campaign items'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_id::text, 0));
  if exists (select 1 from public.client_campaigns where user_id=v_client.user_id and client_id=p_client_id and stage not in ('closed','cancelled','legacy')) then raise exception 'This client already has an active campaign round'; end if;
  select coalesce(max(round_number), 0) + 1 into v_round_number from public.client_campaigns where user_id=v_client.user_id and client_id=p_client_id and stage <> 'legacy';
  insert into public.client_campaigns (user_id,client_id,audit_id,round_number,opened_by)
  values (v_client.user_id,p_client_id,p_audit_id,v_round_number,v_caller) returning * into v_campaign;
  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.campaign_items (campaign_id,user_id,client_id,item_kind,source_key,client_account_id,label,snapshot,sort_order)
    values (v_campaign.id,v_client.user_id,p_client_id,v_item->>'item_kind',v_item->>'source_key',nullif(v_item->>'client_account_id','')::uuid,v_item->>'label',coalesce(v_item->'snapshot','{}'::jsonb),coalesce((v_item->>'sort_order')::integer,0));
  end loop;
  return v_campaign;
end;
$$;

create or replace function public.start_campaign_route(p_route_id uuid, p_letters jsonb, p_sources jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid(); v_role text; v_route public.campaign_letter_routes%rowtype;
  v_item public.campaign_items%rowtype; v_campaign public.client_campaigns%rowtype; v_client public.clients%rowtype;
  v_account public.client_accounts%rowtype; v_round public.dispute_rounds%rowtype; v_letter jsonb; v_source jsonb;
  v_source_letter public.letters%rowtype; v_evidence public.response_evidence%rowtype; v_letter_id text; v_ids text[] := '{}';
  v_has_prior boolean; v_bureau_code text;
begin
  if v_caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select role into v_role from public.profiles where id=v_caller;
  if v_role not in ('admin','auditor') then raise exception 'Staff access required' using errcode='42501'; end if;
  select * into v_route from public.campaign_letter_routes where id=p_route_id for update;
  if not found or v_route.target_type not in ('furnisher','bureau') then raise exception 'Campaign route not found'; end if;
  if v_role <> 'admin' and v_route.user_id <> v_caller then raise exception 'Not authorized' using errcode='42501'; end if;
  if coalesce(array_length(v_route.letter_ids,1),0)>0 then return jsonb_build_object('round_id',v_route.dispute_round_id,'letter_ids',to_jsonb(v_route.letter_ids),'already_started',true); end if;
  select * into v_item from public.campaign_items where id=v_route.item_id and campaign_id=v_route.campaign_id;
  select * into v_campaign from public.client_campaigns where id=v_route.campaign_id for update;
  select * into v_client from public.clients where id=v_campaign.client_id;
  select * into v_account from public.client_accounts where id=v_item.client_account_id;
  if v_item.item_kind <> 'account' or not found then raise exception 'Only linked account items can use an account dispute route'; end if;
  if v_campaign.stage not in ('configure_letters','letter_review') then raise exception 'Campaign is not ready to build letters'; end if;
  if coalesce(v_client.engagement_status,'pending_onboarding') <> 'active' then raise exception 'New letters require an Active engagement'; end if;
  if coalesce(jsonb_typeof(p_letters),'null') <> 'array' or jsonb_array_length(p_letters)<1 or jsonb_array_length(p_letters)>2 then raise exception 'A route requires one or two letters'; end if;
  if v_route.target_type='bureau' and v_route.target_bureau is null then raise exception 'Bureau route requires a bureau'; end if;
  if v_route.target_type='bureau' then
    v_bureau_code := case v_route.target_bureau when 'equifax' then 'EQ' when 'experian' then 'EXP' when 'transunion' then 'TU' end;
    if not (coalesce(v_item.snapshot->'bureaus','[]'::jsonb) ? v_bureau_code) then raise exception 'Selected bureau is not active for this account on the frozen audit'; end if;
  end if;
  select exists(select 1 from public.dispute_rounds where user_id=v_campaign.user_id and client_account_id=v_account.id and status='closed') into v_has_prior;
  if v_has_prior and jsonb_array_length(coalesce(p_sources,'[]'::jsonb))<1 then raise exception 'A later account dispute requires reviewed prior evidence'; end if;
  select * into v_round from public.dispute_rounds where campaign_id=v_campaign.id and client_account_id=v_account.id and target_type=v_route.target_type limit 1;
  if not found then
    insert into public.dispute_rounds (user_id,client_id,client_account_id,round_number,target_type,opened_by,campaign_id)
    values (v_campaign.user_id,v_campaign.client_id,v_account.id,v_campaign.round_number,v_route.target_type,v_caller,v_campaign.id)
    returning * into v_round;
  end if;
  for v_letter in select value from jsonb_array_elements(p_letters) loop
    v_letter_id := gen_random_uuid()::text;
    insert into public.letters (id,user_id,created_by,client_id,client_name,furnisher,account_id,client_account_id,phase,type,saved_at,date,html,dispute_basis,round_id,round_number,letter_kind,target_type,target_bureau,round_review_status,covered_furnishers,campaign_id,campaign_item_id,campaign_route_id,generation_style)
    values (v_letter_id,v_campaign.user_id,v_caller,v_campaign.client_id,v_client.name,coalesce(v_account.display_furnisher,v_item.label),coalesce(v_letter->>'account_id',''),v_account.id,'Round '||v_campaign.round_number::text||' — '||case when v_route.target_type='bureau' then initcap(v_route.target_bureau) else 'Furnisher' end,nullif(v_letter->>'type',''),now(),current_date::text,'GENERATING...',nullif(v_letter->>'dispute_basis',''),v_round.id,v_campaign.round_number,'dispute',v_route.target_type,v_route.target_bureau,'not_reviewed',case when v_route.target_type='bureau' then jsonb_build_array(coalesce(v_account.display_furnisher,v_item.label)) else '[]'::jsonb end,v_campaign.id,v_item.id,v_route.id,v_route.letter_style);
    v_ids := array_append(v_ids,v_letter_id);
    for v_source in select value from jsonb_array_elements(coalesce(p_sources,'[]'::jsonb)) loop
      select * into v_source_letter from public.letters where user_id=v_campaign.user_id and id=v_source->>'source_letter_id';
      if not found or v_source_letter.client_account_id is distinct from v_account.id or v_source_letter.mailed_date is null then raise exception 'Invalid prior source letter'; end if;
      select * into v_evidence from public.response_evidence where id=(v_source->>'response_evidence_id')::uuid and firm_user_id=v_campaign.user_id and letter_id=v_source_letter.id;
      if not found or v_evidence.analysis_status<>'analyzed' or coalesce(v_evidence.review_status,'not_reviewed')='not_reviewed' then raise exception 'Prior evidence is not analyzed and reviewed'; end if;
      insert into public.letter_source_links (user_id,letter_id,source_letter_id,response_evidence_id,apply_to_bureau,source_order,created_by)
      values (v_campaign.user_id,v_letter_id,v_source_letter.id,v_evidence.id,v_route.target_bureau,coalesce((v_source->>'source_order')::integer,0),v_caller);
    end loop;
  end loop;
  update public.campaign_letter_routes set status='generating',dispute_round_id=v_round.id,letter_ids=v_ids,generation_error=null,updated_at=now() where id=v_route.id;
  update public.client_campaigns set stage='letter_review',updated_at=now() where id=v_campaign.id;
  return jsonb_build_object('round_id',v_round.id,'round_number',v_campaign.round_number,'letter_ids',to_jsonb(v_ids));
end;
$$;

-- Preserve legacy adaptive rounds as explicitly legacy campaign references;
-- they remain fully accessible through the existing Letters/round history UI.
insert into public.client_campaigns (id,user_id,client_id,round_number,stage,opened_by,opened_at,closed_at)
select gen_random_uuid(),r.user_id,r.client_id,
  (row_number() over (partition by r.user_id,r.client_id order by r.opened_at,r.id))::integer,
  'legacy',r.opened_by,r.opened_at,r.closed_at
from public.dispute_rounds r
where r.campaign_id is null
on conflict do nothing;

grant select,insert,update,delete on public.client_campaigns,public.campaign_items,public.campaign_letter_routes to authenticated;
grant all on public.client_campaigns,public.campaign_items,public.campaign_letter_routes to service_role;
revoke all on function public.create_client_campaign(uuid,text,jsonb) from public;
revoke all on function public.start_campaign_route(uuid,jsonb,jsonb) from public;
grant execute on function public.create_client_campaign(uuid,text,jsonb) to authenticated;
grant execute on function public.start_campaign_route(uuid,jsonb,jsonb) to authenticated;

-- A campaign's displayed round continues the client's existing adaptive-round
-- history. The campaign RPC still serializes creation; this trigger also keeps
-- future server-side inserts from accidentally restarting an established
-- client at Round 1.
create or replace function public.set_client_campaign_round_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign_max integer;
  v_dispute_max integer;
begin
  if new.stage = 'legacy' then return new; end if;
  select coalesce(max(round_number), 0) into v_campaign_max
  from public.client_campaigns
  where user_id = new.user_id and client_id = new.client_id and stage <> 'legacy';
  select coalesce(max(round_number), 0) into v_dispute_max
  from public.dispute_rounds
  where user_id = new.user_id and client_id = new.client_id;
  new.round_number := greatest(v_campaign_max, v_dispute_max) + 1;
  return new;
end;
$$;

drop trigger if exists set_client_campaign_round_number on public.client_campaigns;
create trigger set_client_campaign_round_number
before insert on public.client_campaigns
for each row execute function public.set_client_campaign_round_number();
