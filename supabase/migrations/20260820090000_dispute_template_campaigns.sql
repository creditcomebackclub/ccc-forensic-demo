-- Staff-managed reusable templates for the deterministic CRA dispute flow.
-- Template text is kept separate from letters so each saved letter can retain
-- an immutable snapshot even after the library template is revised or retired.

create table if not exists public.dispute_templates (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  name text not null,
  flow_code text not null check (flow_code in ('accuracy', 'collection', 'combo', 'consent', 'late_pay')),
  round_number integer not null check (
    (flow_code in ('accuracy', 'combo') and round_number between 1 and 12)
    or (flow_code = 'collection' and round_number between 1 and 10)
    or (flow_code = 'consent' and round_number between 1 and 3)
    or (flow_code = 'late_pay' and round_number between 1 and 2)
  ),
  bureau_code text not null default 'ALL' check (bureau_code in ('ALL', 'EQ', 'EXP', 'TU')),
  version_label text not null default 'v1',
  body_text text not null check (length(btrim(body_text)) > 0),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dispute_templates_lookup_idx
  on public.dispute_templates (flow_code, round_number, bureau_code, is_active, updated_at desc);

alter table public.dispute_templates enable row level security;

drop policy if exists "staff_read_dispute_templates" on public.dispute_templates;
create policy "staff_read_dispute_templates"
on public.dispute_templates for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
  )
);

drop policy if exists "admins_insert_dispute_templates" on public.dispute_templates;
create policy "admins_insert_dispute_templates"
on public.dispute_templates for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "admins_update_dispute_templates" on public.dispute_templates;
create policy "admins_update_dispute_templates"
on public.dispute_templates for update to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "admins_delete_dispute_templates" on public.dispute_templates;
create policy "admins_delete_dispute_templates"
on public.dispute_templates for delete to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

grant select, insert, update, delete on public.dispute_templates to authenticated;
grant all on public.dispute_templates to service_role;

alter table public.letters
  add column if not exists dispute_template_id uuid references public.dispute_templates(id) on delete set null,
  add column if not exists dispute_template_name text,
  add column if not exists dispute_flow_code text,
  add column if not exists dispute_round_number integer,
  add column if not exists dispute_bureau_code text,
  add column if not exists dispute_template_snapshot text,
  add column if not exists dispute_editable_sections jsonb not null default '{}'::jsonb;

alter table public.letters
  drop constraint if exists letters_dispute_flow_code_check,
  add constraint letters_dispute_flow_code_check
    check (dispute_flow_code is null or dispute_flow_code in ('accuracy', 'collection', 'combo', 'consent', 'late_pay')),
  drop constraint if exists letters_dispute_round_number_check,
  add constraint letters_dispute_round_number_check
    check (dispute_round_number is null or dispute_round_number between 1 and 12),
  drop constraint if exists letters_dispute_bureau_code_check,
  add constraint letters_dispute_bureau_code_check
    check (dispute_bureau_code is null or dispute_bureau_code in ('EQ', 'EXP', 'TU'));

create index if not exists letters_dispute_campaign_idx
  on public.letters (client_id, dispute_round_number, dispute_bureau_code, saved_at desc)
  where dispute_flow_code is not null;
