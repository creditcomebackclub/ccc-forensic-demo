import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Download, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ScoreDeltaBadge, getScoreColor } from './ScoreMeter';
import { downloadProgressUpdatePdf, progressSnapshotMetrics } from '../../utils/progressUpdatePdf.js';

const BUREAUS = [
  { key: 'equifax', label: 'Equifax' },
  { key: 'experian', label: 'Experian' },
  { key: 'transunion', label: 'TransUnion' },
];

function fmt(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function monthLabel(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
function money(value) {
  return '$' + Math.round(Number(value) || 0).toLocaleString('en-US');
}

function MetricTile({ label, value, accent }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${accent ? 'bg-[#121F38] border-[#121F38] text-white' : 'bg-white border-gray-100 text-slate-900'}`}>
      <div className={`text-[10px] uppercase tracking-[0.14em] font-semibold ${accent ? 'text-[#C9A84C]' : 'text-slate-400'}`}>{label}</div>
      <div className={`mt-1.5 text-2xl font-bold tracking-tight ${accent ? 'text-white' : 'text-slate-900'}`}>{value}</div>
    </div>
  );
}

function ScoreBoard({ scoreDeltas }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
      {BUREAUS.map(({ key, label }) => {
        const s = scoreDeltas[key] || {};
        const current = s.new;
        const prior = s.old;
        const delta = s.delta;
        return (
          <div key={key} className="rounded-xl bg-[#121F38] px-4 py-3.5 text-white">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-[#C9A84C]">{label}</span>
              <ScoreDeltaBadge delta={delta} />
            </div>
            <div className="mt-2 text-3xl font-bold tracking-tight" style={{ color: current != null ? getScoreColor(current) : '#fff' }}>
              {current != null ? current : '—'}
            </div>
            <div className="mt-1 text-[11px] text-white/45">{prior != null ? `Was ${prior}` : 'No prior score'}</div>
          </div>
        );
      })}
    </div>
  );
}

function DetailTable({ deleted, added, changed }) {
  const rows = [
    ...deleted.map((a) => ({ ...a, kind: 'Removed', tone: 'green' })),
    ...added.map((a) => ({ ...a, kind: 'Added', tone: 'amber' })),
    ...changed.map((a) => ({
      furnisher: a.furnisher,
      balance: a.newBalance,
      status: a.oldStatus !== a.newStatus ? `${a.oldStatus || '—'} → ${a.newStatus || '—'}` : a.newStatus,
      kind: 'Changed',
      tone: 'slate',
    })),
  ];
  if (rows.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-gray-100">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="bg-[#121F38] text-[#C9A84C]">
            <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-wider text-[10px]">Account</th>
            <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-wider text-[10px]">Change</th>
            <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-wider text-[10px]">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`border-t border-gray-50 ${r.tone === 'green' ? 'bg-green-50/60' : r.tone === 'amber' ? 'bg-amber-50/60' : 'bg-white'}`}>
              <td className="px-3 py-2.5">
                <div className="font-semibold text-slate-900">{r.furnisher}</div>
                {r.status && <div className="text-[11px] text-slate-400 mt-0.5">{r.status}</div>}
              </td>
              <td className={`px-3 py-2.5 font-bold ${r.tone === 'green' ? 'text-green-700' : r.tone === 'amber' ? 'text-amber-700' : 'text-slate-600'}`}>{r.kind}</td>
              <td className="px-3 py-2.5 text-right text-slate-500">{r.balance != null ? money(r.balance) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProgressCard({ update, expanded, onToggle }) {
  const metrics = useMemo(() => progressSnapshotMetrics(update.diff || {}), [update.diff]);
  const neg = metrics.negativeCounts;
  const [showDetail, setShowDetail] = useState(false);
  const detailCount = metrics.deletedCount + metrics.addedCount + metrics.changedCount;

  const handleDownload = (event) => {
    event.stopPropagation();
    downloadProgressUpdatePdf({
      clientName: update.client_name || 'Client',
      fromReportDate: update.from_report_date,
      toReportDate: update.to_report_date,
      narrative: update.narrative || '',
      diff: update.diff,
      phaseProgress: [],
    });
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-[0_8px_30px_rgba(18,31,56,0.04)]">
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-slate-50/70 transition-colors">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-[#C9A84C]">Progress Update</div>
          <div className="mt-1 text-[17px] font-bold text-slate-900 tracking-tight">{monthLabel(update.to_report_date)}</div>
          <div className="text-[12px] text-slate-400 mt-0.5">Compared to {fmt(update.from_report_date)}</div>
        </div>
        <div className="flex items-center gap-3">
          {metrics.deletedCount > 0 && (
            <span className="hidden sm:inline-flex items-center rounded-full bg-green-50 border border-green-100 px-2.5 py-1 text-[11px] font-bold text-green-700">
              {metrics.deletedCount} removed
            </span>
          )}
          <div className="hidden md:flex items-center gap-1.5">
            {BUREAUS.map(({ key }) => {
              const delta = metrics.scoreDeltas[key]?.delta;
              if (delta == null || delta === 0) return null;
              return <ScoreDeltaBadge key={key} delta={delta} />;
            })}
          </div>
          {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-5 border-t border-gray-50 pt-5">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                <MetricTile label="Removed" value={String(metrics.deletedCount)} accent={metrics.deletedCount > 0} />
                <MetricTile label="Debt cleared" value={money(metrics.totalDebtRemoved)} accent={metrics.totalDebtRemoved > 0} />
                <MetricTile
                  label="Negatives"
                  value={neg?.before != null && neg?.after != null ? `${neg.before} → ${neg.after}` : '—'}
                />
                <MetricTile label="New items" value={String(metrics.addedCount)} />
              </div>

              <ScoreBoard scoreDeltas={metrics.scoreDeltas} />

              {update.narrative ? (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 mb-2.5">Your update</div>
                  <p className="text-[14px] text-slate-600 leading-relaxed whitespace-pre-line">{update.narrative}</p>
                </div>
              ) : (
                <p className="text-[13px] text-slate-400 italic">Your update for this report is being prepared and will appear here shortly.</p>
              )}

              {detailCount > 0 && (
                <div>
                  <button
                    onClick={() => setShowDetail((v) => !v)}
                    className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#121F38] hover:text-[#C9A84C] transition-colors"
                  >
                    {showDetail ? 'Hide account details' : `View account details (${detailCount})`}
                  </button>
                  {showDetail && (
                    <div className="mt-3">
                      <DetailTable deleted={metrics.deleted} added={metrics.added} changed={metrics.changed} />
                    </div>
                  )}
                </div>
              )}

              {update.narrative && (
                <button
                  onClick={handleDownload}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#121F38] px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[#C9A84C]"
                >
                  <Download size={13} /> Download PDF
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function ProgressTab({ updates }) {
  const sorted = [...(updates || [])]
    .filter((u) => u.status === 'sent' || u.emailed_at)
    .sort((a, b) => String(b.to_report_date).localeCompare(String(a.to_report_date)));
  const [expandedId, setExpandedId] = useState(sorted[0]?.id || null);

  if (sorted.length === 0) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-[#C9A84C]">Retention</div>
          <h1 className="text-3xl font-bold text-slate-900 ccc-display mt-1">Your Progress</h1>
          <p className="text-sm text-slate-500 mt-2 mb-2 max-w-xl">Each time we review a new report, you get a clear update on scores, removals, and campaign status.</p>
        </div>
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white/70 p-12 text-center">
          <Sparkles size={28} className="text-gray-200 mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-sm text-slate-400">Your first progress report will appear after your next monthly report is reviewed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-[#C9A84C]">Retention</div>
        <h1 className="text-3xl font-bold text-slate-900 ccc-display mt-1">Your Progress</h1>
        <p className="text-sm text-slate-500 mt-2 mb-2 max-w-xl">Plain-language updates with scores, account movement, and campaign status after each report review.</p>
      </div>

      <div className="space-y-3.5">
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
