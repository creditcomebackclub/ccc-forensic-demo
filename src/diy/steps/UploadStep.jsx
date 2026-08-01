import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileUp, Sparkles } from 'lucide-react';
import { ANALYZE_STEPS } from '../demoData';
import { getFieldworkStatus, runFieldworkAudit } from '../api';
import { useFieldwork } from '../state';

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export default function UploadStep({ onComplete }) {
  const { user, plan, auditCredits } = useFieldwork();
  const [phase, setPhase] = useState('idle'); // idle | analyzing
  const [stepIdx, setStepIdx] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [engineReady, setEngineReady] = useState(false);
  const auditsLeft = typeof auditCredits === 'number' ? auditCredits : plan.auditCredits;

  useEffect(() => {
    getFieldworkStatus().then((s) => {
      setEngineReady(Boolean(s.anthropicConfigured));
    });
  }, []);

  useEffect(() => {
    if (phase !== 'analyzing') return undefined;
    // Progress animation while sample OR live audit runs
    if (stepIdx >= ANALYZE_STEPS.length) return undefined;
    const t = setTimeout(() => setStepIdx((s) => s + 1), 900);
    return () => clearTimeout(t);
  }, [phase, stepIdx]);

  const finishSample = () => {
    // Let the animation land, then hand canned Fieldwork audit to parent
    const wait = Math.max(400, (ANALYZE_STEPS.length - stepIdx) * 200);
    setTimeout(() => onComplete(null, { fileName: 'PrivacyGuard_3bureau_sample.pdf' }), wait);
  };

  const startSample = () => {
    setError('');
    setPhase('analyzing');
    setStepIdx(0);
    finishSample();
  };

  const startLive = async (file) => {
    setError('');

    if (!engineReady) {
      // No Fieldwork Anthropic key — keep demo UX with canned findings (no audit credit)
      setPhase('analyzing');
      setStepIdx(0);
      finishSample();
      return;
    }

    if (auditsLeft < 1) {
      setError(
        `You’ve used all ${plan.auditCredits} forensic audits on ${plan.name} this period. Upgrade for a higher cap, or use the sample report to explore the UI.`,
      );
      return;
    }

    setPhase('analyzing');
    setStepIdx(0);

    try {
      const base64 = await readFileAsBase64(file);
      const mediaType = file.type || 'application/pdf';
      const res = await runFieldworkAudit({
        base64,
        mediaType,
        fileName: file.name,
        mode: 'combined',
        subscriberId: user?.subscriberId,
      });
      onComplete(res.audit, { fileName: file.name, mode: res.mode });
    } catch (err) {
      console.error(err);
      setError(
        err.message
        || 'Live audit failed. For local PDFs run `npm run audit:fieldwork` in a second terminal, then retry upload.',
      );
      setPhase('idle');
      setStepIdx(0);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">Step 01 · Upload</p>
      <h1 className="fw-display mt-2 text-4xl font-bold md:text-5xl">Drop your credit report</h1>
      <p className="mt-3 text-lg text-[var(--fw-muted)]">
        PrivacyGuard, IdentityIQ, or any 3-bureau PDF/HTML export.
        {engineReady
          ? ' Drop a real report for a live furnisher-first audit — findings render in this same UI.'
          : ' This demo runs a canned forensic sample so you can feel the product instantly.'}
      </p>
      <p className="mt-2 fw-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fw-sea)]">
        {auditsLeft} of {plan.auditCredits} audits left · {plan.name}
      </p>

      <AnimatePresence mode="wait">
        {phase === 'idle' ? (
          <motion.div
            key="idle"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mt-10"
          >
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) startLive(file);
                else startSample();
              }}
              className={`relative overflow-hidden rounded-lg border-2 border-dashed px-6 py-16 text-center transition ${
                dragOver
                  ? 'border-[var(--fw-signal-dim)] bg-[rgba(46,230,166,0.08)]'
                  : 'border-[var(--fw-line)] bg-white'
              }`}
            >
              <div className="absolute inset-0 fw-field-scan opacity-60 pointer-events-none" />
              <FileUp className="relative mx-auto text-[var(--fw-sea)]" size={36} strokeWidth={1.5} />
              <p className="relative mt-4 text-lg font-semibold">Drag & drop a report</p>
              <p className="relative mt-1 text-sm text-[var(--fw-muted)]">
                PDF, HTML, or TXT · {engineReady ? 'live forensic audit when key is set' : 'demo accepts anything'}
              </p>
              <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
                <button type="button" onClick={startSample} className="fw-btn-ink">
                  <Sparkles size={16} /> Use sample 3-bureau report
                </button>
                <label className="fw-btn-ghost cursor-pointer !border-[var(--fw-line)] !text-[var(--fw-ink)]">
                  Upload file
                  <input
                    type="file"
                    accept=".pdf,.html,.htm,.txt,application/pdf,text/html,text/plain"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) startLive(file);
                    }}
                  />
                </label>
              </div>
            </div>
            {error ? (
              <p className="mt-4 text-sm text-[#b93d30]">{error}</p>
            ) : null}
          </motion.div>
        ) : (
          <motion.div
            key="analyzing"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative mt-10 overflow-hidden rounded-lg bg-[var(--fw-ink)] px-6 py-14 text-white"
          >
            <div className="pointer-events-none absolute inset-0 fw-grid-overlay opacity-80" />
            <div className="fw-scan-line pointer-events-none absolute inset-x-8 h-16 bg-gradient-to-b from-transparent via-[rgba(46,230,166,0.25)] to-transparent" />
            <div className="relative">
              <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-signal)]">Analyzing</p>
              <h2 className="fw-display mt-3 text-3xl font-bold">Running furnisher-first audit…</h2>
              <ul className="mt-8 space-y-3">
                {ANALYZE_STEPS.map((label, i) => {
                  const done = i < stepIdx;
                  const active = i === stepIdx;
                  return (
                    <li
                      key={label}
                      className={`flex items-center gap-3 text-sm transition ${
                        done ? 'text-[var(--fw-signal)]' : active ? 'text-white' : 'text-white/30'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${done || active ? 'bg-[var(--fw-signal)]' : 'bg-white/20'}`} />
                      {label}
                    </li>
                  );
                })}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
