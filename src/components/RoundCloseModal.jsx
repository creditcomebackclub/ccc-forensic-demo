import React, { useState } from 'react';
import { AlertTriangle, CheckCircle, ChevronRight, Scale, X } from 'lucide-react';
import { closeRound } from '../utils/rounds.js';

const options = [
  { value: 'resolved', label: 'Resolved / Close Account', description: 'The reviewed results resolve this account’s dispute campaign.', icon: CheckCircle },
  { value: 'next_round', label: 'Prepare Another Round', description: 'Close this round and allow a new explicit target/evidence selection.', icon: ChevronRight },
  { value: 'escalate', label: 'Escalation Ready', description: 'Explicitly route the reviewed record to the escalation dashboard.', icon: Scale },
];

export default function RoundCloseModal({ roundId, roundNumber, onClose, onCompleted }) {
  const [disposition, setDisposition] = useState(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    if (!disposition) return setError('Choose the final disposition for this round.');
    setSaving(true);
    setError(null);
    try {
      const result = await closeRound(roundId, disposition, notes);
      onCompleted?.(result);
    } catch (submitError) {
      setError(submitError.message || 'Could not close the round.');
    } finally {
      setSaving(false);
    }
  }

  return <div className="fixed inset-0 bg-black/55 flex items-center justify-center z-[60] p-4"><div className="bg-white rounded w-full max-w-lg">
    <div className="px-5 py-4 border-b border-border flex items-center justify-between"><div><div className="text-[10px] uppercase tracking-wider text-gold-dark">Every sibling letter reviewed</div><div className="text-[15px] font-medium text-ink">Close Round {roundNumber}</div></div><button onClick={onClose} className="p-2 hover:bg-gray-100 rounded"><X size={15} /></button></div>
    <div className="p-5 space-y-3">
      {options.map(({ value, label, description, icon: Icon }) => <button key={value} onClick={() => setDisposition(value)} className={`w-full p-3 rounded border text-left flex gap-3 ${disposition === value ? 'border-gold bg-amber-50' : 'border-border'}`}><Icon size={17} className="mt-0.5 text-navy" /><span><span className="block text-[12px] font-medium text-ink">{label}</span><span className="block text-[10px] text-ink-muted mt-0.5">{description}</span></span></button>)}
      <label className="block"><span className="block text-[10px] uppercase tracking-wider text-ink-muted mb-1">Internal notes (optional)</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={2000} className="w-full border border-border rounded p-2 text-[12px]" /></label>
      <div className="flex gap-2 text-[10px] text-amber-800 bg-amber-50 border border-amber-200 p-2 rounded"><AlertTriangle size={13} className="flex-shrink-0" />This disposition controls whether another round may be created. It does not change the stored forensic analysis.</div>
      {error && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 p-2 rounded">{error}</div>}
    </div>
    <div className="px-5 py-4 border-t border-border flex justify-end gap-2"><button onClick={onClose} className="px-4 py-2 text-[11px] uppercase tracking-wider border border-border rounded">Not Yet</button><button onClick={submit} disabled={saving || !disposition} className="px-4 py-2 text-[11px] uppercase tracking-wider bg-navy text-gold rounded disabled:opacity-40">{saving ? 'Closing…' : 'Close Round'}</button></div>
  </div></div>;
}
