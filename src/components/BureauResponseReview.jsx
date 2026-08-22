import React from 'react';
import { Archive, FileText, X } from 'lucide-react';
import PacketAccountResponseReview from './PacketAccountResponseReview.jsx';
import { isCccDisputePhase } from '../utils/cccMailRules.js';

/**
 * Version-one bureau response records predate the current account-bound CCC
 * packet review. They remain visible as evidence, but cannot write a new
 * disposition, select a retired follow-up action, or open letter generation.
 */
function HistoricalBureauResponseReview({ letter, evidence, onClose }) {
  const classification = evidence?.analysis?.classification || letter?.bureauResponseClassification || null;
  const summary = evidence?.analysis?.summary || letter?.bureauResponseSummary || null;
  const currentPhaseWithOldPacket = isCccDisputePhase(letter?.phase);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50"
      onClick={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
    >
      <div className="bg-white rounded-lg max-w-xl w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="text-[16px] font-semibold text-ink">
              {currentPhaseWithOldPacket ? 'Prior packet review unavailable' : 'Historical bureau response'}
            </div>
            <div className="text-[12px] text-ink-muted mt-0.5">
              {letter?.furnisher || 'Prior bureau'}{letter?.phase ? ` · ${letter.phase}` : ''}
            </div>
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-[12px] leading-relaxed text-slate-700">
          <Archive size={16} className="shrink-0 mt-0.5" />
          <div>
            <p>
              This response is linked to a packet created before CCC&apos;s current account-bound review workflow.
              The record remains readable, but this screen cannot change its disposition or create correspondence.
            </p>
            <p className="font-medium text-ink mt-2">
              Continue current work from the client&apos;s CCC campaign and its reviewed template track.
            </p>
          </div>
        </div>

        {(classification || summary) && (
          <div className="mt-4 rounded-md border border-border bg-white p-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink-faint font-medium">
              <FileText size={13} /> Stored analysis
            </div>
            {classification && <div className="mt-2 text-[12px] font-medium text-ink">{classification}</div>}
            {summary && <div className="mt-1 text-[12px] text-ink-muted">{summary}</div>}
          </div>
        )}

        <div className="flex justify-end mt-5">
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] uppercase tracking-wider px-3 py-2 rounded-md text-white"
            style={{ backgroundColor: '#1B2A4A' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BureauResponseReview(props) {
  return Number(props.letter?.packetVersion || props.letter?.packet_version || 1) === 2
    ? <PacketAccountResponseReview letter={props.letter} evidence={props.evidence} onClose={props.onClose} onSaved={props.onSaved} />
    : <HistoricalBureauResponseReview letter={props.letter} evidence={props.evidence} onClose={props.onClose} />;
}
