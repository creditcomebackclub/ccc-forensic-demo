import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, FileText, X } from 'lucide-react';
import { supabase } from '../utils/supabase.js';
import { listResponseEvidence } from '../utils/responseEvidence.js';

const DISPOSITIONS = [
  ['corrected_deleted', 'Corrected / deleted'], ['verified', 'Verified — confirm on next report'],
  ['partial', 'Partially addressed'], ['needs_documents', 'Needs documents'],
  ['no_response', 'No response'], ['follow_up_eligible', 'Follow-up eligible'], ['resolved', 'Resolved'],
];

const defaultAction = (disposition) => {
  if (['corrected_deleted', 'resolved'].includes(disposition)) return 'resolved';
  if (disposition === 'needs_documents') return 'needs_documents';
  return 'next_round';
};

export default function PacketAccountResponseReview({ letter, evidence: evidenceProp, onClose, onSaved }) {
  const [evidence, setEvidence] = useState(evidenceProp || null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      let resolvedEvidence = evidenceProp || evidence;
      if (!resolvedEvidence?.id) {
        const records = await listResponseEvidence({ letterId: letter.id });
        resolvedEvidence = records.find((record) => record.analysis_status === 'analyzed') || records[0] || null;
      }
      if (!resolvedEvidence?.id) throw new Error('Analyze the packet response before reviewing its accounts.');
      setEvidence(resolvedEvidence);
      const { data: assessments, error: assessmentError } = await supabase
        .from('response_evidence_account_assessment')
        .select('*,letter_account_coverage!inner(coverage_order,campaign_item_id,letter_id)')
        .eq('response_evidence_id', resolvedEvidence.id)
        .eq('letter_account_coverage.letter_id', letter.id)
        .order('created_at');
      if (assessmentError) throw assessmentError;
      const itemIds = (assessments || []).map((row) => row.letter_account_coverage?.campaign_item_id).filter(Boolean);
      const { data: items, error: itemError } = itemIds.length
        ? await supabase.from('campaign_items').select('id,label,snapshot').in('id', itemIds)
        : { data: [], error: null };
      if (itemError) throw itemError;
      const itemById = new Map((items || []).map((item) => [item.id, item]));
      setRows((assessments || []).sort((a, b) => a.letter_account_coverage.coverage_order - b.letter_account_coverage.coverage_order).map((row) => {
        const item = itemById.get(row.letter_account_coverage.campaign_item_id);
        return {
          ...row,
          label: item?.label || `Account ${row.letter_account_coverage.coverage_order}`,
          maskedAccount: item?.snapshot?.accountNumberMasked || '',
          disposition: row.disposition || 'follow_up_eligible',
          next_action: row.next_action || defaultAction(row.disposition),
          staff_notes: row.staff_notes || '',
          client_document_request: row.client_document_request || '',
        };
      }));
    } catch (e) { setError(e.message || 'Could not load packet account assessments.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [letter.id, evidenceProp?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const reviewedCount = useMemo(() => rows.filter((row) => row.review_status === 'reviewed').length, [rows]);
  const patchRow = (id, patch) => setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  const save = async (row) => {
    setSavingId(row.id); setError(null);
    try {
      const { error: reviewError } = await supabase.rpc('review_packet_account_assessment', {
        p_assessment_id: row.id, p_disposition: row.disposition,
        p_next_action: row.next_action, p_notes: row.staff_notes.trim() || null,
        p_document_request: row.next_action === 'needs_documents' ? row.client_document_request.trim() || null : null,
      });
      if (reviewError) throw reviewError;
      patchRow(row.id, { review_status: 'reviewed' });
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        await fetch('/.netlify/functions/packet-review-milestone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ letterId: letter.id }),
        });
      }
      onSaved?.();
    } catch (e) { setError(e.message || 'Could not save this account review.'); }
    finally { setSavingId(null); }
  };

  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white">
      <div className="flex items-start justify-between gap-4 border-b border-border bg-navy px-6 py-4"><div><div className="text-[14px] font-medium text-white ccc-display">Packet Account Response Review</div><div className="mt-0.5 text-[11px] uppercase tracking-wider text-gold">{letter.furnisher} · {reviewedCount} of {rows.length} reviewed</div></div><button onClick={onClose} className="text-gray-400 hover:text-white"><X size={18} /></button></div>
      <div className="flex-1 overflow-auto p-5">
        <div className="mb-4 flex gap-2 rounded border border-blue-100 bg-blue-50 p-3 text-[12px] text-blue-950"><FileText size={15} className="mt-0.5 shrink-0" /><span>The response was extracted once. Each card compares that evidence only with the demands and findings for its covered account. Save every account independently.</span></div>
        {loading && <div className="py-10 text-center text-[12px] text-ink-muted">Loading account assessments…</div>}
        {!loading && <div className="space-y-3">{rows.map((row) => <div key={row.id} className="rounded-lg border border-border p-4">
          <div className="flex items-start justify-between gap-3"><div><div className="text-[13px] font-medium text-ink">{row.label} {row.maskedAccount ? `· ${row.maskedAccount}` : ''}</div><div className="mt-0.5 text-[10px] uppercase tracking-wider text-ink-faint">{row.analysis?.classification || 'Review ready'}{row.cited_pages?.length ? ` · cited pages ${row.cited_pages.join(', ')}` : ''}</div></div>{row.review_status === 'reviewed' && <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700"><CheckCircle size={13} /> Reviewed</span>}</div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">{row.analysis?.summary || 'The structured account result is ready for staff disposition.'}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2"><select value={row.disposition} disabled={row.review_status === 'reviewed'} onChange={(event) => { const disposition = event.target.value; patchRow(row.id, { disposition, next_action: defaultAction(disposition) }); }} className="rounded border border-border px-3 py-2 text-[11px] disabled:bg-gray-50">{DISPOSITIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select value={row.next_action} disabled={row.review_status === 'reviewed' || ['corrected_deleted', 'resolved', 'needs_documents'].includes(row.disposition)} onChange={(event) => patchRow(row.id, { next_action: event.target.value })} className="rounded border border-border px-3 py-2 text-[11px] disabled:bg-gray-50"><option value="resolved">Resolved</option><option value="next_round">Next round</option><option value="needs_documents">Request documents</option><option value="escalate">Escalate</option></select></div>
          <textarea value={row.staff_notes} disabled={row.review_status === 'reviewed'} onChange={(event) => patchRow(row.id, { staff_notes: event.target.value })} rows={2} maxLength={2000} placeholder="Staff-only notes" className="mt-2 w-full rounded border border-border p-2 text-[11px] disabled:bg-gray-50" />
          {row.next_action === 'needs_documents' && <textarea value={row.client_document_request} disabled={row.review_status === 'reviewed'} onChange={(event) => patchRow(row.id, { client_document_request: event.target.value })} rows={2} maxLength={1000} placeholder="Client-facing document request (required)" className="mt-2 w-full rounded border border-amber-300 bg-amber-50 p-2 text-[11px] disabled:bg-gray-50" />}
          {row.review_status !== 'reviewed' && <div className="mt-2 flex justify-end"><button onClick={() => save(row)} disabled={savingId === row.id || (row.next_action === 'needs_documents' && !row.client_document_request.trim())} className="rounded bg-navy px-3 py-2 text-[10px] uppercase tracking-wider text-gold disabled:opacity-50">{savingId === row.id ? 'Saving…' : 'Save account result'}</button></div>}
        </div>)}</div>}
        {error && <div className="mt-4 flex gap-2 rounded border border-red-200 bg-red-50 p-3 text-[12px] text-red-700"><AlertCircle size={14} />{error}</div>}
      </div>
      <div className="flex justify-between border-t border-border px-6 py-4"><button onClick={onClose} className="text-[11px] uppercase tracking-wider text-ink-muted">Close</button><span className="text-[10px] text-ink-faint">Document requests become client-visible only after this staff review.</span></div>
    </div>
  </div>;
}
