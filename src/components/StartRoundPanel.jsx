import React, { useEffect, useMemo, useState } from 'react';
import { Check, FileText, Loader2, ShieldAlert, X } from 'lucide-react';
import { generateRoundLetter, retryFailedRoundLetters } from '../utils/api.js';
import { letterGenerationState } from '../utils/letterGeneration.js';
import { BUREAU_LABEL, resolveActiveBureaus } from '../utils/roundTargets.js';
import { cancelRound, getLatestRound, reopenRound } from '../utils/rounds.js';
import { resolveSignatureViewUrl } from '../utils/storagePaths.js';
import { supabase } from '../utils/supabase.js';
import LetterViewer from './LetterViewer.jsx';
import RoundCloseModal from './RoundCloseModal.jsx';
import TargetPicker from './TargetPicker.jsx';

const reviewLabel = {
  resolved: 'Resolved',
  follow_up: 'Follow-up approved',
  needs_documents: 'More documents needed',
  escalated: 'Escalation approved',
};

function auditDateLabel(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return 'the latest saved audit';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function StartRoundPanel({ account, client, onClose }) {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [changingRound, setChangingRound] = useState(false);
  const [error, setError] = useState(null);
  const [latestRound, setLatestRound] = useState(null);
  const [targetType, setTargetType] = useState(null);
  const [activeBureaus, setActiveBureaus] = useState([]);
  const [bureauAudit, setBureauAudit] = useState(null);
  const [bureausLoading, setBureausLoading] = useState(false);
  const [selectedBureaus, setSelectedBureaus] = useState([]);
  const [sources, setSources] = useState([]);
  const [selectedSources, setSelectedSources] = useState([]);
  const [enrichedClient, setEnrichedClient] = useState(client);
  const [completed, setCompleted] = useState(null);
  const [openLetters, setOpenLetters] = useState([]);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [engagementStatus, setEngagementStatus] = useState(client?.engagementStatus || null);

  const nextRoundNumber = (latestRound?.round_number || 0) + 1;
  const roundAllowsNext = !latestRound || latestRound.status === 'cancelled' || (latestRound.status === 'closed' && latestRound.final_disposition === 'next_round');
  const mayStart = roundAllowsNext && engagementStatus === 'active';
  const needsSources = nextRoundNumber > 1;

  async function refreshOpenRound() {
    const round = await getLatestRound(account.clientAccountId);
    setLatestRound(round);
    if (round?.status !== 'open') {
      setOpenLetters([]);
      return round;
    }
    const { data, error: letterError } = await supabase.from('letters')
      .select('id,html,summary,target_type,target_bureau,dispute_basis,round_number,mailed_date,lob_id')
      .eq('round_id', round.round_id)
      .order('target_bureau');
    if (letterError) throw letterError;
    setOpenLetters(data || []);
    return round;
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (!account?.clientAccountId) throw new Error('This account is not linked to a stable account identity. Reconcile it before starting a round.');
        if (!client?.id) throw new Error('This audit is missing the stable client ID required for a dispute round.');
        const round = await getLatestRound(account.clientAccountId);
        if (cancelled) return;
        setLatestRound(round);

        const profileQuery = supabase.from('client_profiles').select('signature_data').eq('client_id', client.id).limit(1);
        const clientQuery = supabase.from('clients').select('lpoa_signature_data,address,engagement_status').eq('id', client.id).limit(1);
        const [{ data: profiles }, { data: clients }] = await Promise.all([profileQuery, clientQuery]);
        const profile = profiles?.[0];
        const clientRow = clients?.[0];
        let signatureData = profile?.signature_data || null;
        if (!signatureData && clientRow?.lpoa_signature_data) signatureData = await resolveSignatureViewUrl(supabase, clientRow.lpoa_signature_data);
        if (!cancelled) {
          setEngagementStatus(clientRow?.engagement_status || client.engagementStatus || 'pending_onboarding');
          setEnrichedClient({ ...client, signatureData, address: clientRow?.address || client.address, engagementStatus: clientRow?.engagement_status || client.engagementStatus || 'pending_onboarding' });
        }

        if (round?.status === 'open') {
          const { data, error: letterError } = await supabase.from('letters').select('id,html,summary,target_type,target_bureau,dispute_basis,round_number,mailed_date,lob_id').eq('round_id', round.round_id).order('target_bureau');
          if (letterError) throw letterError;
          if (!cancelled) setOpenLetters(data || []);
        } else if (round?.status === 'closed' && round.final_disposition === 'next_round') {
          const { data: priorLetters, error: letterError } = await supabase
            .from('letters')
            .select('id,phase,round_number,target_type,target_bureau,furnisher,summary')
            .eq('client_account_id', account.clientAccountId)
            .not('round_id', 'is', null)
            .order('round_number', { ascending: false });
          if (letterError) throw letterError;
          const ids = (priorLetters || []).map((letter) => letter.id);
          const { data: evidence, error: evidenceError } = ids.length
            ? await supabase.from('response_evidence').select('id,letter_id,review_status,analysis_status,evidence_kind,received_at').in('letter_id', ids).eq('analysis_status', 'analyzed').neq('review_status', 'not_reviewed')
            : { data: [], error: null };
          if (evidenceError) throw evidenceError;
          const letterById = new Map((priorLetters || []).map((letter) => [letter.id, letter]));
          const options = (evidence || []).map((item) => ({ ...item, letter: letterById.get(item.letter_id) })).filter((item) => item.letter);
          if (!cancelled) setSources(options);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || 'Could not prepare this dispute round.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [account, client]);

  const usableOpenLetters = useMemo(() => openLetters.filter((letter) => letter.html && letter.html !== 'GENERATING...' && !letter.html.startsWith('ERROR:')), [openLetters]);
  const failedOpenLetters = useMemo(() => openLetters.filter((letter) => letterGenerationState(letter) === 'failed' && !letter.mailed_date && !letter.lob_id), [openLetters]);

  async function chooseTarget(value) {
    setTargetType(value);
    setError(null);
    setSelectedBureaus([]);
    if (value !== 'bureau' || activeBureaus.length) return;
    setBureausLoading(true);
    try {
      const resolved = await resolveActiveBureaus({
        clientId: client.id,
        clientName: client.name,
        clientAccountId: account.clientAccountId,
        accountId: account.accountNumberMasked || account.id,
        furnisher: account.furnisher,
      });
      setActiveBureaus(resolved.activeBureaus);
      setBureauAudit({
        id: resolved.auditId,
        reportDate: resolved.auditReportDate,
        savedAt: resolved.auditSavedAt,
      });
    } catch (resolveError) {
      setError(resolveError.message);
    } finally {
      setBureausLoading(false);
    }
  }

  function toggleSource(source) {
    setSelectedSources((current) => current.some((item) => item.responseEvidenceId === source.id)
      ? current.filter((item) => item.responseEvidenceId !== source.id)
      : [...current, { sourceLetterId: source.letter_id, responseEvidenceId: source.id }]);
  }

  async function handleGenerate() {
    if (!targetType) return setError('Choose who this round will dispute with.');
    if (targetType === 'bureau' && !selectedBureaus.length) return setError('Confirm at least one bureau shown as active on the latest audit.');
    if (needsSources && !selectedSources.length) return setError('Select at least one reviewed prior letter and response/nonresponse pair.');
    setGenerating(true);
    setError(null);
    try {
      const result = await generateRoundLetter({ account, client: enrichedClient, targetType, selectedBureaus, priorSources: selectedSources });
      setCompleted({ ...result, targetType });
    } catch (generationError) {
      setError(generationError.message || 'Round generation failed.');
      await refreshOpenRound().catch(() => {});
    } finally {
      setGenerating(false);
    }
  }

  async function handleRetryGeneration() {
    setGenerating(true);
    setError(null);
    try {
      await retryFailedRoundLetters({ account, client: enrichedClient, roundId: latestRound.round_id });
      await refreshOpenRound();
    } catch (retryError) {
      setError(retryError.message || 'The failed drafts could not be retried.');
      await refreshOpenRound().catch(() => {});
    } finally {
      setGenerating(false);
    }
  }

  async function handleCancelRound() {
    const reason = window.prompt('Why is this entire unmailed round being cancelled?');
    if (!reason?.trim()) return;
    setChangingRound(true);
    setError(null);
    try {
      await cancelRound(completed?.roundId || latestRound?.round_id, reason.trim());
      onClose();
    } catch (cancelError) {
      setError(cancelError.message || 'Could not cancel the round.');
    } finally {
      setChangingRound(false);
    }
  }

  async function handleReopenRound() {
    setChangingRound(true);
    setError(null);
    try {
      const reopened = await reopenRound(latestRound.round_id);
      const { data: reopenedLetters, error: reopenedLettersError } = await supabase.from('letters').select('id,html,summary,target_type,target_bureau,round_number').eq('round_id', latestRound.round_id).order('target_bureau');
      if (reopenedLettersError) throw reopenedLettersError;
      setOpenLetters(reopenedLetters || []);
      setLatestRound({ ...latestRound, ...reopened, status: 'open', final_disposition: null });
    } catch (reopenError) {
      setError(reopenError.message || 'Could not reopen the round.');
    } finally {
      setChangingRound(false);
    }
  }

  if (completed) return <LetterViewer letters={completed.letters} account={account} client={enrichedClient} roundNumber={completed.roundNumber} targetType={completed.targetType} onClose={onClose} onCancelRound={handleCancelRound} cancelling={changingRound} />;
  if (latestRound?.status === 'open' && usableOpenLetters.length === latestRound.letter_count) return <>
    <LetterViewer
      letters={usableOpenLetters}
      account={account}
      client={enrichedClient}
      roundNumber={latestRound.round_number}
      targetType={latestRound.target_type}
      onClose={onClose}
      onCancelRound={latestRound.mailed_count > 0 ? null : handleCancelRound}
      onCloseRound={latestRound.ready_to_close ? () => setShowCloseModal(true) : null}
      cancelling={changingRound}
    />
    {showCloseModal && <RoundCloseModal
      roundId={latestRound.round_id}
      roundNumber={latestRound.round_number}
      onClose={() => setShowCloseModal(false)}
      onCompleted={() => onClose()}
    />}
  </>;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 no-print">
      <div className="bg-white rounded max-w-2xl w-full max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-gold-dark">{mayStart ? `Prepare Round ${nextRoundNumber}` : `Round ${latestRound?.round_number || ''}`}</div>
            <div className="text-[15px] font-medium text-ink mt-0.5">{account?.furnisher}</div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded" aria-label="Close round setup"><X size={15} /></button>
        </div>

        <div className="p-5 overflow-auto space-y-5">
          {loading && <div className="py-12 text-center text-[13px] text-ink-muted"><Loader2 size={24} className="animate-spin mx-auto mb-3 text-gold" />Loading account round history…</div>}

          {!loading && latestRound?.status === 'open' && usableOpenLetters.length !== latestRound.letter_count && (
            <div className="bg-amber-50 border border-amber-200 rounded p-4 text-[12px] text-amber-900">
              <div className="font-medium">Round {latestRound.round_number} is already open.</div>
              <div className="mt-1">Its {latestRound.generated_count}/{latestRound.letter_count} letter drafts are complete. A duplicate round was not created.</div>
              {!!failedOpenLetters.length && <button type="button" onClick={handleRetryGeneration} disabled={generating} className="mt-3 px-3 py-2 rounded bg-navy text-gold text-[10px] uppercase tracking-wider font-semibold disabled:opacity-40 flex items-center gap-2">{generating && <Loader2 size={12} className="animate-spin" />}{generating ? 'Retrying failed drafts…' : `Retry ${failedOpenLetters.length} failed draft${failedOpenLetters.length === 1 ? '' : 's'}`}</button>}
              <button type="button" onClick={handleCancelRound} disabled={changingRound} className="mt-3 text-[10px] uppercase tracking-wider font-medium underline disabled:opacity-40">Cancel entire unmailed round</button>
            </div>
          )}

          {!loading && latestRound?.status === 'closed' && latestRound.final_disposition !== 'next_round' && (
            <div className="bg-blue-50 border border-blue-200 rounded p-4 text-[12px] text-blue-900 flex gap-3"><ShieldAlert size={17} className="flex-shrink-0" /><div><div className="font-medium">This account is closed as “{latestRound.final_disposition}.”</div><div className="mt-1">Reopen the final round before preparing another dispute.</div><button type="button" onClick={handleReopenRound} disabled={changingRound} className="mt-3 text-[10px] uppercase tracking-wider font-medium underline disabled:opacity-40">{changingRound ? 'Reopening…' : 'Reopen final round'}</button></div></div>
          )}

          {!loading && roundAllowsNext && engagementStatus !== 'active' && (
            <div className="bg-amber-50 border border-amber-200 rounded p-4 text-[12px] text-amber-900 flex gap-3"><ShieldAlert size={17} className="flex-shrink-0" /><div><div className="font-medium">New rounds are paused for this engagement.</div><div className="mt-1">Service status is {String(engagementStatus || 'pending_onboarding').replace(/_/g, ' ')}. Activate the signed engagement in Billing before preparing new dispute work. Existing letters, deadlines, and response reviews are unaffected.</div></div></div>
          )}

          {!loading && mayStart && (
            <>
              <section>
                <div className="text-[11px] uppercase tracking-wider text-ink-muted mb-2">1. Choose this round’s target</div>
                <TargetPicker value={targetType ? { track: targetType, furnisherName: account.furnisher } : null} furnisherName={account.furnisher} onChange={(next) => chooseTarget(next.track)} />
              </section>

              {targetType === 'bureau' && (
                <section>
                  <div className="text-[11px] uppercase tracking-wider text-ink-muted mb-2">2. Choose confirmed reporting bureaus</div>
                  {bureausLoading ? (
                    <div className="border border-border bg-gray-50 rounded p-3 text-[11px] text-ink-muted flex items-center gap-2"><Loader2 size={13} className="animate-spin" />Checking this account against the latest audit…</div>
                  ) : (
                    <>
                      {!!activeBureaus.length && (
                        <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-2 text-[11px] text-blue-900 leading-relaxed">
                          <span className="font-medium">{account.furnisher} is confirmed on {activeBureaus.length === 1 ? 'one bureau' : `${activeBureaus.length} bureaus`} in {auditDateLabel(bureauAudit?.reportDate || bureauAudit?.savedAt)}.</span>
                          <span className="block mt-0.5">Only those confirmed bureaus are available below.</span>
                        </div>
                      )}
                      <div className="grid grid-cols-3 gap-2">
                        {activeBureaus.map((bureau) => {
                          const selected = selectedBureaus.includes(bureau);
                          return <button key={bureau} type="button" onClick={() => setSelectedBureaus((current) => selected ? current.filter((item) => item !== bureau) : [...current, bureau])} className={`p-3 rounded border text-[12px] flex items-center justify-between ${selected ? 'border-gold bg-amber-50 text-ink' : 'border-border text-ink-muted'}`}><span>{BUREAU_LABEL[bureau]}</span>{selected && <Check size={13} />}</button>;
                        })}
                      </div>
                      {!!activeBureaus.length && <div className="text-[10px] text-ink-faint mt-2">No bureau is selected automatically. Each checked bureau receives its own letter in this round.</div>}
                    </>
                  )}
                </section>
              )}

              {needsSources && (
                <section>
                  <div className="text-[11px] uppercase tracking-wider text-ink-muted mb-2">{targetType === 'bureau' ? '3' : '2'}. Select prior evidence</div>
                  {sources.length ? <div className="space-y-2">{sources.map((source) => {
                    const selected = selectedSources.some((item) => item.responseEvidenceId === source.id);
                    return <button key={source.id} type="button" onClick={() => toggleSource(source)} className={`w-full p-3 rounded border text-left flex gap-3 ${selected ? 'border-gold bg-amber-50' : 'border-border'}`}><span className={`mt-0.5 p-1 rounded ${selected ? 'bg-gold text-navy-dark' : 'bg-gray-100 text-ink-muted'}`}><FileText size={13} /></span><span className="min-w-0"><span className="block text-[12px] font-medium text-ink">Round {source.letter.round_number} · {source.letter.target_type === 'bureau' ? BUREAU_LABEL[source.letter.target_bureau] : 'Direct Furnisher'}</span><span className="block text-[10px] text-ink-muted mt-0.5">{reviewLabel[source.review_status] || source.review_status} · {source.evidence_kind === 'non_response' ? 'reviewed nonresponse' : 'reviewed response'}</span></span>{selected && <Check size={14} className="ml-auto text-gold-dark" />}</button>;
                  })}</div> : <div className="bg-red-50 border border-red-200 rounded p-3 text-[12px] text-red-800">No reviewed prior response or nonresponse evidence is available. Finish review before starting the next round.</div>}
                </section>
              )}

              <div className="bg-gray-50 border border-border rounded p-3 text-[11px] text-ink-muted leading-relaxed">
                The existing forensic findings remain the factual foundation. This step changes campaign routing and recipient framing; it does not rerun or simplify the report audit.
              </div>
            </>
          )}

          {error && <div className="bg-red-50 border border-red-200 rounded p-3 text-[12px] text-red-800">{error}</div>}
        </div>

        {!loading && mayStart && (
          <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-[11px] uppercase tracking-wider border border-border rounded text-ink-muted">Cancel</button>
            <button onClick={handleGenerate} disabled={generating || !targetType || (needsSources && !selectedSources.length)} className="px-4 py-2 text-[11px] uppercase tracking-wider rounded bg-navy text-gold disabled:opacity-40 flex items-center gap-2">{generating && <Loader2 size={13} className="animate-spin" />}{generating ? 'Generating forensic letters…' : `Create Round ${nextRoundNumber}`}</button>
          </div>
        )}
      </div>
    </div>
  );
}
