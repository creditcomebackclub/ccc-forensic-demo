-- Keep database-stored client email overrides aligned with the current CCC
-- method. Historical client_emails already contain immutable subject/body
-- snapshots, so these targeted in-place replacements preserve every sent
-- message and every template foreign key while preventing an active seeded
-- row from restoring retired campaign copy.

with replacement (
  name,
  category,
  event_type,
  old_subject,
  old_body,
  new_subject,
  new_body
) as (
  values
    (
      'Credit-file cleanup mailed',
      'campaign',
      'file_cleanup_mailed',
      'Your credit-file cleanup is underway',
      E'Hi {{client.name}},\n\nYour personal-information and inquiry cleanup letters have been mailed by certified mail. This is the first step in your campaign.\n\nOur team will now prepare Round {{round.number}} of your account disputes. We will monitor delivery and the response window for the cleanup letters while that work continues.\n\nYou do not need to take action unless a response arrives at your home. If one does, please upload every page through your portal.',
      'Your credit-file update mailing is recorded',
      E'Hi {{client.name}},\n\nYour Story. The Facts. The Pressure.\n\nCCC recorded the mailing of your personal-information or inquiry correspondence by USPS First-Class Mail. This mailing is documented separately from the account-specific paths in Round {{round.number}}.\n\nThe recorded send date is the mailing record; this notice does not claim delivery or receipt. If a response or updated credit report arrives, please upload every page through your portal.'
    ),
    (
      'Round prepared',
      'round',
      'next_round_prepared',
      'Round {{round.number}} is prepared for review',
      E'Hi {{client.name}},\n\nWe prepared Round {{round.number}} of your dispute campaign. Our team will review the letters and mailing packet before anything is sent.\n\nYou do not need to take action right now.',
      'Round {{round.number}} is prepared for review',
      E'Hi {{client.name}},\n\nYour Story. The Facts. The Pressure.\n\nThe letter set for Round {{round.number}} has been prepared from the saved account paths in your campaign. A team member will review the personalized facts, required statement when applicable, and packet enclosures before anything is sent.\n\nYou do not need to take action right now.'
    ),
    (
      'Round mailed — furnisher',
      'round',
      'round_mailed:furnisher',
      'Round {{round.number}} has been mailed',
      E'Hi {{client.name}},\n\nEvery direct-furnisher letter in Round {{round.number}} has now been mailed by certified mail. We will monitor delivery and the response window.\n\nIf a response arrives at your home, please upload every page in your portal.',
      'Round {{round.number}} mailing is recorded',
      E'Hi {{client.name}},\n\nYour Story. The Facts. The Pressure.\n\nEvery selected letter in Round {{round.number}} has been mailed by USPS First-Class Mail, and CCC recorded the send date for each letter. This notice records mailing; it does not claim delivery or receipt.\n\nIf a response or updated credit report arrives, please upload every page in your portal. The team will document the result before selecting any next step.'
    ),
    (
      'Round mailed — bureau',
      'round',
      'round_mailed:bureau',
      'Round {{round.number}} has been mailed',
      E'Hi {{client.name}},\n\nEvery selected credit-bureau letter in Round {{round.number}} has now been mailed by certified mail. We will monitor each delivery and response window.\n\nIf a response arrives at your home, please upload every page in your portal.',
      'Round {{round.number}} mailing is recorded',
      E'Hi {{client.name}},\n\nYour Story. The Facts. The Pressure.\n\nEvery selected letter in Round {{round.number}} has been mailed by USPS First-Class Mail, and CCC recorded the send date for each letter. This notice records mailing; it does not claim delivery or receipt.\n\nIf a response or updated credit report arrives, please upload every page in your portal. The team will document the result before selecting any next step.'
    ),
    (
      'First response received',
      'round',
      'first_response_received',
      'We received a response for Round {{round.number}}',
      E'Hi {{client.name}},\n\nA response connected to Round {{round.number}} has been received. Our forensic review will compare it with the exact disputes and evidence in that round before we decide what happens next.\n\nNo action is needed unless we ask for a specific document.',
      'A response for Round {{round.number}} is ready for review',
      E'Hi {{client.name}},\n\nYour Story. The Facts. The Pressure.\n\nCCC recorded a response connected to Round {{round.number}}. A team member will compare it with the exact correspondence and evidence in that round before any outcome or next step is recorded.\n\nNo action is needed unless we ask for a specific document.'
    ),
    (
      'Documents needed',
      'round',
      'documents_needed',
      'Documents needed for Round {{round.number}}',
      E'Hi {{client.name}},\n\nOur review of Round {{round.number}} identified documents we need from you before we can make the next decision. Please open your portal for the request and upload only the requested items.',
      'Documents needed for Round {{round.number}}',
      E'Hi {{client.name}},\n\nYour Story. The Facts. The Pressure.\n\nThe documented review for Round {{round.number}} identified specific items needed from you before a team member can record the next decision. Please open your portal and upload only the requested documents.'
    ),
    (
      'Round resolved',
      'round',
      'round_resolved',
      'Round {{round.number}} review is complete',
      E'Hi {{client.name}},\n\nWe completed our review of every response and nonresponse in Round {{round.number}}. This account''s dispute campaign is now marked resolved. You can view the current status in your portal.',
      'Round {{round.number}} review is complete',
      E'Hi {{client.name}},\n\nYour Story. The Facts. The Pressure.\n\nThe documented review for Round {{round.number}} is complete, and this account path is marked resolved. You can view the recorded status in your portal. No additional outcome is assumed beyond what the file shows.'
    ),
    (
      'Escalation ready',
      'round',
      'escalation_ready',
      'Round {{round.number}} is ready for escalation review',
      E'Hi {{client.name}},\n\nWe completed the response review for Round {{round.number}} and marked the record ready for escalation review. This does not mean a complaint or legal filing has been submitted. Our team will review the available path and contact you if anything is needed.',
      'Round {{round.number}} is ready for staff review',
      E'Hi {{client.name}},\n\nYour Story. The Facts. The Pressure.\n\nThe documented review for Round {{round.number}} is complete, and the record is ready for a team member to review the available path. This does not mean a complaint or legal filing has been submitted. We will contact you if a specific item is needed.'
    )
)
update public.client_email_templates as template
set
  category = replacement.category,
  subject_template = replacement.new_subject,
  body_template = replacement.new_body,
  updated_at = now()
