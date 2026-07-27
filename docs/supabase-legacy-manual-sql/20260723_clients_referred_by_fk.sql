-- Follow-up to 20260723_commission_payouts.sql, shipped as its own migration
-- deliberately. Turned out to be unnecessary in production: a constraint
-- named clients_referred_by_fkey already existed (verified via
-- `select conname, pg_get_constraintdef(oid) from pg_constraint where
-- conname = 'clients_referred_by_fkey'` -> "FOREIGN KEY (referred_by)
-- REFERENCES affiliates(id)", no ON DELETE clause) — set up directly in
-- Supabase Studio when the column was created, same undocumented-in-git
-- drift as the affiliates table itself. Kept here, guarded, so a genuinely
-- fresh environment (where this constraint really is missing) still gets
-- it, without erroring against the current production database where it
-- already exists. Matches the existing constraint's actual definition
-- (no ON DELETE override) rather than introducing a behavior change.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_referred_by_fkey'
  ) then
    alter table public.clients
      add constraint clients_referred_by_fkey
      foreign key (referred_by) references public.affiliates(id);
  end if;
end $$;
