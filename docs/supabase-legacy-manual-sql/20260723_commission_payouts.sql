-- Affiliate commission tracking fix. Confirmed business rule: affiliates earn
-- 20% (or a per-client referral_fee override) of the First Work Fee AND all
-- ongoing monthly recurring revenue, for as long as the client keeps paying.
--
-- The prior implementation tracked "paid" as a single permanent boolean
-- (clients.commission_paid) recomputed against a client's ENTIRE lifetime
-- revenue every time — so any client who kept paying after their commission
-- was first marked paid had all subsequent months silently counted as
-- already-paid too, with nothing anywhere showing the affiliate was being
-- underpaid. A boolean cannot represent "paid through some point, still
-- accruing" — only an append-only payout ledger can.
--
-- Formalizes the affiliates table (never captured in a migration — built ad
-- hoc in Studio, same drift progress_updates had before this session) as a
-- safe no-op create-table-if-not-exists for git/disaster-recovery fidelity
-- only. Deliberately does NOT touch its RLS: ClientBillingPanel.jsx already
-- reads `affiliates` client-side under the staff user's own session, and
-- there's no way to confirm from git whether RLS is currently on or off for
-- that table — enabling it blind, without knowing the current policy state,
-- risks silently breaking that working feature. Leave it alone; if RLS needs
-- adjustment there, that's a separate, deliberate change made after checking
-- the actual Studio state.
create table if not exists public.affiliates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  name text,
  company text,
  email text,
  commission_rate numeric,
  brand_name text,
  brand_color text,
  brand_logo_url text,
  created_at timestamptz not null default now()
);

-- The new payout ledger. client_id (not clients.name) is the real key —
-- clients.name has no unique constraint anywhere and is already a fragile
-- join key used elsewhere in this codebase; no reason to extend that
-- fragility into a brand-new table. client_name is kept only as a
-- denormalized display convenience.
create table if not exists public.commission_payouts (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id),
  client_id uuid not null references public.clients(id),
  client_name text not null,
  covered_tx_ids jsonb not null default '[]'::jsonb,
  amount numeric(12,2) not null,
  paid_at timestamptz not null default now(),
  paid_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.commission_payouts enable row level security;

-- Staff only. Deliberately NO affiliate-facing policy: the `notes` column
-- here is internal commentary, the same category as the clients.notes leak
-- this same effort fixes in affiliate-portal-data.cjs — RLS is row-level,
-- not column-level, so it can't hide just that field. The Netlify function
-- (service role) stays the sole path for affiliate-visible data, returning
-- only sanitized aggregates, never these rows directly.
drop policy if exists "staff_all_commission_payouts" on public.commission_payouts;
create policy "staff_all_commission_payouts" on public.commission_payouts for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor'))
);

-- Idempotent backfill: one payout row per client currently marked
-- commission_paid = true, covering every ledger transaction that has a
-- stable id (older/malformed entries without one are left uncovered — they
-- surface as owed rather than silently vanishing), dated at the existing
-- commission_paid_at so the cutover doesn't create a sudden "everything is
-- newly owed" spike. Computed from each client's real ledger, not
-- hardcoded to today's data, so this is safe to run at any point.
do $$
declare
  r record;
  recognized_total numeric;
  rate numeric;
  commission_amount numeric;
  tx_ids jsonb;
begin
  for r in
    select c.id, c.referred_by, c.name, c.referral_fee, c.commission_paid_at, c.ledger, a.commission_rate
    from public.clients c
    join public.affiliates a on a.id = c.referred_by
    where c.commission_paid = true
      and not exists (select 1 from public.commission_payouts cp where cp.client_id = c.id)
  loop
    rate := coalesce(r.referral_fee, coalesce(r.commission_rate, 0.20) * 100) / 100;

    select coalesce(sum((elem->>'amount')::numeric), 0)
      into recognized_total
      from jsonb_array_elements(coalesce(r.ledger, '[]'::jsonb)) as elem
      where (elem->>'type') = 'Payment'
         or ((elem->>'type') = 'Invoice' and (elem->>'status') = 'Paid');

    select coalesce(jsonb_agg(elem->>'id'), '[]'::jsonb)
      into tx_ids
      from jsonb_array_elements(coalesce(r.ledger, '[]'::jsonb)) as elem
      where ((elem->>'type') = 'Payment' or ((elem->>'type') = 'Invoice' and (elem->>'status') = 'Paid'))
        and (elem->>'id') is not null;

    commission_amount := round(recognized_total * rate, 2);

    insert into public.commission_payouts (affiliate_id, client_id, client_name, covered_tx_ids, amount, paid_at, notes)
    values (r.referred_by, r.id, r.name, tx_ids, commission_amount, coalesce(r.commission_paid_at, now()), 'Backfilled from legacy commission_paid boolean');
  end loop;
end $$;
