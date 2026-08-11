-- Let staff revise a campaign's dispute targets until letter generation starts.
-- Route configuration is derived from the selected items, so any real change
-- clears only ungenerated routes and returns the campaign to Disputes.

create or replace function public.revise_client_campaign_selection(
  p_campaign_id uuid,
  p_item_ids uuid[],
  p_selection_state text
)
returns public.client_campaigns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_campaign public.client_campaigns%rowtype;
  v_changed boolean;
begin
  if v_caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select role into v_role from public.profiles where id = v_caller;
  if v_role not in ('admin', 'auditor') then raise exception 'Staff access required' using errcode = '42501'; end if;
  if p_selection_state is null or p_selection_state not in ('candidate', 'selected', 'later') then raise exception 'Invalid dispute selection state'; end if;
  if coalesce(cardinality(p_item_ids), 0) = 0 then raise exception 'Choose at least one campaign item'; end if;

  select * into v_campaign from public.client_campaigns where id = p_campaign_id for update;
  if not found or (v_role <> 'admin' and v_campaign.user_id <> v_caller) then raise exception 'Campaign not found' using errcode = '42501'; end if;
  if v_campaign.stage not in ('select_disputes', 'configure_letters', 'letter_review') then
    raise exception 'This round can no longer change dispute targets';
  end if;
  if exists (
    select 1 from unnest(p_item_ids) requested(id)
    where not exists (
      select 1 from public.campaign_items item
      where item.id = requested.id and item.campaign_id = p_campaign_id
    )
  ) then raise exception 'A dispute item does not belong to this campaign'; end if;

  select exists (
    select 1 from public.campaign_items item
    where item.campaign_id = p_campaign_id
      and item.id = any(p_item_ids)
      and item.selection_state is distinct from p_selection_state
  ) into v_changed;
  if not v_changed then return v_campaign; end if;

  if exists (select 1 from public.letters letter where letter.campaign_id = p_campaign_id)
    or exists (
      select 1 from public.campaign_letter_routes route
      where route.campaign_id = p_campaign_id
        and (coalesce(cardinality(route.letter_ids), 0) > 0 or route.dispute_round_id is not null)
    ) then raise exception 'This selection is locked because a downstream letter already exists'; end if;

  delete from public.campaign_letter_routes where campaign_id = p_campaign_id;
  update public.campaign_items
  set selection_state = p_selection_state, updated_at = now()
  where campaign_id = p_campaign_id and id = any(p_item_ids);
  update public.client_campaigns
  set stage = 'select_disputes', updated_at = now()
  where id = p_campaign_id
  returning * into v_campaign;
  return v_campaign;
end;
$$;

revoke all on function public.revise_client_campaign_selection(uuid,uuid[],text) from public;
grant execute on function public.revise_client_campaign_selection(uuid,uuid[],text) to authenticated;

-- A deliberately deferred item remains deferred in the next campaign when the
-- new frozen audit emits the same stable source key. Skipped
-- items use the normal candidate default and receive no carry-forward marker.
create or replace function public.carry_forward_later_campaign_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_round integer;
  v_prior_campaign_id uuid;
begin
  if new.selection_state <> 'candidate' then return new; end if;
  select round_number into v_current_round from public.client_campaigns where id = new.campaign_id;
  select campaign.id into v_prior_campaign_id
  from public.client_campaigns campaign
  where campaign.user_id = new.user_id
    and campaign.client_id = new.client_id
    and campaign.stage in ('closed', 'cancelled')
    and campaign.round_number < v_current_round
  order by campaign.round_number desc
  limit 1;
  if v_prior_campaign_id is not null and exists (
    select 1 from public.campaign_items prior_item
    where prior_item.campaign_id = v_prior_campaign_id
      and prior_item.item_kind = new.item_kind
      and prior_item.source_key = new.source_key
      and prior_item.selection_state = 'later'
  ) then
    new.selection_state := 'later';
  end if;
  return new;
end;
$$;

drop trigger if exists carry_forward_later_campaign_item on public.campaign_items;
create trigger carry_forward_later_campaign_item
before insert on public.campaign_items
for each row execute function public.carry_forward_later_campaign_item();
