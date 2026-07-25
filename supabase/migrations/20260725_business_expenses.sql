-- Tracks business overhead (recurring subscriptions + monthly variable
-- costs like mail/API usage) so BillingDashboardPage.jsx can show a real
-- overhead % against collected revenue, not just top-line revenue metrics.
--
-- Two shapes in one table:
--   - Recurring (month IS NULL): a subscription that repeats every month
--     until edited/deleted (Netlify, Claude, Gemini). Counted every month
--     without re-entry.
--   - Variable (month = 'YYYY-MM'): a cost that has to be checked and
--     entered by hand each month because it isn't fixed (Lob mail spend,
--     metered Claude API console usage). Deliberately not auto-computed
--     from a per-letter rate — that would drift from the real Lob invoice
--     (address-correction fees, canceled-letter refunds, mixed mail types).
create table if not exists public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  amount numeric(10,2) not null check (amount >= 0),
  category text not null check (category in ('subscription', 'variable')),
  month text check (month is null or month ~ '^\d{4}-\d{2}$'),
  created_at timestamptz not null default now()
);

alter table public.business_expenses enable row level security;

-- Internal financial data — staff (admin/auditor) only, no client-facing
-- policy at all, same posture as commission_payouts.
drop policy if exists business_expenses_staff_all on public.business_expenses;
create policy business_expenses_staff_all on public.business_expenses
  for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor'))
  );
