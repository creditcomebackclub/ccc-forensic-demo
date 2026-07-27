// Cross-phase campaign progress is derived from immutable mail/response
// lifecycle fields plus the latest report comparison.  This intentionally
// produces a client-safe view: it never includes private response evidence,
// model output, staff notes, or escalation narrative text.

import { lastFour, normalizeFurnisher } from './diffEngine';

function value(row, camel, snake) {
  return row?.[camel] ?? row?.[snake] ?? null;
}

function phaseNumber(letter) {
  const phase = String(value(letter, 'phase', 'phase') || '');
  if (/^phase\s*4\b/i.test(phase)) return 4;
  if (/^phase\s*3\b/i.test(phase)) return 3;
  return 1;
}

function accountKey(account) {
  const clientAccountId = value(account, 'clientAccountId', 'client_account_id');
  if (clientAccountId) return `client-account:${clientAccountId}`;
  const furnisher = normalizeFurnisher(account?.furnisher);
  const masked = account?.accountNumberMasked || account?.account_id || account?.accountId || '';
  const last4 = lastFour(masked);
  return last4 ? `masked:${furnisher}:${last4}` : `furnisher:${furnisher}`;
}

function matchesAccount(letter, account) {
  const letterClientAccountId = value(letter, 'clientAccountId', 'client_account_id');
  const accountClientAccountId = value(account, 'clientAccountId', 'client_account_id');
  if (letterClientAccountId && accountClientAccountId) return letterClientAccountId === accountClientAccountId;
  if (normalizeFurnisher(value(letter, 'furnisher', 'furnisher')) !== normalizeFurnisher(account?.furnisher)) return false;

  const letterLast4 = lastFour(value(letter, 'accountId', 'account_id'));
  const accountLast4 = lastFour(account?.accountNumberMasked || account?.account_id || account?.accountId);
  // A same-furnisher fallback is permitted only when one side has no usable
  // last four. This keeps legacy rows visible without pretending two
  // same-furnisher accounts are the same tradeline.
  return !letterLast4 || !accountLast4 || letterLast4 === accountLast4;
}

function updatedAt(row) {
  return [
    value(row, 'bureauResponseAnalyzedAt', 'bureau_response_analyzed_at'),
    value(row, 'bureauResponseReceivedAt', 'bureau_response_received_at'),
    value(row, 'bureauReviewedAt', 'bureau_reviewed_at'),
    value(row, 'phase2AnalyzedAt', 'phase2_analyzed_at'),
    value(row, 'deliveredAt', 'delivered_at'),
    value(row, 'mailedDate', 'mailed_date'),
    value(row, 'savedAt', 'saved_at'),
    value(row, 'date', 'date'),
  ].filter(Boolean).sort().slice(-1)[0] || null;
}

function newest(rows) {
  return [...(rows || [])].sort((a, b) => String(updatedAt(b) || '').localeCompare(String(updatedAt(a) || '')))[0] || null;
}

function reportLabel(reportStatus) {
  if (reportStatus === 'deleted') return 'Reported deleted on newest report';
  if (reportStatus === 'changed') return 'Changed on newest report';
  if (reportStatus === 'new') return 'Newly reported account';
  return 'No material report change detected';
}

function lifecycleForPhaseOne(letter) {
  if (!letter) return { phase: 1, status: 'not_started', label: 'No dispute letter generated yet' };
  const outcome = value(letter, 'responseOutcome', 'response_outcome');
  if (outcome === 'deleted') return { phase: 1, status: 'reported_deleted', label: 'Reported deleted on newest report' };
  if (value(letter, 'phase2AnalyzedAt', 'phase2_analyzed_at')) return { phase: 2, status: 'response_analyzed', label: 'Response analyzed; Phase 3 decision ready' };
  if (outcome === 'received') return { phase: 2, status: 'response_received', label: 'Response received and awaiting analysis' };
  if (outcome === 'no_response') return { phase: 2, status: 'no_response', label: 'Response window closed; Phase 3 decision ready' };
  if (value(letter, 'deliveredAt', 'delivered_at')) return { phase: 1, status: 'delivered', label: 'Dispute delivered; response window is running' };
  if (value(letter, 'mailedDate', 'mailed_date')) return { phase: 1, status: 'mailed', label: 'Dispute mailed; awaiting confirmed delivery' };
  return { phase: 1, status: 'draft', label: 'Dispute draft prepared' };
}

