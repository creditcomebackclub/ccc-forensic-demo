-- Follow-up to 20260723_commission_payouts.sql — shipped as its own
-- migration deliberately, not bundled with the payout ledger: an
-- ADD CONSTRAINT failure here (if an orphaned referred_by ever existed)
-- would have taken that migration's actually-important new table down
-- with it. Verified zero orphaned clients.referred_by values immediately
-- before writing this file.
alter table public.clients
  add constraint clients_referred_by_fkey
  foreign key (referred_by) references public.affiliates(id)
  on delete set null;
