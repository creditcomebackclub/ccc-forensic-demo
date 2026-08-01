import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, ChevronDown, Scale } from 'lucide-react';

const severityStyle = {
  critical: 'bg-[rgba(232,93,76,0.12)] text-[#b93d30] border-[rgba(232,93,76,0.25)]',
  high: 'bg-[rgba(232,163,23,0.14)] text-[#9a6a0a] border-[rgba(232,163,23,0.3)]',
  medium: 'bg-[rgba(20,80,95,0.1)] text-[var(--fw-sea)] border-[rgba(20,80,95,0.2)]',
  low: 'bg-black/5 text-[var(--fw-muted)] border-black/10',
};

function ViolationBlock({ v, open, onToggle }) {
  return (
    <div className="border-t border-[var(--fw-line)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-4 px-0 py-4 text-left"
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`fw-mono rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${severityStyle[v.severity]}`}>
              {v.severity}
            </span>
            <span className="fw-mono text-[11px] text-[var(--fw-muted)]">
              Field {v.field} · {v.statute}
            </span>
          </div>
          <div className="mt-2 text-base font-semibold">{v.title}</div>
        </div>
        <ChevronDown
          size={18}
          className={`mt-1 shrink-0 text-[var(--fw-muted)] transition ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28 }}
            className="overflow-hidden"
          >
            <div className="pb-5 text-sm leading-relaxed text-[var(--fw-muted)]">
              <p>{v.plain}</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded border border-[var(--fw-line)] bg-[var(--fw-paper)] px-3 py-2.5">
                  <div className="fw-mono text-[10px] uppercase tracking-wider text-[var(--fw-muted)]">Reported</div>
                  <div className="mt-1 text-[var(--fw-ink)]">{v.reported}</div>
                </div>
                <div className="rounded border border-[rgba(22,158,111,0.25)] bg-[rgba(46,230,166,0.08)] px-3 py-2.5">
                  <div className="fw-mono text-[10px] uppercase tracking-wider text-[var(--fw-signal-dim)]">Challenge</div>
                  <div className="mt-1 text-[var(--fw-ink)]">{v.expected}</div>
                </div>
              </div>
              <div className="fw-mono mt-3 text-[11px] text-black/40">{v.fieldName}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AccountCard({ account, index }) {
  const [openId, setOpenId] = useState(account.violations[0]?.id);

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06 * index, duration: 0.45 }}
      className="rounded-lg border border-[var(--fw-line)] bg-white p-5 md:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="fw-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fw-sea)]">
            {account.typeLabel}
          </div>
          <h3 className="fw-display mt-1 text-2xl font-bold">{account.furnisher}</h3>
          <p className="mt-1 text-sm text-[var(--fw-muted)]">
            {account.originalCreditor} · {account.accountMask} · {account.type}
          </p>
        </div>
        <div className="text-right text-sm">
          <div className="font-semibold">
            {account.balance == null ? '—' : `$${account.balance.toLocaleString()}`}
          </div>
          <div className="text-[var(--fw-muted)]">{account.status}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {account.bureaus.map((b) => (
          <span key={b} className="fw-mono rounded bg-[var(--fw-paper)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--fw-muted)]">
            {b}
          </span>
        ))}
      </div>

      <div className="mt-5 rounded border border-[rgba(20,80,95,0.15)] bg-[rgba(20,80,95,0.04)] px-3 py-3 text-sm leading-relaxed">
        <div className="fw-mono text-[10px] uppercase tracking-wider text-[var(--fw-sea)]">Why furnisher first</div>
        <p className="mt-1 text-[var(--fw-ink)]/80">{account.whyFurnisherFirst}</p>
      </div>

      <div className="mt-2">
        {account.violations.map((v) => (
          <ViolationBlock
            key={v.id}
            v={v}
            open={openId === v.id}
            onToggle={() => setOpenId((id) => (id === v.id ? null : v.id))}
          />
        ))}
      </div>
    </motion.article>
  );
}

export default function AuditStep({ audit, onContinue }) {
  const { summary, scoreSnapshot, accounts } = audit;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">Step 02 · Audit</p>
          <h1 className="fw-display mt-2 text-4xl font-bold md:text-5xl">Your forensic readout</h1>
          <p className="mt-3 max-w-2xl text-lg text-[var(--fw-muted)]">{audit.methodologyNote}</p>
        </div>
        <button type="button" onClick={onContinue} className="fw-btn-ink">
          Choose disputes <ArrowRight size={16} />
        </button>
      </div>

      {/* Summary strip — not a dashboard wall of stats; one purposeful band */}
      <div className="mt-10 overflow-hidden rounded-lg bg-[var(--fw-ink)] text-white">
        <div className="grid gap-0 md:grid-cols-[1.2fr_1fr]">
          <div className="relative p-6 md:p-8">
            <div className="absolute inset-0 fw-field-scan opacity-40 pointer-events-none" />
            <div className="relative">
              <div className="fw-mono text-[11px] uppercase tracking-[0.2em] text-[var(--fw-signal)]">Actionable</div>
              <div className="fw-display mt-2 text-5xl font-bold md:text-6xl">
                {summary.actionableAccounts}
                <span className="text-2xl text-white/40"> / {summary.accountsReviewed}</span>
              </div>
              <p className="mt-2 text-white/65">accounts with furnisher-first dispute targets</p>
              <div className="mt-6 flex flex-wrap gap-6 text-sm">
                <div>
                  <div className="fw-mono text-[10px] uppercase text-white/40">Violations</div>
                  <div className="text-xl font-semibold">{summary.totalViolations}</div>
                </div>
                <div>
                  <div className="fw-mono text-[10px] uppercase text-white/40">Cross-bureau</div>
                  <div className="text-xl font-semibold">{summary.crossBureauConflicts}</div>
                </div>
              </div>
            </div>
          </div>
          <div className="border-t border-white/10 p-6 md:border-l md:border-t-0 md:p-8">
            <div className="fw-mono text-[11px] uppercase tracking-[0.2em] text-white/40">Score snapshot</div>
            <div className="mt-4 space-y-3">
              {Object.entries(scoreSnapshot).map(([bureau, score]) => (
                <div key={bureau} className="flex items-center justify-between text-sm">
                  <span className="capitalize text-white/70">{bureau}</span>
                  <span className="fw-mono text-lg font-semibold">{score}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 flex items-start gap-2 text-xs text-white/45">
              <Scale size={14} className="mt-0.5 shrink-0 text-[var(--fw-signal)]" />
              Scores are context — Fieldwork optimizes for reportable accuracy defects, not magical point promises.
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 space-y-4">
        {accounts.map((account, i) => (
          <AccountCard key={account.id} account={account} index={i} />
        ))}
      </div>

      <div className="mt-10 flex justify-end">
        <button type="button" onClick={onContinue} className="fw-btn-ink text-base">
          Continue to dispute selection <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}
