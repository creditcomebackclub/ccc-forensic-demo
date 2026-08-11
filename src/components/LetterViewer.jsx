import React, { useMemo, useState } from 'react';
import { CheckCircle, ChevronLeft, ChevronRight, Download, Mail, Printer, RefreshCw, Trash2, X } from 'lucide-react';

const bureauLabel = (value) => ({
  equifax: 'Equifax',
  experian: 'Experian',
  transunion: 'TransUnion',
}[String(value || '').toLowerCase()] || value);

/**
 * Display-only letter viewer. Generation belongs to StartRoundPanel so simply
 * opening a saved letter can never create a new paid AI job or campaign row.
 */
export default function LetterViewer({ letters = [], account, client, roundNumber, targetType, onClose, onCancelRound, onCloseRound, onRegenerate, cancelling = false }) {
  const available = useMemo(() => letters.filter((letter) => letter?.html), [letters]);
  const [index, setIndex] = useState(0);
  const letter = available[index] || null;
  const html = letter?.html || '';
  const recipient = targetType === 'bureau'
    ? bureauLabel(letter?.targetBureau || letter?.target_bureau)
    : account?.furnisher;
  const title = `Round ${roundNumber || letter?.roundNumber || letter?.round_number || 1} · ${targetType === 'bureau' ? 'Credit Bureau Dispute' : 'Direct Furnisher Dispute'}`;

  const handlePrint = () => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const printWindow = window.open(url, '_blank', 'width=900,height=1100');
    if (!printWindow) {
      URL.revokeObjectURL(url);
      return;
    }
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      URL.revokeObjectURL(url);
    }, 500);
  };

  const handleDownload = () => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const safeClient = (client?.name || 'Client').replace(/[^a-z0-9]/gi, '_');
    const safeRecipient = (recipient || account?.furnisher || 'Dispute').replace(/[^a-z0-9]/gi, '_');
    anchor.href = url;
    anchor.download = `${safeClient}_Round_${roundNumber || 1}_${safeRecipient}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 no-print">
      <div className="bg-white rounded max-w-4xl w-full max-h-[92vh] flex flex-col">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Mail size={14} className="text-navy flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-ink truncate">{title}</div>
              <div className="text-[11px] text-ink-muted truncate">{recipient || account?.furnisher}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {available.length > 1 && (
              <div className="flex items-center gap-1 mr-1">
                <button onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0} className="p-1.5 border border-border rounded disabled:opacity-30" aria-label="Previous letter"><ChevronLeft size={13} /></button>
                <span className="text-[11px] text-ink-muted px-1">{index + 1}/{available.length}</span>
                <button onClick={() => setIndex((value) => Math.min(available.length - 1, value + 1))} disabled={index === available.length - 1} className="p-1.5 border border-border rounded disabled:opacity-30" aria-label="Next letter"><ChevronRight size={13} /></button>
              </div>
            )}
            <button onClick={handleDownload} className="text-[11px] uppercase tracking-wider px-3 py-1.5 rounded-sm border border-border text-ink-muted hover:bg-gray-50 flex items-center gap-1.5"><Download size={11} /> HTML</button>
            {onRegenerate && <button onClick={onRegenerate} disabled={cancelling} className="text-[11px] uppercase tracking-wider px-3 py-1.5 rounded-sm border border-amber-300 text-amber-800 hover:bg-amber-50 disabled:opacity-40 flex items-center gap-1.5"><RefreshCw size={11} className={cancelling ? 'animate-spin' : ''} />{cancelling ? 'Regenerating…' : 'Regenerate drafts'}</button>}
            {onCloseRound && <button onClick={onCloseRound} className="text-[11px] uppercase tracking-wider px-3 py-1.5 rounded-sm border border-green-200 text-green-700 hover:bg-green-50 flex items-center gap-1.5"><CheckCircle size={11} /> Close reviewed round</button>}
            {onCancelRound && <button onClick={onCancelRound} disabled={cancelling} className="text-[11px] uppercase tracking-wider px-3 py-1.5 rounded-sm border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-40 flex items-center gap-1.5"><Trash2 size={11} />{cancelling ? 'Cancelling…' : 'Cancel round'}</button>}
            <button onClick={handlePrint} className="text-[11px] uppercase tracking-wider px-3 py-1.5 rounded-sm bg-navy text-white hover:bg-navy-dark flex items-center gap-1.5"><Printer size={11} /> Print / Save as PDF</button>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded" aria-label="Close letter viewer"><X size={14} className="text-ink-muted" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-gray-100 p-6">
          {letter ? (
            <div className="bg-white shadow-md mx-auto max-w-3xl letter-print-area" style={{ minHeight: '11in' }}>
              <iframe srcDoc={html} sandbox="allow-same-origin" title={`${title} — ${recipient || ''}`} className="w-full" style={{ minHeight: '11in', border: 'none' }} />
            </div>
          ) : (
            <div className="max-w-md mx-auto bg-amber-50 border border-amber-200 rounded p-4 text-[13px] text-amber-900">No completed letter is available to display.</div>
          )}
        </div>
      </div>
    </div>
  );
}
