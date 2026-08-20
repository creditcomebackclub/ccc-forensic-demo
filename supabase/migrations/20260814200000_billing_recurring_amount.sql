-- Per-client monthly override for active recurring billing. This is separate
-- from service_agreement_amount, which represents a one-time custom package.

alter table public.clients
  add column if not exists billing_recurring_amount numeric;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_billing_recurring_amount_check'
  ) then
    alter table public.clients
      add constraint clients_billing_recurring_amount_check
      check (billing_recurring_amount is null or billing_recurring_amount > 0);
  end if;
end $$;

comment on column public.clients.billing_recurring_amount is
  'Optional monthly fee override for Automated Recurring billing and MRR; independent of ledger balance/payment status.';
