-- Install the 38 CCC-original v1 templates that model the course's
-- law/round structure without copying its wording. Apply after the template
-- table migration. Curly-token hashes are verified by the repository test.

alter table public.dispute_templates
  alter column created_by drop not null;

alter table public.dispute_templates
  drop constraint if exists dispute_templates_flow_code_check,
  drop constraint if exists dispute_templates_round_number_check;

alter table public.dispute_templates
  add constraint dispute_templates_flow_code_check
    check (flow_code in ('accuracy', 'collection', 'combo', 'consent', 'late_pay', 'direct', 'accuracy_solo')),
  add constraint dispute_templates_round_number_check
    check (
      (flow_code in ('accuracy', 'combo') and round_number between 1 and 12)
      or (flow_code = 'collection' and round_number between 1 and 10)
      or (flow_code = 'consent' and round_number between 1 and 3)
      or (flow_code in ('late_pay', 'direct') and round_number between 1 and 2)
      or (flow_code = 'accuracy_solo' and round_number = 1)
    );

alter table public.letters
  drop constraint if exists letters_dispute_flow_code_check;

alter table public.letters
  add constraint letters_dispute_flow_code_check
    check (dispute_flow_code is null or dispute_flow_code in (
      'accuracy', 'collection', 'combo', 'consent', 'late_pay', 'direct', 'accuracy_solo'
    ));

comment on column public.dispute_templates.created_by is
  'Null only for source-controlled CCC system templates; admin-created templates retain their auth user id.';

