-- Course-style template performance and per-account results for CCC.
-- This expands the existing snapshot-based letter model without changing or
-- deleting any legacy letter/outcome data. Quarterly review is a staff flag;
-- it never auto-retires or rewrites a template.

alter table public.dispute_templates
  add column if not exists template_family_key text,
  add column if not exists published_on date,
  add column if not exists review_due_on date,
  add column if not exists supersedes_template_id uuid references public.dispute_templates(id) on delete set null,
  add column if not exists retired_at timestamptz,
  add column if not exists retirement_reason text;

update public.dispute_templates
set
  template_family_key = coalesce(
    nullif(template_family_key, ''),
    upper(flow_code) || ':R' || round_number::text || ':' || bureau_code
  ),
  published_on = coalesce(published_on, created_at::date),
  review_due_on = coalesce(review_due_on, coalesce(published_on, created_at::date) + 90)
where template_family_key is null
   or published_on is null
   or review_due_on is null;

alter table public.dispute_templates
  alter column template_family_key set not null,
  alter column published_on set not null,
  alter column review_due_on set not null,
  drop constraint if exists dispute_templates_review_dates_check,
  add constraint dispute_templates_review_dates_check
    check (review_due_on >= published_on);

create index if not exists dispute_templates_family_version_idx
  on public.dispute_templates (template_family_key, published_on desc, created_at desc);

create index if not exists dispute_templates_review_due_idx
  on public.dispute_templates (review_due_on, is_active)
  where is_active = true;

comment on column public.dispute_templates.template_family_key is
  'Stable law/flow/round family; quarterly rewrites create a new row in this family.';
comment on column public.dispute_templates.review_due_on is
  'Ninety-day staff review flag. Reaching this date does not auto-retire the template.';

alter table public.letters
  add column if not exists dispute_template_version_label text,
  add column if not exists dispute_template_family_key text,
  add column if not exists dispute_account_snapshot jsonb not null default '[]'::jsonb;

update public.letters letter
set
  dispute_template_version_label = coalesce(letter.dispute_template_version_label, template.version_label),
  dispute_template_family_key = coalesce(letter.dispute_template_family_key, template.template_family_key)
from public.dispute_templates template
where letter.dispute_template_id = template.id
  and (
    letter.dispute_template_version_label is null
    or letter.dispute_template_family_key is null
  );

update public.letters
set dispute_account_snapshot = (
  select coalesce(jsonb_agg(jsonb_build_object(
    'accountKey', 'furnisher:' || lower(regexp_replace(value, '[^a-zA-Z0-9]+', '-', 'g')),
    'clientAccountId', null,
    'accountId', null,
    'furnisher', value,
    'accountNumberMasked', null
  )), '[]'::jsonb)
  from jsonb_array_elements_text(coalesce(covered_furnishers, '[]'::jsonb)) as item(value)
)
where dispute_template_id is not null
  and dispute_account_snapshot = '[]'::jsonb
  and jsonb_typeof(coalesce(covered_furnishers, '[]'::jsonb)) = 'array';

comment on column public.letters.dispute_account_snapshot is
  'Immutable account/furnisher identities covered by this exact template-version letter.';

