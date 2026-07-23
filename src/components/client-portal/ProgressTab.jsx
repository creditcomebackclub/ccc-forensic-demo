import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ScoreDeltaBadge } from './ScoreMeter';

const BUREAU_LABEL = { equifax: 'Equifax', experian: 'Experian', transunion: 'TransUnion' };

function fmt(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function monthLabel(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Deletions green, additions amber — per Retention Build 1c. Deliberately
// never reads `diff.unmatched`: low-confidence accounts must never surface
// to the client, so this table only ever sees deleted/new/changed.
function DetailTable({ diff }) {
  const rows = [
    ...diff.deleted.map((a) => ({ ...a, kind: 'Removed' })),
    ...diff.new.map((a) => ({ ...a, kind: 'Added' })),
  ];
  if (rows.length === 0) return null;
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-gray-100">
      <table className="w-full text-[12px]">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`border-t border-gray-50 first:border-t-0 ${r.kind === 'Removed' ? 'bg-green-50/50' : 'bg-amber-50/50'}`}>
              <td className="px-3 py-2 font-semibold text-slate-900">{r.furnisher}</td>
              <td className={`px-3 py-2 font-bold ${r.kind === 'Removed' ? 'text-green-700' : 'text-amber-700'}`}>{r.kind}</td>
              <td className="px-3 py-2 text-gray-500 text-right">{r.balance != null ? '$' + Number(r.balance).toLocaleString() : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProgressCard({ update, expanded, onToggle }) {
  const diff = update.diff || {};
  const scoreDeltas = diff.scoreDeltas || {};
  const hasAnyScoreDelta = Object.values(scoreDeltas).some((s) => s && s.delta != null);
  const [showDetail, setShowDetail] = useState(false);
  const detailCount = (diff.deleted?.length || 0) + (diff.new?.length || 0);

  return (
    <div className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl overflow-hidden shadow-sm">
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left">
        <div>
          <div className="text-[13px] font-bold text-slate-900">{monthLabel(update.to_report_date)}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">Compared to {fmt(update.from_report_date)}</div>
        </div>
        <div className="flex items-center gap-3">
          {hasAnyScoreDelta && (
            <div className="hidden sm:flex items-center gap-2">
              {Object.entries(scoreDeltas).filter(([, s]) => s && s.delta != null && s.delta !== 0).map(([bureau, s]) => (
                <ScoreDeltaBadge key={bureau} delta={s.delta} />
              ))}
            </div>
          )}
          {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5">
              {update.narrative ? (
                <p className="text-[13px] text-gray-600 leading-relaxed whitespace-pre-line">{update.narrative}</p>
              ) : (
                <p className="text-[13px] text-gray-400 italic">Your update for this report is being prepared and will appear here shortly.</p>
              )}

              {detailCount > 0 && (
                <div className="mt-3">
                  <button onClick={() => setShowDetail((v) => !v)} className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 hover:text-amber-700">
                    {showDetail ? 'Hide account details' : 'View account details (' + detailCount + ')'}
                  </button>
                  {showDetail && <DetailTable diff={diff} />}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function ProgressTab({ updates }) {
  const sorted = [...(updates || [])].sort((a, b) => String(b.to_report_date).localeCompare(String(a.to_report_date)));
  const [expandedId, setExpandedId] = useState(sorted[0]?.id || null);

  if (sorted.length === 0) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 ccc-display">Your Progress</h1>
          <p className="text-sm text-gray-500 mt-1 mb-6">Plain-language updates each time your report is reviewed.</p>
        </div>
        <div className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl p-10 text-center shadow-sm">
          <Sparkles size={28} className="text-gray-200 mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-sm text-gray-400">Your first progress report will appear after your next monthly report is reviewed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 ccc-display">Your Progress</h1>
        <p className="text-sm text-gray-500 mt-1 mb-6">Plain-language updates each time your report is reviewed.</p>
      </div>

      <div className="space-y-3">
        {sorted.map((u) => (
          <ProgressCard
            key={u.id}
            update={u}
            expanded={expandedId === u.id}
            onToggle={() => setExpandedId((cur) => (cur === u.id ? null : u.id))}
          />
        ))}
      </div>
    </div>
  );
}
