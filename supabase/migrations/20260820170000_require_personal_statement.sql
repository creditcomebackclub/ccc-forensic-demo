-- A client-authored personal statement is mandatory in the CCC method. The
-- two direct-to-collector source templates predated this application-wide
-- contract, so add the same human merge field without changing their laws.
update public.dispute_templates
set body_text = rtrim(body_text) || E'\n\n{consumer_statement}',
    notes = rtrim(coalesce(notes, ''), '.') || '. Team field required: consumer_statement.',
    updated_at = now()
where id in (
  '8341ad23-49f5-505d-a05d-23a0202b5746',
  'd0a64f13-9e1f-55e4-867c-c38fc3f39e41'
)
and body_text not like '%{consumer_statement}%';

alter table public.dispute_templates
  drop constraint if exists dispute_templates_active_personal_statement;

alter table public.dispute_templates
  add constraint dispute_templates_active_personal_statement
  check (created_by is not null or not is_active or body_text like '%{consumer_statement}%');

comment on constraint dispute_templates_active_personal_statement on public.dispute_templates is
  'Every active source-controlled CCC template must expose the non-negotiable client personal-statement merge field; the application enforces the same rule for staff templates.';
