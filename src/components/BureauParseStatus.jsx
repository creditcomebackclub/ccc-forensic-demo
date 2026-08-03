import React from 'react';
import { CheckCircle2, Circle, ArrowRight } from 'lucide-react';
import { BUREAU_PARSE_KEYS, bureauDisplayName } from '../utils/auditBureauParses';

const T = {
  navy: '#1B2A4A',
  gold: '#C9A84C',
  border: '#E7EAF0',
  ink: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  cardShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
};

export default function BureauParseStatus({ result, onMerge, onReset, merging = false }) {
  const ready = new Set(result?.readyBureaus || []);
  const canMerge = !!result?.canMerge;

  return (
    <div className="max-w-2xl mx-auto" style={{ padding: '24px 0' }}>
      <div className="mb-6 flex items-center gap-3">
        <span style={{ width: 4, height: 30, borderRadius: 2, background: T.gold, display: 'inline-block' }} />
        <div>
          <h1 className="ccc-display text-[22px] font-medium leading-tight" style={{ color: T.ink }}>
            {result?.bureauLabel || 'Bureau'} parse saved
          </h1>
          <p className="text-[12px]" style={{ color: T.muted }}>
            Staged for {result?.clientName || 'this client'} — not a full unified audit yet.
            {result?.pageCount ? ` · ${result.pageCount} pages` : ''}
            {result?.chunkCount > 1 ? ` in ${result.chunkCount} parts` : ''}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl p-5 mb-4" style={{ border: '1px solid ' + T.border, boxShadow: T.cardShadow }}>
        <div className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: T.faint }}>
          Ready for merge ({ready.size}/3)
        </div>
        <div className="space-y-2">
          {BUREAU_PARSE_KEYS.map((key) => {
            const ok = ready.has(key);
            return (
              <div key={key} className="flex items-center gap-2 text-[13px]" style={{ color: ok ? T.ink : T.faint }}>
                {ok
                  ? <CheckCircle2 size={16} className="text-green-600" strokeWidth={2} />
                  : <Circle size={16} strokeWidth={1.75} style={{ color: T.faint }} />}
                <span className="font-medium">{bureauDisplayName(key)}</span>
                <span className="text-[11px]">{ok ? 'saved' : 'still needed'}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        {canMerge ? (
          <button
            onClick={onMerge}
            disabled={merging}
            className="flex-1 inline-flex items-center justify-center gap-2 py-3 text-[13px] uppercase tracking-wider rounded-lg font-medium disabled:opacity-60"
            style={{ backgroundColor: T.navy, color: T.gold }}
          >
            {merging ? 'Merging…' : 'Merge into unified audit'}
            {!merging && <ArrowRight size={14} strokeWidth={2} />}
          </button>
        ) : (
          <button
            onClick={onReset}
            className="flex-1 py-3 text-[13px] uppercase tracking-wider rounded-lg font-medium"
            style={{ backgroundColor: T.navy, color: T.gold }}
          >
            Run next bureau
          </button>
        )}
        <button
          onClick={onReset}
          className="py-3 px-4 text-[13px] rounded-lg font-medium"
          style={{ border: '1px solid ' + T.border, color: T.muted, background: '#fff' }}
        >
          Back to upload
        </button>
      </div>

      {!canMerge && (
        <p className="mt-4 text-[12px] leading-relaxed" style={{ color: T.muted }}>
          Run Single Bureau once for each bureau on this same client. When all three are saved, merge them into one audit — no PDF re-upload, just the cross-bureau reconciliation call.
        </p>
      )}
    </div>
  );
}
