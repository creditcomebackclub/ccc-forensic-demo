import { Check } from 'lucide-react';
import { PRICING_PLANS } from '../demoData';
import { CREDIT_PACKS, formatCreditCostRange, MAIL_PHASES } from '../mailEconomics';
import { useFieldwork } from '../state';

export default function Billing() {
  const { planId, plan, mailCredits, auditCredits, expertChatCredits, changePlan, buyCreditPack, billingHistory } = useFieldwork();
  const [switching, setSwitching] = useState(null);
  const [switchError, setSwitchError] = useState('');

  return (
    <div className="mx-auto max-w-5xl">
      <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">Billing</p>
      <h1 className="fw-display mt-2 text-4xl font-bold md:text-5xl">Plan & credits</h1>
      <p className="mt-3 max-w-2xl text-lg text-[var(--fw-muted)]">
        Mail credits track real Lob packets ({formatCreditCostRange()}). Audits and Campaign expert chat are capped so API cost stays honest.
      </p>

      <div className={`mt-8 grid gap-4 ${plan.expertChats ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'}`}>
        <div className="rounded-lg bg-[var(--fw-ink)] p-6 text-white">
          <div className="fw-mono text-[10px] uppercase tracking-wider text-white/40">Current plan</div>
          <div className="fw-display mt-2 text-4xl font-bold">{plan.name}</div>
          <div className="mt-1 text-white/60">${plan.price}/month</div>
        </div>
        <div className="rounded-lg border border-[var(--fw-line)] bg-white p-6">
          <div className="fw-mono text-[10px] uppercase tracking-wider text-[var(--fw-muted)]">Mail credits remaining</div>
          <div className="fw-display mt-2 text-4xl font-bold">{mailCredits}</div>
          <div className="mt-1 text-sm text-[var(--fw-muted)]">
            Includes {plan.mailCredits} / month · 1 credit = 1 opening or follow-up packet
          </div>
        </div>
        <div className="rounded-lg border border-[var(--fw-line)] bg-white p-6">
          <div className="fw-mono text-[10px] uppercase tracking-wider text-[var(--fw-muted)]">Audits remaining</div>
          <div className="fw-display mt-2 text-4xl font-bold">{auditCredits}</div>
          <div className="mt-1 text-sm text-[var(--fw-muted)]">
            Cap {plan.auditCredits} / month · live 3-bureau forensic runs
          </div>
        </div>
        {plan.expertChats ? (
          <div className="rounded-lg border border-[var(--fw-line)] bg-white p-6">
            <div className="fw-mono text-[10px] uppercase tracking-wider text-[var(--fw-muted)]">Expert chat left</div>
            <div className="fw-display mt-2 text-4xl font-bold">{expertChatCredits}</div>
            <div className="mt-1 text-sm text-[var(--fw-muted)]">
              {plan.expertChats} / month · AI brief to live expert · 9am–5pm MT
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {Object.values(MAIL_PHASES).map((p) => (
          <div key={p.id} className="rounded-lg border border-[var(--fw-line)] bg-white p-5">
            <div className="fw-mono text-[10px] uppercase tracking-wider text-[var(--fw-sea)]">{p.label}</div>
            <div className="fw-display mt-1 text-xl font-bold">{p.title}</div>
            <p className="mt-2 text-sm text-[var(--fw-muted)]">{p.blurb}</p>
            <ul className="mt-3 space-y-1 text-sm text-[var(--fw-ink)]/80">
              {p.enclosures.map((e) => (
                <li key={e.id}>▸ {e.name}</li>
              ))}
            </ul>
            <div className="mt-3 text-xs font-semibold text-[var(--fw-sea)]">{p.credits} credit · {p.costHint}</div>
          </div>
        ))}
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
        <h2 className="fw-display text-2xl font-bold">Top up credits</h2>
        <p className="mt-2 text-sm text-[var(--fw-muted)]">
          Need more sends mid-cycle? Packs are priced near Lob pass-through (~$14–15 / credit).
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {CREDIT_PACKS.map((pack) => (
            <div key={pack.id} className="rounded-lg border border-[var(--fw-line)] bg-white p-4">
              <div className="fw-display text-xl font-bold">{pack.label}</div>
              <div className="mt-1 text-sm text-[var(--fw-muted)]">{pack.credits} credits · ${pack.price}</div>
              <button
                type="button"
                onClick={() => buyCreditPack(pack.id)}
                className="fw-btn-ink mt-4 w-full !py-2 text-sm"
              >
                Add pack (demo)
              </button>
            </div>
          ))}
        </div>
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
