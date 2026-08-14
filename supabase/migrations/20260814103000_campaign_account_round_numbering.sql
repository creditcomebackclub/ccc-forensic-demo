-- Client campaigns are client-wide batches, but dispute rounds remain scoped to
-- one account. A client may therefore be in Campaign 2 while a newly selected
-- account is starting its own Round 1. Keep those two counters independent so
-- first-time account routes do not incorrectly require prior response evidence.
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
  v_has_prior boolean; v_bureau_code text; v_account_round_number integer;
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

  -- Serialize numbering for this account independently of the campaign's
  -- client-wide sequence number.
  perform pg_advisory_xact_lock(hashtextextended(v_account.id::text, 0));
  select coalesce(max(round_number), 0) + 1 into v_account_round_number
  from public.dispute_rounds
  where user_id=v_campaign.user_id and client_account_id=v_account.id;

  select exists(select 1 from public.dispute_rounds where user_id=v_campaign.user_id and client_account_id=v_account.id and status='closed') into v_has_prior;
  if v_has_prior and jsonb_array_length(coalesce(p_sources,'[]'::jsonb))<1 then raise exception 'A later account dispute requires reviewed prior evidence'; end if;
  select * into v_round from public.dispute_rounds where campaign_id=v_campaign.id and client_account_id=v_account.id and target_type=v_route.target_type limit 1;
  if not found then
    insert into public.dispute_rounds (user_id,client_id,client_account_id,round_number,target_type,opened_by,campaign_id)
    values (v_campaign.user_id,v_campaign.client_id,v_account.id,v_account_round_number,v_route.target_type,v_caller,v_campaign.id)
    returning * into v_round;
  end if;
  for v_letter in select value from jsonb_array_elements(p_letters) loop
    v_letter_id := gen_random_uuid()::text;
    insert into public.letters (id,user_id,created_by,client_id,client_name,furnisher,account_id,client_account_id,phase,type,saved_at,date,html,dispute_basis,round_id,round_number,letter_kind,target_type,target_bureau,round_review_status,covered_furnishers,campaign_id,campaign_item_id,campaign_route_id,generation_style)
    values (v_letter_id,v_campaign.user_id,v_caller,v_campaign.client_id,v_client.name,coalesce(v_account.display_furnisher,v_item.label),coalesce(v_letter->>'account_id',''),v_account.id,'Round '||v_round.round_number::text||' — '||case when v_route.target_type='bureau' then initcap(v_route.target_bureau) else 'Furnisher' end,nullif(v_letter->>'type',''),now(),current_date::text,'GENERATING...',nullif(v_letter->>'dispute_basis',''),v_round.id,v_round.round_number,'dispute',v_route.target_type,v_route.target_bureau,'not_reviewed',case when v_route.target_type='bureau' then jsonb_build_array(coalesce(v_account.display_furnisher,v_item.label)) else '[]'::jsonb end,v_campaign.id,v_item.id,v_route.id,v_route.letter_style);
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
  return jsonb_build_object('round_id',v_round.id,'round_number',v_round.round_number,'letter_ids',to_jsonb(v_ids));
end;
$$;

revoke all on function public.start_campaign_route(uuid,jsonb,jsonb) from public;
grant execute on function public.start_campaign_route(uuid,jsonb,jsonb) to authenticated;
