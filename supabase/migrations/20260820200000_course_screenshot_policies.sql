-- Make the original-course screenshot rules explicit per template version.
-- A {screenshots} merge token remains a placement hint only; the saved policy
-- snapshot is the mailing authority. Existing letters and used template bodies
-- are preserved.

alter table public.dispute_templates
  add column if not exists screenshot_policy_code text,
  add column if not exists screenshot_staff_instructions text;

-- Existing staff templates get a conservative one-time default. Staff can
-- explicitly revise the policy in the library; new templates default to none.
update public.dispute_templates
set screenshot_policy_code = case
      when body_text ~* '\{\{?[[:space:]]*screenshots[[:space:]]*\}?\}'
        then 'inaccurate_accounts'
      else 'none'
    end,
    screenshot_staff_instructions = case
      when body_text ~* '\{\{?[[:space:]]*screenshots[[:space:]]*\}?\}'
        then 'For every disputed account, upload reviewed credit-report evidence supporting the exact issue raised by this template.'
      else null
    end
where screenshot_policy_code is null
   or btrim(screenshot_policy_code) = '';

-- Original-course source template matrix. Combo R5-R7 intentionally use the
-- corresponding Accuracy template through the existing fallback selector.
with policies(id, policy_code, staff_instructions) as (
  values
    ('24becae4-87a4-516c-a701-33ad86991853'::uuid, 'none', null),
    ('c666f020-2ee9-5a08-99d7-d769e33f50ef'::uuid, 'cross_bureau_mismatch', 'For every disputed account, upload reviewed credit-report evidence showing the exact field values that conflict across bureaus.'),
    ('14733136-64e9-5020-bb21-7520c97149be'::uuid, 'inaccurate_accounts', 'For every disputed account, upload a reviewed screenshot from the current credit report showing the inaccurate reporting addressed in this round.'),
    ('463c2c76-ee3d-5fc0-ae48-2f01af99d5bd'::uuid, 'inaccurate_accounts', 'For every disputed account, upload a reviewed screenshot from the current credit report showing the inaccurate reporting addressed in this round.'),
    ('0484d6e3-4d1e-554b-b441-6a4d5bb4ecc3'::uuid, 'none', null),
    ('2e0021f4-1f1b-5061-88c9-1c00e557bfc6'::uuid, 'none', null),
    ('2704a966-6678-52ca-ae31-39c1327a0702'::uuid, 'prior_consumer_statement_comments', 'For every disputed account, upload the current report''s comments section showing that the prior Consumer Statement is missing or incomplete.'),
    ('3b4e12a6-d773-51da-8162-4f6776283967'::uuid, 'inaccurate_accounts', 'For every disputed account, upload a reviewed screenshot from the current credit report showing the inaccurate reporting addressed in this round.'),
    ('f7de2437-2bb2-5927-91fe-4036779abaae'::uuid, 'mismatching_accounts', 'For every disputed account, upload reviewed report evidence showing the values that still mismatch across bureaus.'),
    ('b784cf55-3af4-5c42-b54a-d018812a45c5'::uuid, 'closure_status', 'For every disputed account, upload the current report''s status or comments section showing that it does not indicate the consumer voluntarily closed the account.'),
    ('a9309275-a620-5c03-acdf-1b0aecc2e690'::uuid, 'none', null),
    ('d3c0727c-4458-5e76-90f7-048e1ed76e50'::uuid, 'none', null),
    ('b26bbaad-2a4d-52a8-bdef-e58eef901c37'::uuid, 'dispute_comments', 'For every disputed account, upload the current report''s comments section showing that the account is not marked as disputed.'),
    ('e8e15504-e5b9-55a3-a422-5286d83e6a40'::uuid, 'none', null),
    ('de1dabd9-2f74-51b6-8820-884a9409c9e6'::uuid, 'cross_bureau_mismatch', 'For every disputed account, upload reviewed credit-report evidence showing the exact field values that conflict across bureaus.'),
    ('754843f5-268a-5892-b25f-bd486d5ef005'::uuid, 'inaccurate_accounts', 'For every disputed account, upload a reviewed screenshot from the current credit report showing the inaccurate reporting addressed in this round.'),
    ('36083515-93b6-50d4-a44f-28a2b65df429'::uuid, 'inaccurate_accounts', 'For every disputed account, upload a reviewed screenshot from the current credit report showing the inaccurate reporting addressed in this round.'),
    ('a68ee1fb-6973-5660-abd4-a255a5cd7f50'::uuid, 'inaccurate_accounts', 'For every disputed account, upload a reviewed screenshot from the current credit report showing the inaccurate reporting addressed in this round.'),
    ('7576ddf0-6373-5b43-b859-b18c93cec0a6'::uuid, 'mismatching_accounts', 'For every disputed account, upload reviewed report evidence showing the values that still mismatch across bureaus.'),
    ('e94483a7-bc1b-5fca-8a41-a5a9ed0e0228'::uuid, 'closure_status', 'For every disputed account, upload the current report''s status or comments section showing that it does not indicate the consumer voluntarily closed the account.'),
    ('e0692e55-6960-5932-9225-bc9f0f0fe734'::uuid, 'none', null),
    ('464fe265-72f8-54f0-8e5b-c5c55a7cb61d'::uuid, 'none', null)
)
update public.dispute_templates template
set screenshot_policy_code = policies.policy_code,
    screenshot_staff_instructions = policies.staff_instructions,
    updated_at = now()
