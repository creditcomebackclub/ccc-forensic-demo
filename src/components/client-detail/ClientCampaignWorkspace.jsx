import React from 'react';
import { Archive, FileText, ShieldCheck } from 'lucide-react';
import { isCccDisputePhase } from '../../utils/cccMailRules.js';

const T = {
  navy: '#1B2A4A',
  gold: '#C9A84C',
  border: '#E7EAF0',
  ink: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
};

function letterDate(letter) {
  return letter.mailedDate || letter.mailed_date || letter.savedAt || letter.saved_at || letter.date || null;
}

/**
 * Compatibility surface for the retired adaptive campaign workspace.
 * Historical letters remain readable, but all old build, regenerate, approve,
 * route, and mail actions have been removed. New work starts in the current
 * state-driven CCC dispute module at R1.
 */
export default function ClientCampaignWorkspace({ client, onOpenAudit, onOpenLetters }) {
  const letters = Array.isArray(client?.letters) ? client.letters : [];
  const historicalLetters = letters.filter((letter) => !isCccDisputePhase(letter.phase));

  return (
    <div className="space-y-4">
      <section className="bg-white rounded-2xl p-6" style={{ border: `1px solid ${T.border}` }}>
        <div className="w-11 h-11 rounded-full flex items-center justify-center mb-4" style={{ background: '#FBF7EA', color: T.gold }}>
          <ShieldCheck size={21} />
        </div>
        <div className="text-[10px] uppercase tracking-[0.14em] font-semibold" style={{ color: T.gold }}>Current CCC method</div>
        <h2 className="ccc-display text-[21px] font-semibold mt-1" style={{ color: T.navy }}>New dispute work starts at R1 in the state-driven campaign</h2>
        <p className="text-[12px] leading-relaxed mt-2 max-w-3xl" style={{ color: T.muted }}>
          The former adaptive letter builder is retired. Use the deterministic audit classification and approved Consent, Accuracy, Collection, Combo, Late Pay, or direct-verification template selected in the Dispute module.
        </p>
        <div className="flex flex-wrap gap-2 mt-5">
          {onOpenAudit && <button onClick={() => onOpenAudit(client)} className="px-4 py-2.5 rounded-lg text-[10px] uppercase tracking-wider font-semibold" style={{ background: T.navy, color: T.gold }}>Open current audit</button>}
          {onOpenLetters && <button onClick={onOpenLetters} className="px-4 py-2.5 rounded-lg text-[10px] uppercase tracking-wider font-semibold bg-white" style={{ color: T.navy, border: `1px solid ${T.border}` }}>Open letter history</button>}
        </div>
      </section>

      <section className="bg-white rounded-2xl overflow-hidden" style={{ border: `1px solid ${T.border}` }}>
        <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: `1px solid ${T.border}` }}>
          <Archive size={18} style={{ color: T.gold }} />
          <div>
            <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: T.navy }}>Historical campaign evidence</div>
            <div className="text-[10px] mt-0.5" style={{ color: T.muted }}>Read-only; no old letter can be generated, regenerated, approved, or mailed here.</div>
          </div>
        </div>
        {historicalLetters.length ? historicalLetters.map((letter) => (
          <div key={letter.id || `${letter.phase}-${letterDate(letter)}`} className="px-5 py-3 flex items-start gap-3" style={{ borderTop: `1px solid ${T.border}` }}>
            <FileText size={15} className="shrink-0 mt-0.5" style={{ color: T.faint }} />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium truncate" style={{ color: T.ink }}>{letter.furnisher || letter.targetBureau || 'Historical letter'}</div>
              <div className="text-[10px] mt-0.5" style={{ color: T.muted }}>{letter.phase || 'Legacy campaign'}{letterDate(letter) ? ` · ${String(letterDate(letter)).slice(0, 10)}` : ''}</div>
              {letter.summary && <p className="text-[10px] mt-1 line-clamp-2" style={{ color: T.faint }}>{letter.summary}</p>}
            </div>
            <span className="text-[9px] uppercase tracking-wider font-semibold px-2 py-1 rounded-full" style={{ background: '#F3F4F6', color: T.muted }}>Read only</span>
          </div>
        )) : (
          <div className="px-5 py-8 text-[11px] text-center" style={{ color: T.faint }}>No historical letters are attached to this client.</div>
        )}
      </section>
    </div>
  );
}
