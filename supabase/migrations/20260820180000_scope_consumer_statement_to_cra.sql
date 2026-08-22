-- Consumer Statements belong to bureau/CRA disputes. The preceding migration
-- applied that contract globally and appended the field to the two
-- direct-to-collector source templates. Correct only those source-controlled
-- rows; staff-created templates and saved letter snapshots remain untouched.

alter table public.dispute_templates
  drop constraint if exists dispute_templates_active_personal_statement;

alter table public.dispute_templates
  drop constraint if exists dispute_templates_active_cra_consumer_statement;

-- Preserve the immutable-version contract. An unused source row can be
-- corrected in place. If a row already has letter history, create a
-- deterministic successor version and let the existing versioning trigger
-- retire the incorrect row; its prior letters and snapshots remain intact.
do $$
declare
  source_template public.dispute_templates%rowtype;
  corrected_body text;
  corrected_notes text;
  corrected_id uuid;
begin
  for source_template in
    select *
    from public.dispute_templates
    where id in (
      '8341ad23-49f5-505d-a05d-23a0202b5746',
      'd0a64f13-9e1f-55e4-867c-c38fc3f39e41'
    )
      and created_by is null
      and flow_code = 'direct'
      and (
        right(body_text, char_length(E'\n\n{consumer_statement}')) = E'\n\n{consumer_statement}'
        or right(coalesce(notes, ''), char_length(' Team field required: consumer_statement.')) =
           ' Team field required: consumer_statement.'
      )
    for update
  loop
    corrected_body := case
      when right(source_template.body_text, char_length(E'\n\n{consumer_statement}')) = E'\n\n{consumer_statement}'
        then left(source_template.body_text, char_length(source_template.body_text) - char_length(E'\n\n{consumer_statement}'))
      else source_template.body_text
    end;
    corrected_notes := case
      when right(coalesce(source_template.notes, ''), char_length(' Team field required: consumer_statement.')) =
           ' Team field required: consumer_statement.'
        then left(source_template.notes, char_length(source_template.notes) - char_length(' Team field required: consumer_statement.'))
      else source_template.notes
    end;

    if exists (
      select 1 from public.letters letter
      where letter.dispute_template_id = source_template.id
    ) then
      corrected_id := case source_template.id
        when '8341ad23-49f5-505d-a05d-23a0202b5746'::uuid then '81607451-98b8-4043-9a3b-55c60ebc1061'::uuid
        else 'b475ac1a-89be-4353-a2c5-4d13c3545342'::uuid
      end;

      if not exists (select 1 from public.dispute_templates where id = corrected_id) then
        insert into public.dispute_templates (
          id, created_by, name, flow_code, round_number, bureau_code,
          version_label, body_text, notes, is_active, created_at, updated_at,
          template_family_key, published_on, review_due_on,
          supersedes_template_id, retired_at, retirement_reason
        ) values (
          corrected_id, null, source_template.name, source_template.flow_code,
          source_template.round_number, source_template.bureau_code,
          source_template.version_label || '-cra-only', corrected_body,
          corrected_notes, true, now(), now(), source_template.template_family_key,
          current_date, current_date + 49, source_template.id, null, null
        );
      end if;
    else
      update public.dispute_templates
      set body_text = corrected_body,
          notes = corrected_notes,
          updated_at = now()
      where id = source_template.id;
    end if;
  end loop;
end;
$$;

alter table public.dispute_templates
  add constraint dispute_templates_active_cra_consumer_statement
  check (
    created_by is not null
    or not is_active
    or flow_code = 'direct'
    or body_text like '%{consumer_statement}%'
  );

comment on constraint dispute_templates_active_cra_consumer_statement on public.dispute_templates is
  'Every active source-controlled bureau/CRA template exposes an editable Consumer Statement; direct creditor/collector templates and staff-created templates are preserved without that database requirement.';