from policies
where template.id = policies.id
  and template.created_by is null;

-- All other source-controlled Collection, Consent, Late Pay, and Direct
-- templates require no credit-report screenshots under the original course.
update public.dispute_templates
set screenshot_policy_code = 'none',
    screenshot_staff_instructions = null,
    updated_at = now()
where created_by is null
  and flow_code in ('collection', 'consent', 'late_pay', 'direct');

alter table public.dispute_templates
  alter column screenshot_policy_code set default 'none',
  alter column screenshot_policy_code set not null,
  drop constraint if exists dispute_templates_screenshot_policy_code_check,
  add constraint dispute_templates_screenshot_policy_code_check check (
    screenshot_policy_code in (
      'none',
      'cross_bureau_mismatch',
      'inaccurate_accounts',
      'prior_consumer_statement_comments',
      'mismatching_accounts',
      'closure_status',
      'dispute_comments'
    )
  ),
  drop constraint if exists dispute_templates_screenshot_policy_instructions_check,
  add constraint dispute_templates_screenshot_policy_instructions_check check (
    screenshot_policy_code = 'none'
    or length(btrim(coalesce(screenshot_staff_instructions, ''))) > 0
  );

comment on column public.dispute_templates.screenshot_policy_code is
  'Course-authoritative evidence rule for this exact template version. The screenshots merge token controls placement only.';
comment on column public.dispute_templates.screenshot_staff_instructions is
  'Template-version-specific instructions telling staff which credit-report evidence must be reviewed and attached.';

-- The initial CCC seed placed a generic screenshot section on every Accuracy
-- and Combo body. Remove it only from the eight definite course false positives.
-- Used rows get deterministic successors so mailed/saved template history stays
-- immutable; unused rows are safely corrected in place.
do $$
declare
  source_template public.dispute_templates%rowtype;
  correction record;
  corrected_body text;
