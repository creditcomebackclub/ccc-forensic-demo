import { Check } from 'lucide-react';
import { PRICING_PLANS } from '../demoData';
import { useFieldwork } from '../state';

export default function Billing() {
  const { planId, plan, mailCredits, changePlan, billingHistory } = useFieldwork();

  return (
    <div className="mx-auto max-w-5xl">
      <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">Billing</p>
      <h1 className="fw-display mt-2 text-4xl font-bold md:text-5xl">Plan & credits</h1>
      <p className="mt-3 max-w-2xl text-lg text-[var(--fw-muted)]">
        Simulated Stripe subscription. In production: Checkout + Customer Portal, metered or bundled Lob postage, invoice history.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg bg-[var(--fw-ink)] p-6 text-white">
          <div className="fw-mono text-[10px] uppercase tracking-wider text-white/40">Current plan</div>
          <div className="fw-display mt-2 text-4xl font-bold">{plan.name}</div>
          <div className="mt-1 text-white/60">${plan.price}/month</div>
        </div>
        <div className="rounded-lg border border-[var(--fw-line)] bg-white p-6">
          <div className="fw-mono text-[10px] uppercase tracking-wider text-[var(--fw-muted)]">Mail credits remaining</div>
          <div className="fw-display mt-2 text-4xl font-bold">{mailCredits}</div>
          <div className="mt-1 text-sm text-[var(--fw-muted)]">
            Resets to {plan.mailCredits} on renew (demo: switching plans refills)
          </div>
        </div>
      </div>

      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        {PRICING_PLANS.map((p) => {
          const active = p.id === planId;
          return (
            <div
              key={p.id}
              className={`flex flex-col border p-5 ${
                active ? 'border-[var(--fw-ink)] bg-[var(--fw-ink)] text-white' : 'border-[var(--fw-line)] bg-white'
              }`}
            >
              <div className="fw-mono text-[11px] uppercase tracking-widest opacity-60">{p.name}</div>
              <div className="fw-display mt-2 text-4xl font-bold">
                ${p.price}
                <span className="text-base font-semibold opacity-50">/mo</span>
              </div>
              <p className={`mt-2 text-sm ${active ? 'text-white/65' : 'text-[var(--fw-muted)]'}`}>{p.blurb}</p>
              <ul className="mt-5 flex-1 space-y-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check size={15} className={active ? 'text-[var(--fw-signal)]' : 'text-[var(--fw-sea)]'} />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={active}
                onClick={() => changePlan(p.id)}
                className={`mt-6 w-full ${active ? 'fw-btn-ghost !border-white/20 opacity-60' : 'fw-btn-ink'}`}
              >
                {active ? 'Current plan' : `Switch to ${p.name}`}
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-12">
        <h2 className="fw-display text-2xl font-bold">Invoices</h2>
        <div className="mt-4 overflow-hidden rounded-lg border border-[var(--fw-line)] bg-white">
          {billingHistory.length === 0 ? (
            <p className="p-5 text-sm text-[var(--fw-muted)]">No invoices yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--fw-line)]">
              {billingHistory.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-sm">
                  <div>
                    <div className="font-medium">{row.label}</div>
                    <div className="text-[var(--fw-muted)]">{row.date}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">${row.amount}.00</div>
                    <div className="text-xs text-[var(--fw-signal-dim)]">{row.status}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
