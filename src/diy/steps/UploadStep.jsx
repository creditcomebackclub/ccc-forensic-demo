import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { ANALYZE_STEPS } from '../demoData';
import { useFieldwork } from '../state';

export default function UploadStep({ onComplete }) {
  const { isGuestDemo, user, runtime } = useFieldwork();
  const guest = isGuestDemo || user?.guest || runtime?.mode === 'guest-demo';
  const [phase, setPhase] = useState('idle'); // idle | analyzing
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (phase !== 'analyzing') return undefined;
    if (stepIdx >= ANALYZE_STEPS.length) return undefined;
    const t = setTimeout(() => setStepIdx((s) => s + 1), 900);
    return () => clearTimeout(t);
  }, [phase, stepIdx]);

  const finishSample = () => {
    const wait = Math.max(400, (ANALYZE_STEPS.length - stepIdx) * 200);
    setTimeout(() => onComplete(null, { fileName: 'PrivacyGuard_3bureau_sample.pdf' }), wait);
  };

  const startSample = () => {
    setPhase('analyzing');
    setStepIdx(0);
    finishSample();
  };

  return (
    <div className="mx-auto max-w-2xl">
      <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">
        Step 01 · Sample audit
      </p>
      <h1 className="fw-display mt-2 text-4xl font-bold md:text-5xl">
        Run a sample audit
      </h1>
      <p className="mt-3 text-lg text-[var(--fw-muted)]">
        {guest
          ? 'Guest tour uses a canned 3-bureau sample so you can walk the full flow — no file upload.'
          : 'This build uses a canned 3-bureau sample so you can walk audit → select → mail without uploading a report.'}
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
            <div className="relative overflow-hidden rounded-lg border border-[var(--fw-line)] bg-white px-6 py-14 text-center">
              <div className="absolute inset-0 fw-field-scan opacity-60 pointer-events-none" />
              <Sparkles className="relative mx-auto text-[var(--fw-sea)]" size={36} strokeWidth={1.5} />
              <p className="relative mt-4 text-lg font-semibold">Sample 3-bureau report</p>
              <p className="relative mt-1 text-sm text-[var(--fw-muted)]">
                Midland, Capital One, and more — Metro 2 findings ready to dispute
              </p>
              <button type="button" onClick={startSample} className="fw-btn-ink relative mt-8">
                <Sparkles size={16} /> Run sample audit
              </button>
            </div>
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