from replacement
where template.is_active = true
  and template.name = replacement.name
  and template.event_type is not distinct from replacement.event_type
  and template.subject_template = replacement.old_subject
  and template.body_template = replacement.old_body;

-- A staff-edited version of one of the known seed rows may still carry retired
-- method claims. Preserve that customized row and its references, but remove
-- it from active selection instead of overwriting staff-authored wording.
with seeded_key (name, event_type) as (
  values
    ('Credit-file cleanup mailed', 'file_cleanup_mailed'),
    ('Round prepared', 'next_round_prepared'),
    ('Round mailed — furnisher', 'round_mailed:furnisher'),
    ('Round mailed — bureau', 'round_mailed:bureau'),
    ('First response received', 'first_response_received'),
    ('Documents needed', 'documents_needed'),
    ('Round resolved', 'round_resolved'),
    ('Escalation ready', 'escalation_ready')
)
update public.client_email_templates as template
set
  is_active = false,
  updated_at = now()
from seeded_key
where template.is_active = true
  and template.name = seeded_key.name
  and template.event_type is not distinct from seeded_key.event_type
  and template.body_template ~* '(certified([[:space:]]+mail)?|monitor([[:space:]]+each)?[[:space:]]+delivery|response[[:space:]]+window|direct-furnisher|first[[:space:]]+step[[:space:]]+in[[:space:]]+your[[:space:]]+campaign|metro[[:space:]]*2|lpoa)';

