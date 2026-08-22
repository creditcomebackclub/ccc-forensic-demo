import React from 'react';
import { Archive, X } from 'lucide-react';

/**
 * Historical compatibility surface for response records created by the
 * retired phase-based workflow. It deliberately cannot draft, save, or mail
 * a new letter. Current work belongs in the CCC Campaign Studio, where the
 * reviewed account route and current letter track remain authoritative.
 */
export default function BureauFollowUpPanel({ letter, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className="bg-white rounded-lg max-w-lg w-full p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-[16px] font-semibold text-ink">Historical workflow retired</div>
            <div className="text-[12px] text-ink-muted mt-0.5">
              {letter?.furnisher || 'Prior recipient'}
              {letter?.phase ? ` · ${letter.phase}` : ''}
            </div>
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-3 text-[12px] text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-3 py-3">
          <Archive size={16} className="shrink-0 mt-0.5" />
          <div className="space-y-2 leading-relaxed">
            <p>
              This record came from CCC&apos;s previous phase-based process. It remains available as
              historical evidence, but this screen no longer creates or sends follow-up letters.
            </p>
            <p className="font-medium text-ink">
              Open the client&apos;s current campaign, confirm the reviewed account route, and continue
              from the Campaign Studio.
            </p>
          </div>
        </div>

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
