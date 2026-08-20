-- Calendly is the authoritative source for consultation scheduling. Keep the
-- lifecycle on the CRM row so lead nurture and staff workflows can make a
-- deterministic decision without parsing email markers or browser events.

alter table public.clients
  add column if not exists consultation_status text,
  add column if not exists consultation_scheduled_at timestamptz,
  add column if not exists consultation_canceled_at timestamptz,
  add column if not exists calendly_event_uri text,
  add column if not exists calendly_invitee_uri text,
  add column if not exists calendly_booking_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_consultation_status_check'
  ) then
    alter table public.clients add constraint clients_consultation_status_check
      check (consultation_status is null or consultation_status in (
        'requested', 'scheduled', 'rescheduled', 'canceled', 'completed', 'no_show'
      ));
  end if;
end $$;

create unique index if not exists clients_calendly_invitee_uri_uidx
  on public.clients (calendly_invitee_uri)
  where calendly_invitee_uri is not null;

create index if not exists clients_consultation_status_idx
  on public.clients (consultation_status, consultation_scheduled_at)
  where consultation_status is not null;

comment on column public.clients.consultation_status is
  'Consultation lifecycle synchronized from Calendly and finalized by staff for completed/no-show outcomes.';

-- Durable receipt ledger: retries remain idempotent, failed deliveries can be
-- retried after a configuration fix, and the raw provider payload is retained
-- for an internal audit trail.
create table if not exists public.calendly_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  invitee_uri text,
  scheduled_event_uri text,
  client_id uuid references public.clients(id) on delete set null,
  payload jsonb not null,
  processing_status text not null default 'processing'
    check (processing_status in ('processing', 'processed', 'failed', 'ignored')),
  processing_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists calendly_webhook_events_client_received_idx
  on public.calendly_webhook_events (client_id, received_at desc)
  where client_id is not null;

alter table public.calendly_webhook_events enable row level security;

drop policy if exists "staff_read_calendly_webhook_events" on public.calendly_webhook_events;
create policy "staff_read_calendly_webhook_events"
  on public.calendly_webhook_events for select to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
        and (
          p.role = 'admin'
          or exists (
            select 1 from public.clients c
            where c.id = calendly_webhook_events.client_id
              and c.user_id = p.id
          )
        )
    )
  );

revoke all on public.calendly_webhook_events from public, anon, authenticated;
grant select on public.calendly_webhook_events to authenticated;
grant all on public.calendly_webhook_events to service_role;
