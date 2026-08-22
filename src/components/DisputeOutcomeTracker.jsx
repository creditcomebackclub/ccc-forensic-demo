import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Save, Search } from 'lucide-react';
import {
  NEXT_ACTION_LABELS,
  RESPONSE_STATUS_OPTIONS,
  TARGET_STATUS_OPTIONS,
  accountsForTrackedLetter,
  classifyR7StatementMatch,
  consumerStatementEvidenceForLetter,
  deriveCourseOutcome,
  eligibleAchievedTargets,
  evidenceAccountPresentForSnapshot,
  evidenceCommentForSnapshot,
  hasCourseTrackSnapshots,
  isPostMailEvidenceAudit,
  isR7ConsumerStatementStep,
  letterIsWin,
  listTrackedDisputeLetters,
  saveDisputeOutcomeBatch,
} from '../utils/disputeTracking.js';
import { FLOW_LABELS } from '../utils/disputeFlow.js';

function fmt(value) {
  if (!value) return '—';
  const raw = String(value);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00`) : new Date(raw);
  return Number.isNaN(parsed.getTime())
    ? raw
    : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function resultForAccount(letter, account) {
  return (letter.dispute_letter_results || []).find((result) => (
    result.track_id === account.trackSnapshot?.trackId
    || result.client_account_id === account.clientAccountId
    || result.account_key === account.accountKey
  )) || null;
}

function auditLabel(audit) {
  return `${fmt(audit.report_date)} report · saved ${fmt(audit.saved_at)}`;
}

function defaultDraft(account) {
  return {
    trackId: account.trackSnapshot.trackId,
    expectedRevision: account.trackSnapshot.revision,
    targetStatus: '',
    responseStatus: '',
    achievedTarget: 'none',
    notes: '',
  };
}

function oppositeSideFullyAchieved(snapshot, accounts, drafts) {
  if (snapshot.logicalFlow !== 'combo') return false;
  const opposite = snapshot.nativeFlow === 'accuracy' ? 'collection'
    : snapshot.nativeFlow === 'collection' ? 'accuracy' : null;
  if (!opposite) return false;
  const oppositeAccounts = accounts.filter((account) => account.trackSnapshot?.nativeFlow === opposite);
  return oppositeAccounts.length > 0
    && oppositeAccounts.every((account) => drafts[account.trackSnapshot.trackId]?.targetStatus === 'achieved');
}

function completedResultBadge(result) {
  const status = result?.target_status;
  if (status === 'achieved') return 'bg-green-100 text-green-700';
  if (status === 'partial') return 'bg-amber-100 text-amber-700';
  if (status === 'remains') return 'bg-gray-100 text-gray-700';
  return 'bg-red-50 text-red-700';
}

function CompletedOutcomeRow({ letter, account }) {
  const result = resultForAccount(letter, account);
  if (!result?.target_status) {
    const legacy = result?.result_code || 'not recorded';
    return (
      <div className="border-t border-gray-100 px-4 py-3 text-[10px] text-gray-500">
        <span className="font-semibold text-navy">{account.furnisher || letter.furnisher}</span>
        <span className="ml-2">Historical result: {legacy}. This row predates account-state outcome tracking.</span>
      </div>
    );
  }
  return (
    <div className="grid gap-3 border-t border-gray-100 px-4 py-3 lg:grid-cols-[minmax(170px,1fr)_130px_150px_minmax(180px,1fr)]">
      <div>
        <div className="text-[11px] font-semibold text-navy">{account.furnisher || result.furnisher || letter.furnisher}</div>
        <div className="mt-0.5 text-[9px] text-gray-400">{account.accountNumberMasked || 'Canonical account linked'}</div>
      </div>
      <div><span className={`rounded px-2 py-1 text-[8px] font-bold uppercase tracking-wider ${completedResultBadge(result)}`}>{result.target_status}</span><div className="mt-2 text-[9px] text-gray-500">Response: {result.response_status}</div></div>
      <div className="text-[9px] leading-relaxed text-gray-600"><div className="font-bold uppercase tracking-wider text-gray-400">Achieved target</div><div className="mt-1">{result.achieved_target === 'none' ? 'None' : result.achieved_target?.replaceAll('_', ' ')}</div></div>
      <div className="text-[9px] leading-relaxed text-gray-600"><div className="font-bold uppercase tracking-wider text-gray-400">Account-specific next action</div><div className="mt-1 font-semibold text-navy">{NEXT_ACTION_LABELS[result.next_action] || result.next_action}</div>{result.notes && <div className="mt-1 text-gray-500">{result.notes}</div>}</div>
      {result.r7_statement_match_status && (
        <div className="lg:col-span-4 rounded-md border border-blue-100 bg-blue-50/50 p-2 text-[9px] text-blue-900">
          R7 server comparison: <span className="font-bold uppercase">{result.r7_statement_match_status}</span>
          <span className="ml-2">Current report comment: {result.current_report_comment || 'No comment reported'}</span>
        </div>
      )}
    </div>
  );
}

function OutcomeBatchEditor({ letter, onRecorded }) {
  const accounts = useMemo(() => accountsForTrackedLetter(letter), [letter]);
  const eligibleAudits = useMemo(
    () => (letter.evidenceAudits || []).filter((audit) => isPostMailEvidenceAudit(letter, audit)),
    [letter],
  );
  const [evidenceAuditId, setEvidenceAuditId] = useState('');
  const [drafts, setDrafts] = useState(() => Object.fromEntries(accounts.map((account) => [account.trackSnapshot.trackId, defaultDraft(account)])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const selectedAudit = eligibleAudits.find((audit) => audit.id === evidenceAuditId) || null;
  const mailedStatement = consumerStatementEvidenceForLetter(letter)?.text || '';

  useEffect(() => {
    if (!selectedAudit) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const account of accounts) {
        const snapshot = account.trackSnapshot;
        if (!isR7ConsumerStatementStep(snapshot)) continue;
        if (!evidenceAccountPresentForSnapshot(selectedAudit, snapshot)) continue;
        const match = classifyR7StatementMatch(mailedStatement, evidenceCommentForSnapshot(selectedAudit, snapshot));
        const automatic = match === 'full'
          ? { targetStatus: 'achieved', achievedTarget: 'consumer_statement_full_match' }
          : match === 'partial'
            ? { targetStatus: 'partial', achievedTarget: 'none' }
            : { targetStatus: 'remains', achievedTarget: 'none' };
        next[snapshot.trackId] = { ...next[snapshot.trackId], ...automatic };
      }
      return next;
    });
  }, [accounts, mailedStatement, selectedAudit]);

  const update = (trackId, patch) => setDrafts((current) => ({
    ...current,
    [trackId]: { ...current[trackId], ...patch },
  }));

  const complete = Boolean(selectedAudit) && accounts.every((account) => {
    const draft = drafts[account.trackSnapshot.trackId];
    return draft?.targetStatus && draft?.responseStatus
      && (draft.targetStatus !== 'achieved' || draft.achievedTarget !== 'none');
  });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await saveDisputeOutcomeBatch({
        letter,
        evidenceAuditId,
        outcomes: accounts.map((account) => drafts[account.trackSnapshot.trackId]),
      });
      onRecorded(letter.id, response);
    } catch (err) {
      setError(err.message || 'The reviewed letter outcome could not be recorded.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t border-gray-100">
      <div className="bg-[#FAFBFC] px-4 py-3">
        <label className="text-[8px] font-bold uppercase tracking-wider text-gray-500">Exact post-mail report update</label>
        <select value={evidenceAuditId} onChange={(event) => setEvidenceAuditId(event.target.value)} className="mt-1.5 w-full rounded-md border border-border bg-white px-3 py-2 text-[10px]">
          <option value="">Select the saved report update used for this review…</option>
          {eligibleAudits.map((audit) => <option key={`${audit.user_id}:${audit.id}`} value={audit.id}>{auditLabel(audit)}</option>)}
        </select>
        {!eligibleAudits.length && <div className="mt-2 flex items-center gap-1.5 text-[9px] text-amber-700"><AlertTriangle size={11} /> Save a fresh 3B audit after this letter was mailed before scoring it.</div>}
      </div>

      {accounts.map((account) => {
        const snapshot = account.trackSnapshot;
        const draft = drafts[snapshot.trackId] || defaultDraft(account);
        const r7 = isR7ConsumerStatementStep(snapshot);
        const accountPresent = selectedAudit ? evidenceAccountPresentForSnapshot(selectedAudit, snapshot) : false;
        const currentComment = selectedAudit ? evidenceCommentForSnapshot(selectedAudit, snapshot) : '';
        const r7Match = r7 && selectedAudit && accountPresent ? classifyR7StatementMatch(mailedStatement, currentComment) : null;
        const serverPreview = deriveCourseOutcome({
          snapshot,
          targetStatus: draft.targetStatus,
          achievedTarget: draft.achievedTarget,
          r7Match,
          oppositeSideFullyAchieved: oppositeSideFullyAchieved(snapshot, accounts, drafts),
        });
        const r7Locked = Boolean(r7 && selectedAudit && accountPresent);
        return (
          <div key={snapshot.trackId} className="border-t border-gray-100 px-4 py-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div><div className="text-[11px] font-semibold text-navy">{account.furnisher || letter.furnisher}</div><div className="mt-0.5 text-[9px] text-gray-400">{account.accountNumberMasked || snapshot.clientAccountId} · {snapshot.nativeFlow.replaceAll('_', ' ')} account</div></div>
              <div className="rounded bg-gray-100 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-gray-600">Account state rev. {snapshot.revision}</div>
            </div>
            {selectedAudit && (
              <div className={`mb-3 rounded-md border p-2 text-[9px] ${accountPresent ? 'border-blue-100 bg-blue-50/50 text-blue-900' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                {accountPresent ? `Canonical account found on ${snapshot.bureauCode || 'the Direct report update'}.` : `Canonical account is absent from ${snapshot.bureauCode || 'this report update'}. Select deletion only if the reviewed report proves removal; otherwise choose indeterminate.`}
                {r7 && <div className="mt-1">Current report comment: <span className="font-semibold">{currentComment || 'No exact bureau comment reported'}</span>{r7Match && <span className="ml-2 rounded bg-white px-1.5 py-0.5 font-bold uppercase">{r7Match}</span>}</div>}
              </div>
            )}
            <div className="grid gap-2 lg:grid-cols-3">
              <div><label className="text-[8px] font-bold uppercase tracking-wider text-gray-400">Target status</label><select disabled={r7Locked} value={draft.targetStatus} onChange={(event) => update(snapshot.trackId, { targetStatus: event.target.value, achievedTarget: event.target.value === 'achieved' ? draft.achievedTarget : 'none' })} className="mt-1 w-full rounded-md border border-border bg-white px-2 py-2 text-[10px] disabled:bg-gray-50"><option value="">Select…</option>{TARGET_STATUS_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></div>
              <div><label className="text-[8px] font-bold uppercase tracking-wider text-gray-400">Bureau / collector response</label><select value={draft.responseStatus} onChange={(event) => update(snapshot.trackId, { responseStatus: event.target.value })} className="mt-1 w-full rounded-md border border-border bg-white px-2 py-2 text-[10px]"><option value="">Select…</option>{RESPONSE_STATUS_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></div>
              <div><label className="text-[8px] font-bold uppercase tracking-wider text-gray-400">Target actually achieved</label><select disabled={draft.targetStatus !== 'achieved' || r7Locked} value={draft.achievedTarget} onChange={(event) => update(snapshot.trackId, { achievedTarget: event.target.value })} className="mt-1 w-full rounded-md border border-border bg-white px-2 py-2 text-[10px] disabled:bg-gray-50">{eligibleAchievedTargets(snapshot).map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></div>
            </div>
            <div className="mt-2 grid gap-2 lg:grid-cols-[1fr_280px]">
              <input value={draft.notes} onChange={(event) => update(snapshot.trackId, { notes: event.target.value })} maxLength={2000} placeholder="Evidence note for this account (optional)" className="rounded-md border border-border px-2 py-2 text-[10px]" />
              <div className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-[9px]"><span className="font-bold uppercase tracking-wider text-gray-400">Next action</span><div className="mt-0.5 font-semibold text-navy">{draft.targetStatus ? NEXT_ACTION_LABELS[serverPreview.nextAction] : 'Complete this account review'}</div></div>
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-4 py-3">
        <div className="text-[9px] leading-relaxed text-gray-500">Save is atomic: every covered account is recorded together. The letter is a win if any one account achieved its target; unresolved accounts continue independently.</div>
        <button onClick={save} disabled={saving || !complete} className="flex items-center justify-center gap-1.5 rounded-md bg-navy px-4 py-2 text-[9px] font-bold uppercase tracking-wider text-gold disabled:opacity-40">{saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Record entire letter</button>
        {error && <div className="w-full rounded-md border border-red-200 bg-red-50 p-2 text-[9px] text-red-700">{error}</div>}
      </div>
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

  const reviewed = letters.filter((letter) => letter.outcomeBatch);
  const wins = reviewed.filter((letter) => letter.outcomeBatch.is_letter_win).length;
  const reviewedNonWins = reviewed.length - wins;
  const pending = letters.filter((letter) => hasCourseTrackSnapshots(letter) && !letter.outcomeBatch).length;
  const visibleLetters = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return letters.filter((letter) => {
      const accounts = accountsForTrackedLetter(letter);
      const matchesQuery = !needle || [letter.client_name, letter.dispute_template_name, letter.dispute_flow_code, ...accounts.map((account) => account.furnisher)]
        .some((value) => String(value || '').toLowerCase().includes(needle));
      const matchesResult = resultFilter === 'all'
        || (resultFilter === 'pending' && hasCourseTrackSnapshots(letter) && !letter.outcomeBatch)
        || (resultFilter === 'wins' && letter.outcomeBatch?.is_letter_win)
        || (resultFilter === 'nonwins' && letter.outcomeBatch && !letter.outcomeBatch.is_letter_win)
        || (resultFilter === 'historical' && !hasCourseTrackSnapshots(letter));
      return matchesQuery && matchesResult;
    });
  }, [letters, query, resultFilter]);

  const onRecorded = (letterId, response) => {
    setLetters((current) => current.map((letter) => letter.id === letterId
      ? {
        ...letter,
        outcomeBatch: response.batch,
        dispute_letter_results: response.results || [],
      }
      : letter));
  };

  if (loading) return <div className="flex h-48 items-center justify-center gap-2 text-[11px] text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading course outcomes…</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-green-200 bg-green-50 p-4"><div className="text-[9px] font-bold uppercase tracking-wider text-green-700">Letter wins</div><div className="mt-1 text-2xl font-bold text-green-800">{wins}</div><div className="mt-1 text-[8px] text-green-700">At least one covered account achieved</div></div>
        <div className="rounded-xl border border-gray-200 bg-white p-4"><div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">Reviewed non-wins</div><div className="mt-1 text-2xl font-bold text-navy">{reviewedNonWins}</div><div className="mt-1 text-[8px] text-gray-400">Every account continues or holds</div></div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="text-[9px] font-bold uppercase tracking-wider text-amber-700">Awaiting review</div><div className="mt-1 text-2xl font-bold text-amber-800">{pending}</div><div className="mt-1 text-[8px] text-amber-700">Requires a post-mail saved report</div></div>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1"><Search size={13} className="absolute left-2.5 top-2.5 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search client, account, template, or flow" className="w-full rounded-md border border-border py-2 pl-8 pr-3 text-[11px]" /></div>
        <select value={resultFilter} onChange={(event) => setResultFilter(event.target.value)} className="rounded-md border border-border bg-white px-3 py-2 text-[11px]"><option value="all">All letters</option><option value="pending">Awaiting review</option><option value="wins">Letter wins</option><option value="nonwins">Reviewed non-wins</option><option value="historical">Historical rows</option></select>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[11px] text-red-700">{error}</div>}
      {!visibleLetters.length ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-[12px] text-gray-500">No mailed CCC template letters match this view.</div>
      ) : visibleLetters.map((letter) => {
        const statementEvidence = consumerStatementEvidenceForLetter(letter);
        const courseTracked = hasCourseTrackSnapshots(letter);
        const completedResults = letter.dispute_letter_results || [];
        return (
          <div key={`${letter.user_id}:${letter.id}`} className="overflow-hidden rounded-xl border border-border bg-white">
            <div className="flex items-start justify-between gap-4 bg-gray-50 px-4 py-3">
              <div><div className="flex items-center gap-2 text-[12px] font-semibold text-navy">{letter.client_name}{letter.outcomeBatch?.is_letter_win && <span className="rounded bg-green-100 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-green-700">Letter win</span>}</div><div className="mt-0.5 text-[10px] text-gray-500">{letter.dispute_template_name} · {FLOW_LABELS[letter.dispute_flow_code] || letter.dispute_flow_code} R{letter.dispute_round_number} · {letter.dispute_bureau_code || 'Direct'}</div></div>
              <div className="text-right text-[9px] text-gray-400"><div>Mailed {fmt(letter.mailed_date)}</div><div>Version {letter.dispute_template_version_label || 'snapshot preserved'}</div>{letter.outcomeBatch && <div className="mt-1 font-semibold text-green-700">Reviewed {fmt(letter.outcomeBatch.reviewed_at)}</div>}</div>
            </div>
            {statementEvidence && (
              <div className="border-t border-gray-100 bg-blue-50/50 px-4 py-3"><div className="flex items-center justify-between gap-3"><div className="text-[9px] font-bold uppercase tracking-wider text-blue-800">Consumer Statement used for this round</div><div className={`rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider ${statementEvidence.source === 'mailed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{statementEvidence.source === 'mailed' ? 'Captured from mailed packet' : 'Draft snapshot only'}</div></div><div className="mt-1.5 whitespace-pre-wrap text-[10px] leading-relaxed text-gray-700">{statementEvidence.text}</div>{statementEvidence.source === 'draft' && <div className="mt-1 text-[8px] text-amber-700">Exact mail-time evidence is unavailable for this historical letter. Do not use this draft alone to score report comments.</div>}</div>
            )}
            {!courseTracked ? (
              <div className="border-t border-amber-100 bg-amber-50 p-3 text-[9px] text-amber-800"><AlertTriangle size={11} className="mr-1 inline" /> Historical letter: the exact CCC account/track snapshot is missing, so it cannot move the new course state. Existing results remain readable below.{accountsForTrackedLetter(letter).map((account) => <CompletedOutcomeRow key={account.accountKey} letter={letter} account={account} />)}</div>
            ) : letter.outcomeBatch ? (
              <>{accountsForTrackedLetter(letter).map((account) => <CompletedOutcomeRow key={account.accountKey} letter={letter} account={account} />)}{letterIsWin(completedResults) && <div className="flex items-center gap-1.5 border-t border-green-100 bg-green-50 px-4 py-2 text-[9px] font-semibold text-green-800"><CheckCircle2 size={11} /> This letter is recorded as a win. Only the accounts marked achieved closed; every remaining account followed its own next action.</div>}</>
            ) : <OutcomeBatchEditor letter={letter} onRecorded={onRecorded} />}
          </div>
        );
      })}
    </div>
  );
}
