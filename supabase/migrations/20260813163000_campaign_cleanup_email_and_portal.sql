-- One cleanup milestone email per client campaign, plus the minimal campaign
-- metadata needed to present cleanup before adaptive account-dispute rounds.

create or replace function public.seed_client_email_templates(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.client_email_templates (user_id, name, category, event_type, subject_template, body_template)
  values
    (p_user_id, 'Credit-file cleanup mailed', 'campaign', 'file_cleanup_mailed', 'Your credit-file cleanup is underway', E'Hi {{client.name}},\n\nYour personal-information and inquiry cleanup letters have been mailed by certified mail. This is the first step in your campaign.\n\nOur team will now prepare Round {{round.number}} of your account disputes. We will monitor delivery and the response window for the cleanup letters while that work continues.\n\nYou do not need to take action unless a response arrives at your home. If one does, please upload every page through your portal.'),
    (p_user_id, 'Round prepared', 'round', 'next_round_prepared', 'Round {{round.number}} is prepared for review', E'Hi {{client.name}},\n\nWe prepared Round {{round.number}} of your dispute campaign. Our team will review the letters and mailing packet before anything is sent.\n\nYou do not need to take action right now.'),
    (p_user_id, 'Round mailed — furnisher', 'round', 'round_mailed:furnisher', 'Round {{round.number}} has been mailed', E'Hi {{client.name}},\n\nEvery direct-furnisher letter in Round {{round.number}} has now been mailed by certified mail. We will monitor delivery and the response window.\n\nIf a response arrives at your home, please upload every page in your portal.'),
    (p_user_id, 'Round mailed — bureau', 'round', 'round_mailed:bureau', 'Round {{round.number}} has been mailed', E'Hi {{client.name}},\n\nEvery selected credit-bureau letter in Round {{round.number}} has now been mailed by certified mail. We will monitor each delivery and response window.\n\nIf a response arrives at your home, please upload every page in your portal.'),
    (p_user_id, 'First response received', 'round', 'first_response_received', 'We received a response for Round {{round.number}}', E'Hi {{client.name}},\n\nA response connected to Round {{round.number}} has been received. Our forensic review will compare it with the exact disputes and evidence in that round before we decide what happens next.\n\nNo action is needed unless we ask for a specific document.'),
    (p_user_id, 'Documents needed', 'round', 'documents_needed', 'Documents needed for Round {{round.number}}', E'Hi {{client.name}},\n\nOur review of Round {{round.number}} identified documents we need from you before we can make the next decision. Please open your portal for the request and upload only the requested items.'),
    (p_user_id, 'Round resolved', 'round', 'round_resolved', 'Round {{round.number}} review is complete', E'Hi {{client.name}},\n\nWe completed our review of every response and nonresponse in Round {{round.number}}. This account''s dispute campaign is now marked resolved. You can view the current status in your portal.'),
    (p_user_id, 'Escalation ready', 'round', 'escalation_ready', 'Round {{round.number}} is ready for escalation review', E'Hi {{client.name}},\n\nWe completed the response review for Round {{round.number}} and marked the record ready for escalation review. This does not mean a complaint or legal filing has been submitted. Our team will review the available path and contact you if anything is needed.')
  on conflict (user_id, name) do nothing;
end;
$$;

do $$
declare staff_row record;
begin
  for staff_row in select id from public.profiles where role in ('admin', 'auditor') loop
    perform public.seed_client_email_templates(staff_row.id);
  end loop;
end;
$$;

-- Append campaign_id so deployed clients that use the prior columns continue
-- to work while the new portal groups sibling account routes together.
create or replace view public.client_dispute_round_status
with (security_barrier = true) as
select
  r.id as round_id,
  r.client_id,
  r.client_account_id,
  r.round_number,
  r.target_type,
  r.status,
  r.final_disposition,
  r.opened_at,
  r.closed_at,
  r.cancelled_at,
  count(l.id)::integer as letter_count,
  count(l.id) filter (where l.mailed_date is not null)::integer as mailed_count,
  count(l.id) filter (where coalesce(l.round_review_status, 'not_reviewed') <> 'not_reviewed')::integer as reviewed_count,
  r.campaign_id
from public.dispute_rounds r
join public.letters l on l.round_id = r.id and l.user_id = r.user_id
where exists (
  select 1 from public.client_profiles cp
  where cp.user_id = auth.uid() and cp.client_id = r.client_id
)
group by r.id;

create or replace view public.client_campaign_status
with (security_barrier = true) as
select
  c.id as campaign_id,
  c.client_id,
  c.round_number,
  c.stage,
  c.opened_at,
  c.closed_at,
  count(i.id) filter (where i.selection_state = 'selected' and i.item_kind in ('personal_info', 'inquiry'))::integer as selected_cleanup_count,
  count(i.id) filter (where i.selection_state = 'selected' and i.item_kind = 'account')::integer as selected_account_count
from public.client_campaigns c
left join public.campaign_items i on i.campaign_id = c.id and i.user_id = c.user_id
where exists (
  select 1 from public.client_profiles cp
  where cp.user_id = auth.uid() and cp.client_id = c.client_id
)
group by c.id;

grant select on public.client_dispute_round_status, public.client_campaign_status to authenticated;
grant select on public.client_campaign_status to service_role;
