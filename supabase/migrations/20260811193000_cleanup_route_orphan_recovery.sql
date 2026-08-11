-- Campaign cleanup routes store generated letter IDs as an ordered array. A
-- deleted draft can therefore leave a route pointing at a missing placeholder.
-- Repair is allowed only when no letter or downstream mail/response evidence
-- exists for any referenced ID.

create or replace function public.reset_orphaned_campaign_cleanup_route(p_route_id uuid)
returns public.campaign_letter_routes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_route public.campaign_letter_routes%rowtype;
  v_item_ids uuid[];
  v_cleanup_item_count integer;
begin
  if v_caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select role into v_role from public.profiles where id = v_caller;
  if v_role not in ('admin', 'auditor') then raise exception 'Staff access required' using errcode = '42501'; end if;

  select * into v_route from public.campaign_letter_routes where id = p_route_id for update;
  if not found or (v_role <> 'admin' and v_route.user_id <> v_caller) then
    raise exception 'Campaign route not found' using errcode = '42501';
  end if;
  if v_route.status = 'configured' and coalesce(cardinality(v_route.letter_ids), 0) = 0 then
    return v_route;
  end if;
  if v_route.status <> 'failed' or v_route.target_type <> 'bureau'
      or v_route.target_bureau is null or v_route.dispute_round_id is not null
      or coalesce(cardinality(v_route.letter_ids), 0) = 0 then
    raise exception 'Only a failed orphaned cleanup route can be reset';
  end if;

  v_item_ids := case when coalesce(cardinality(v_route.item_ids), 0) > 0
    then v_route.item_ids else array[v_route.item_id] end;
  select count(*) into v_cleanup_item_count
  from public.campaign_items item
  where item.campaign_id = v_route.campaign_id
    and item.id = any(v_item_ids)
    and item.item_kind in ('personal_info', 'inquiry');
  if v_cleanup_item_count <> cardinality(v_item_ids) then
    raise exception 'The route is not a verified personal-information/inquiry cleanup route';
  end if;

  if exists (
    select 1 from public.letters letter
    where letter.campaign_route_id = v_route.id or letter.id = any(v_route.letter_ids)
  ) then raise exception 'A persisted campaign letter still exists; use the normal retry path'; end if;
  if exists (select 1 from public.mail_submissions submission where submission.letter_id = any(v_route.letter_ids))
    or exists (select 1 from public.mail_artifacts artifact where artifact.letter_id = any(v_route.letter_ids))
    or exists (select 1 from public.lob_webhook_events event where event.letter_id = any(v_route.letter_ids))
    or exists (select 1 from public.response_evidence evidence where evidence.letter_id = any(v_route.letter_ids))
    or exists (select 1 from public.phase2_jobs job where job.letter_id = any(v_route.letter_ids)) then
    raise exception 'Downstream mail or response evidence exists for this route; it cannot be reset';
  end if;

  update public.campaign_letter_routes
  set status = 'configured', letter_ids = '{}', approved_letter_ids = '{}',
      generation_error = null, generated_at = null, updated_at = now()
  where id = v_route.id
  returning * into v_route;
  return v_route;
end;
$$;

revoke all on function public.reset_orphaned_campaign_cleanup_route(uuid) from public;
grant execute on function public.reset_orphaned_campaign_cleanup_route(uuid) to authenticated;

-- Keep the ordinary Letters workboard from deleting a campaign-owned draft.
-- Campaign retry/reset operations own that lifecycle and keep route state in
-- sync. Standalone letters retain the existing deletion behavior.
create or replace function public.delete_standalone_letter(p_letter_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_letter public.letters%rowtype;
begin
  if v_caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_letter from public.letters
  where id = p_letter_id and user_id = v_caller
  for update;
  if not found then return false; end if;
  if v_letter.campaign_route_id is not null then
    raise exception 'Campaign letters must be managed from the Campaign workspace';
  end if;
  delete from public.letters where id = v_letter.id and user_id = v_caller;
  return true;
end;
$$;

revoke all on function public.delete_standalone_letter(text) from public;
grant execute on function public.delete_standalone_letter(text) to authenticated;

-- Repair existing routes only when the same invariants used by the RPC prove
-- that every stored letter ID is orphaned and has no downstream evidence.
with repairable as (
  select route.id
  from public.campaign_letter_routes route
  where route.status = 'failed'
    and route.target_type = 'bureau'
    and route.target_bureau is not null
    and route.dispute_round_id is null
    and coalesce(cardinality(route.letter_ids), 0) > 0
    and (
      select count(*)
      from public.campaign_items item
      where item.campaign_id = route.campaign_id
        and item.id = any(case when coalesce(cardinality(route.item_ids), 0) > 0 then route.item_ids else array[route.item_id] end)
        and item.item_kind in ('personal_info', 'inquiry')
    ) = cardinality(case when coalesce(cardinality(route.item_ids), 0) > 0 then route.item_ids else array[route.item_id] end)
    and not exists (select 1 from public.letters letter where letter.campaign_route_id = route.id or letter.id = any(route.letter_ids))
    and not exists (select 1 from public.mail_submissions submission where submission.letter_id = any(route.letter_ids))
    and not exists (select 1 from public.mail_artifacts artifact where artifact.letter_id = any(route.letter_ids))
    and not exists (select 1 from public.lob_webhook_events event where event.letter_id = any(route.letter_ids))
    and not exists (select 1 from public.response_evidence evidence where evidence.letter_id = any(route.letter_ids))
    and not exists (select 1 from public.phase2_jobs job where job.letter_id = any(route.letter_ids))
)
update public.campaign_letter_routes route
set status = 'configured', letter_ids = '{}', approved_letter_ids = '{}',
    generation_error = null, generated_at = null, updated_at = now()
where route.id in (select id from repairable);
