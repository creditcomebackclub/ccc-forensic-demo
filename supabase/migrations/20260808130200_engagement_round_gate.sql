-- Leads are not engagements. Correct the first status backfill and make the
-- service gate authoritative in the round-creation RPC, not just the UI.
update public.clients
set engagement_status = 'pending_onboarding', engagement_status_changed_at = now()
where status = 'lead' and engagement_status = 'active';

create or replace function public.start_dispute_round(
  p_client_account_id uuid,
  p_target_type text,
  p_letters jsonb,
  p_sources jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid(); v_role text; v_account public.client_accounts%rowtype; v_client public.clients%rowtype;
  v_round_id uuid := gen_random_uuid(); v_round_number integer; v_letter jsonb; v_source jsonb; v_letter_id text; v_letter_ids text[] := '{}';
  v_bureau text; v_bureau_code text; v_latest_audit jsonb; v_audit_account jsonb; v_source_letter public.letters%rowtype; v_evidence public.response_evidence%rowtype;
begin
  if v_caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select role into v_role from public.profiles where id = v_caller;
  if v_role not in ('admin', 'auditor') then raise exception 'Staff access required' using errcode = '42501'; end if;
  if p_target_type not in ('furnisher', 'bureau') then raise exception 'Invalid round target'; end if;
  if coalesce(jsonb_typeof(p_letters), 'null') <> 'array' or jsonb_array_length(p_letters) < 1 or jsonb_array_length(p_letters) > 3 then raise exception 'A round requires one to three letters'; end if;
  if coalesce(jsonb_typeof(coalesce(p_sources, '[]'::jsonb)), 'null') <> 'array' then raise exception 'Sources must be an array'; end if;
  if p_target_type = 'bureau' and exists (select 1 from jsonb_array_elements(p_letters) item group by lower(item->>'target_bureau') having count(*) > 1) then raise exception 'A bureau may appear only once in a round'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_account_id::text, 0));
  select * into v_account from public.client_accounts where id = p_client_account_id;
  if not found then raise exception 'Account identity not found'; end if;
  if v_role <> 'admin' and v_account.user_id <> v_caller then raise exception 'Not authorized for this account' using errcode = '42501'; end if;
  if v_account.needs_review then raise exception 'Account identity requires reconciliation before starting a round'; end if;
  select * into v_client from public.clients where id = v_account.client_id and user_id = v_account.user_id;
  if not found then raise exception 'Client record not found for account identity'; end if;
  if coalesce(v_client.engagement_status, 'pending_onboarding') <> 'active' then raise exception 'New rounds require an Active service engagement. Existing work remains available.'; end if;
  if p_target_type = 'bureau' then
    select a.audit into v_latest_audit from public.audits a where a.user_id = v_account.user_id and a.client_id = v_client.id order by a.saved_at desc, a.id desc limit 1;
    if v_latest_audit is null then raise exception 'The client has no latest audit for bureau verification'; end if;
    select item.value into v_audit_account from jsonb_array_elements(coalesce(v_latest_audit->'accounts', '[]'::jsonb)) item where item.value->>'clientAccountId' = p_client_account_id::text limit 1;
    if v_audit_account is null then raise exception 'The account identity is not present in the latest audit'; end if;
  end if;
  if exists (select 1 from public.dispute_rounds where user_id = v_account.user_id and client_account_id = p_client_account_id and status = 'open') then raise exception 'This account already has an open round'; end if;
  if exists (select 1 from public.dispute_rounds r where r.user_id = v_account.user_id and r.client_account_id = p_client_account_id and r.status = 'closed' and r.round_number = (select max(r2.round_number) from public.dispute_rounds r2 where r2.user_id = r.user_id and r2.client_account_id = r.client_account_id) and r.final_disposition <> 'next_round') then raise exception 'The latest round is not approved for a next round'; end if;
  select coalesce(max(round_number), 0) + 1 into v_round_number from public.dispute_rounds where user_id = v_account.user_id and client_account_id = p_client_account_id;
  if v_round_number > 1 and jsonb_array_length(coalesce(p_sources, '[]'::jsonb)) < 1 then raise exception 'A later round requires at least one reviewed prior letter/evidence pair'; end if;
  if v_round_number > 1 and exists (select 1 from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) source where nullif(source->>'response_evidence_id', '') is null) then raise exception 'Every later-round source requires reviewed response or non-response evidence'; end if;
  insert into public.dispute_rounds (id,user_id,client_id,client_account_id,round_number,target_type,opened_by) values (v_round_id,v_account.user_id,v_client.id,p_client_account_id,v_round_number,p_target_type,v_caller);
  for v_letter in select value from jsonb_array_elements(p_letters) loop
    v_letter_id := gen_random_uuid()::text; v_bureau := nullif(lower(v_letter->>'target_bureau'), '');
    if p_target_type = 'bureau' and v_bureau not in ('equifax','experian','transunion') then raise exception 'Every bureau letter requires an explicit active bureau'; end if;
    if p_target_type = 'bureau' then v_bureau_code := case v_bureau when 'equifax' then 'EQ' when 'experian' then 'EXP' when 'transunion' then 'TU' end; if not (coalesce(v_audit_account->'bureaus','[]'::jsonb) ? v_bureau_code) then raise exception 'Selected bureau % is not active for this account on the latest audit', v_bureau; end if; end if;
    if p_target_type = 'furnisher' and v_bureau is not null then raise exception 'Furnisher letters cannot name a bureau'; end if;
    insert into public.letters (id,user_id,created_by,client_id,client_name,furnisher,account_id,client_account_id,phase,type,saved_at,date,html,summary,dispute_basis,round_id,round_number,letter_kind,target_type,target_bureau,round_review_status,covered_furnishers) values (v_letter_id,v_account.user_id,v_caller,v_client.id,v_client.name,coalesce(v_account.display_furnisher,v_letter->>'furnisher','Unknown Furnisher'),coalesce(v_letter->>'account_id',''),p_client_account_id,'Round '||v_round_number::text||' — '||case when p_target_type='bureau' then initcap(v_bureau) else 'Furnisher' end,nullif(v_letter->>'type',''),now(),current_date::text,'GENERATING...',null,nullif(v_letter->>'dispute_basis',''),v_round_id,v_round_number,'dispute',p_target_type,v_bureau,'not_reviewed',case when p_target_type='bureau' then jsonb_build_array(coalesce(v_account.display_furnisher,v_letter->>'furnisher','Unknown Furnisher')) else '[]'::jsonb end);
    v_letter_ids := array_append(v_letter_ids,v_letter_id);
    for v_source in select value from jsonb_array_elements(coalesce(p_sources,'[]'::jsonb)) loop
      if nullif(lower(v_source->>'apply_to_bureau'),'') is not null and nullif(lower(v_source->>'apply_to_bureau'),'') is distinct from v_bureau then continue; end if;
      select * into v_source_letter from public.letters where user_id=v_account.user_id and id=v_source->>'source_letter_id';
      if not found or v_source_letter.client_account_id is distinct from p_client_account_id then raise exception 'A selected source letter does not belong to this account'; end if;
      if v_source_letter.round_id is null or v_source_letter.mailed_date is null or not exists(select 1 from public.dispute_rounds source_round where source_round.id=v_source_letter.round_id and source_round.user_id=v_account.user_id and source_round.client_account_id=p_client_account_id and source_round.status='closed' and source_round.round_number<v_round_number) then raise exception 'Every source must be a mailed letter from a closed prior round'; end if;
      select * into v_evidence from public.response_evidence where id=(v_source->>'response_evidence_id')::uuid and firm_user_id=v_account.user_id and letter_id=v_source_letter.id;
      if not found or v_evidence.analysis_status <> 'analyzed' or coalesce(v_evidence.review_status,'not_reviewed')='not_reviewed' then raise exception 'Selected prior response evidence is not analyzed and reviewed'; end if;
      insert into public.letter_source_links (user_id,letter_id,source_letter_id,response_evidence_id,apply_to_bureau,source_order,created_by) values (v_account.user_id,v_letter_id,v_source_letter.id,(v_source->>'response_evidence_id')::uuid,nullif(lower(v_source->>'apply_to_bureau'),''),coalesce((v_source->>'source_order')::integer,0),v_caller);
    end loop;
    if v_round_number>1 and not exists(select 1 from public.letter_source_links link where link.user_id=v_account.user_id and link.letter_id=v_letter_id) then raise exception 'Every later-round letter requires at least one applicable prior letter/evidence pair'; end if;
  end loop;
  return jsonb_build_object('round_id',v_round_id,'round_number',v_round_number,'letter_ids',to_jsonb(v_letter_ids));
end;
$$;
