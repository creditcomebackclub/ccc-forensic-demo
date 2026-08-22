import React, { useEffect, useState } from 'react';
import { Archive, FileText, Loader2, X } from 'lucide-react';
import { supabase } from '../utils/supabase.js';

/**
 * Read-only compatibility panel for account rounds created before the CCC
 * Consent / Accuracy / Collection cutover. Creation, regeneration, target
 * switching, and reopening were removed; current work starts at R1 in the
 * state-driven dispute campaign.
 */
export default function StartRoundPanel({ account, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [letters, setLetters] = useState([]);

  useEffect(() => {
    let active = true;
    async function loadHistory() {
      setLoading(true);
      setError(null);
      try {
        if (!account?.clientAccountId) throw new Error('This account is not linked to a stable account identity.');
        const { data, error: queryError } = await supabase.from('letters')
          .select('id,phase,summary,target_type,target_bureau,round_number,mailed_date,lob_id,tracking_status,saved_at')
          .eq('client_account_id', account.clientAccountId)
          .not('round_id', 'is', null)
          .order('round_number', { ascending: false })
          .order('saved_at', { ascending: false });
        if (queryError) throw queryError;
        if (active) setLetters(data || []);
      } catch (loadError) {
        if (active) setError(loadError.message || 'Could not load the historical round record.');
      } finally {
        if (active) setLoading(false);
      }
    }
    loadHistory();
    return () => { active = false; };
  }, [account?.clientAccountId]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 no-print">
      <div className="bg-white rounded max-w-2xl w-full max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-gold-dark">Historical round archive</div>
            <div className="text-[15px] font-medium text-ink mt-0.5">{account?.furnisher || 'Account history'}</div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded" aria-label="Close historical rounds"><X size={15} /></button>
        </div>

        <div className="p-5 overflow-auto space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded p-4 text-[12px] text-blue-900 flex gap-3">
            <Archive size={17} className="shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">This former round builder is read-only.</div>
              <div className="mt-1 leading-relaxed">Saved evidence remains visible below. New work for every current client begins at R1 in the state-driven CCC dispute campaign.</div>
            </div>
          </div>

          {loading && <div className="py-10 text-center text-[12px] text-ink-muted"><Loader2 size={22} className="animate-spin mx-auto mb-3 text-gold" />Loading historical letters…</div>}
          {error && <div className="bg-red-50 border border-red-200 rounded p-3 text-[12px] text-red-800">{error}</div>}
          {!loading && !error && (letters.length ? (
            <div className="border border-border rounded overflow-hidden">
              {letters.map((letter) => (
                <div key={letter.id} className="p-4 flex items-start gap-3 border-t first:border-t-0 border-border">
                  <FileText size={15} className="shrink-0 mt-0.5 text-ink-faint" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium text-ink">Round {letter.round_number || '—'} · {letter.phase || letter.target_type || 'Historical letter'}</div>
                    <div className="text-[10px] text-ink-muted mt-0.5">{letter.mailed_date ? `Mailed ${letter.mailed_date}` : 'Not mailed'}{letter.tracking_status ? ` · ${letter.tracking_status}` : ''}{letter.lob_id ? ` · Lob ${letter.lob_id}` : ''}</div>
                    {letter.summary && <p className="text-[10px] text-ink-faint mt-1 leading-relaxed">{letter.summary}</p>}
                  </div>
                  <span className="text-[9px] uppercase tracking-wider font-semibold px-2 py-1 rounded bg-gray-100 text-ink-muted">Read only</span>
                </div>
              ))}
            </div>
          ) : <div className="py-8 text-center text-[11px] text-ink-faint">No historical round letters were found for this account.</div>)}
        </div>

        <div className="px-5 py-4 border-t border-border flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-[11px] uppercase tracking-wider rounded bg-navy text-gold">Close</button>
        </div>
      </div>
    </div>
  );
}