-- CCC-TEMPLATE {"key":"ACC-R1-v1","flow":"accuracy","round":1,"source":"ACC - R1 - Factual Dispute.docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","personalization","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"5323276051599bc3a3e637a43666d85bbab21105d6dd4cc4751eb56ba9af2a86"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '24becae4-87a4-516c-a701-33ad86991853', null, 'ACC - R1 - Factual Dispute', 'accuracy',
  1, 'ALL', 'v1', $ccc_01${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

FACTUAL DISPUTE — {bureau_name} is publishing numbers that do not match the other two bureaus.

{damages}
— — — FACTS (do not change this section) — — —
Here is the problem in one sentence. The accounts listed in this dispute report one set of numbers at {bureau_name} and a different set of numbers somewhere else. Same account, same person, same month, three different answers. They cannot all be correct, which means at least one of them is wrong, and the wrong one is sitting on my credit report doing damage to me right now.
The FCRA does not hold {bureau_name} to a standard of close enough. It holds you to maximum possible accuracy. That standard means that once I put you on notice of a discrepancy in writing, the information you publish about me has to line up. This letter is that notice.
I am not asking you to take my word for any of this. Below I have listed each account, the exact fields that disagree, and what each bureau reports for that field. I have included screenshots straight from my credit report so there is no question about what I am looking at. You do not have to investigate whether a discrepancy exists. You only have to look.

Every item listed below this sentence is reporting information about me that is not accurate.

{personalization}
{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following inaccurate information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —
The information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute.

{screenshots}$ccc_01$, 'CCC-original v1 rewrite modeled on the course''s ACC R1 law and escalation purpose. Source: ACC - R1 - Factual Dispute.docx. Team fields: damages, personalization, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"ACC-R2-v1","flow":"accuracy","round":2,"source":"ACC - R2 - 1681e(b).docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","personalization","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"b65885dccb8961be8f0f5b543fadcf5e9adf533da844a740b6a718367e24994e"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  'c666f020-2ee9-5a08-99d7-d769e33f50ef', null, 'ACC - R2 - 1681e(b)', 'accuracy',
  2, 'ALL', 'v1', $ccc_02${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1681e(b) — You answered "verified" and changed nothing. That is not a reasonable procedure.

{damages}
— — — FACTS (do not change this section) — — —
In my last letter I showed {bureau_name} exactly which fields on these accounts disagreed with the other bureaus. I gave you the accounts, the fields, and screenshots. Your response was that the information was verified. Then you left every number exactly the way it was.
That is the part I want you to sit with. If this information had actually been verified against the furnisher, one of two things would have happened. Either the numbers would have been corrected so they matched, or you would have told me which version was accurate and why. Neither happened. The accounts still report differently at different bureaus, which means whatever you did, it was not a reinvestigation of the thing I disputed.
15 USC 1681e(b) requires {bureau_name} to follow reasonable procedures to assure maximum possible accuracy whenever you prepare a consumer report. A procedure that accepts a furnisher's one-word answer and passes it back to me without ever comparing it against the conflicting data I handed you is not a reasonable procedure. It is a rubber stamp, and 1681e(b) exists specifically to stop that.

Every item listed below this sentence is reporting information about me that is not accurate.

{personalization}
{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following inaccurate information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —
The information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute.

{screenshots}$ccc_02$, 'CCC-original v1 rewrite modeled on the course''s ACC R2 law and escalation purpose. Source: ACC - R2 - 1681e(b).docx. Team fields: damages, personalization, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"ACC-R3-v1","flow":"accuracy","round":3,"source":"ACC - R3 - 1681i(a)(5).docx","sourceTokens":["bdate","bureau_address","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","personalization","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"1dfb8710160cd23b8ddbf35665e02cb4c1e3ba866bb0126c92f154d885ae9f35"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '14733136-64e9-5020-bb21-7520c97149be', null, 'ACC - R3 - 1681i(a)(5)', 'accuracy',
  3, 'ALL', 'v1', $ccc_03${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1681i(a)(5) — If it cannot be verified, the law does not leave you a third option.

{damages}
— — — FACTS (do not change this section) — — —
Two rounds in, the same accounts are reporting the same conflicting information, and I still have not been told which version is the accurate one.
15 USC 1681i(a)(5) is direct about what happens next. If, after a reinvestigation, an item of information is found to be inaccurate or incomplete, or cannot be verified, the agency shall promptly delete that item from the consumer's file or modify it as appropriate based on the results of the reinvestigation.
Notice what that section does not include. There is no option to leave the item exactly as it was and call it verified. There is no option to keep publishing information you have twice been told conflicts with itself. The statute gives you delete or modify, and nothing has been deleted and nothing has been modified.
So one of two things is true. Either you verified these accounts against the furnisher and the information is still wrong, which makes it inaccurate under (a)(5) and it must be deleted. Or you did not actually verify them, which makes them unverified under (a)(5) and it must be deleted. Both roads end in the same place.

Every item listed below this sentence is reporting information about me that is not accurate.

{personalization}
{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following inaccurate information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —
The information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute.

{screenshots}$ccc_03$, 'CCC-original v1 rewrite modeled on the course''s ACC R3 law and escalation purpose. Source: ACC - R3 - 1681i(a)(5).docx. Team fields: damages, personalization, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"ACC-R4-v1","flow":"accuracy","round":4,"source":"ACC - R4 - 1681i(a)(1)(a).docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","personalization","penalty","consumer_statement"],"exampleOnlyTokens":["bureau_name"],"bodySha256":"26ed4ffb4a638e3a230c92c9e0651cd3a65ebbf5f6cc42581f7b8a0264053c60"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '463c2c76-ee3d-5fc0-ae48-2f01af99d5bd', null, 'ACC - R4 - 1681i(a)(1)(a)', 'accuracy',
  4, 'ALL', 'v1', $ccc_04${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1681i(a)(1)(A) — Three disputes, thirty days each, and nothing has been reinvestigated.

{damages}
— — — FACTS (do not change this section) — — —
This is my fourth letter about the same accounts. I want to talk about what was supposed to happen after the first one.
Under 15 USC 1681i(a)(1)(A), when a consumer disputes the completeness or accuracy of information and notifies the agency directly, the agency shall conduct a reasonable reinvestigation, free of charge, to determine whether the disputed information is inaccurate, and shall record the current status of the disputed information or delete the item from the file, before the end of the 30-day period beginning on the date the agency receives the notice.
The word doing the work in that sentence is reasonable. A reinvestigation is not a database query. It is not sending a code through the ACDV system and forwarding whatever comes back. A reinvestigation means somebody looked at the specific conflict I identified and determined which version is true.
I know that did not happen here, and I can prove it from your own responses. I gave you specific fields with specific conflicting values. Your responses have never once addressed a single one of those fields. You cannot reasonably reinvestigate a dispute you never actually read.

Every item listed below this sentence is reporting information about me that is not accurate.

{personalization}
{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following inaccurate information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —
The information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute.

{screenshots}$ccc_04$, 'CCC-original v1 rewrite modeled on the course''s ACC R4 law and escalation purpose. Source: ACC - R4 - 1681i(a)(1)(a).docx. Team fields: damages, personalization, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"ACC-R5-v1","flow":"accuracy","round":5,"source":"ACC - R5 - 1681i(a)(7) MOV.docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"2d1ee7c3a1525603e0841a24009783f08d39778d3ce1c95682f6dc713a1d15ba"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '0484d6e3-4d1e-554b-b441-6a4d5bb4ecc3', null, 'ACC - R5 - 1681i(a)(7) MOV', 'accuracy',
  5, 'ALL', 'v1', $ccc_05${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1681i(a)(7) — I am formally requesting your method of verification. You have 15 days.

{damages}
— — — FACTS (do not change this section) — — —
I am done arguing about whether these accounts are accurate. I am now asking you to show me how you decided they were.
Under 15 USC 1681i(a)(7), a consumer reporting agency shall provide to the consumer a description of the procedure used to determine the accuracy and completeness of the information, not later than 15 days after receiving a request for that description. This letter is that request.
That description is defined in 1681i(a)(6)(B)(iii) and it is specific. It includes the business name and address of any furnisher of information contacted in connection with the information, and the telephone number of that furnisher if reasonably available. So I am asking for exactly that, for each account in this dispute:
The name of the furnisher you contacted. The business address you contacted them at. The telephone number. The date of the contact. The name or employee identifier of the person at {bureau_name} who conducted the reinvestigation. And a description of what documents were actually reviewed.
I want to be plain about why I am asking. If you contacted these furnishers and reviewed real documents, this request costs you fifteen minutes and ends the dispute. If you did not, then the verifications you have sent me were not based on anything, and every one of these accounts is unverified under 1681i(a)(5) and has to come off.

{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following inaccurate information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —
The information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute.

{screenshots}$ccc_05$, 'CCC-original v1 rewrite modeled on the course''s ACC R5 law and escalation purpose. Source: ACC - R5 - 1681i(a)(7) MOV.docx. Team fields: damages, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"ACC-R6-v1","flow":"accuracy","round":6,"source":"ACC - R6 - 1681i(a)(6)(B).docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","penalty","consumer_statement"],"exampleOnlyTokens":["bureau_name"],"bodySha256":"da1d27ef0f05d18fb1bfcfd569fbdccd16e87b5ca383d007350ee69d5654c317"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '2e0021f4-1f1b-5061-88c9-1c00e557bfc6', null, 'ACC - R6 - 1681i(a)(6)(B)', 'accuracy',
  6, 'ALL', 'v1', $ccc_06${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1681i(a)(6)(B) — Your notice of results was missing almost everything the statute requires in it.

{damages}
— — — FACTS (do not change this section) — — —
I requested your method of verification in my last letter. What came back was not a description of a procedure. It was a form.
15 USC 1681i(a)(6)(B) lists what a notice of reinvestigation results has to contain, and it is not a short list. A statement that the reinvestigation is completed. A consumer report based on my file as revised by the reinvestigation. A notice that a description of the procedure used to determine accuracy and completeness will be provided on request, including the business name and address of any furnisher contacted and that furnisher's telephone number where reasonably available. A notice of my right to add a statement to my file disputing the information. And a notice of my right to request that you notify prior recipients of my report.
Go back and look at what you actually sent me against that list. The furnisher contact information is not there. The description of the procedure is not there, even though I requested it in writing. Several of the required notices are not there.
This matters beyond the paperwork. Each of those items exists so a consumer can check the agency's work. By leaving them out, you removed the only mechanism I have for testing whether any reinvestigation happened at all, which is convenient for you and is exactly what the statute was written to prevent.

{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following inaccurate information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —
The information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute.

{screenshots}$ccc_06$, 'CCC-original v1 rewrite modeled on the course''s ACC R6 law and escalation purpose. Source: ACC - R6 - 1681i(a)(6)(B).docx. Team fields: damages, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"ACC-R7-v1","flow":"accuracy","round":7,"source":"ACC - R7 - 1681i(c).docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"ba64f8fe81b35c7032ea6735ea88ed0c1c149886d840a5c7bd9587569031523e"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '2704a966-6678-52ca-ae31-39c1327a0702', null, 'ACC - R7 - 1681i(c)', 'accuracy',
  7, 'ALL', 'v1', $ccc_07${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1681i(c) — Every letter I have sent carried a consumer statement. Not one made it into my report.

{damages}
— — — FACTS (do not change this section) — — —
Go back through the letters I have sent {bureau_name}. Every single one ends with a consumer statement. Now pull my current credit report and look for any of them.
15 USC 1681i(c) is not discretionary. Whenever a statement of dispute is filed, unless there are reasonable grounds to believe it is frivolous or irrelevant, the agency shall, in any subsequent consumer report containing the information in question, clearly note that the information is disputed by the consumer and provide either the consumer's statement or a clear and accurate codification or summary of it.
You have never noted these accounts as disputed. You have never carried my statement forward. And you have never told me you found any of my statements frivolous or irrelevant, which is the only exit the statute gives you and one you would have had to actually invoke.
So consider what that means for every report you have sold about me since my first dispute. Each one went out carrying accounts that were under active dispute, presented to lenders as undisputed fact. That is not a technical omission. Every one of those reports was incomplete on its face, and incomplete information is grounds for deletion under 1681i(a)(5) on its own.

{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following inaccurate information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —
The information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute.

{screenshots}$ccc_07$, 'CCC-original v1 rewrite modeled on the course''s ACC R7 law and escalation purpose. Source: ACC - R7 - 1681i(c).docx. Team fields: damages, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"ACC-R8-v1","flow":"accuracy","round":8,"source":"ACC - R8 - 1681s-2(a)(b).docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"c5ce376bc60c872991edb2d67f9fe43b11d66cdc4f1b072b1ae1e90e73c28d50"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '3b4e12a6-d773-51da-8162-4f6776283967', null, 'ACC - R8 - 1681s-2(a)(b)', 'accuracy',
  8, 'ALL', 'v1', $ccc_08${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1681s-2 and 1681i(a)(2) — Prove you ever told the furnisher I disputed this.

{damages}
— — — FACTS (do not change this section) — — —
There is a step in this process that happens out of my sight, and I want to establish whether it ever happened at all.
Under 15 USC 1681i(a)(2)(A), within five business days of receiving my dispute, {bureau_name} must provide notification of that dispute to the furnisher who supplied the information, and that notice must include all relevant information regarding the dispute that you received from me. All relevant information. Not a two-digit code. The substance of what I actually told you.
That notice matters because it triggers the furnisher's own obligations under 15 USC 1681s-2(b) — to conduct its own investigation, to review all relevant information you provided, and to report the results back to you. None of that can happen if the furnisher was never properly notified in the first place.
I have now described specific conflicting fields across multiple letters. If those descriptions had been passed to the furnishers as the statute requires, the furnishers would have had to address them. Nothing in any response I have received suggests any furnisher ever saw a word of what I wrote. So I am asking directly: produce the date each furnisher was notified and the content of what was sent.

{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following inaccurate information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —
The information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute.

{screenshots}$ccc_08$, 'CCC-original v1 rewrite modeled on the course''s ACC R8 law and escalation purpose. Source: ACC - R8 - 1681s-2(a)(b).docx. Team fields: damages, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"ACC-R9-v1","flow":"accuracy","round":9,"source":"ACC - R9 - 1681(b) combo.docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"fabf8c4938b597a0df35c6301271663b2f7fe13bd45ece567f8e139c958f110f"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  'f7de2437-2bb2-5927-91fe-4036779abaae', null, 'ACC - R9 - 1681(b) combo', 'accuracy',
  9, 'ALL', 'v1', $ccc_09${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1681(b), 1681e(b) and 1681i(a) — Your procedures have now failed the same accounts eight times.

{damages}
— — — FACTS (do not change this section) — — —
I want to step back from the individual accounts and talk about the pattern, because the pattern is now its own violation.
15 USC 1681(b) states the purpose the entire statute is built to serve — that consumer reporting agencies adopt reasonable procedures for meeting the needs of commerce in a manner which is fair and equitable to the consumer, with regard to the confidentiality, accuracy, relevancy, and proper utilization of the information.
Read that against the record here. 1681e(b) required reasonable procedures to assure maximum possible accuracy and the accounts still conflict. 1681i(a)(1)(A) required a reasonable reinvestigation and no disputed field has ever been addressed. 1681i(a)(5) required deletion of anything unverified and nothing has been deleted. 1681i(a)(7) required a description of your procedure and none was provided. 1681i(c) required my statements to be carried forward and none were.
Any one of those alone is an isolated failure. All of them, on the same accounts, across eight rounds, is not a series of accidents. It is a description of how {bureau_name}'s procedures actually operate, and those procedures are not fair and equitable to the consumer by any reading of 1681(b).

{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following inaccurate information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —
The information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute.

{screenshots}$ccc_09$, 'CCC-original v1 rewrite modeled on the course''s ACC R9 law and escalation purpose. Source: ACC - R9 - 1681(b) combo.docx. Team fields: damages, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"ACC-R10-v1","flow":"accuracy","round":10,"source":"ACC - R10 - 1681c(e).docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","personalization","penalty","consumer_statement"],"exampleOnlyTokens":["bureau_name"],"bodySha256":"1a8d418a1b039ddc20994542f8d7abff9865a55da9d341a0df404c9c33139e34"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  'b784cf55-3af4-5c42-b54a-d018812a45c5', null, 'ACC - R10 - 1681c(e)', 'accuracy',
  10, 'ALL', 'v1', $ccc_10${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1681c(e) — I closed these accounts. Your report does not say so.

{damages}
— — — FACTS (do not change this section) — — —
There is a specific fact about these accounts that my credit report does not reflect, and the omission is not neutral.
15 USC 1681c(e) provides that if a consumer reporting agency is notified that a credit account of a consumer was voluntarily closed by the consumer, the agency shall indicate that fact in any consumer report that includes the account.
The accounts listed below were closed by me. Not closed by the creditor, not closed for inactivity, not closed as a consequence of anything. I closed them. Your report either shows them as closed by the creditor or does not indicate who closed them at all.
Anyone in lending will tell you those two things read completely differently. An account a consumer closed themselves is a person managing their own credit. An account the creditor closed reads as an account somebody shut down on me. By omitting the indication 1681c(e) requires, you are presenting the second story about accounts where the first one is true. This letter is your notification. Indicate it or delete the accounts.

Every item listed below this sentence is reporting information about me that is not accurate.

{personalization}
{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following inaccurate information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —
The information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute.

{screenshots}$ccc_10$, 'CCC-original v1 rewrite modeled on the course''s ACC R10 law and escalation purpose. Source: ACC - R10 - 1681c(e).docx. Team fields: damages, personalization, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"ACC-R11-v1","flow":"accuracy","round":11,"source":"ACC - R11 - 1681e(b) discharged debt.docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","personalization","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"28b3f14ffab8bd67e564769430311d922c8392bb41f3e32e6a3633f4a170816b"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  'a9309275-a620-5c03-acdf-1b0aecc2e690', null, 'ACC - R11 - 1681e(b) discharged debt', 'accuracy',
  11, 'ALL', 'v1', $ccc_11${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1681e(b) — You are reporting a balance on a debt that legally no longer exists.

{damages}
— — — FACTS (do not change this section) — — —
The accounts listed below were discharged in bankruptcy. Your report still shows a balance owed on them.
A discharge is not a payment plan and it is not a settlement. It is a federal court order extinguishing my personal liability for that debt. After discharge there is no amount I owe, no amount that can lawfully be collected, and no amount that can accurately be reported. The correct balance on a discharged account is zero. There is no second opinion available on this.
15 USC 1681e(b) requires {bureau_name} to follow reasonable procedures to assure maximum possible accuracy. Reporting a balance on a discharged debt is not a close call under that standard. It is reporting money owed on a debt that a federal court has already ruled is not owed.
And the consequence is not theoretical. Every underwriter who pulls my file sees an outstanding balance and counts it against my debt-to-income. I went through bankruptcy specifically so that this debt would stop following me, and your reporting is the one thing keeping it attached to my name.

Every item listed below this sentence is reporting information about me that is not accurate.

{personalization}
{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following inaccurate information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —
The information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute.

{screenshots}$ccc_11$, 'CCC-original v1 rewrite modeled on the course''s ACC R11 law and escalation purpose. Source: ACC - R11 - 1681e(b) discharged debt.docx. Team fields: damages, personalization, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"ACC-R12-v1","flow":"accuracy","round":12,"source":"ACC - R12 - RANT 1681o 1681n.docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","personalization","penalty","consumer_statement"],"exampleOnlyTokens":["bureau_name"],"bodySha256":"04f027b3ca5b2e92bbd9a802339ca87ea72de1546ddf82d4d5616d7c48fa9298"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  'd3c0727c-4458-5e76-90f7-048e1ed76e50', null, 'ACC - R12 - RANT 1681o 1681n', 'accuracy',
  12, 'ALL', 'v1', $ccc_12${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1681o and 1681n — Eleven disputes. Eleven failures. This is the last letter before it stops being a dispute.

{damages}
{personalization}
{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following inaccurate information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —
The information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute.

{screenshots}$ccc_12$, 'CCC-original v1 rewrite modeled on the course''s ACC R12 law and escalation purpose. Source: ACC - R12 - RANT 1681o 1681n.docx. Team fields: damages, personalization, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"ACC-SOLO-R1-v1","flow":"accuracy_solo","round":1,"source":"BONUS - 1681c(f) ACCURACY SOLO technique.docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","personalization","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"de821c4b3ecfffdb00c3f6558c742fc63d48cee89d590d9cfb7c0a9dd4f75bfa"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  'b26bbaad-2a4d-52a8-bdef-e58eef901c37', null, 'BONUS - 1681c(f) ACCURACY SOLO technique', 'accuracy_solo',
  1, 'ALL', 'v1', $ccc_13${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1681c(f) — Nowhere on my report does it indicate these accounts were ever disputed.

{damages}
— — — FACTS (do not change this section) — — —
15 USC 1681c(f) requires that when a consumer reporting agency is notified that information it furnishes about a consumer is disputed by that consumer, the agency shall indicate that fact in each consumer report that includes the disputed information.
That requirement is not cosmetic and the reason it exists is practical. The comments section is the only place a creditor reading my file can see that an account is contested. Without that indication, nobody who pulls my report has any way to know a dispute is open, whether an investigation was ever conducted, or that there is another side to the account they are looking at. The account reads as settled, verified fact.
That is what {bureau_name} has done here. I have disputed these accounts in writing and the comments section on my report reflects none of it.
And that omission is not a separate complaint from accuracy — it IS the accuracy problem. An account presented to lenders as undisputed when it is actively disputed is not complete information. It is missing the single fact that would tell a reader how much weight to give it. Under 15 USC 1681i(a)(5) information that is inaccurate OR INCOMPLETE must be promptly deleted or modified. These accounts are incomplete on their face, and the incompleteness is entirely {bureau_name}'s doing.

Every item listed below this sentence is reporting incomplete information about me.

{personalization}
{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following incomplete information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — REQUIRED FOR THIS LETTER — — —
The information below consists of screenshots taken directly from my credit report showing the accounts described in this dispute and their comments sections.

{screenshots}$ccc_13$, 'CCC-original v1 rewrite modeled on the course''s BONUS R1 law and escalation purpose. Source: BONUS - 1681c(f) ACCURACY SOLO technique.docx. Team fields: damages, personalization, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"COL-R1-v1","flow":"collection","round":1,"source":"COL - R1 - 1692g.docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"c553475bf2f1b85cdf2d290ca857e4fd6837d80a9bf2759cda6cbcf8088c16ce"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '607b59f1-dadc-53cd-a2df-2e39f6193c57', null, 'COL - R1 - 1692g', 'collection',
  1, 'ALL', 'v1', $ccc_14${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1692g — No dunning letter was ever sent. This debt was never validated before it hit my report.

{damages}
— — — FACTS (do not change this section) — — —
I found out about these collection accounts the same way a stranger would have. By pulling my own credit report. Nobody wrote to me and nobody called.
Under 15 USC 1692g(a), a debt collector's first obligation is not to report a debt. It is to notify the consumer. Within five days of the initial communication the collector must send written notice stating the amount of the debt, the name of the creditor to whom it is owed, that I have 30 days to dispute it, that if I dispute it in writing the collector will obtain verification and mail it to me, and that on written request they will provide the name and address of the original creditor. That notice is called a dunning letter and it is not optional.
The collectors listed below never sent me one. I know this because the only reason I am aware these accounts exist is that I found them on my own credit report months after the fact.
And here is what makes the sequence worse. Furnishing a collection account to {bureau_name} is itself a communication about the debt. So these collectors communicated about my debt to a third party before they ever validated it with me, which is precisely the practice 1692g was written to prevent.
There is one clean way for these accounts to stay on my file. Produce proof that a dunning letter was mailed to my address within five days of the account being reported. If that proof does not exist, the accounts cannot lawfully remain and must be deleted.

{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}$ccc_14$, 'CCC-original v1 rewrite modeled on the course''s COL R1 law and escalation purpose. Source: COL - R1 - 1692g.docx. Team fields: damages, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"COL-R2-v1","flow":"collection","round":2,"source":"COL - R2 - 1692g(b).docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"a1ed09a51e6b1974f333fcb5ca33a2f3e98ec90b2807f184b5e18d5cbb4bc627"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  'c3655e9c-6a39-5222-b3aa-f4e8791e4cd1', null, 'COL - R2 - 1692g(b)', 'collection',
  2, 'ALL', 'v1', $ccc_15${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1692g(b) — I disputed in writing. Collection was required to stop. It did not.

{damages}
— — — FACTS (do not change this section) — — —
My previous letter disputed these debts in writing. That letter did something specific under federal law and I want to be exact about what it was.
Under 15 USC 1692g(b), once a consumer disputes a debt in writing, the collector must cease collection of that debt until it obtains verification and mails that verification to the consumer. Not until it feels like responding. Until verification is actually obtained and actually mailed to me.
I have received no verification. Nothing was mailed. And yet these accounts are still being reported to {bureau_name} and still appear on my credit report, where every lender who pulls my file sees them.
Continuing to report a disputed debt to a credit reporting agency is continuing to collect on it. The reporting is the pressure. It is the entire reason collectors furnish to you in the first place — a collection account on a credit report does the work of a phone call without anyone having to pick up a phone.
So the position these collectors have put you in is this. They were required to stop until they verified. They never verified. They never stopped. And {bureau_name} is the one publishing the result.

{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}$ccc_15$, 'CCC-original v1 rewrite modeled on the course''s COL R2 law and escalation purpose. Source: COL - R2 - 1692g(b).docx. Team fields: damages, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"COL-R3-v1","flow":"collection","round":3,"source":"COL - R3 - 1692j.docx","sourceTokens":["bdate","bureau_address","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"0fc49516c593d4f2a6237b13fa382ef475f735aa442b6b777c6e3983a6169f06"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  'dff1fb6f-be51-547c-9c7e-8d9b4c99220b', null, 'COL - R3 - 1692j', 'collection',
  3, 'ALL', 'v1', $ccc_16${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1692j — Your report presents these collectors as my creditors. They never were.

{damages}
— — — FACTS (do not change this section) — — —
Look at how these accounts appear on my credit report. They are listed the same way a bank or a card issuer is listed. Creditor name, account number, balance, payment status. Anyone reading my file would conclude I opened an account with these companies.
I never did. I never applied to them, never signed anything with them, never received a dollar from them. Whatever relationship exists is between them and somebody else. They bought a debt.
15 USC 1692j makes it unlawful to design, compile, or furnish any form knowing it would be used to create the false belief in a consumer that a person other than the creditor is participating in collecting a debt when that person is not in fact so participating. The section exists to stop collectors from dressing themselves up as something they are not in order to make a debt look more legitimate than it is.
That is exactly what the tradeline format does here. By furnishing these accounts in creditor format, these collectors have used your reporting system as the deceptive form. And it works — it worked on the underwriter who declined me, who had no way to tell a purchased debt from an account I actually opened.

{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}$ccc_16$, 'CCC-original v1 rewrite modeled on the course''s COL R3 law and escalation purpose. Source: COL - R3 - 1692j.docx. Team fields: damages, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"COL-R4-v1","flow":"collection","round":4,"source":"COL - R4 - 1681a(m).docx","sourceTokens":["bdate","bureau_address","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"9926ce78571f6c54dc6b89f13a2dfabfa685380b0f4f7e803de1e7895130f538"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '276e4b8c-5658-5734-b003-1f7fbba0c81e', null, 'COL - R4 - 1681a(m)', 'collection',
  4, 'ALL', 'v1', $ccc_17${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1681a(m) — These collectors have no account with me, so nothing here was initiated by me.

{damages}
— — — FACTS (do not change this section) — — —
I want to address a specific defense before anyone raises it. Collectors and bureaus routinely justify pulling and reporting a consumer's file by pointing to account review or collection activity. That justification does not reach these companies.
15 USC 1681a(m) defines a credit transaction that is not initiated by the consumer, and it carves out one thing specifically. It does not include use of a consumer report by a person with which the consumer has an account, for the purpose of reviewing that account or collecting it.
Read the condition carefully. A person with which the consumer has an account. Not a person who bought a receivable. Not a person assigned a file. A person with which I have an account.
I have no account with any company listed in this dispute. I never opened one, never signed one, never made a payment on one. Whatever they purchased, they purchased from someone else, and buying paper does not create an account between me and the buyer.
Which means the carve-out in 1681a(m) does not apply to them. Their access to and reporting of my file is a credit transaction that was not initiated by me in any sense the statute recognizes, and it is being conducted without any relationship that would justify it.

{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}$ccc_17$, 'CCC-original v1 rewrite modeled on the course''s COL R4 law and escalation purpose. Source: COL - R4 - 1681a(m).docx. Team fields: damages, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"COL-R5-v1","flow":"collection","round":5,"source":"COL - R5 - 1681(b).docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"f065c0f78a16e7254ca952041927290a52486b176c5b90446172da7e71772daa"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '3d5e43d2-085e-560a-b006-f5121e0213b7', null, 'COL - R5 - 1681(b)', 'collection',
  5, 'ALL', 'v1', $ccc_18${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1681(b) — Proper utilization is a requirement, not a suggestion, and this is not it.

{damages}
— — — FACTS (do not change this section) — — —
I have now written {bureau_name} four times about the same collection accounts, and each round has surfaced a separate problem. No validation notice. No cessation after written dispute. Creditor-format reporting by companies that are not my creditors. No account relationship to justify any of it.
15 USC 1681(b) sets out what your agency exists to do. Consumer reporting agencies are to adopt reasonable procedures for meeting the needs of commerce in a manner which is fair and equitable to the consumer, with regard to the confidentiality, accuracy, relevancy, and proper utilization of that information.
The phrase that matters here is proper utilization. It is not enough that data arrived in your system. There is a standard governing whether the use you put it to is legitimate.
Taking accounts from companies with no relationship to me, presenting them in a format that implies a relationship that never existed, and continuing to publish them after being told in writing four separate times why they are unlawful, is not proper utilization of my information under any reading of 1681(b). At this point the problem is not the collectors. It is what {bureau_name} does with what the collectors send.

{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}$ccc_18$, 'CCC-original v1 rewrite modeled on the course''s COL R5 law and escalation purpose. Source: COL - R5 - 1681(b).docx. Team fields: damages, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"COL-R6-v1","flow":"collection","round":6,"source":"COL - R6 - 1692e(10).docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"86037661f4658ccb87eb7486039cc3412f596aee0c6d93fc909061e49e68f386"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '55562ecf-ec63-5844-8869-837ddc20b989', null, 'COL - R6 - 1692e(10)', 'collection',
  6, 'ALL', 'v1', $ccc_19${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1692e(10) — False and deceptive means. That is what this whole file has been.

{damages}
— — — FACTS (do not change this section) — — —
I want to gather up what has happened across the last five rounds, because separately each piece looks like a technicality and together it looks like something else.
15 USC 1692e(10) prohibits the use of any false representation or deceptive means to collect or attempt to collect any debt, or to obtain information concerning a consumer. It is deliberately broad. Congress did not list every trick; it banned the category.
Here is what has been established in writing and never rebutted. These collectors reported the debt before sending any validation notice, so my first knowledge of it came from a credit report rather than from them. They continued reporting after a written dispute that legally required them to stop until verification was mailed, and no verification was ever mailed. They present themselves on my file in the format of original creditors when they hold no account with me.
Every one of those is a representation to a third party — to {bureau_name}, and through you to every lender who reads my file — that this debt is validated, undisputed, and owed to the party claiming it. None of those three things is true. That is not an aggressive collection style. It is deceptive means under 1692e(10), and it has been continuous for months.

{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}$ccc_19$, 'CCC-original v1 rewrite modeled on the course''s COL R6 law and escalation purpose. Source: COL - R6 - 1692e(10).docx. Team fields: damages, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"COL-R7-v1","flow":"collection","round":7,"source":"COL - R7 - 1681q.docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"0d8ae100ae80365800146eaa87dad0bacb27cc90b5fb57f15e27d2145b1021a6"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  'b022635d-5f4a-52f3-9a9b-edebf11950e4', null, 'COL - R7 - 1681q', 'collection',
  7, 'ALL', 'v1', $ccc_20${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1681q — Obtaining my file under false pretenses is not a civil matter.

{damages}
— — — FACTS (do not change this section) — — —
Everything in this file so far has been about civil obligations. This letter is about something else, and I want to be careful and precise, because I am not making this accusation loosely.
15 USC 1681q provides that any person who knowingly and willfully obtains information on a consumer from a consumer reporting agency under false pretenses shall be fined under title 18, imprisoned for not more than two years, or both.
The pretense under which these companies access and report on my file is that they hold an account with me and are collecting on it. I have established across prior rounds, in writing and without rebuttal, that no such account exists. I never applied to these companies, never signed an agreement with them, and never received anything from them.
I am not asking {bureau_name} to prosecute anyone. I am pointing out that you are the agency from which that information was obtained, and that you have now been told in writing, more than once, that the basis claimed for obtaining it does not exist. Whatever the collectors knew when they first accessed my file, {bureau_name} knows now. Continuing to supply my information to a party whose stated basis you have been told is false is a decision you are making with full notice.

{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}$ccc_20$, 'CCC-original v1 rewrite modeled on the course''s COL R7 law and escalation purpose. Source: COL - R7 - 1681q.docx. Team fields: damages, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"COL-R8-v1","flow":"collection","round":8,"source":"COL - R8 - 1692c(c).docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"a733e66cde8d2dd1897c23e2cb1578cd93cbc0bb038f108a258730ccb07a1664"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '952c5635-4435-5d18-9729-ab1729f71d30', null, 'COL - R8 - 1692c(c)', 'collection',
  8, 'ALL', 'v1', $ccc_21${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1692c(c) — I refused to pay in writing. The account is still reporting. Reporting is communicating.

{damages}
— — — FACTS (do not change this section) — — —
I am putting something in writing in this letter that I want recorded plainly, and then I am going to explain why it changes the legal situation.
I refuse to pay the debts listed in this dispute, and I am notifying every collector named here, through this dispute, that I want all further communication regarding these debts to cease.
15 USC 1692c(c) provides that once a consumer notifies a debt collector in writing that the consumer refuses to pay a debt, or wishes the collector to cease further communication, the collector shall not communicate further with respect to that debt, with narrow exceptions — to say collection efforts are ending, or to state that a specific remedy will be invoked.
Now apply that to a tradeline. Continuing to furnish this account to {bureau_name} every month is a continuing communication about the debt. It is a monthly statement about my alleged obligation, transmitted to a third party and republished to everyone who reads my file. It is not one of the narrow exceptions the statute allows.
So the position is now this. I have refused to pay in writing and demanded communication cease. If these accounts appear on my next report, that is a communication made after written notice to stop, and every subsequent monthly furnish is another one.

{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}$ccc_21$, 'CCC-original v1 rewrite modeled on the course''s COL R8 law and escalation purpose. Source: COL - R8 - 1692c(c).docx. Team fields: damages, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"COL-R9-v1","flow":"collection","round":9,"source":"COL - R9 - 1681b(a)(3)(a).docx","sourceTokens":["bdate","bureau_address","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"31afa897219d23ac0c61b62e81f225467a2dcb96b8fb8590c92f67816613e3e5"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '72cfc695-45a0-5066-9f30-04bdecbe8693', null, 'COL - R9 - 1681b(a)(3)(a)', 'collection',
  9, 'ALL', 'v1', $ccc_22${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1681b(a)(3)(A) — There is no permissible purpose here, because there was never a transaction.

{damages}
— — — FACTS (do not change this section) — — —
This is my ninth letter about these accounts. I want to close the loop on the question that everything else has been circling.
15 USC 1681b(a)(3)(A) permits a consumer report to be furnished to a person who intends to use the information in connection with a credit transaction involving the consumer, and involving the extension of credit to, or review or collection of an account of, the consumer.
Every clause of that provision assumes a relationship between me and the party receiving my file. A credit transaction involving me. An extension of credit to me. Review or collection of an account of mine.
None of those describe the companies in this dispute. There was no credit transaction between us. No credit was extended to me by them. There is no account of mine to review or collect. They bought a receivable from someone else, and a purchase agreement between two other parties does not manufacture a permissible purpose to access my file.
That is the whole case, and it has been unrebutted for nine rounds. Without a permissible purpose under 1681b(a), the furnishing of my file to these parties was not authorized, and the accounts they placed there as a result have no lawful basis to remain.

{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}$ccc_22$, 'CCC-original v1 rewrite modeled on the course''s COL R9 law and escalation purpose. Source: COL - R9 - 1681b(a)(3)(a).docx. Team fields: damages, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"COL-R10-v1","flow":"collection","round":10,"source":"COL - R10 - RANT 1692k.docx","sourceTokens":["bdate","bureau_address","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","personalization","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"621b3b0f321ca72a03268ffd450bc38d3be03fa79a75a5a42ad7da748f1a197c"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '76c7aee9-553f-5220-acb4-84ac4a1271aa', null, 'COL - R10 - RANT 1692k', 'collection',
  10, 'ALL', 'v1', $ccc_23${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1692k — Nine disputes, nine violations, and not one of them was ever answered.

{damages}
{personalization}
{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}$ccc_23$, 'CCC-original v1 rewrite modeled on the course''s COL R10 law and escalation purpose. Source: COL - R10 - RANT 1692k.docx. Team fields: damages, personalization, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"COMBO-R1-v1","flow":"combo","round":1,"source":"COMBO - R1 - Factual + 1692g.docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","personalization","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"e788f7500bb5fd1a3a84808ae5a764dca7195efb69dbd16388576f61b8099707"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  'e8e15504-e5b9-55a3-a422-5286d83e6a40', null, 'COMBO - R1 - Factual + 1692g', 'combo',
  1, 'ALL', 'v1', $ccc_24${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

TWO SEPARATE VIOLATIONS — Inaccurate reporting, and collection accounts that were never validated.

{damages}
— — — FACTS (do not change this section) — — —
This dispute covers two different problems under two different laws. I have separated them. Please treat them as separate counts.
COUNT 1 — INACCURATE REPORTING. The accuracy accounts listed below report one set of numbers at {bureau_name} and a different set at another bureau. Same account, same month, different answers. The FCRA holds you to maximum possible accuracy, which means that once I put you on notice of a conflict in writing, what you publish about me has to line up. I have listed the exact fields and attached screenshots so there is nothing to guess at.
COUNT 2 — COLLECTION ACCOUNTS NEVER VALIDATED. Under 15 USC 1692g, a debt collector must send written notice of the debt within five days of the initial communication, stating the amount, the creditor, and my right to dispute. The collectors listed below never sent me one. I learned these accounts existed by pulling my own credit report. Reporting a debt to you is itself a communication about it, so these collectors communicated about my debt to a third party before ever validating it with me. Produce proof a dunning letter was mailed within five days, or delete the accounts.

Every item listed below this sentence is reporting information about me that is not accurate.

{personalization}
{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —
The information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute.

{screenshots}$ccc_24$, 'CCC-original v1 rewrite modeled on the course''s COMBO R1 law and escalation purpose. Source: COMBO - R1 - Factual + 1692g.docx. Team fields: damages, personalization, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"COMBO-R2-v1","flow":"combo","round":2,"source":"COMBO - R2 - 1681e(b) + 1692g(b).docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","personalization","penalty","consumer_statement"],"exampleOnlyTokens":["bureau_name"],"bodySha256":"0c553a406f3953bc0db4fa9504435a4c99abe3ea8e13c99f0009f42fefb8e166"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  'de1dabd9-2f74-51b6-8820-884a9409c9e6', null, 'COMBO - R2 - 1681e(b) + 1692g(b)', 'combo',
  2, 'ALL', 'v1', $ccc_25${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

STILL TWO VIOLATIONS — "Verified" with nothing corrected, and collection that never stopped.

{damages}
— — — FACTS (do not change this section) — — —
My last letter raised two counts. Both are still open, and both got worse the same way — you answered without acting.
COUNT 1 — 15 USC 1681e(b). I documented exactly which fields conflicted across bureaus and gave you screenshots. You answered that the information was verified, then left every number the way it was. If anything had actually been compared against the conflicting data I sent, either the numbers would now match or you would have told me which version was right and why. Neither happened. Passing a furnisher's one-word answer back to me without resolving a documented conflict is not the reasonable procedure 1681e(b) requires.
COUNT 2 — 15 USC 1692g(b). My written dispute triggered a specific duty. Once a consumer disputes a debt in writing, the collector must cease collection until it obtains verification and mails it to the consumer. I received no verification. Nothing was mailed. And these accounts still report on my file. Continuing to report a disputed debt is continuing to collect on it — the reporting is the pressure, which is why collectors furnish to you at all.

Every item listed below this sentence is reporting information about me that is not accurate.

{personalization}
{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —
The information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute.

{screenshots}$ccc_25$, 'CCC-original v1 rewrite modeled on the course''s COMBO R2 law and escalation purpose. Source: COMBO - R2 - 1681e(b) + 1692g(b).docx. Team fields: damages, personalization, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"COMBO-R3-v1","flow":"combo","round":3,"source":"COMBO - R3 - 1681i(a)(5) + 1692j.docx","sourceTokens":["bdate","bureau_address","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","personalization","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"d87cc6790f417ff125619e716e41d15e4b7dfd21f586417f8dbb4dad8cecee7f"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '754843f5-268a-5892-b25f-bd486d5ef005', null, 'COMBO - R3 - 1681i(a)(5) + 1692j', 'combo',
  3, 'ALL', 'v1', $ccc_26${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

COUNT 1: unverifiable information must be deleted. COUNT 2: these collectors are not my creditors.

{damages}
— — — FACTS (do not change this section) — — —
Three rounds in, both counts are unresolved and both have hardened into something more specific.
COUNT 1 — 15 USC 1681i(a)(5). If after a reinvestigation an item is found inaccurate or incomplete, or cannot be verified, the agency shall promptly delete it or modify it based on the results. There is no third option where the item stays exactly as it was and gets called verified. So either you verified these accounts and the information is still wrong, which makes it inaccurate, or you did not actually verify them, which makes it unverified. Both roads end in deletion.
COUNT 2 — 15 USC 1692j. Look at how these collection accounts appear on my report. Creditor name, account number, balance, payment status — formatted exactly like a bank or a card issuer. Anyone reading my file would conclude I opened an account with these companies. I never did. 1692j makes it unlawful to furnish any form knowing it would create the false belief that a person other than the creditor is participating in collecting a debt. Furnishing a purchased receivable in original-creditor format is that false belief, manufactured.

Every item listed below this sentence is reporting information about me that is not accurate.

{personalization}
{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —
The information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute.

{screenshots}$ccc_26$, 'CCC-original v1 rewrite modeled on the course''s COMBO R3 law and escalation purpose. Source: COMBO - R3 - 1681i(a)(5) + 1692j.docx. Team fields: damages, personalization, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"COMBO-R4-v1","flow":"combo","round":4,"source":"COMBO - R4 - 1681i(a)(1)(a) + 1681a(m).docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","personalization","penalty","consumer_statement"],"exampleOnlyTokens":["bureau_name"],"bodySha256":"32a829aedaf7da12c89a21ae4661e58412775a19689fb1c43364ac8744f6e80f"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '36083515-93b6-50d4-a44f-28a2b65df429', null, 'COMBO - R4 - 1681i(a)(1)(a) + 1681a(m)', 'combo',
  4, 'ALL', 'v1', $ccc_27${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

COUNT 1: no reasonable reinvestigation, four rounds running. COUNT 2: no account, no carve-out.

{damages}
— — — FACTS (do not change this section) — — —
Four letters, four cycles, and neither count has been touched.
COUNT 1 — 15 USC 1681i(a)(1)(A). When a consumer disputes accuracy and notifies the agency directly, the agency shall conduct a reasonable reinvestigation and record the current status of the disputed information or delete it, before the end of the 30-day period. The word doing the work is reasonable. A reinvestigation is not a code sent through the ACDV system with whatever comes back forwarded to me. I have given you specific fields with specific conflicting values and not one of your responses has ever addressed a single field. You cannot reasonably reinvestigate a dispute nobody read.
COUNT 2 — 15 USC 1681a(m). Collectors justify pulling and reporting a file by pointing to account review or collection. That defense does not reach these companies. 1681a(m) carves out use of a consumer report by a person with which the consumer has an account, for reviewing or collecting that account. A person with which I have an account. I have no account with any company in this dispute — they purchased a receivable from someone else, and buying paper does not create an account between me and the buyer.

Every item listed below this sentence is reporting information about me that is not accurate.

{personalization}
{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —
The information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute.

{screenshots}$ccc_27$, 'CCC-original v1 rewrite modeled on the course''s COMBO R4 law and escalation purpose. Source: COMBO - R4 - 1681i(a)(1)(a) + 1681a(m).docx. Team fields: damages, personalization, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"COMBO-R8-v1","flow":"combo","round":8,"source":"COMBO - R8 - 1681s-2(b) + 1681(b).docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","personalization","penalty","consumer_statement"],"exampleOnlyTokens":["bureau_name"],"bodySha256":"474a08017bc9d8ef981b3e1697eaf26795f2554df9a2d3206b3ad0c47ac214f2"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  'a68ee1fb-6973-5660-abd4-a255a5cd7f50', null, 'COMBO - R8 - 1681s-2(b) + 1681(b)', 'combo',
  8, 'ALL', 'v1', $ccc_28${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

COUNT 1: prove you ever notified the furnishers. COUNT 2: proper utilization is a legal standard.

{damages}
— — — FACTS (do not change this section) — — —
Two counts, both about a step that happens where I cannot see it.
COUNT 1 — 15 USC 1681i(a)(2)(A) and 1681s-2(b). Within five business days of receiving my dispute you must notify the furnisher and include all relevant information regarding the dispute that you received from me. All relevant information — the substance of what I wrote, not a two-digit code. That notice is what triggers the furnisher's own duties under 1681s-2(b) to investigate and review all relevant information you provided. Nothing in any response I have received suggests any furnisher ever saw a word I wrote. Produce the date each furnisher was notified and the content of what was sent.
COUNT 2 — 15 USC 1681(b). Your agency exists to adopt reasonable procedures for meeting the needs of commerce in a manner fair and equitable to the consumer, with regard to confidentiality, accuracy, relevancy, and proper utilization of the information. Taking accounts from companies with no relationship to me, presenting them in a format implying a relationship that never existed, and continuing to publish after repeated written notice is not proper utilization by any reading of 1681(b).

Every item listed below this sentence is reporting information about me that is not accurate.

{personalization}
{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —
The information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute.

{screenshots}$ccc_28$, 'CCC-original v1 rewrite modeled on the course''s COMBO R8 law and escalation purpose. Source: COMBO - R8 - 1681s-2(b) + 1681(b).docx. Team fields: damages, personalization, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"COMBO-R9-v1","flow":"combo","round":9,"source":"COMBO - R9 - 1681(b) + 1692e(10).docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","personalization","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"9ae594a1c40457409153c285c92bfd615325246aba16a2a9f9cae2b6586c7eb8"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '7576ddf0-6373-5b43-b859-b18c93cec0a6', null, 'COMBO - R9 - 1681(b) + 1692e(10)', 'combo',
  9, 'ALL', 'v1', $ccc_29${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

COUNT 1: your procedures have failed the same accounts nine times. COUNT 2: deceptive means.

{damages}
— — — FACTS (do not change this section) — — —
I want to stop arguing individual accounts and describe the pattern, because the pattern is now the violation.
COUNT 1 — 15 USC 1681(b). 1681e(b) required reasonable procedures to assure maximum possible accuracy and the accounts still conflict. 1681i(a)(1)(A) required a reasonable reinvestigation and no disputed field has ever been addressed. 1681i(a)(5) required deletion of anything unverified and nothing has been deleted. 1681i(c) required my consumer statements to be carried forward and none were. One of those alone is an isolated failure. All of them, on the same accounts, across nine rounds, is a description of how your procedures actually operate.
COUNT 2 — 15 USC 1692e(10), which prohibits any false representation or deceptive means to collect a debt. Established in writing and never rebutted: these collectors reported before sending any validation notice, continued reporting after a written dispute that required them to stop until verification was mailed, and present themselves as original creditors while holding no account with me. Each is a representation to {bureau_name}, and through you to every lender, that this debt is validated, undisputed, and owed to the party claiming it. None of those three things is true.

Every item listed below this sentence is reporting information about me that is not accurate.

{personalization}
{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —
The information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute.

{screenshots}$ccc_29$, 'CCC-original v1 rewrite modeled on the course''s COMBO R9 law and escalation purpose. Source: COMBO - R9 - 1681(b) + 1692e(10).docx. Team fields: damages, personalization, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"COMBO-R10-v1","flow":"combo","round":10,"source":"COMBO - R10 - 1681c(e) + 1681q.docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","personalization","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"3d38b241e1e262ba073aa495a594e872d3a61ad1296cd16d0f653920715287f7"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  'e94483a7-bc1b-5fca-8a41-a5a9ed0e0228', null, 'COMBO - R10 - 1681c(e) + 1681q', 'combo',
  10, 'ALL', 'v1', $ccc_30${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

COUNT 1: I closed these accounts and your report does not say so. COUNT 2: false pretenses.

{damages}
— — — FACTS (do not change this section) — — —
Two counts. One is a specific omission. The other is more serious and I am stating it carefully.
COUNT 1 — 15 USC 1681c(e). If an agency is notified that a credit account was voluntarily closed by the consumer, the agency shall indicate that fact in any consumer report including the account. The accounts listed below were closed by me. Not by the creditor, not for inactivity. Your report either shows them closed by the creditor or does not indicate who closed them. Anyone in lending will tell you those read completely differently — one is a person managing their credit, the other is a lender shutting someone down. This letter is your notification. Indicate it or delete them.
COUNT 2 — 15 USC 1681q, which addresses knowingly and willfully obtaining consumer information under false pretenses. The pretense under which these collectors access and report my file is that they hold an account with me and are collecting on it. I have established across prior rounds, unrebutted, that no such account exists. I am not asking {bureau_name} to prosecute anyone. I am pointing out that you are the agency the information was obtained from, you have now been told in writing more than once that the stated basis does not exist, and continuing to supply my file to those parties is a decision you are making with full notice.

Every item listed below this sentence is reporting information about me that is not accurate.

{personalization}
{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —
The information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute.

{screenshots}$ccc_30$, 'CCC-original v1 rewrite modeled on the course''s COMBO R10 law and escalation purpose. Source: COMBO - R10 - 1681c(e) + 1681q.docx. Team fields: damages, personalization, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"COMBO-R11-v1","flow":"combo","round":11,"source":"COMBO - R11 - Legal dispute + 1692c(c).docx","sourceTokens":["bdate","bureau_address","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","personalization","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"f09bf6a9bd2eb3b3a23abe500c2c50c89eceac7d64d1b405927fccbfc2a34ccc"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  'e0692e55-6960-5932-9225-bc9f0f0fe734', null, 'COMBO - R11 - Legal dispute + 1692c(c)', 'combo',
  11, 'ALL', 'v1', $ccc_31${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

COUNT 1: the legal position, stated plainly. COUNT 2: I refused to pay in writing and it is still reporting.

{damages}
— — — FACTS (do not change this section) — — —
Eleven rounds. I am going to state the whole legal position in one place, and then I am going to put something on the record.
COUNT 1 — THE LEGAL POSITION. Every requirement that governs this file has been triggered and failed. Reasonable procedures to assure maximum possible accuracy under 1681e(b). A reasonable reinvestigation within 30 days under 1681i(a)(1)(A). Deletion of anything inaccurate, incomplete, or unverifiable under 1681i(a)(5). A description of the verification procedure under 1681i(a)(7). Notation of dispute and carriage of my consumer statement under 1681i(c). Notice to furnishers under 1681i(a)(2)(A). Each was invoked in writing, and none produced a compliant response.
COUNT 2 — 15 USC 1692c(c). I am notifying every collector named in this dispute, in writing, that I refuse to pay these debts and that all further communication regarding them must cease. Under 1692c(c) a collector may not communicate further about a debt after that notice, with narrow exceptions for saying efforts have ended or that a specific remedy will be invoked. Continuing to furnish these accounts monthly is a continuing communication about the debt — a monthly statement about my alleged obligation, transmitted to a third party and republished to everyone who reads my file. If these accounts appear on my next report, that is a communication made after written notice to stop.

Every item listed below this sentence is reporting information about me that is not accurate.

{personalization}
{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —
The information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute.

{screenshots}$ccc_31$, 'CCC-original v1 rewrite modeled on the course''s COMBO R11 law and escalation purpose. Source: COMBO - R11 - Legal dispute + 1692c(c).docx. Team fields: damages, personalization, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"COMBO-R12-v1","flow":"combo","round":12,"source":"COMBO - R12 - RANT LITIGATE 1681o 1681n.docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","personalization","penalty","consumer_statement"],"exampleOnlyTokens":["bureau_name"],"bodySha256":"003485d78ef7fcbd5bd760db2f4636bf1c836690ce21d3bf81f718bff44e2de0"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '464fe265-72f8-54f0-8e5b-c5c55a7cb61d', null, 'COMBO - R12 - RANT LITIGATE 1681o 1681n', 'combo',
  12, 'ALL', 'v1', $ccc_32${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1681o and 1681n — Eleven disputes on two separate counts. This is the last one before it stops being a dispute.

{damages}
{personalization}
{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}
— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —
The information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute.

{screenshots}$ccc_32$, 'CCC-original v1 rewrite modeled on the course''s COMBO R12 law and escalation purpose. Source: COMBO - R12 - RANT LITIGATE 1681o 1681n.docx. Team fields: damages, personalization, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"CON-R1-v1","flow":"consent","round":1,"source":"CON - R1 - 1681b(a)(2).docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","optional_strengthener","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"a67eac95bfa474405252890a0e8ab4c706ef2a3c4dcc71f9e58e5530896f60a2"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '6e226088-da84-59b1-827c-dcd6e57ac2e0', null, 'CON - R1 - 1681b(a)(2)', 'consent',
  1, 'ALL', 'v1', $ccc_33${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1681b(a)(2) — You are furnishing my file without my written instructions.

{damages}
— — — FACTS (do not change this section) — — —
You have run over my right to privacy by reporting accounts without my written authorization, and for that you are facing penalties under 15 USC 1681b(a)(2).
The law is straightforward. For {bureau_name} to report an account on my credit file, you must have specific written instructions from me, the consumer. Not implied consent. Not a business relationship you have with some other company. Not something buried in an agreement I signed with a creditor years ago. Written instructions, from me, to you.
You have none. Every account listed below was placed on my report without my prior written consent, which means not one of them has a permissible purpose to be there. Unless you can produce a signed agreement between me and {bureau_name} showing I authorized this, you are furnishing my information without a permissible purpose, and that is a direct violation of my right to privacy.
{optional_strengthener}
{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}$ccc_33$, 'CCC-original v1 rewrite modeled on the course''s CON R1 law and escalation purpose. Source: CON - R1 - 1681b(a)(2).docx. Team fields: damages, optional_strengthener, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"CON-R2-v1","flow":"consent","round":2,"source":"CON - R2 - 1681(a)(4).docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"924c19ac93bcb6ff4398f283aad08bb9c286eebd6eb76fe2bb09fa01ab4e56b7"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '749d436a-812b-5df5-912e-2054d2232cf7', null, 'CON - R2 - 1681(a)(4)', 'consent',
  2, 'ALL', 'v1', $ccc_34${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1681(a)(4) — I told you once. It is still on my report. That is my privacy, not a clerical error.

{damages}
— — — FACTS (do not change this section) — — —
In my last letter I explained, in writing, exactly why the information listed below does not belong on my credit report. {bureau_name} received that letter. My report has since updated. The information is still there.
Congress was direct about what your obligations are. 15 USC 1681(a)(4) states that there is a need to insure that consumer reporting agencies exercise their grave responsibilities with fairness, impartiality, and a respect for the consumer's right to privacy. That is not decoration at the front of the statute. It is the reason every other section of the FCRA exists, and it is the standard your conduct gets measured against.
Here is why this is a privacy problem and not a filing problem. You were told in writing that this information is either being furnished without my consent or is information the law excludes from a consumer report. You had a full cycle to look at that and act. Instead you kept publishing it to every party that requested my file during that window.
Once you have been told and you publish anyway, the fairness and impartiality Congress described stops describing what you are doing. Every day this stays up, my private financial information is released to people with no right to see it, by an agency that has already been told so in writing.

{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}$ccc_34$, 'CCC-original v1 rewrite modeled on the course''s CON R2 law and escalation purpose. Source: CON - R2 - 1681(a)(4).docx. Team fields: damages, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"CON-R3-v1","flow":"consent","round":3,"source":"CON - R3 - 1681a(d)(2)(b).docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"328b76f99fd7f771a6da314d7d41a67261733d7247cf06e2820b2875a93ae768"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  'b175aad1-6acb-5731-be3e-37ee111e83c3', null, 'CON - R3 - 1681a(d)(2)(b)', 'consent',
  3, 'ALL', 'v1', $ccc_35${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1681a(d)(2)(B) — Excluded information. You have now been told twice and it is still there.

{damages}
— — — FACTS (do not change this section) — — —
I have told {bureau_name} twice, in writing, that these accounts are reporting without my consent and without a permissible purpose. Both letters were ignored and the accounts are still on my report. So let me put the sharpest version of the argument in front of you.
15 USC 1681a(d)(2)(B) excludes from the definition of a consumer report any authorization or approval of a specific extension of credit directly or indirectly by the issuer of a credit card or similar device.
Now look at who the furnishers in this dispute actually are. They are my credit card issuers. And look at what they are reporting. A balance. That balance is not an abstraction — it is the specific extension of credit those issuers approved for me. It is the exact thing the statute names.
If you want the more technical version: a specific extension of credit used through a credit card is a consumer transaction, and for a consumer transaction to occur an extension of credit must first be granted. So you are publishing both the extension of credit and the transaction it produced, and 1681a(d)(2)(B) excludes the first one outright.
To be clear about what I am not arguing, because it comes up and it is wrong: I am not claiming a social security card is a credit card. That argument fails and the courts have said so — see Young v. National Credit Audit Corp., 2022 U.S. Dist. LEXIS 192281 at *9. My argument is simpler and it is the one the statute actually supports. These furnishers are credit card issuers and they are reporting a specific extension of credit.

{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}$ccc_35$, 'CCC-original v1 rewrite modeled on the course''s CON R3 law and escalation purpose. Source: CON - R3 - 1681a(d)(2)(b).docx. Team fields: damages, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"DIRECT-R1-v1","flow":"direct","round":1,"source":"DIRECT - R1 - Debt Verification.docx","sourceTokens":["account_number","client_address","client_first_name","client_last_name","creditor_address","creditor_city","creditor_name","creditor_state","creditor_zip","curr_date"],"humanTokens":["damages","personalization","optional_strengthener","penalty"],"exampleOnlyTokens":[],"bodySha256":"6d9dc991e531699890d8ac041649919a53825fdecf60c4a6dc71d3706dbec262"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '8341ad23-49f5-505d-a05d-23a0202b5746', null, 'DIRECT - R1 - Debt Verification', 'direct',
  1, 'ALL', 'v1', $ccc_36${client_first_name} {client_last_name}
{client_address}

{curr_date}

{creditor_name}
{creditor_address}
{creditor_city}
{creditor_state} {creditor_zip}

Account number: {account_number}

DEBT VERIFICATION REQUEST — 15 USC 1692g(b)

{damages}
{personalization}
{optional_strengthener}
{penalty}$ccc_36$, 'CCC-original v1 rewrite modeled on the course''s DIRECT R1 law and escalation purpose. Source: DIRECT - R1 - Debt Verification.docx. Team fields: damages, personalization, optional_strengthener, penalty.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"DIRECT-R2-v1","flow":"direct","round":2,"source":"DIRECT - R2 - Call Out and Kill.docx","sourceTokens":["account_number","client_address","client_first_name","client_last_name","creditor_address","creditor_city","creditor_name","creditor_state","creditor_zip","curr_date"],"humanTokens":["personalization","optional_strengthener","damages","penalty"],"exampleOnlyTokens":[],"bodySha256":"6a46de5a421e8a15362bbe875fa363de2aabf1999089f05ce6682faae79a8927"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  'd0a64f13-9e1f-55e4-867c-c38fc3f39e41', null, 'DIRECT - R2 - Call Out and Kill', 'direct',
  2, 'ALL', 'v1', $ccc_37${client_first_name} {client_last_name}
{client_address}

{curr_date}

{creditor_name}
{creditor_address}
{creditor_city}
{creditor_state} {creditor_zip}

Account number: {account_number}

SECOND AND FINAL NOTICE — You did not verify. 15 USC 1692g(b) and 1692e(10)

{personalization}
{optional_strengthener}
{damages}
{penalty}$ccc_37$, 'CCC-original v1 rewrite modeled on the course''s DIRECT R2 law and escalation purpose. Source: DIRECT - R2 - Call Out and Kill.docx. Team fields: personalization, optional_strengthener, damages, penalty.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();

-- CCC-TEMPLATE {"key":"LP-R1-v1","flow":"late_pay","round":1,"source":"LP - R1 - 1681a(d)(a)(2)(a)(i).docx","sourceTokens":["bdate","bureau_address","bureau_name","client_address","client_first_name","client_last_name","curr_date","dispute_item_and_explanation","ss_number"],"humanTokens":["damages","penalty","consumer_statement"],"exampleOnlyTokens":[],"bodySha256":"02a0e2a85f767c102a909ab3811f50e09705a91b7b532b7998b1d49d196fe2e5"}
insert into public.dispute_templates (
  id, created_by, name, flow_code, round_number, bureau_code,
  version_label, body_text, notes, is_active
) values (
  '4dfef33d-46c6-5b56-ac0f-c6227eb2e11b', null, 'LP - R1 - 1681a(d)(a)(2)(a)(i)', 'late_pay',
  1, 'ALL', 'v1', $ccc_38${client_first_name} {client_last_name}
{client_address}
SS#: {ss_number}
Date of birth: {bdate}

{bureau_address}

{curr_date}

15 USC 1681a(d)(a)(2)(a)(i) — A late payment is a private transaction. The law excludes it from my report.

{damages}
— — — FACTS (do not change this section) — — —
I am not disputing that this account is mine and I am not asking you to delete the account. I am disputing one specific thing you publish about it, and I want to be exact about what that thing is.
A late payment is not a status. It is a transaction. It is a record of a payment that happened between me and my creditor, and no one else on earth was party to it.
15 USC 1681a(d)(a)(2)(a)(i) excludes from the definition of a consumer report any information solely as to transactions or experiences between the consumer and the person making the report. Read that against what you are publishing. A 30, 60, or 90 day late marker is a report of a specific transaction between me and that creditor. It is the definition of the thing Congress carved out.
And it is a consumer transaction specifically. Under U.C.C. 3-103, a consumer transaction is one that obligates the consumer for personal, family, or household purposes. Every charge that account ever carried was for one of those three things, which makes each payment a consumer transaction and makes the late markers a report of them.
The last piece is who is doing the reporting. My creditor has firsthand knowledge of that transaction. {bureau_name} does not. You were not a party to it. You are a third party taking a private transaction between me and my creditor and broadcasting it to every lender in the country, which is exactly the information the statute excludes.

{penalty}
— — — DELETION LIST (do not change this line) — — —
I demand you delete the following illegal information from my credit report:

{dispute_item_and_explanation}

{consumer_statement}$ccc_38$, 'CCC-original v1 rewrite modeled on the course''s LP R1 law and escalation purpose. Source: LP - R1 - 1681a(d)(a)(2)(a)(i).docx. Team fields: damages, penalty, consumer_statement.', true
)
on conflict (id) do update set
  name = excluded.name,
  flow_code = excluded.flow_code,
  round_number = excluded.round_number,
  bureau_code = excluded.bureau_code,
  version_label = excluded.version_label,
  body_text = excluded.body_text,
  notes = excluded.notes,
  is_active = excluded.is_active,
  updated_at = now();