create table if not exists public.dispute_letter_results (
  id uuid primary key default gen_random_uuid(),
  letter_id text not null references public.letters(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  client_account_id uuid references public.client_accounts(id) on delete set null,
  account_key text not null,
  furnisher text not null,
  bureau_code text check (bureau_code is null or bureau_code in ('EQ', 'EXP', 'TU')),
  result_code text not null check (result_code in ('deleted', 'verified', 'updated', 'no_response', 'duplicate')),
  result_date date not null,
  notes text,
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (letter_id, account_key)
);

create index if not exists dispute_letter_results_template_metrics_idx
  on public.dispute_letter_results (result_code, result_date desc, letter_id);
create index if not exists dispute_letter_results_client_idx
  on public.dispute_letter_results (client_id, result_date desc);

alter table public.dispute_letter_results enable row level security;

drop policy if exists "staff_read_dispute_letter_results" on public.dispute_letter_results;
create policy "staff_read_dispute_letter_results"
on public.dispute_letter_results for select to authenticated
using (
  exists (
    select 1
    from public.letters letter
    join public.profiles profile on profile.id = auth.uid()
    where letter.id = dispute_letter_results.letter_id
      and profile.role in ('admin', 'auditor')
      and (profile.role = 'admin' or letter.user_id = auth.uid())
  )
);

drop policy if exists "staff_insert_dispute_letter_results" on public.dispute_letter_results;
create policy "staff_insert_dispute_letter_results"
on public.dispute_letter_results for insert to authenticated
with check (
  recorded_by = auth.uid()
  and exists (
    select 1
    from public.letters letter
    join public.profiles profile on profile.id = auth.uid()
    where letter.id = dispute_letter_results.letter_id
      and profile.role in ('admin', 'auditor')
      and (profile.role = 'admin' or letter.user_id = auth.uid())
  )
);

drop policy if exists "staff_update_dispute_letter_results" on public.dispute_letter_results;
create policy "staff_update_dispute_letter_results"
on public.dispute_letter_results for update to authenticated
using (
  exists (
    select 1
    from public.letters letter
    join public.profiles profile on profile.id = auth.uid()
    where letter.id = dispute_letter_results.letter_id
      and profile.role in ('admin', 'auditor')
      and (profile.role = 'admin' or letter.user_id = auth.uid())
  )
)
with check (
  recorded_by = auth.uid()
  and exists (
    select 1
    from public.letters letter
    join public.profiles profile on profile.id = auth.uid()
    where letter.id = dispute_letter_results.letter_id
      and profile.role in ('admin', 'auditor')
      and (profile.role = 'admin' or letter.user_id = auth.uid())
  )
);

grant select, insert, update on public.dispute_letter_results to authenticated;
grant all on public.dispute_letter_results to service_role;

create or replace function public.prevent_used_dispute_template_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (old.body_text, old.flow_code, old.round_number, old.bureau_code, old.version_label,
      old.template_family_key)
     is distinct from
     (new.body_text, new.flow_code, new.round_number, new.bureau_code, new.version_label,
      new.template_family_key)
     and exists (
       select 1 from public.letters letter
       where letter.dispute_template_id = old.id
     ) then
    raise exception 'This template version has letter history. Create a new version instead of rewriting it.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_used_dispute_template_version on public.dispute_templates;
create trigger protect_used_dispute_template_version
before update on public.dispute_templates
for each row execute function public.prevent_used_dispute_template_rewrite();

create or replace function public.activate_new_dispute_template_version()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  prior_family text;
begin
  if exists (
    select 1 from public.dispute_templates template
    where template.id <> new.id
      and template.template_family_key = new.template_family_key
      and lower(template.version_label) = lower(new.version_label)
  ) then
    raise exception 'Version % already exists for template family %.', new.version_label, new.template_family_key;
  end if;

  if new.supersedes_template_id is not null then
    select template_family_key into prior_family
    from public.dispute_templates
    where id = new.supersedes_template_id;

    if prior_family is null or prior_family <> new.template_family_key then
      raise exception 'A new template version must stay in the same template family.';
    end if;

    update public.dispute_templates
    set
      is_active = false,
      retired_at = coalesce(retired_at, now()),
      retirement_reason = coalesce(retirement_reason, 'Superseded by ' || new.version_label),
      updated_at = now()
    where id = new.supersedes_template_id;
  end if;
  return new;
end;
$$;

drop trigger if exists activate_dispute_template_version on public.dispute_templates;
create trigger activate_dispute_template_version
after insert on public.dispute_templates
for each row execute function public.activate_new_dispute_template_version();

create or replace view public.dispute_template_performance
with (security_invoker = true)
as
select
  template.id as template_id,
  count(distinct letter.id) filter (where letter.mailed_date is not null) as times_mailed,
  count(result.id) as results_recorded,
  count(result.id) filter (where result.result_code = 'deleted') as wins,
  count(result.id) filter (where result.result_code <> 'deleted') as non_deletion_results,
  case
    when count(result.id) = 0 then null
    else round(
      count(result.id) filter (where result.result_code = 'deleted')::numeric
      / count(result.id)::numeric,
      4
    )
  end as win_rate
from public.dispute_templates template
left join public.profiles caller on caller.id = auth.uid()
left join public.letters letter
  on letter.dispute_template_id = template.id
 and caller.role in ('admin', 'auditor')
 and (caller.role = 'admin' or letter.user_id = auth.uid())
left join public.dispute_letter_results result on result.letter_id = letter.id
group by template.id;

grant select on public.dispute_template_performance to authenticated;

-- Rollback strategy: deploy the prior UI/functions and leave these additive columns,
-- immutable letter snapshots, and outcome rows in place. Dropping them would destroy
-- audit history, so an automated destructive down migration is intentionally omitted.