begin
  for correction in
    select * from (values
      ('24becae4-87a4-516c-a701-33ad86991853'::uuid, 'b4040650-3ec8-4af2-bbf3-9b2f740f2401'::uuid),
      ('0484d6e3-4d1e-554b-b441-6a4d5bb4ecc3'::uuid, 'db7b2b20-c777-4803-99e3-119bca18e86e'::uuid),
      ('2e0021f4-1f1b-5061-88c9-1c00e557bfc6'::uuid, '4cdf8bcb-e329-4bd2-827e-ccb72ac6e2e8'::uuid),
      ('a9309275-a620-5c03-acdf-1b0aecc2e690'::uuid, '3ea09018-9010-4f6b-97f0-3806c43eb850'::uuid),
      ('d3c0727c-4458-5e76-90f7-048e1ed76e50'::uuid, '1bae1295-a87b-44b0-99e7-bc378d647e2f'::uuid),
      ('e8e15504-e5b9-55a3-a422-5286d83e6a40'::uuid, '7d477a80-fa1c-4429-9312-2c8b835cfc80'::uuid),
      ('e0692e55-6960-5932-9225-bc9f0f0fe734'::uuid, 'c88fcfbe-b97e-48df-96f4-002ffa1bedcb'::uuid),
      ('464fe265-72f8-54f0-8e5b-c5c55a7cb61d'::uuid, '16db52f6-ea35-4dd4-a3ab-d9e8dfd393de'::uuid)
    ) as values_to_correct(source_id, successor_id)
  loop
    select * into source_template
    from public.dispute_templates
    where id = correction.source_id
      and created_by is null
    for update;

    if not found then
      continue;
    end if;

    corrected_body := regexp_replace(
      source_template.body_text,
      E'\\n— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —\\nThe information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute\\.\\n\\n\\{screenshots\\}[[:space:]]*$',
      '',
      'i'
    );

    -- The CCC-authored ACC/Combo R1 masters also claimed inside fixed prose
    -- that screenshots were attached. Neither original course R1 letter says
    -- that, and both R1 policies are `none`, so remove only those CCC-added
    -- claims while preserving every law, fact pattern, and demand.
    if correction.source_id = '24becae4-87a4-516c-a701-33ad86991853'::uuid then
      corrected_body := replace(
        corrected_body,
        'I have included screenshots straight from my credit report so there is no question about what I am looking at. ',
        ''
      );
    elsif correction.source_id = 'e8e15504-e5b9-55a3-a422-5286d83e6a40'::uuid then
      corrected_body := replace(
        corrected_body,
        'I have listed the exact fields and attached screenshots so there is nothing to guess at.',
        'I have listed the exact fields so there is nothing to guess at.'
      );
    end if;

    if corrected_body = source_template.body_text then
      continue;
    end if;

    if exists (
      select 1 from public.letters letter
      where letter.dispute_template_id = source_template.id
    ) then
      if not exists (
        select 1 from public.dispute_templates
        where id = correction.successor_id
      ) then
        insert into public.dispute_templates (
          id, created_by, name, flow_code, round_number, bureau_code,
          version_label, body_text, notes, is_active, created_at, updated_at,
          template_family_key, published_on, review_due_on,
          supersedes_template_id, retired_at, retirement_reason,
          screenshot_policy_code, screenshot_staff_instructions
        ) values (
          correction.successor_id, null, source_template.name,
          source_template.flow_code, source_template.round_number,
          source_template.bureau_code, source_template.version_label || '-course-policy',
          corrected_body, source_template.notes, true, now(), now(),
          source_template.template_family_key, current_date, current_date + 49,
          source_template.id, null, null, 'none', null
        );
      end if;
      -- The activation trigger retires a newly superseded row. Repeat that
      -- result explicitly so a safely re-run migration cannot leave both the
      -- predecessor and its already-created successor selectable.
      update public.dispute_templates
      set is_active = false,
          retired_at = coalesce(retired_at, now()),
          retirement_reason = coalesce(retirement_reason, 'Superseded by course screenshot-policy correction'),
          updated_at = now()
      where id = source_template.id
        and exists (
          select 1 from public.dispute_templates successor
          where successor.id = correction.successor_id
            and successor.is_active = true
        );
    else
      update public.dispute_templates
      set body_text = corrected_body,
          screenshot_policy_code = 'none',
          screenshot_staff_instructions = null,
          updated_at = now()
      where id = source_template.id;
    end if;
  end loop;
end;
$$;

