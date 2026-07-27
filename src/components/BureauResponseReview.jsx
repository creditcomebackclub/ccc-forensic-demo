import React, { useState } from 'react';
import { AlertCircle, CheckCircle, FileText, X } from 'lucide-react';
import { updateLetter } from '../utils/storage';
import { updateResponseEvidenceReview } from '../utils/responseEvidence';

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

export default function BureauResponseReview({ letter, evidence, onClose, onSaved, onEscalate }) {
  const [choice, setChoice] = useState(evidence?.review_status || letter.bureauReviewStatus || 'not_reviewed');
  const [notes, setNotes] = useState(evidence?.review_notes || letter.bureauReviewNotes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const chosen = OPTIONS.find((o) => o.key === choice);

  const save = async (openEscalation = false) => {
    if (!chosen) { setError('Choose the next action before saving.'); return; }
    setSaving(true);
    setError(null);
    try {
      const reviewedAt = new Date().toISOString();
      // The rationale is staff-only evidence. Do not persist newly written
      // notes onto letters, which the client portal can read as part of its
      // campaign timeline.
      if (evidence?.id) {
        await updateResponseEvidenceReview(evidence.id, {
          reviewStatus: chosen.key,
          reviewNotes: notes.trim() || null,
          reviewedAt,
        });
      }
      await updateLetter(letter.id, {
        bureauReviewStatus: chosen.key,
        bureauNextAction: chosen.action,
        bureauReviewNotes: evidence?.id ? null : (notes.trim() || null),
        bureauReviewedAt: reviewedAt,
        bureauResponseStatus: 'reviewed',
      });
      onSaved && onSaved();
      if (openEscalation) onEscalate && onEscalate();
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
          <span>A bureau response is a staff decision point—not an automatic escalation. Record the next action before moving the case forward.</span>
        </div>

        <div className="space-y-2 mb-4">
          {OPTIONS.map((option) => (
            <button key={option.key} onClick={() => setChoice(option.key)}
              className="w-full text-left border rounded-md px-3 py-3 transition-colors"
              style={{ borderColor: choice === option.key ? option.tone : '#E7EAF0', background: choice === option.key ? '#F8FAFC' : '#fff' }}>
              <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
                {choice === option.key && <CheckCircle size={14} style={{ color: option.tone }} />}
                {choice !== option.key && <span className="w-[14px]" />}
                {option.title}
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
            <button onClick={() => save(false)} disabled={saving || !chosen}
              className="text-[11px] uppercase tracking-wider px-3 py-2 rounded-md border border-navy text-navy disabled:opacity-40">
              {saving ? 'Saving…' : 'Save decision'}
            </button>
            {choice === 'escalated' && (
              <button onClick={() => save(true)} disabled={saving}
                className="text-[11px] uppercase tracking-wider px-3 py-2 rounded-md text-white bg-red-700 disabled:opacity-40">
                Save &amp; open escalation
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
