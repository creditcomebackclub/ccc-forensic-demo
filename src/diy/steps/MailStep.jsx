import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle2, Loader2, Package } from 'lucide-react';
import { estimatePostageUsd, formatCreditCostRange, MAIL_PHASES } from '../mailEconomics';
import { buildFieldworkLetter, fieldworkLetterPlainExcerpt } from '../adapters/buildFieldworkLetter';
import { isFieldworkLetterHtml } from '../adapters/fieldworkLetterCss';
import { generateFieldworkLetter, getFieldworkStatus } from '../api';

export default function MailStep({ user, audit, selectedIds, mailCredits = 99, onComplete }) {
  const accounts = useMemo(
    () => audit.accounts.filter((a) => selectedIds.includes(a.id)),
    [audit, selectedIds],
  );
  const [activeId, setActiveId] = useState(accounts[0]?.id);
  const [phaseId, setPhaseId] = useState('phase1');
  const [sending, setSending] = useState(false);
  const [sentFlash, setSentFlash] = useState(false);
  const [letterByAccount, setLetterByAccount] = useState({});
  const [letterMode, setLetterMode] = useState('local');
  const [engineReady, setEngineReady] = useState(false);

  const phase = MAIL_PHASES[phaseId];
  const active = accounts.find((a) => a.id === activeId) || accounts[0];
  const cost = accounts.length * phase.credits;
  const canAfford = mailCredits >= cost;
  const postageEst = estimatePostageUsd(accounts.length, { phase: phaseId });

  useEffect(() => {
    getFieldworkStatus().then((s) => setEngineReady(Boolean(s.anthropicConfigured)));
  }, []);

  // Fieldwork-styled letters (CCC substance). Engine when FIELDWORK_ANTHROPIC is set.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!accounts.length) return;
      const next = {};
      for (const account of accounts) {
        next[account.id] = buildFieldworkLetter(user, account, phaseId);
      }
      if (!cancelled) {
        setLetterByAccount({ ...next });
        setLetterMode('local');
      }

      if (!engineReady) return;

      let mode = 'local';
      await Promise.all(
        accounts.map(async (account) => {
          try {
            const res = await generateFieldworkLetter({
              user,
              account,
              phaseId,
              tone: 'Standard',
            });
            if (!cancelled && res?.letter) {
              next[account.id] = res.letter;
              if (res.mode === 'engine') mode = 'engine';
            }
          } catch {
            // keep local Fieldwork builder — same look as demo
          }
        }),
      );

      if (!cancelled) {
        setLetterByAccount({ ...next });
        setLetterMode(mode);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [accounts, phaseId, user, engineReady]);

  useEffect(() => {
    if (active && !accounts.some((a) => a.id === activeId)) {
      setActiveId(accounts[0]?.id);
    }
  }, [accounts, active, activeId]);

  const letter = active
    ? (letterByAccount[active.id] || buildFieldworkLetter(user, active, phaseId))
    : '';

  const sendAll = async () => {
    if (!canAfford) return;
    setSending(true);
    await new Promise((r) => setTimeout(r, 1600));
    const now = Date.now();
    const letters = accounts.map((account, i) => {
      const body = letterByAccount[account.id] || buildFieldworkLetter(user, account, phaseId);
      return {
        id: `lob_demo_${account.id}_${now}`,
        accountId: account.id,
        furnisher: account.furnisher,
        phase: phaseId,
        enclosures: phase.enclosures.map((e) => e.name),
        trackingNumber: `9401 1198 9898 ${String(1000000000 + i).slice(0, 10)}`,
        status: i === 0 ? 'In transit' : 'Accepted by Lob',
        mailedAt: new Date(now - i * 60000).toISOString(),
        etaDays: 30,
        violationCount: account.violations.length,
        estimatedLobCostUsd: phaseId === 'phase2' ? 15 : 14,
        preview: fieldworkLetterPlainExcerpt(body, 200),
        body,
        format: 'html',
      };
    });
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
      {!user?.signatureData && (
        <div className="mt-4 rounded-lg border border-[rgba(232,163,23,0.35)] bg-[rgba(232,163,23,0.1)] px-4 py-3 text-sm text-[var(--fw-ink)]">
          No drawn signature on file yet — letters will show a blank line.{' '}
          <Link to="/app/settings" className="font-semibold text-[var(--fw-sea)] hover:underline">
            Draw it in Settings
          </Link>
          , then come back here.
        </div>
      )}
      <p className="mt-3 max-w-2xl text-lg text-[var(--fw-muted)]">
        One credit = one certified Lob packet ({formatCreditCostRange()} with enclosures).
        Letters go out in <strong className="font-semibold text-[var(--fw-ink)]">your name</strong>
        {letterMode === 'engine' ? ' — forensic substance from the live engine, Fieldwork formatting.' : '.'}
      </p>

      <div className="mt-8 grid gap-3 md:grid-cols-2">
        {Object.values(MAIL_PHASES).map((p) => {
          const selected = p.id === phaseId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPhaseId(p.id)}
              className={`rounded-lg border p-4 text-left transition ${
                selected
                  ? 'border-[var(--fw-ink)] bg-[var(--fw-ink)] text-white'
                  : 'border-[var(--fw-line)] bg-white hover:border-black/20'
              }`}
            >
              <div className="fw-mono text-[10px] uppercase tracking-wider opacity-60">{p.label}</div>
              <div className="fw-display mt-1 text-xl font-bold">{p.title}</div>
              <p className={`mt-2 text-sm ${selected ? 'text-white/65' : 'text-[var(--fw-muted)]'}`}>{p.blurb}</p>
              <div className={`mt-3 text-xs font-semibold ${selected ? 'text-[var(--fw-signal)]' : 'text-[var(--fw-sea)]'}`}>
                {p.credits} credit · {p.costHint}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 rounded-lg border border-[var(--fw-line)] bg-white p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Package size={16} className="text-[var(--fw-sea)]" />
          Enclosure pack — {phase.label}
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {phase.enclosures.map((enc) => (
            <li key={enc.id} className="flex items-center gap-2 text-sm text-[var(--fw-muted)]">
              <span className="fw-mono text-[10px] text-[var(--fw-signal-dim)]">PDF</span>
              {enc.name}
            </li>
          ))}
        </ul>
      </div>

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
                Field {account.violations[0]?.field} · {phase.label}
              </div>
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--fw-line)] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--fw-line)] px-4 py-3">
            <div className="fw-mono text-[11px] uppercase tracking-wider text-[var(--fw-muted)]">
              Letter preview · {active.furnisher}
            </div>
            <div className="text-xs text-[var(--fw-muted)]">
              {phase.enclosures.length} enclosures · {formatCreditCostRange()} Lob
            </div>
          </div>
          {isFieldworkLetterHtml(letter) ? (
            <iframe
              title={`Letter preview ${active.furnisher}`}
              srcDoc={letter}
              className="h-[520px] w-full bg-white"
              sandbox=""
            />
          ) : (
            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap px-5 py-5 font-[Figtree] text-sm leading-relaxed text-[var(--fw-ink)]">
              {letter || 'Composing…'}
            </pre>
          )}
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-[var(--fw-ink)] p-5 text-white">
        <div>
          <div className="fw-display text-xl font-bold">
            Mail {accounts.length} {phase.label} packet{accounts.length === 1 ? '' : 's'}
          </div>
          <p className="mt-1 text-sm text-white/60">
            {cost} credit{cost === 1 ? '' : 's'} · you have {mailCredits}
            {!canAfford
              ? ' — need more credits (top up or upgrade)'
              : ` · ~$${postageEst} Lob postage at ${formatCreditCostRange()} / send`}
          </p>
        </div>
        <button type="button" disabled={sending || !canAfford} onClick={sendAll} className="fw-btn-primary min-w-[200px]">
          {sending ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Building packet…
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
          Assembling {phase.label} enclosures · certified tracking · Lob submission…
        </motion.p>
      )}
    </div>
  );
}
