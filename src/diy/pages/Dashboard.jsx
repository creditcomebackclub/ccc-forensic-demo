import { Link } from 'react-router-dom';
import { ArrowRight, Crosshair, FileSearch, Mail, Sparkles } from 'lucide-react';
import { useFieldwork } from '../state';

export default function Dashboard() {
  const { user, plan, mailCredits, audit, campaigns, letters, runtime } = useFieldwork();
  const first = user.name.split(' ')[0];
  const active = campaigns[0];

  return (
    <div className="mx-auto max-w-5xl">
      <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">Home</p>
      <h1 className="fw-display mt-2 text-4xl font-bold md:text-5xl">Welcome back, {first}</h1>
      <p className="mt-3 max-w-2xl text-lg text-[var(--fw-muted)]">
        Your furnisher-first workspace. Audit reports, pick disputes, mail certified letters, and track response windows — as a subscriber, not a client of an agency.
      </p>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-[var(--fw-line)] bg-white p-5">
          <div className="fw-mono text-[10px] uppercase tracking-wider text-[var(--fw-muted)]">Subscription</div>
          <div className="fw-display mt-2 text-3xl font-bold">{plan.name}</div>
          <div className="mt-1 text-sm text-[var(--fw-muted)]">${plan.price}/mo · demo billing</div>
          <Link to="/app/billing" className="mt-4 inline-flex text-sm font-semibold text-[var(--fw-sea)] hover:underline">
            Manage plan
          </Link>
        </div>
        <div className="rounded-lg border border-[var(--fw-line)] bg-white p-5">
          <div className="fw-mono text-[10px] uppercase tracking-wider text-[var(--fw-muted)]">Mail credits</div>
          <div className="fw-display mt-2 text-3xl font-bold">{mailCredits}</div>
          <div className="mt-1 text-sm text-[var(--fw-muted)]">1 credit = 1 Lob certified letter</div>
          <Link to="/app/billing" className="mt-4 inline-flex text-sm font-semibold text-[var(--fw-sea)] hover:underline">
            Top up / upgrade
          </Link>
        </div>
        <div className="rounded-lg border border-[var(--fw-line)] bg-white p-5">
          <div className="fw-mono text-[10px] uppercase tracking-wider text-[var(--fw-muted)]">Campaigns</div>
          <div className="fw-display mt-2 text-3xl font-bold">{campaigns.length}</div>
          <div className="mt-1 text-sm text-[var(--fw-muted)]">
            {letters.length ? `${letters.length} letters in latest wave` : 'No mail sent yet'}
          </div>
          <Link to="/app/campaigns" className="mt-4 inline-flex text-sm font-semibold text-[var(--fw-sea)] hover:underline">
            View history
          </Link>
        </div>
      </div>

      {/* Primary CTA band */}
      <div className="relative mt-8 overflow-hidden rounded-lg bg-[var(--fw-ink)] p-6 text-white md:p-8">
        <div className="absolute inset-0 fw-field-scan opacity-40 pointer-events-none" />
        <div className="relative grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-center">
          <div>
            <div className="fw-mono text-[11px] uppercase tracking-[0.2em] text-[var(--fw-signal)]">
              {audit ? 'Continue your campaign' : 'Start a campaign'}
            </div>
            <h2 className="fw-display mt-2 text-3xl font-bold md:text-4xl">
              {audit
                ? `${audit.summary.actionableAccounts} furnisher targets ready`
                : 'Upload a report. Dispute at the source.'}
            </h2>
            <p className="mt-3 max-w-xl text-white/65">
              {audit
                ? 'Your Metro 2 / FCRA audit is loaded. Select disputes, compose letters, and spend mail credits.'
                : 'Fieldwork runs a field-level forensic audit, then you choose what to mail — in your name, via certified Lob.'}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
            <Link to="/app/campaign/new" className="fw-btn-primary justify-center">
              {audit ? 'Open campaign wizard' : 'New campaign'} <ArrowRight size={16} />
            </Link>
            {active && (
              <Link
                to="/app/campaigns"
                className="fw-btn-ghost justify-center !border-white/20"
              >
                Latest: {active.status}
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="mt-10 grid gap-8 md:grid-cols-3">
        {[
          {
            icon: FileSearch,
            title: '1 · Audit',
            body: 'Metro 2 fields + FCRA citations, written for humans.',
          },
          {
            icon: Crosshair,
            title: '2 · Choose',
            body: 'You pick the furnishers. No agency owns the playbook.',
          },
          {
            icon: Mail,
            title: '3 · Mail & track',
            body: 'Credits → Lob certified → 30-day clocks on your timeline.',
          },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="border-t border-[var(--fw-line)] pt-5">
            <Icon size={20} className="text-[var(--fw-sea)]" strokeWidth={1.75} />
            <h3 className="fw-display mt-3 text-xl font-bold">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--fw-muted)]">{body}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 flex items-start gap-3 rounded-lg border border-[rgba(22,158,111,0.2)] bg-[rgba(46,230,166,0.08)] px-4 py-4 text-sm">
        <Sparkles size={16} className="mt-0.5 shrink-0 text-[var(--fw-signal-dim)]" />
        <p className="text-[var(--fw-ink)]/80">
          <strong className="font-semibold">Isolated from CCC:</strong> {runtime.message || 'Fieldwork uses its own tables and FIELDWORK_* keys.'}
          {' '}Agency Forensic Suite data, Lob, and Claude accounts are not used unless you deliberately configure separate Fieldwork credentials.
        </p>
      </div>
    </div>
  );
}
