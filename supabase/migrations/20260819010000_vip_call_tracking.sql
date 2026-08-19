-- VIP clients get a recurring monthly 1-on-1 call, separate from the one-time
-- intake consultation tracked by consultation_status/calendly_*. Kept in its
-- own column namespace so a new monthly booking never collides with the
-- intake booking already recorded on the same client row.

alter table public.clients
  add column if not exists vip_call_status text,
  add column if not exists vip_call_scheduled_at timestamptz,
  add column if not exists vip_call_invitee_uri text,
  add column if not exists vip_call_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_vip_call_status_check'
  ) then
    alter table public.clients add constraint clients_vip_call_status_check
      check (vip_call_status is null or vip_call_status in (
        'scheduled', 'rescheduled', 'canceled'
      ));
  end if;
end $$;

create unique index if not exists clients_vip_call_invitee_uri_uidx
  on public.clients (vip_call_invitee_uri)
  where vip_call_invitee_uri is not null;

create index if not exists clients_vip_call_scheduled_at_idx
  on public.clients (vip_call_scheduled_at)
  where is_vip and vip_call_scheduled_at is not null;

comment on column public.clients.vip_call_scheduled_at is
  'Start time of the VIP client''s most recently booked monthly strategy call, synchronized from Calendly.';
