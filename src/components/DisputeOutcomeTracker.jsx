import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Save, Search } from 'lucide-react';
import {
  DISPUTE_RESULT_OPTIONS,
  accountsForTrackedLetter,
  listTrackedDisputeLetters,
  saveDisputeLetterResult,
} from '../utils/disputeTracking.js';
import { FLOW_LABELS } from '../utils/disputeFlow.js';

const todayIso = () => new Date().toISOString().slice(0, 10);

function fmt(value) {
  if (!value) return '—';
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function resultForAccount(letter, account) {
  return (letter.dispute_letter_results || []).find((result) => result.account_key === account.accountKey) || null;
}

function OutcomeRow({ letter, account, onSaved }) {
  const existing = resultForAccount(letter, account);
  const [resultCode, setResultCode] = useState(existing?.result_code || '');
  const [resultDate, setResultDate] = useState(existing?.result_date || todayIso());
  const [notes, setNotes] = useState(existing?.notes || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await saveDisputeLetterResult({ letter, account, resultCode, resultDate, notes });
      onSaved(letter.id, result);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      setError(err.message || 'Could not save this result.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-[minmax(170px,1fr)_190px_130px_minmax(180px,1.2fr)_80px] items-start gap-2 border-t border-gray-100 px-4 py-3">
      <div>
        <div className="text-[11px] font-semibold text-navy">{account.furnisher || letter.furnisher}</div>
        <div className="mt-0.5 text-[9px] text-gray-400">{account.accountNumberMasked || account.accountId || 'Account number not stored'}</div>
      </div>
      <select value={resultCode} onChange={(event) => { setResultCode(event.target.value); setSaved(false); }} className="rounded-md border border-border bg-white px-2 py-1.5 text-[10px]">
        <option value="">Select outcome…</option>
        {DISPUTE_RESULT_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
      </select>
      <input type="date" value={resultDate} onChange={(event) => setResultDate(event.target.value)} className="rounded-md border border-border px-2 py-1.5 text-[10px]" />
      <input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="Result or proof note" className="rounded-md border border-border px-2 py-1.5 text-[10px]" />
      <button onClick={save} disabled={saving || !resultCode || !resultDate} className="flex items-center justify-center gap-1 rounded-md bg-navy px-2 py-1.5 text-[9px] font-bold uppercase tracking-wider text-gold disabled:opacity-40">
        {saving ? <Loader2 size={10} className="animate-spin" /> : saved ? <CheckCircle2 size={10} /> : <Save size={10} />}
        {saved ? 'Saved' : 'Save'}
      </button>
      {error && <div className="col-span-5 text-[9px] text-red-600">{error}</div>}
    </div>
  );
}

export default function DisputeOutcomeTracker() {
  const [letters, setLetters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [resultFilter, setResultFilter] = useState('all');

  useEffect(() => {
    listTrackedDisputeLetters()
      .then(setLetters)
      .catch((err) => setError(err.message || 'Could not load dispute results.'))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => letters.flatMap((letter) => accountsForTrackedLetter(letter).map((account) => ({
    letter,
    account,
    result: resultForAccount(letter, account),
  }))), [letters]);
  const filteredLetterIds = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return new Set(rows.filter(({ letter, account, result }) => {
      const matchesQuery = !needle || [letter.client_name, account.furnisher, letter.dispute_template_name, letter.dispute_flow_code]
        .some((value) => String(value || '').toLowerCase().includes(needle));
      const matchesResult = resultFilter === 'all'
        || (resultFilter === 'pending' ? !result : result?.result_code === resultFilter);
      return matchesQuery && matchesResult;
    }).map(({ letter }) => letter.id));
  }, [query, resultFilter, rows]);
  const visibleLetters = letters.filter((letter) => filteredLetterIds.has(letter.id));
  const wins = rows.filter((row) => row.result?.result_code === 'deleted').length;
  const nonDeletion = rows.filter((row) => row.result && row.result.result_code !== 'deleted').length;
  const pending = rows.filter((row) => !row.result).length;

  const onSaved = (letterId, savedResult) => {
    setLetters((current) => current.map((letter) => letter.id === letterId
      ? {
        ...letter,
        dispute_letter_results: [
          ...(letter.dispute_letter_results || []).filter((result) => result.account_key !== savedResult.account_key),
          savedResult,
        ],
      }
      : letter));
  };

  if (loading) return <div className="flex h-48 items-center justify-center gap-2 text-[11px] text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading template outcomes…</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-green-200 bg-green-50 p-4"><div className="text-[9px] font-bold uppercase tracking-wider text-green-700">Deletion wins</div><div className="mt-1 text-2xl font-bold text-green-800">{wins}</div></div>
        <div className="rounded-xl border border-gray-200 bg-white p-4"><div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">Non-deletion results</div><div className="mt-1 text-2xl font-bold text-navy">{nonDeletion}</div></div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="text-[9px] font-bold uppercase tracking-wider text-amber-700">Awaiting result</div><div className="mt-1 text-2xl font-bold text-amber-800">{pending}</div></div>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1"><Search size={13} className="absolute left-2.5 top-2.5 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search client, account, template, or flow" className="w-full rounded-md border border-border py-2 pl-8 pr-3 text-[11px]" /></div>
        <select value={resultFilter} onChange={(event) => setResultFilter(event.target.value)} className="rounded-md border border-border bg-white px-3 py-2 text-[11px]">
          <option value="all">All outcomes</option>
          <option value="pending">Awaiting result</option>
          {DISPUTE_RESULT_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
        </select>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[11px] text-red-700">{error}</div>}
      {!visibleLetters.length ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-[12px] text-gray-500">No mailed CCC template letters match this view.</div>
      ) : visibleLetters.map((letter) => (
        <div key={letter.id} className="overflow-hidden rounded-xl border border-border bg-white">
          <div className="flex items-start justify-between gap-4 bg-gray-50 px-4 py-3">
            <div><div className="text-[12px] font-semibold text-navy">{letter.client_name}</div><div className="mt-0.5 text-[10px] text-gray-500">{letter.dispute_template_name} · {FLOW_LABELS[letter.dispute_flow_code] || letter.dispute_flow_code} R{letter.dispute_round_number} · {letter.dispute_bureau_code}</div></div>
            <div className="text-right text-[9px] text-gray-400"><div>Mailed {fmt(letter.mailed_date)}</div><div>Version {letter.dispute_template_version_label || 'snapshot preserved'}</div></div>
          </div>
          {accountsForTrackedLetter(letter).map((account) => <OutcomeRow key={account.accountKey} letter={letter} account={account} onSaved={onSaved} />)}
        </div>
      ))}
    </div>
  );
}
