import { motion } from 'framer-motion';
import { ArrowRight, Package, TimerReset } from 'lucide-react';

export default function TrackStep({ user, mailed, onBackHome }) {
  return (
    <div>
      <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">Step 05 · Track</p>
      <h1 className="fw-display mt-2 text-4xl font-bold md:text-5xl">Campaign in flight</h1>
      <p className="mt-3 max-w-2xl text-lg text-[var(--fw-muted)]">
        Hi {user.name.split(' ')[0]} — your furnisher letters are moving. Watch delivery, sit the 30-day clock, then upload responses for analysis.
      </p>

      <div className="mt-10 space-y-4">
        {mailed.map((letter, i) => (
          <motion.article
            key={letter.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="rounded-lg border border-[var(--fw-line)] bg-white p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="fw-display text-2xl font-bold">{letter.furnisher}</div>
                <div className="fw-mono mt-1 text-[11px] text-[var(--fw-muted)]">
                  {letter.trackingNumber}
                </div>
              </div>
              <span className="rounded border border-[rgba(22,158,111,0.3)] bg-[rgba(46,230,166,0.12)] px-2.5 py-1 text-xs font-semibold text-[var(--fw-signal-dim)]">
                {letter.status}
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded bg-[var(--fw-paper)] px-3 py-2.5 text-sm">
                <div className="fw-mono text-[10px] uppercase text-[var(--fw-muted)]">Mailed</div>
                <div className="mt-0.5 font-medium">
                  {new Date(letter.mailedAt).toLocaleDateString()}
                </div>
              </div>
              <div className="rounded bg-[var(--fw-paper)] px-3 py-2.5 text-sm">
                <div className="fw-mono text-[10px] uppercase text-[var(--fw-muted)]">Response window</div>
                <div className="mt-0.5 flex items-center gap-1.5 font-medium">
                  <TimerReset size={14} /> {letter.etaDays} days
                </div>
              </div>
              <div className="rounded bg-[var(--fw-paper)] px-3 py-2.5 text-sm">
                <div className="fw-mono text-[10px] uppercase text-[var(--fw-muted)]">Issues cited</div>
                <div className="mt-0.5 font-medium">{letter.violationCount}</div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 text-sm text-[var(--fw-muted)]">
              <Package size={15} className="text-[var(--fw-sea)]" />
              Lob certified · return receipt will attach when delivered (demo)
            </div>
          </motion.article>
        ))}
      </div>

      <div className="mt-12 overflow-hidden rounded-lg bg-[var(--fw-ink)] p-8 text-white">
        <h2 className="fw-display text-3xl font-bold">Campaign saved to your workspace</h2>
        <p className="mt-3 max-w-2xl text-white/70">
          In the standalone SaaS, this lands in Campaigns with Lob webhooks updating status. Next: upload responses in Documents, then analyze or escalate.
        </p>
        <button type="button" onClick={onBackHome} className="fw-btn-primary mt-6">
          View campaigns <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
