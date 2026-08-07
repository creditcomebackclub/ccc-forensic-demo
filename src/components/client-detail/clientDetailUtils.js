// Shared helpers for the staff client command-center detail view.
// Letter status codes mirror ClientsPage.letterStatus — keep in sync.

export const WINDOW_DAYS = 30;

export const LETTER_STAGES = ['Generated', 'Mailed', 'Delivered', 'Outcome'];

export const MAIL_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'not_mailed', label: 'Not mailed' },
  { key: 'in_transit', label: 'In transit' },
  { key: 'awaiting', label: 'Awaiting' },
  { key: 'window_closed', label: 'Ready to escalate' },
  { key: 'received', label: 'Needs Phase 3' },
  { key: 'outcome', label: 'Outcome logged' },
];

/** Map board list chips → Letters tab filter keys */
/** Map board list chips → Letters tab filter keys (only dispute-mail chips) */
export const LIST_FILTER_TO_LETTER = {
  ready: 'received',
  awaiting: 'awaiting',
  escalate: 'window_closed',
  received: 'received',
};

function todayISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function daysBetween(aIso, bIso) {
  const a = new Date(String(aIso).slice(0, 10) + 'T00:00:00');
  const b = new Date(String(bIso).slice(0, 10) + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

export function letterStatusCode(l, windowDays = WINDOW_DAYS) {
  if (l.responseOutcome === 'received') return 'received';
  if (l.responseOutcome === 'no_response') return 'no_response';
  if (!l.mailedDate) return 'not_mailed';
  if (!l.deliveredAt) return 'in_transit';
  const clockStart = l.deliveredAt.slice(0, 10);
  const elapsed = daysBetween(clockStart, todayISO());
  const remaining = windowDays - elapsed;
  if (remaining > 0) return 'awaiting';
  return 'window_closed';
}

export function letterStageIndex(l) {
  if (l.responseOutcome) return 3;
  if (l.trackingStatus === 'Delivered' || l.deliveredAt) return 2;
  if (l.mailedDate) return 1;
  return 0;
}

export function letterMatchesMailFilter(l, filterKey) {
  if (!filterKey || filterKey === 'all') return true;
  const code = letterStatusCode(l);
  if (filterKey === 'outcome') return code === 'received' || code === 'no_response';
  if (filterKey === 'received') {
    // Needs Phase 3: response received on Phase 1/2, or ready-to-analyze
    return code === 'received' && !(l.phase || '').startsWith('Phase 3');
  }
  return code === filterKey;
}

export function countMailStatuses(letters = []) {
  const counts = {
    all: letters.length,
    not_mailed: 0,
    in_transit: 0,
    awaiting: 0,
    window_closed: 0,
    received: 0,
    outcome: 0,
    no_response: 0,
  };
  for (const l of letters) {
    const code = letterStatusCode(l);
    if (counts[code] != null) counts[code] += 1;
    if (code === 'received' || code === 'no_response') counts.outcome += 1;
  }
  // Needs Phase 3 chip uses a tighter match than raw `received` status
  counts.received = letters.filter((l) => letterMatchesMailFilter(l, 'received')).length;
  return counts;
}

export function summarizeCampaignPhases(phaseRows = []) {
  const byPhase = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const row of phaseRows) {
    const p = Number(row.phase) || 1;
    if (byPhase[p] != null) byPhase[p] += 1;
    else byPhase[1] += 1;
  }
  const total = phaseRows.length;
  const dominant = total === 0
    ? null
    : [4, 3, 2, 1].find((p) => byPhase[p] > 0) || 1;
  return { byPhase, total, dominant };
}

/**
 * Single next-action for the command header.
 * Returns { label, detail, letterFilter, tone }
 */
export function deriveNextAction(client) {
  const letters = client?.letters || [];
  const open = letters.filter((l) => !(l.phase || '').startsWith('Phase 3'));

  const notMailed = open.filter((l) => letterStatusCode(l) === 'not_mailed');
  const logResponse = letters.filter((l) => l.mailedDate && !l.responseOutcome);
  const escalate = open.filter((l) => {
    const code = letterStatusCode(l);
    const hasPhase3 = letters.some(
      (pl) => (pl.phase || '').startsWith('Phase 3') && pl.furnisher === l.furnisher
    );
    return (code === 'window_closed' || code === 'no_response') && !hasPhase3;
  });
  const needsAnalyze = open.filter((l) => {
    const code = letterStatusCode(l);
    return code === 'received' || code === 'window_closed' || code === 'no_response';
  });
  const inTransit = open.filter((l) => letterStatusCode(l) === 'in_transit');
  const awaiting = open.filter((l) => letterStatusCode(l) === 'awaiting');

  if (escalate.length > 0) {
    return {
      label: escalate.length === 1 ? 'Escalate 1 letter' : `Escalate ${escalate.length} letters`,
      detail: 'Window elapsed — ready for Phase 3',
      letterFilter: 'window_closed',
      tone: 'urgent',
    };
  }
  if (needsAnalyze.some((l) => letterStatusCode(l) === 'received')) {
    const n = needsAnalyze.filter((l) => letterStatusCode(l) === 'received').length;
    return {
      label: n === 1 ? 'Analyze 1 response' : `Analyze ${n} responses`,
      detail: 'Client or bureau response ready for Phase 2',
      letterFilter: 'received',
      tone: 'action',
    };
  }
  if (logResponse.length > 0) {
    const hasAwaiting = logResponse.some((l) => letterStatusCode(l) === 'awaiting');
    return {
      label: logResponse.length === 1 ? 'Log 1 response' : `Log ${logResponse.length} responses`,
      detail: 'Mailed letters waiting for an outcome',
      letterFilter: hasAwaiting ? 'awaiting' : 'in_transit',
      tone: 'action',
    };
  }
  if (notMailed.length > 0) {
    return {
      label: notMailed.length === 1 ? 'Mail 1 letter' : `Mail ${notMailed.length} letters`,
      detail: 'Drafts ready to send via Lob',
      letterFilter: 'not_mailed',
      tone: 'action',
    };
  }
  if (awaiting.length > 0) {
    return {
      label: awaiting.length === 1 ? '1 letter awaiting' : `${awaiting.length} letters awaiting`,
      detail: 'Inside the FCRA response window',
      letterFilter: 'awaiting',
      tone: 'wait',
    };
  }
  if (inTransit.length > 0) {
    return {
      label: inTransit.length === 1 ? '1 letter in transit' : `${inTransit.length} in transit`,
      detail: 'Waiting on USPS delivery',
      letterFilter: 'in_transit',
      tone: 'wait',
    };
  }
  if (letters.length === 0) {
    return {
      label: 'Run an audit',
      detail: 'No letters yet — generate Phase 1 from an audit',
      letterFilter: 'all',
      tone: 'neutral',
    };
  }
  return {
    label: 'On track',
    detail: 'No urgent letter actions',
    letterFilter: 'all',
    tone: 'clear',
  };
}