-- Treat screenshot policy as part of the immutable template-version contract.
create or replace function public.prevent_used_dispute_template_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (old.body_text, old.flow_code, old.round_number, old.bureau_code,
      old.version_label, old.template_family_key, old.screenshot_policy_code,
      old.screenshot_staff_instructions)
     is distinct from
     (new.body_text, new.flow_code, new.round_number, new.bureau_code,
      new.version_label, new.template_family_key, new.screenshot_policy_code,
      new.screenshot_staff_instructions)
     and exists (
       select 1 from public.letters letter
       where letter.dispute_template_id = old.id
     ) then
    raise exception 'This template version has letter history. Create a new version instead of rewriting it.';
  end if;
  return new;
end;
$$;

alter table public.letters
  add column if not exists dispute_screenshot_policy_snapshot jsonb not null default '{}'::jsonb;

alter table public.letters
  drop constraint if exists letters_dispute_screenshot_policy_snapshot_object,
  add constraint letters_dispute_screenshot_policy_snapshot_object
    check (jsonb_typeof(dispute_screenshot_policy_snapshot) = 'object'),
  drop constraint if exists letters_dispute_screenshot_policy_snapshot_contract,
  add constraint letters_dispute_screenshot_policy_snapshot_contract check (
    dispute_screenshot_policy_snapshot = '{}'::jsonb
    or (
      dispute_screenshot_policy_snapshot ?& array['version', 'code', 'label', 'required', 'staffInstructions']
      and dispute_screenshot_policy_snapshot->>'code' in (
        'none',
        'cross_bureau_mismatch',
        'inaccurate_accounts',
        'prior_consumer_statement_comments',
        'mismatching_accounts',
        'closure_status',
        'dispute_comments'
      )
      and jsonb_typeof(dispute_screenshot_policy_snapshot->'version') = 'number'
      and jsonb_typeof(dispute_screenshot_policy_snapshot->'label') = 'string'
      and jsonb_typeof(dispute_screenshot_policy_snapshot->'required') = 'boolean'
      and jsonb_typeof(dispute_screenshot_policy_snapshot->'staffInstructions') = 'string'
      and dispute_screenshot_policy_snapshot @> jsonb_build_object(
        'required',
        dispute_screenshot_policy_snapshot->>'code' <> 'none'
      )
      and (
        dispute_screenshot_policy_snapshot->>'code' = 'none'
        or length(btrim(dispute_screenshot_policy_snapshot->>'staffInstructions')) > 0
      )
    )
  );

update public.letters letter
set dispute_screenshot_policy_snapshot = jsonb_build_object(
  'version', 1,
  'code', template.screenshot_policy_code,
  'label', case template.screenshot_policy_code
    when 'none' then 'No credit-report screenshots'
    when 'cross_bureau_mismatch' then 'Cross-bureau mismatch evidence'
    when 'inaccurate_accounts' then 'Inaccurate-account evidence'
    when 'prior_consumer_statement_comments' then 'Prior Consumer Statement comments'
    when 'mismatching_accounts' then 'Mismatching-account evidence'
    when 'closure_status' then 'Consumer-closure status evidence'
    when 'dispute_comments' then 'Dispute/comments evidence'
  end,
  'required', template.screenshot_policy_code <> 'none',
  'staffInstructions', coalesce(template.screenshot_staff_instructions, '')
)
from public.dispute_templates template
where letter.dispute_template_id = template.id
  and letter.dispute_screenshot_policy_snapshot = '{}'::jsonb;

create or replace function public.prevent_dispute_screenshot_policy_snapshot_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.dispute_screenshot_policy_snapshot
     is distinct from new.dispute_screenshot_policy_snapshot then
    raise exception 'A saved letter screenshot-policy snapshot is immutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_dispute_screenshot_policy_snapshot on public.letters;
create trigger protect_dispute_screenshot_policy_snapshot
before update of dispute_screenshot_policy_snapshot on public.letters
for each row execute function public.prevent_dispute_screenshot_policy_snapshot_rewrite();

comment on column public.letters.dispute_screenshot_policy_snapshot is
  'Immutable course evidence policy captured when this exact template-version letter is saved. Empty only for legacy letters with no resolvable template metadata.';

-- Rollback: deploy the prior application, which ignores these additive fields.
-- Keep policy snapshots and successor versions so historical evidence rules and
-- saved-letter provenance are never destroyed.
