/**
 * Client-portal presentation helpers.
 * Pure functions over data ClientPortal already loads — no staff-only fields.
 */

import { isPortalMailTerminal } from './portalCampaigns.js';

function finiteScore(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function buildScoreGap(latestScores = {}, clientMeta = {}) {
  const scores = [
    { key: 'equifax', label: 'Equifax', score: finiteScore(latestScores.equifax ?? clientMeta.score_eq_start) },
    { key: 'experian', label: 'Experian', score: finiteScore(latestScores.experian ?? clientMeta.score_exp_start) },
    { key: 'transunion', label: 'TransUnion', score: finiteScore(latestScores.transunion ?? clientMeta.score_tu_start) },
  ].filter((entry) => entry.score != null);

  if (scores.length < 2) {
    return { points: 0, high: null, low: null, narrative: null };
  }

  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const high = sorted[0];
  const low = sorted[sorted.length - 1];
  const points = high.score - low.score;
  if (points < 15) {
    return {
      points,
      high,
      low,
      narrative: 'Your bureau scores are relatively aligned. We still track every documented item on the plan.',
    };
  }
  return {
    points,
    high,
    low,
    narrative: `${high.label} is reading stronger than ${low.label} by about ${points} points. Month-one work is aimed at the weaker read.`,
  };
}

/**
 * Unified client-facing stage for the overview rail.
 * Order: plan → mailed → waiting → results → next round
 */
export function derivePortalStage({
  blueprints = [],
  mailed = [],
  delivered = [],
  reviewStarted = null,
  responded = [],
  deletions = [],
  rounds = [],
  campaigns = [],
  docsComplete = false,
}) {
  const activeReviews = Array.isArray(reviewStarted) ? reviewStarted : delivered;
  const hasBlueprint = (blueprints || []).some((b) => b.status === 'approved' || b.status === 'sent');
  const openRounds = (rounds || []).filter((r) => r.status === 'open');
  const closedRounds = (rounds || []).filter((r) => r.status === 'closed' || r.closed_at);
  const maxRound = Math.max(0, ...[...(rounds || []).map((r) => Number(r.round_number) || 0), ...(campaigns || []).map((c) => Number(c.round_number) || 0)]);
  const hasRound2 = maxRound >= 2 || (closedRounds.length > 0 && openRounds.some((r) => Number(r.round_number) >= 2));

  const steps = [
    {
      id: 'plan',
      label: 'Plan ready',
      detail: hasBlueprint ? 'Recovery Blueprint on file' : 'Recovery plan being prepared',
      done: hasBlueprint || mailed.length > 0,
    },
    {
      id: 'mailed',
      label: 'Letters sent',
      detail: mailed.length ? `${mailed.length} mailed package${mailed.length === 1 ? '' : 's'}` : 'Waiting on first mailing',
      done: mailed.length > 0,
    },
    {
      id: 'waiting',
      label: 'Review window',
      detail: activeReviews.length
        ? 'Case review clock active'
        : mailed.length
          ? 'Starts from the saved expected-delivery date'
          : 'Starts after mailing',
      done: activeReviews.length > 0 || responded.length > 0 || deletions.length > 0,
    },
    {
      id: 'results',
      label: 'Results logged',
      detail: deletions.length
        ? `${deletions.length} removal${deletions.length === 1 ? '' : 's'} confirmed`
        : responded.length
          ? 'Responses under review'
          : 'Appear when responses are recorded',
      done: responded.length > 0 || deletions.length > 0,
    },
    {
      id: 'next',
      label: 'Next wave',
      detail: hasRound2 || maxRound >= 2
        ? 'Follow-up round in progress'
        : closedRounds.length && !openRounds.length
          ? 'Preparing the next wave'
          : 'Opens after Round 1 results',
      done: hasRound2 || maxRound >= 2,
    },
  ];

  // Current = first not-done step; if all done, last step is current.
  let currentIndex = steps.findIndex((step) => !step.done);
  if (currentIndex < 0) currentIndex = steps.length - 1;

  // If docs incomplete and nothing mailed, bias current toward plan/onboarding.
  if (!docsComplete && mailed.length === 0 && !hasBlueprint) {
    currentIndex = 0;
  }

  steps.forEach((step, index) => {
    step.current = index === currentIndex;
  });

  return {
    steps,
    currentId: steps[currentIndex].id,
    hasBlueprint,
    maxRound,
  };
}

/**
 * Client action queue — only items that need the client, not staff.
 */
export function buildActionQueue({
  clientDocs = { id: null, address: null },
  profile = null,
  letters = [],
  stagedFiles = {},
  uploadSuccess = null,
}) {
  const actions = [];

  if (!clientDocs?.id) {
    actions.push({
      id: 'upload-id',
      title: 'Upload government ID',
      body: 'Needed so case letters match your legal identity.',
      tab: 'documents',
      tone: 'amber',
    });
  }
  if (!clientDocs?.address) {
    actions.push({
      id: 'upload-address',
      title: 'Upload proof of address',
      body: 'Keeps mail and bureau headers aligned to your current address.',
      tab: 'documents',
      tone: 'amber',
    });
  }

  // Letters awaiting a bureau response that the client may have received by mail.
  const waitingOnClientScan = (letters || []).filter((letter) => {
    const mailed = Boolean(letter.mailed_date) && !isPortalMailTerminal(letter);
    const hasStaffResponse = !!(letter.bureau_response_status || letter.bureau_response_received_at || letter.response_outcome);
    const clientUploaded = uploadSuccess === letter.id || (stagedFiles && stagedFiles[letter.id]?.length);
    return mailed && !hasStaffResponse && !clientUploaded && isBureauish(letter);
  });

  waitingOnClientScan.slice(0, 3).forEach((letter) => {
    const bureau = letter.target_bureau || letter.furnisher || 'bureau';
    actions.push({
      id: `upload-response-${letter.id}`,
      title: `Upload ${bureau} response if it arrived`,
      body: 'If you received a letter from the bureau, upload it under Disputes so we can log each account.',
      tab: 'disputes',
      tone: 'blue',
      letterId: letter.id,
    });
  });

  if (!actions.length) {
    actions.push({
      id: 'clear',
      title: 'You’re clear for now',
      body: 'Nothing is needed from you right now. Your team is continuing the documented casework.',
      tab: null,
      tone: 'green',
    });
  }

  return actions;
}

function isBureauish(letter) {
  const t = `${letter.target_type || ''} ${letter.letter_kind || ''} ${letter.type || ''} ${letter.target_bureau || ''}`.toLowerCase();
  return /bureau|equifax|experian|transunion|eq\b|exp\b|tu\b/.test(t) || !!letter.target_bureau;
}

/**
 * Account-level results safe for client display (from packet coverage + letters).
 */
export function buildAccountResults({ packetCoverage = [], letters = [] }) {
  const rows = [];

  (packetCoverage || []).forEach((row) => {
    const outcome = String(
      row.final_disposition
      || row.account_outcome
      || row.response_outcome
      || row.status
      || row.client_progress
      || row.response_status
      || '',
    ).toLowerCase();
    if (!outcome || ['open', 'pending', 'in_flight', 'not_received', 'received', 'analyzing', 'review_ready'].includes(outcome)) return;
    const accountName = row.account_label || row.furnisher || row.account_name || row.creditor_name || 'Account';
    rows.push({
      id: row.coverage_id || row.id || `${row.campaign_id}-${row.account_id || row.client_account_id}`,
      name: `${accountName}${row.masked_account ? ` · ${row.masked_account}` : ''}`,
      bureau: row.bureau || row.target_bureau || row.bureau_code || null,
      outcome,
      outcomeLabel: labelOutcome(outcome),
      positive: isPositiveOutcome(outcome),
    });
  });

  // Fallback: letter-level outcomes when packet coverage is empty.
  if (!rows.length) {
    (letters || []).forEach((letter) => {
      const outcome = String(letter.response_outcome || '').toLowerCase();
      if (!outcome) return;
      rows.push({
        id: letter.id,
        name: letter.furnisher || letter.target_bureau || 'Dispute item',
        bureau: letter.target_bureau || null,
        outcome,
        outcomeLabel: labelOutcome(outcome),
        positive: isPositiveOutcome(outcome),
      });
    });
  }

  const wins = rows.filter((r) => r.positive);
  const working = rows.filter((r) => !r.positive);

  return {
    rows: rows.slice(0, 12),
    wins: wins.length,
    working: working.length,
    hasResults: rows.length > 0,
  };
}

function labelOutcome(outcome) {
  const o = String(outcome || '').toLowerCase();
  if (/delet|remov|corrected_deleted|deleted/.test(o)) return 'Removed';
  if (/verif/.test(o)) return 'Verified — still working';
  if (/updat|correct/.test(o)) return 'Updated';
  if (/partial/.test(o)) return 'Partial result';
  if (/no_response|expired|no response/.test(o)) return 'No response yet';
  if (o === 'resolved') return 'Review complete';
  if (o === 'documents_requested') return 'Documents requested';
  if (o === 'next_step_being_prepared') return 'Next step being prepared';
  if (o === 'reviewed') return 'Reviewed';
  return o.replace(/_/g, ' ') || 'Recorded';
}

function isPositiveOutcome(outcome) {
  const o = String(outcome || '').toLowerCase();
  return /delet|remov|corrected_deleted/.test(o);
}
