-- Per-client optional service agreement override for LPOA Section 4.
-- When mode = 'custom' and fee_text is set, that text wins over tier/inquiry defaults.
-- Existing rows stay on tier behavior (mode default 'tier', fee_text null).

alter table public.clients
  add column if not exists service_agreement_mode text not null default 'tier',
  add column if not exists service_agreement_label text,
  add column if not exists service_agreement_amount numeric,
  add column if not exists service_agreement_fee_text text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_service_agreement_mode_check'
  ) then
    alter table public.clients
      add constraint clients_service_agreement_mode_check
      check (service_agreement_mode in ('tier', 'custom'));
  end if;
end $$;

comment on column public.clients.service_agreement_mode is
  'tier = use billing_tier / inquiry defaults; custom = use service_agreement_fee_text for LPOA Section 4';
comment on column public.clients.service_agreement_label is
  'Short label for custom package (ledger description / staff UI)';
comment on column public.clients.service_agreement_amount is
  'One-time custom package amount in USD';
comment on column public.clients.service_agreement_fee_text is
  'Exact LPOA Section 4 fee prose when mode is custom';
