import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle, Loader2, X } from 'lucide-react';
import { runPhase2Job } from '../utils/phase2Jobs';
import { saveLetter } from '../utils/storage';

const AUTO_OK = new Set(['VERIFIED_WITHOUT_SUBSTANCE', 'PARTIAL_CORRECTION']);

function bureauLabel(bureau) {
  if (bureau === 'equifax') return 'Equifax';
  if (bureau === 'experian') return 'Experian';
  if (bureau === 'transunion') return 'TransUnion';
  return bureau || 'Bureau';
}

function bureauFromPhase(phase) {
  const p = String(phase || '').toLowerCase();
  if (p.includes('equifax')) return 'equifax';
  if (p.includes('experian')) return 'experian';
  if (p.includes('transunion') || p.includes('trans union')) return 'transunion';
  return null;
}

/**
 * After staff chooses "Continue with bureau follow-up", draft a supplemental
 * Phase 3 letter from the prior bureau-response analysis + response pages.
 */
export default function BureauFollowUpPanel({ letter, client, evidence, onClose, onSaved }) {
  const [tokens, setTokens] = useState(0);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [savedLetterId, setSavedLetterId] = useState(null);
  const [phase, setPhase] = useState('starting'); // starting | running | done | error
  const [runKey, setRunKey] = useState(0);
  const running = useRef(false);

  const classification = evidence?.analysis?.classification || null;
  const warnClassification = classification && !AUTO_OK.has(classification);

  const runDraft = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setError(null);
    setResult(null);
    setSavedLetterId(null);
    setTokens(0);
    setPhase('running');
    try {
      if (!evidence?.id) throw new Error('Missing bureau response evidence for follow-up generation.');
      if (evidence.analysis_status !== 'analyzed' || !evidence.analysis) {
        throw new Error('Analyze the bureau response before generating a follow-up letter.');
      }
      const draft = await runPhase2Job({
        letterId: letter.id,
        kind: 'bureau_follow_up',
        evidenceId: evidence.id,
      }, setTokens);

      if (!draft?.letterHtml) throw new Error('Follow-up job finished without letter HTML.');
      if (draft.enclosure_parse_blocked) {
        const issues = (draft.enclosure_parse_issues || []).join(' ');
        throw new Error(issues || 'Follow-up letter failed quality/citation checks. Review the response and try again.');
      }

      const bureau = draft.bureau || bureauFromPhase(letter.phase);
      if (!bureau) throw new Error('Could not determine bureau for the follow-up letter.');
      if (draft.source_letter_id !== letter.id || draft.source_evidence_id !== evidence.id) {
        throw new Error('Follow-up source mismatch. Nothing was saved; re-run the draft from the intended bureau response.');
      }
      const coveredFurnishers = letter.coveredFurnishers || letter.covered_furnishers || [];
      if (!coveredFurnishers.length) {
        throw new Error('The prior Phase 3 letter has no exact furnisher coverage. Reconcile it before saving a follow-up.');
      }

      const phaseLabel = `Phase 3 — ${bureauLabel(bureau)} (Follow-up)`;
      const letterId = await saveLetter(
        {
          furnisher: letter.furnisher,
          id: letter.account_id || '',
          clientAccountId: letter.client_account_id || letter.clientAccountId || null,
          type: letter.type || null,
        },
        { id: client?.id || letter.client_id || null, name: client?.name || letter.client_name },
        draft.letterHtml,
        draft.summary || `Bureau follow-up to ${bureauLabel(bureau)}`,
        phaseLabel,
        `__phase3-${bureau}-followup`,
        {
          coveredFurnishers,
          enclosureParseBlocked: !!draft.enclosure_parse_blocked,
          enclosureParseIssues: draft.enclosure_parse_issues || [],
          sourcePhase3LetterId: draft.source_letter_id,
          sourceBureauResponseEvidenceId: draft.source_evidence_id,
        }
      );

      setResult(draft);
      setSavedLetterId(letterId);
      setPhase('done');
      onSaved && onSaved({ letterId, draft });
    } catch (e) {
      console.error('Bureau follow-up failed:', e);
      setError(e.message || 'Follow-up generation failed');
      setPhase('error');
    } finally {
      running.current = false;
    }
  }, [letter, client, evidence, onSaved]);

  useEffect(() => {
    runDraft();
    // Only re-run when staff clicks Retry (runKey), not when parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50" onClick={(e) => { if (e.target === e.currentTarget && phase !== 'running') onClose(); }}>
      <div className="bg-white rounded-lg max-w-lg w-full p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-[16px] font-semibold text-ink">Bureau follow-up letter</div>
            <div className="text-[12px] text-ink-muted mt-0.5">{letter.furnisher} · {letter.phase}</div>
          </div>
          {phase !== 'running' && (
            <button onClick={onClose} className="text-ink-faint hover:text-ink" aria-label="Close"><X size={18} /></button>
          )}
        </div>

        {warnClassification && phase !== 'done' && (
          <div className="text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-3">
            Classification is <strong>{classification}</strong>. Auto follow-up is strongest for
            VERIFIED_WITHOUT_SUBSTANCE / PARTIAL_CORRECTION — generation still runs because you chose the bureau path.
          </div>
        )}

        {phase === 'running' || phase === 'starting' ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Loader2 className="animate-spin text-navy" size={28} />
            <div className="text-[13px] font-medium text-ink">Drafting supplemental Phase 3 letter…</div>
            <div className="text-[11px] text-ink-muted">Using the bureau response analysis and unresolved issues. ~{tokens} tokens</div>
          </div>
        ) : null}

        {phase === 'error' && (
          <div className="flex gap-2 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-4">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-3">
            <div className="flex gap-2 text-[12px] text-green-800 bg-green-50 border border-green-200 rounded-md px-3 py-2">
              <CheckCircle size={14} className="shrink-0 mt-0.5" />
              <span>
                Follow-up letter saved
                {result?.bureau ? ` for ${bureauLabel(result.bureau)}` : ''}.
                Review it in the Letters tab, then mail via Lob when ready.
              </span>
            </div>
            {result?.summary && (
              <p className="text-[12px] text-ink-muted leading-relaxed">{result.summary}</p>
            )}
            {Array.isArray(result?.focusIssues) && result.focusIssues.length > 0 && (
              <ul className="text-[12px] text-ink list-disc pl-5 space-y-1">
                {result.focusIssues.map((issue, i) => <li key={i}>{issue}</li>)}
              </ul>
            )}
            {savedLetterId && (
              <div className="text-[10px] text-ink-faint font-mono break-all">Letter id: {savedLetterId}</div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          {phase === 'error' && (
            <button
              type="button"
              onClick={() => setRunKey((k) => k + 1)}
              className="text-[11px] uppercase tracking-wider px-3 py-2 rounded-md text-white"
              style={{ backgroundColor: '#1B2A4A' }}
            >
              Retry draft
            </button>
          )}
          <button onClick={onClose} disabled={phase === 'running'}
            className="text-[11px] uppercase tracking-wider px-3 py-2 rounded-md border border-border text-ink-muted disabled:opacity-40">
            {phase === 'done' ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
