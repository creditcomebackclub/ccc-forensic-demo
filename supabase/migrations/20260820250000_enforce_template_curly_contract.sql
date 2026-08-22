-- Enforce the same physical-recipient curly contract at the database boundary
-- that the Letter Library applies in the browser. Historical inactive rows are
-- preserved; an unsafe active staff template is retired rather than rewritten.

create or replace function public.dispute_template_token_contract_valid(
  p_flow text,
  p_body text
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_flow text := lower(btrim(coalesce(p_flow, '')));
  v_match text[];
  v_token text;
  v_allowed text[];
  v_consumer_statement_count integer := 0;
  v_screenshot_count integer := 0;
  v_without_valid_tokens text;
  v_token_pattern constant text := '\{\{[[:space:]]*([a-zA-Z0-9_ -]+)[[:space:]]*\}\}|\{[[:space:]]*([a-zA-Z0-9_ -]+)[[:space:]]*\}';
begin
  if nullif(btrim(coalesce(p_body, '')), '') is null then
    return false;
  end if;

  if v_flow in ('accuracy','collection','combo','consent','late_pay','accuracy_solo') then
    v_allowed := array[
      'client_first_name','client_last_name','client_name','client_address','curr_date',
      'ss_number','bdate','bureau_address','bureau_name',
      'dispute_item_and_explanation','account_list','report_date','screenshots',
      'damages','personalization','penalty','optional_strengthener','consumer_statement'
    ];
  elsif v_flow = 'direct' then
    v_allowed := array[
      'client_first_name','client_last_name','client_name','client_address','curr_date',
      'creditor_name','creditor_address','creditor_city','creditor_state',
      'creditor_zip','account_number',
      'damages','personalization','penalty','optional_strengthener'
    ];
  else
    return false;
  end if;

  -- Remove every syntactically valid placeholder. Any brace left behind is a
  -- malformed/unsupported placeholder such as {client.first_name} or {{name}.
  v_without_valid_tokens := regexp_replace(p_body, v_token_pattern, '', 'g');
  if strpos(v_without_valid_tokens, '{') > 0 or strpos(v_without_valid_tokens, '}') > 0 then
    return false;
  end if;

  for v_match in
    select captures
    from regexp_matches(p_body, v_token_pattern, 'g') as captures
  loop
    v_token := lower(replace(btrim(coalesce(v_match[1], v_match[2])), '-', '_'));
    if not (v_token = any(v_allowed)) then
      return false;
    end if;
    if v_token = 'consumer_statement' then
      v_consumer_statement_count := v_consumer_statement_count + 1;
    elsif v_token = 'screenshots' then
      v_screenshot_count := v_screenshot_count + 1;
    end if;
  end loop;

  if (v_flow = 'direct' and v_consumer_statement_count <> 0)
    or (v_flow <> 'direct' and v_consumer_statement_count <> 1)
    or v_screenshot_count > 1 then
    return false;
  end if;

  -- Exhibits are assembled after the rendered letter. A placement anchor is
  -- therefore valid only as the final template field.
  if v_screenshot_count = 1 and p_body !~* '(\{\{[[:space:]]*screenshots[[:space:]]*\}\}|\{[[:space:]]*screenshots[[:space:]]*\})[[:space:]]*$' then
    return false;
  end if;

  return true;
end;
$$;

update public.dispute_templates
set is_active = false,
    retired_at = coalesce(retired_at, now()),
    retirement_reason = coalesce(retirement_reason, 'Retired by physical-recipient curly validation'),
    updated_at = now()
where is_active = true
  and not public.dispute_template_token_contract_valid(flow_code, body_text);

alter table public.dispute_templates
  drop constraint if exists dispute_templates_active_curly_contract,
  add constraint dispute_templates_active_curly_contract check (
    is_active = false
    or public.dispute_template_token_contract_valid(flow_code, body_text)
  );

comment on constraint dispute_templates_active_curly_contract on public.dispute_templates is
  'Active templates must use only their physical CRA/Direct token allowlist, exactly one CRA Consumer Statement, no Direct Consumer Statement, valid braces, and a terminal screenshot anchor.';

revoke all on function public.dispute_template_token_contract_valid(text,text) from public;
grant execute on function public.dispute_template_token_contract_valid(text,text) to authenticated, service_role;

-- Rollback path: old clients can ignore the constraint/function, but keep
-- retired rows and their history. Re-activating a row requires a valid body.