function lifecycleForPhaseThree(letter, escalation) {
  if (escalation) {
    const status = escalation.status || 'draft';
    if (status === 'filed') return { phase: 4, status: 'escalation_filed', label: 'Further review has been filed' };
    if (status === 'responded') return { phase: 4, status: 'escalation_responded', label: 'Further review received a response' };
    if (status === 'closed') return { phase: 4, status: 'escalation_closed', label: 'Further review is closed' };
    if (status === 'ready') return { phase: 4, status: 'escalation_ready', label: 'Further review is prepared for filing' };
    return { phase: 4, status: 'escalation_draft', label: 'Further review is being prepared' };
  }
  if (!letter) return null;
  const outcome = value(letter, 'responseOutcome', 'response_outcome');
  const responseStatus = value(letter, 'bureauResponseStatus', 'bureau_response_status') || 'not_received';
  const review = value(letter, 'bureauReviewStatus', 'bureau_review_status') || 'not_reviewed';
  if (outcome === 'deleted') return { phase: 3, status: 'reported_deleted', label: 'Reported deleted on newest report' };
  if (review === 'resolved') return { phase: 3, status: 'bureau_resolved', label: 'Bureau response review completed' };
  if (review === 'follow_up') return { phase: 3, status: 'bureau_follow_up', label: 'Bureau follow-up is planned' };
  if (review === 'needs_documents') return { phase: 3, status: 'bureau_documents', label: 'Additional documents are being gathered' };
  if (review === 'escalated') return { phase: 3, status: 'bureau_escalated', label: 'Further review is in progress' };
  if (responseStatus === 'review_ready') return { phase: 3, status: 'bureau_review_ready', label: 'Bureau response is under staff review' };
  if (responseStatus === 'analyzing') return { phase: 3, status: 'bureau_analyzing', label: 'Bureau response is being analyzed' };
  if (responseStatus === 'received' || outcome === 'received') return { phase: 3, status: 'bureau_received', label: 'Bureau response received' };
  if (outcome === 'no_response') return { phase: 3, status: 'bureau_window_closed', label: 'Bureau response window closed; review is pending' };
  if (value(letter, 'deliveredAt', 'delivered_at')) return { phase: 3, status: 'bureau_delivered', label: 'Bureau dispute delivered; response window is running' };
  if (value(letter, 'mailedDate', 'mailed_date')) return { phase: 3, status: 'bureau_mailed', label: 'Bureau dispute mailed; awaiting confirmed delivery' };
  return { phase: 3, status: 'bureau_draft', label: 'Bureau dispute draft prepared' };
}

/**
 * Returns one safe lifecycle row for every confidently diffed account.
 * `diff.unmatched` is intentionally excluded: an uncertain account match
 * must never drive a client-facing campaign status.
 */
export function buildPhaseProgress(diff, letters = [], escalations = []) {
  const buckets = [
    ['deleted', diff?.deleted || []],
    ['changed', diff?.changed || []],
    ['new', diff?.new || []],
    ['unchanged', diff?.unchanged || []],
  ];

  return buckets.flatMap(([reportStatus, accounts]) => accounts.map((account) => {
    const related = (letters || []).filter((letter) => matchesAccount(letter, account));
    const phaseThree = newest(related.filter((letter) => phaseNumber(letter) === 3));
    const phaseOne = newest(related.filter((letter) => phaseNumber(letter) < 3));
    const phaseThreeEscalations = (escalations || []).filter((escalation) =>
      phaseThree && escalation.phase3_letter_id === value(phaseThree, 'id', 'id')
    );
    const escalation = newest(phaseThreeEscalations);
    const lifecycle = lifecycleForPhaseThree(phaseThree, escalation) || lifecycleForPhaseOne(phaseOne);
    const mostRecent = newest([phaseThree, phaseOne, escalation].filter(Boolean));

    return {
      accountKey: accountKey(account),
      furnisher: account.furnisher || 'Unknown furnisher',
      accountNumberMasked: account.accountNumberMasked || null,
      reportStatus,
      reportLabel: reportLabel(reportStatus),
      phase: lifecycle.phase,
      status: lifecycle.status,
      label: lifecycle.label,
      updatedAt: updatedAt(mostRecent),
    };
  }));
}
