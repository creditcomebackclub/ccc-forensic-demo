-- Versioned service-agreement packets.  The initial template is deliberately
-- draft-only: legal counsel must approve the text and notices before any
-- packet may be sent or signed.

alter table public.clients
  add column if not exists engagement_status text not null default 'pending_onboarding',
  add column if not exists engagement_status_changed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_engagement_status_check') then
    alter table public.clients add constraint clients_engagement_status_check
      check (engagement_status in ('pending_onboarding', 'active', 'paused', 'inactive', 'graduated'));
  end if;
end $$;

-- Preserve the operational status staff already set for existing people.
update public.clients
set engagement_status = case coalesce(billing_status, 'Active')
  when 'Paused' then 'paused'
  when 'Inactive' then 'inactive'
  when 'Graduated' then 'graduated'
  else 'active'
end,
engagement_status_changed_at = coalesce(status_changed_at, now())
where engagement_status = 'pending_onboarding';

create table if not exists public.service_agreement_templates (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null,
  legal_status text not null default 'counsel_review'
    check (legal_status in ('counsel_review', 'approved', 'retired')),
  body_html text,
  effective_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.service_agreement_templates (version, title, legal_status)
values ('ccc-service-agreement-v1-draft', 'CCC Service Agreement & Limited Power of Attorney', 'counsel_review')
on conflict (version) do nothing;

create table if not exists public.client_service_agreements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  template_id uuid not null references public.service_agreement_templates(id),
  template_version text not null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'signed', 'expired', 'cancelled', 'superseded')),
  plan_snapshot jsonb not null,
  client_snapshot jsonb not null,
  signing_token_hash text unique,
  signing_expires_at timestamptz,
  sent_at timestamptz,
  signed_at timestamptz,
  signed_document_path text,
  signed_document_hash text,
  superseded_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists client_service_agreements_active_packet_idx
  on public.client_service_agreements (client_id)
  where status in ('draft', 'sent');
create index if not exists client_service_agreements_client_idx
  on public.client_service_agreements (client_id, created_at desc);

create table if not exists public.client_service_agreement_events (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.client_service_agreements(id) on delete cascade,
  event_type text not null check (event_type in ('prepared', 'sent', 'viewed', 'signed', 'expired', 'superseded', 'portal_invited')),
  actor_type text not null check (actor_type in ('staff', 'client', 'system')),
  actor_id uuid references auth.users(id) on delete set null,
  ip_address text,
  user_agent text,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.service_agreement_templates enable row level security;
alter table public.client_service_agreements enable row level security;
alter table public.client_service_agreement_events enable row level security;

drop policy if exists "staff_manage_service_agreement_templates" on public.service_agreement_templates;
create policy "staff_manage_service_agreement_templates" on public.service_agreement_templates for all to authenticated
using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff_manage_client_service_agreements" on public.client_service_agreements;
create policy "staff_manage_client_service_agreements" on public.client_service_agreements for all to authenticated
using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff_read_client_service_agreement_events" on public.client_service_agreement_events;
create policy "staff_read_client_service_agreement_events" on public.client_service_agreement_events for select to authenticated
using (public.is_staff());

comment on column public.clients.engagement_status is
  'Service eligibility only. It never creates a payment or suppresses in-flight consumer work.';
comment on table public.client_service_agreements is
  'Immutable per-client contract packet snapshots. The service role is the only public-signing writer.';
