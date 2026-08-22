import React, { useState, useEffect } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { ADMIN_BRAND } from '../utils/adminBrand.js';

const T = {
  primary: ADMIN_BRAND.ink,
  accent: ADMIN_BRAND.accent,
  border: ADMIN_BRAND.border,
  ink: ADMIN_BRAND.ink,
  muted: ADMIN_BRAND.muted,
  faint: ADMIN_BRAND.faint,
  grid: '#E8F0F6',
  cardShadow: ADMIN_BRAND.shadow,
};

// Real stages of the 3-file Individual pipeline, matched by prefix against
// the job's live `stage` text (which grows a "(pages X-Y of Z)" suffix for
// chunked files) — must track the literal strings audit-run-background.mjs
// sends via progress(), not a paraphrase, or every stage silently fails to
// match and the checklist gets stuck on the first item.
const INDIVIDUAL_STAGES = [
  'Extracting Equifax report',
  'Extracting Experian report',
  'Extracting TransUnion report',
  'Applying deterministic cross-bureau rules',
];

function fmtElapsed(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function fmtTokens(n) {
  if (!n) return null;
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

export default function AuditProgress({ fileName, progress, mode }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(interval);
  }, []);

  const stage = progress?.stage || 'Starting analysis';
  const pct = progress?.pct ?? null;
  const tokens = fmtTokens(progress?.tokens);
  // The 4-step checklist below is specific to the true 3-file Individual
  // pipeline. Single Bureau and Merge jobs also report a numeric pct, but
  // only ever run one step — showing this checklist for them just pins the
  // display on "Extracting Equifax report" no matter which bureau is
  // actually running.
  const isIndividual = mode === 'individual';
  const currentStageIdx = isIndividual
    ? Math.max(0, INDIVIDUAL_STAGES.findIndex((s) => stage.startsWith(s)))
    : -1;

  return (
    <div className="max-w-2xl mx-auto" style={{ padding: '20px 0 32px' }}>
      {/* Branded page header */}
      <div className="flex items-center gap-3 mb-6">
        <span style={{ width: 4, height: 30, borderRadius: 2, background: T.accent, display: 'inline-block' }} />
        <div>
          <h1 className="ccc-display text-[22px] font-medium leading-tight" style={{ color: T.ink }}>Running Forensic Audit</h1>
          <p className="text-[11px]" style={{ color: T.muted }}>{fileName}</p>
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid ' + T.border, borderRadius: 14, padding: 28, boxShadow: T.cardShadow }}>
        <div className="flex items-center gap-3">
          <Loader2 size={18} className="animate-spin shrink-0" style={{ color: T.accent }} />
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-medium" style={{ color: T.ink }}>{stage}…</div>
            <div className="text-[11px] mt-0.5" style={{ color: T.faint }}>
              {fmtElapsed(elapsed)} elapsed
              {tokens && <span> · ≈{tokens} tokens streamed</span>}
            </div>
          </div>
        </div>

        {/* Determinate bar for the 4-stage pipeline; shimmer for single-call runs */}
        <div className="mt-5 h-1.5 rounded-full overflow-hidden relative" style={{ background: T.grid }}>
          {pct !== null ? (
            <div className="h-full rounded-full transition-all duration-700" style={{ width: pct + '%', background: T.accent }} />
          ) : (
            <div className="h-full rounded-full ccc-progress-shimmer" style={{ width: '40%', background: T.accent }} />
          )}
        </div>

        {isIndividual && (
          <div className="mt-6 space-y-2.5">
            {INDIVIDUAL_STAGES.map((s, i) => {
              const done = i < currentStageIdx || stage === 'Complete';
              const active = i === currentStageIdx && stage !== 'Complete';
              return (
                <div key={s} className="flex items-center gap-3 text-[12px]" style={{ opacity: done || active ? 1 : 0.35 }}>
                  <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor: done ? T.primary : active ? T.accent : 'transparent',
                      border: !done && !active ? '1px solid #D6DCE6' : 'none',
                    }}>
                    {done && <CheckCircle2 size={10} color="#FFF" strokeWidth={3} />}
                    {active && <Loader2 size={10} className="animate-spin" color="#FFF" strokeWidth={2.5} />}
                  </div>
                  <span style={{ color: done || active ? T.ink : T.faint }}>{s}</span>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[10px] mt-6 leading-relaxed" style={{ color: T.faint }}>
          The audit runs server-side — it&apos;s safe to close this tab, and the finished audit is saved to the
          client&apos;s record automatically. Large reports can take a few minutes. Rate limits retry automatically.
        </p>
      </div>

      <style>{`
        @keyframes ccc-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
        .ccc-progress-shimmer { animation: ccc-shimmer 1.8s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