create or replace function public.seed_client_email_templates(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.client_email_templates (
    user_id,
    name,
    category,
    event_type,
    subject_template,
    body_template
  )
  values
    (p_user_id, 'Credit-file cleanup mailed', 'campaign', 'file_cleanup_mailed', 'Your credit-file update mailing is recorded', E'Hi {{client.name}},\n\nYour Story. The Facts. The Pressure.\n\nCCC recorded the mailing of your personal-information or inquiry correspondence by USPS First-Class Mail. This mailing is documented separately from the account-specific paths in Round {{round.number}}.\n\nThe recorded send date is the mailing record; this notice does not claim delivery or receipt. If a response or updated credit report arrives, please upload every page through your portal.'),
    (p_user_id, 'Round prepared', 'round', 'next_round_prepared', 'Round {{round.number}} is prepared for review', E'Hi {{client.name}},\n\nYour Story. The Facts. The Pressure.\n\nThe letter set for Round {{round.number}} has been prepared from the saved account paths in your campaign. A team member will review the personalized facts, required statement when applicable, and packet enclosures before anything is sent.\n\nYou do not need to take action right now.'),
    (p_user_id, 'Round mailed — furnisher', 'round', 'round_mailed:furnisher', 'Round {{round.number}} mailing is recorded', E'Hi {{client.name}},\n\nYour Story. The Facts. The Pressure.\n\nEvery selected letter in Round {{round.number}} has been mailed by USPS First-Class Mail, and CCC recorded the send date for each letter. This notice records mailing; it does not claim delivery or receipt.\n\nIf a response or updated credit report arrives, please upload every page in your portal. The team will document the result before selecting any next step.'),
    (p_user_id, 'Round mailed — bureau', 'round', 'round_mailed:bureau', 'Round {{round.number}} mailing is recorded', E'Hi {{client.name}},\n\nYour Story. The Facts. The Pressure.\n\nEvery selected letter in Round {{round.number}} has been mailed by USPS First-Class Mail, and CCC recorded the send date for each letter. This notice records mailing; it does not claim delivery or receipt.\n\nIf a response or updated credit report arrives, please upload every page in your portal. The team will document the result before selecting any next step.'),
    (p_user_id, 'First response received', 'round', 'first_response_received', 'A response for Round {{round.number}} is ready for review', E'Hi {{client.name}},\n\nYour Story. The Facts. The Pressure.\n\nCCC recorded a response connected to Round {{round.number}}. A team member will compare it with the exact correspondence and evidence in that round before any outcome or next step is recorded.\n\nNo action is needed unless we ask for a specific document.'),
    (p_user_id, 'Documents needed', 'round', 'documents_needed', 'Documents needed for Round {{round.number}}', E'Hi {{client.name}},\n\nYour Story. The Facts. The Pressure.\n\nThe documented review for Round {{round.number}} identified specific items needed from you before a team member can record the next decision. Please open your portal and upload only the requested documents.'),
    (p_user_id, 'Round resolved', 'round', 'round_resolved', 'Round {{round.number}} review is complete', E'Hi {{client.name}},\n\nYour Story. The Facts. The Pressure.\n\nThe documented review for Round {{round.number}} is complete, and this account path is marked resolved. You can view the recorded status in your portal. No additional outcome is assumed beyond what the file shows.'),
    (p_user_id, 'Escalation ready', 'round', 'escalation_ready', 'Round {{round.number}} is ready for staff review', E'Hi {{client.name}},\n\nYour Story. The Facts. The Pressure.\n\nThe documented review for Round {{round.number}} is complete, and the record is ready for a team member to review the available path. This does not mean a complaint or legal filing has been submitted. We will contact you if a specific item is needed.')
  on conflict (user_id, name) do nothing;
end;
$$;

do $$
declare staff_row record;
begin
  for staff_row in
    select id from public.profiles where role in ('admin', 'auditor')
  loop
    perform public.seed_client_email_templates(staff_row.id);
  end loop;
end;
$$;

revoke all on function public.seed_client_email_templates(uuid) from public, anon, authenticated;

comment on function public.seed_client_email_templates(uuid) is
  'Seeds current CCC client email copy; historical sent client_emails retain their original snapshots.';
