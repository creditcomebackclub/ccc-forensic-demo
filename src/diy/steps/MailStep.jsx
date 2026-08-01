import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';

function buildLetterHtml(user, account) {
  const topViolation = account.violations[0];
  return `DIRECT DISPUTE — FCRA §623 / Metro 2 Field ${topViolation.field}

${user.name}
${user.address.line1}
${user.address.city}, ${user.address.state} ${user.address.zip}

${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}

${account.furnisher}
Re: Account ${account.accountMask} · Original creditor: ${account.originalCreditor}

I am writing to dispute inaccurate information you are furnishing about me under the Fair Credit Reporting Act.

ISSUE: ${topViolation.title}
METRO 2 FIELD: ${topViolation.field} (${topViolation.fieldName})
STATUTE: ${topViolation.statute}

${topViolation.plain}

Reported: ${topViolation.reported}
Requested correction: ${topViolation.expected}

Please investigate and correct or delete the inaccurate reporting within thirty (30) days, and update all consumer reporting agencies to which you have furnished this data.

Sincerely,
${user.name}`;
}

export default function MailStep({ user, audit, selectedIds, onComplete }) {
  const accounts = useMemo(
    () => audit.accounts.filter((a) => selectedIds.includes(a.id)),
    [audit, selectedIds],
  );
  const [activeId, setActiveId] = useState(accounts[0]?.id);
  const [sending, setSending] = useState(false);
  const [sentFlash, setSentFlash] = useState(false);

  const active = accounts.find((a) => a.id === activeId) || accounts[0];
  const letter = active ? buildLetterHtml(user, active) : '';

  const sendAll = async () => {
    setSending(true);
    await new Promise((r) => setTimeout(r, 1600));
    const now = Date.now();
    const letters = accounts.map((account, i) => ({
      id: `lob_demo_${account.id}`,
      accountId: account.id,
      furnisher: account.furnisher,
      trackingNumber: `9401 1198 9898 ${String(1000000000 + i).slice(0, 10)}`,
      status: i === 0 ? 'In transit' : 'Accepted by Lob',
      mailedAt: new Date(now - i * 60000).toISOString(),
      etaDays: 30,
      violationCount: account.violations.length,
      preview: buildLetterHtml(user, account).slice(0, 160),
    }));
    setSentFlash(true);
    await new Promise((r) => setTimeout(r, 700));
    setSending(false);
    onComplete(letters);
  };

  if (!active) {
    return <p className="text-[var(--fw-muted)]">No accounts selected.</p>;
  }

  return (
    <div>
      <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">Step 04 · Mail</p>
      <h1 className="fw-display mt-2 text-4xl font-bold md:text-5xl">Review & send</h1>
      <p className="mt-3 max-w-2xl text-lg text-[var(--fw-muted)]">
        Letters go out in <strong className="font-semibold text-[var(--fw-ink)]">your name</strong> — no LPOA, no “c/o agency.” Demo mails are simulated through the Lob-shaped flow.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[240px_1fr]">
        <div className="space-y-2">
          {accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              onClick={() => setActiveId(account.id)}
              className={`w-full rounded border px-3 py-3 text-left text-sm transition ${
                active.id === account.id
                  ? 'border-[var(--fw-ink)] bg-[var(--fw-ink)] text-white'
                  : 'border-[var(--fw-line)] bg-white hover:border-black/20'
              }`}
            >
              <div className="font-semibold">{account.furnisher}</div>
              <div className={`mt-0.5 text-xs ${active.id === account.id ? 'text-white/60' : 'text-[var(--fw-muted)]'}`}>
                Field {account.violations[0].field} · certified
              </div>
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-[var(--fw-line)] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--fw-line)] px-4 py-3">
            <div className="fw-mono text-[11px] uppercase tracking-wider text-[var(--fw-muted)]">
              Letter preview · {active.furnisher}
            </div>
            <div className="text-xs text-[var(--fw-muted)]">Enclosure: ID + proof of address</div>
          </div>
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap px-5 py-5 font-[Figtree] text-sm leading-relaxed text-[var(--fw-ink)]">
            {letter}
          </pre>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-[var(--fw-ink)] p-5 text-white">
        <div>
          <div className="fw-display text-xl font-bold">
            Mail {accounts.length} certified letter{accounts.length === 1 ? '' : 's'}
          </div>
          <p className="mt-1 text-sm text-white/60">
            Est. postage ${(accounts.length * 8.9).toFixed(2)} · charged against Pro mail credits in a live product
          </p>
        </div>
        <button type="button" disabled={sending} onClick={sendAll} className="fw-btn-primary min-w-[200px]">
          {sending ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Submitting to Lob…
            </>
          ) : sentFlash ? (
            <>
              <CheckCircle2 size={16} /> Queued
            </>
          ) : (
            <>
              Send via Lob <ArrowRight size={16} />
            </>
          )}
        </button>
      </div>

      {sending && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-4 text-center text-sm text-[var(--fw-muted)]"
        >
          Creating mail artifacts · attaching enclosures · requesting certified tracking…
        </motion.p>
      )}
    </div>
  );
}
