import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, FileText, X } from 'lucide-react';
import { updateLetter } from '../utils/storage';
import { listResponseEvidence, updateResponseEvidenceReview } from '../utils/responseEvidence';
import { getLatestRound, markRoundClosePrompted, reviewRoundLetter } from '../utils/rounds.js';
import RoundCloseModal from './RoundCloseModal.jsx';

const OPTIONS = [
  {
    key: 'resolved',
    title: 'Resolved / corrected',
    description: 'Close this bureau target after staff confirms the reported result.',
    action: 'close',
    tone: '#15803D',
  },
  {
    key: 'follow_up',
    title: 'Continue with bureau follow-up',
    description: 'Keep the dispute in the bureau lane. This deliberately suppresses automatic external escalation.',
    action: 'bureau_follow_up',
    tone: '#1B2A4A',
  },
  {
    key: 'needs_documents',
    title: 'Request more documentation',
    description: 'Pause the decision while the client or staff obtains supporting documents.',
    action: 'request_documents',
    tone: '#B45309',
  },
  {
    key: 'escalated',
    title: 'Prepare CFPB / State AG escalation',
    description: 'Open the external-escalation workflow. Nothing is filed automatically.',
    action: 'escalation',
    tone: '#B91C1C',
  },
];

export default function BureauResponseReview({ letter, evidence: evidenceProp, onClose, onSaved, onEscalate, onFollowUp }) {
  const [evidence, setEvidence] = useState(evidenceProp || null);
  const [choice, setChoice] = useState(evidenceProp?.review_status || letter.bureauReviewStatus || 'not_reviewed');
  const [notes, setNotes] = useState(evidenceProp?.review_notes || letter.bureauReviewNotes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [roundReady, setRoundReady] = useState(null);

  useEffect(() => {
    if (evidenceProp?.id) {
      setEvidence(evidenceProp);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await listResponseEvidence({ letterId: letter.id });
        const bureau = (rows || []).find((r) => r.response_kind === 'bureau' && r.upload_status === 'received');
        if (!cancelled && bureau) setEvidence(bureau);
      } catch (e) {
        console.warn('Could not load bureau evidence for review:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [letter.id, evidenceProp]);

  const chosen = OPTIONS.find((o) => o.key === choice);
  const classification = evidence?.analysis?.classification || null;
  const canDraftFollowUp = !!(evidence?.id && evidence?.analysis_status === 'analyzed' && evidence?.analysis);

  const save = async (openEscalation = false, startFollowUp = false) => {
    if (!chosen) { setError('Choose the next action before saving.'); return; }
    setSaving(true);
    setError(null);
    try {
      const reviewedAt = new Date().toISOString();
      // The rationale is staff-only evidence. Do not persist newly written
      // notes onto letters, which the client portal can read as part of its
      // campaign timeline.
      if (letter.roundId) {
        if (!evidence?.id) throw new Error('Analyzed bureau-response evidence is required for a structured round review.');
        const decision = {
          resolved: { reviewStatus: 'resolved', nextAction: 'resolved' },
          follow_up: { reviewStatus: 'follow_up', nextAction: 'next_round' },
          needs_documents: { reviewStatus: 'needs_documents', nextAction: 'needs_documents' },
          escalated: { reviewStatus: 'escalated', nextAction: 'escalate' },
        }[chosen.key];
        await reviewRoundLetter({ letterId: letter.id, responseEvidenceId: evidence.id, ...decision, notes: notes.trim() || null });
      } else if (evidence?.id) {
        await updateResponseEvidenceReview(evidence.id, {
          reviewStatus: chosen.key,
          reviewNotes: notes.trim() || null,
          reviewedAt,
        });
      }
      if (!letter.roundId) {
        await updateLetter(letter.id, {
          bureauReviewStatus: chosen.key,
          bureauNextAction: chosen.action,
          bureauReviewNotes: evidence?.id ? null : (notes.trim() || null),
          bureauReviewedAt: reviewedAt,
          bureauResponseStatus: 'reviewed',
        });
      }
      onSaved && onSaved();
      if (letter.roundId && letter.clientAccountId) {
        const latest = await getLatestRound(letter.clientAccountId);
        if (latest?.round_id === letter.roundId && latest.ready_to_close && !latest.close_prompted_at) {
          await markRoundClosePrompted(letter.roundId);
          setRoundReady(latest);
        }
        else onClose();
      } else if (openEscalation) onEscalate && onEscalate();
      else if (startFollowUp) onFollowUp && onFollowUp(evidence);
      else onClose();
    } catch (e) {
      setError(e.message || 'Could not save the bureau-response review.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg max-w-xl w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="text-[16px] font-semibold text-ink">Bureau Response Review</div>
            <div className="text-[12px] text-ink-muted mt-0.5">{letter.furnisher} · {letter.phase}</div>
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="flex gap-2 p-3 rounded-md bg-blue-50 border border-blue-100 text-[12px] text-blue-900 mb-4">
          <FileText size={15} className="shrink-0 mt-0.5" />
          <span>
            A bureau response is a staff decision point—not an automatic escalation.
            {letter.roundId
              ? <>Choosing <strong>Another round</strong> saves this reviewed evidence for a later explicit target and bureau selection.</>
              : <>Choosing <strong>Continue with bureau follow-up</strong> drafts a supplemental legacy Phase 3 letter from the unresolved issues in this analysis.</>}
            {classification ? <> Current classification: <strong>{classification}</strong>.</> : null}
          </span>
        </div>

        <div className="space-y-2 mb-4">
          {OPTIONS.map((option) => (
            <button key={option.key} onClick={() => setChoice(option.key)}
              className="w-full text-left border rounded-md px-3 py-3 transition-colors"
              style={{ borderColor: choice === option.key ? option.tone : '#E7EAF0', background: choice === option.key ? '#F8FAFC' : '#fff' }}>
              <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
                {choice === option.key && <CheckCircle size={14} style={{ color: option.tone }} />}
                {choice !== option.key && <span className="w-[14px]" />}
                {letter.roundId && option.key === 'follow_up' ? 'Another round' : option.title}
              </div>
              <div className="text-[11px] text-ink-muted ml-[22px] mt-1">{option.description}</div>
            </button>
          ))}
        </div>

        <label className="block text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-1.5">Staff notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
          placeholder="Why this response was resolved, needs a follow-up, needs documents, or should be escalated."
          className="w-full text-[12px] border border-border rounded-md p-2.5 mb-3" />

        {error && <div className="flex gap-2 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-3"><AlertCircle size={14} />{error}</div>}

        <div className="flex items-center justify-between gap-3 pt-1">
          <button onClick={onClose} className="text-[11px] uppercase tracking-wider text-ink-muted hover:text-ink">Cancel</button>
          <div className="flex gap-2">
            {choice === 'follow_up' && !letter.roundId ? (
              <>
                <button onClick={() => save(false, false)} disabled={saving || !chosen}
                  className="text-[11px] uppercase tracking-wider px-3 py-2 rounded-md border border-navy text-navy disabled:opacity-40">
                  {saving ? 'Saving…' : 'Save only'}
                </button>
                <button
                  onClick={() => save(false, true)}
                  disabled={saving || !chosen || !onFollowUp || !canDraftFollowUp}
                  title={!canDraftFollowUp ? 'Analyze the bureau response first' : undefined}
                  className="text-[11px] uppercase tracking-wider px-3 py-2 rounded-md text-white disabled:opacity-40"
                  style={{ backgroundColor: '#1B2A4A' }}>
                  {saving
                    ? 'Saving…'
                    : (evidence?.review_status === 'follow_up' || letter.bureauReviewStatus === 'follow_up')
                      ? 'Draft / regenerate follow-up letter'
                      : 'Save & draft follow-up letter'}
                </button>
              </>
            ) : (
              <button onClick={() => save(false)} disabled={saving || !chosen}
                className="text-[11px] uppercase tracking-wider px-3 py-2 rounded-md border border-navy text-navy disabled:opacity-40">
                {saving ? 'Saving…' : 'Save decision'}
              </button>
            )}
            {choice === 'escalated' && !letter.roundId && (
              <button onClick={() => save(true)} disabled={saving}
                className="text-[11px] uppercase tracking-wider px-3 py-2 rounded-md text-white bg-red-700 disabled:opacity-40">
                Save &amp; open escalation
              </button>
            )}
          </div>
        </div>
      </div>
      {roundReady && <RoundCloseModal roundId={roundReady.round_id} roundNumber={roundReady.round_number} onClose={() => setRoundReady(null)} onCompleted={() => { setRoundReady(null); onSaved?.(); onClose(); }} />}
    </div>
  );
}
