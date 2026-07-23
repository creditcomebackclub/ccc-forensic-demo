// ---- Report Diff Engine (Retention Build 1a) ----
// Pure, dependency-free — shared by the frontend (src/utils/storage.js,
// manual "run progress diff") and the server-side narrative background
// function (netlify/functions/progress-narrative-background.mjs, which
// re-verifies rather than trusting a client-supplied diff). Both MUST use
// this exact module, not a re-implementation, or "re-verify server-side"
// stops meaning anything.
//
// Furnisher names and account masking are inconsistent between bureaus and
// between monthly pulls, so matching is confidence-tiered rather than a
// single exact key. A false "deleted" or "new" claim in a client-facing
// narrative is a credibility event that can't be walked back, so any pair we
// aren't confident about goes to `unmatched` instead of being guessed at —
// and the 1b narrative prompt must never be given the unmatched bucket.

// Strip punctuation and common corporate suffixes so the same furnisher
// reported as "Wells Fargo Bank, N.A." one month and "WELLS FARGO BANK NA"
// the next collapses to one comparable string.
const CORP_SUFFIXES = /\b(INC|LLC|LLP|LP|LTD|CO|CORP|CORPORATION|COMPANY|NA|N A|NATIONAL ASSOCIATION)\b/g;
export function normalizeFurnisher(name) {
  return (name || '')
    .toUpperCase()
    .replace(/[.,]/g, '')
    .replace(CORP_SUFFIXES, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Last 4 digits of the masked account number — the one piece of account
// identity that comes straight from the bureau and doesn't vary in format
// between pulls, unlike furnisher name formatting.
export function lastFour(masked) {
  const digits = (masked || '').replace(/[^0-9]/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

// 0..1 token-overlap similarity between two normalized furnisher strings.
// Deliberately simple (no external dep) — good enough to tell "WELLS FARGO"
// from "WELLS FARGO BANK" (should match) apart from "WELLS FARGO" vs
// "SYNCHRONY BANK" (should not).
function nameSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap / Math.max(ta.size, tb.size);
}

function balanceClose(a, b) {
  if (a == null || b == null) return false;
  const tolerance = Math.max(25, 0.08 * Math.max(Math.abs(a), Math.abs(b)));
  return Math.abs(a - b) <= tolerance;
}

function isNegativeAccount(acct) {
  // Type A/C are "original creditor, any derogatory status" / "third-party
  // collector" per the audit classification table (masterPrompt.js §4); Type
  // B is paid/current-with-errors and isn't itself a negative item.
  return acct.type === 'A' || acct.type === 'C';
}

function accountSummary(acct) {
  return {
    furnisher: acct.furnisher,
    accountNumberMasked: acct.accountNumberMasked,
    balance: acct.balance,
    status: acct.status,
    primaryViolation: acct.primaryViolation,
  };
}

export function diffAuditAccounts(oldAudit, newAudit) {
  const oldAccounts = (oldAudit && oldAudit.accounts) || [];
  const newAccounts = (newAudit && newAudit.accounts) || [];

  const oldByIdx = new Map(oldAccounts.map((a, i) => [i, a]));
  const newByIdx = new Map(newAccounts.map((a, i) => [i, a]));
  const oldLeft = new Set(oldByIdx.keys());
  const newLeft = new Set(newByIdx.keys());

  const matches = []; // { oldIdx, newIdx }

  // Pass 1: last-4 anchor. Group by last-4, then within each group pick the
  // best furnisher-similarity pairing. last-4 is strong enough evidence that
  // we only need loose name similarity to confirm it's the same account.
  const oldByLast4 = new Map();
  for (const i of oldLeft) {
    const l4 = lastFour(oldByIdx.get(i).accountNumberMasked);
    if (!l4) continue;
    if (!oldByLast4.has(l4)) oldByLast4.set(l4, []);
    oldByLast4.get(l4).push(i);
  }
  for (const j of [...newLeft]) {
    const newAcct = newByIdx.get(j);
    const l4 = lastFour(newAcct.accountNumberMasked);
    if (!l4 || !oldByLast4.has(l4)) continue;
    const candidates = oldByLast4.get(l4).filter((i) => oldLeft.has(i));
    if (candidates.length === 0) continue;

    let best = null, bestScore = -1;
    for (const i of candidates) {
      const score = nameSimilarity(normalizeFurnisher(oldByIdx.get(i).furnisher), normalizeFurnisher(newAcct.furnisher));
      if (score > bestScore) { bestScore = score; best = i; }
    }
    // last-4 already carries most of the confidence here; a low bar on name
    // similarity is enough to confirm, and ties/near-zero similarity across
    // multiple same-last-4 candidates are genuinely ambiguous — leave them.
    if (best !== null && (candidates.length === 1 ? bestScore >= 0.3 : bestScore >= 0.5)) {
      matches.push({ oldIdx: best, newIdx: j });
      oldLeft.delete(best); newLeft.delete(j); oldByLast4.get(l4).splice(oldByLast4.get(l4).indexOf(best), 1);
    }
  }

  // Pass 2: no usable last-4 on one or both sides — fall back to furnisher
  // similarity + balance proximity, both required, higher bar since we've
  // lost the strongest identity signal.
  for (const j of [...newLeft]) {
    const newAcct = newByIdx.get(j);
    let best = null, bestScore = -1;
    for (const i of oldLeft) {
      const oldAcct = oldByIdx.get(i);
      if (!balanceClose(oldAcct.balance, newAcct.balance)) continue;
      const score = nameSimilarity(normalizeFurnisher(oldAcct.furnisher), normalizeFurnisher(newAcct.furnisher));
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best !== null && bestScore >= 0.6) {
      matches.push({ oldIdx: best, newIdx: j });
      oldLeft.delete(best); newLeft.delete(j);
    }
  }

  const deleted = [], newlyFound = [], changed = [], unchanged = [];

  for (const { oldIdx, newIdx } of matches) {
    const oldAcct = oldByIdx.get(oldIdx);
    const newAcct = newByIdx.get(newIdx);
    const oldViolationCount = (oldAcct.violations || []).length;
    const newViolationCount = (newAcct.violations || []).length;

    const fields = [
      ['balance', oldAcct.balance, newAcct.balance],
      ['status', oldAcct.status, newAcct.status],
      ['paymentRating', oldAcct.paymentRating, newAcct.paymentRating],
      ['dateOfFirstDelinquency', oldAcct.dateOfFirstDelinquency, newAcct.dateOfFirstDelinquency],
      ['remarks', oldAcct.remarks, newAcct.remarks],
      ['disputeFlag', !!oldAcct.disputeFlag, !!newAcct.disputeFlag],
    ];
    const fieldChanges = fields.filter(([, o, n]) => o !== n);
    const violationsChanged = oldViolationCount !== newViolationCount;

    if (fieldChanges.length > 0 || violationsChanged) {
      changed.push({
        furnisher: newAcct.furnisher,
        accountNumberMasked: newAcct.accountNumberMasked,
        changes: Object.fromEntries(fieldChanges.map(([k, o, n]) => [k, { old: o, new: n }])),
        oldViolationCount,
        newViolationCount,
        // Kept for callers/UI still reading the pre-1a shape.
        oldStatus: oldAcct.status,
        newStatus: newAcct.status,
        oldBalance: oldAcct.balance,
        newBalance: newAcct.balance,
      });
    } else {
      unchanged.push({ furnisher: newAcct.furnisher, accountNumberMasked: newAcct.accountNumberMasked });
    }
  }

  // Whatever's left is either a confident deletion/addition (last-4 present
  // and genuinely absent from the other side) or genuinely ambiguous
  // (last-4 missing, or a last-4 collision we couldn't resolve by name — e.g.
  // pass 1 found a same-last-4 candidate but its furnisher was too different
  // to trust) — the latter goes to `unmatched`, never to deleted/new. Built
  // against the FULL account lists (not just what's left) so a collision is
  // detected even though the colliding account was itself confidently
  // matched to something else already.
  const oldLast4All = new Set(oldAccounts.map((a) => lastFour(a.accountNumberMasked)).filter(Boolean));
  const newLast4All = new Set(newAccounts.map((a) => lastFour(a.accountNumberMasked)).filter(Boolean));
  const unmatchedOld = [], unmatchedNew = [];
  for (const i of oldLeft) {
    const acct = oldByIdx.get(i);
    const l4 = lastFour(acct.accountNumberMasked);
    if (l4 && newLast4All.has(l4)) unmatchedOld.push(accountSummary(acct)); // collision, unresolved
    else if (l4) deleted.push(accountSummary(acct));
    else unmatchedOld.push(accountSummary(acct));
  }
  for (const j of newLeft) {
    const acct = newByIdx.get(j);
    const l4 = lastFour(acct.accountNumberMasked);
    if (l4 && oldLast4All.has(l4)) unmatchedNew.push(accountSummary(acct)); // collision, unresolved
    else if (l4) newlyFound.push(accountSummary(acct));
    else unmatchedNew.push(accountSummary(acct));
  }

  const oldScores = (oldAudit && oldAudit.scores) || {};
  const newScores = (newAudit && newAudit.scores) || {};
  const scoreDeltas = {};
  for (const bureau of ['equifax', 'experian', 'transunion']) {
    const o = oldScores[bureau] ?? null;
    const n = newScores[bureau] ?? null;
    scoreDeltas[bureau] = { old: o, new: n, delta: (o != null && n != null) ? n - o : null };
  }

  const negativeCounts = {
    before: oldAccounts.filter(isNegativeAccount).length,
    after: newAccounts.filter(isNegativeAccount).length,
  };
  const totalDebtRemoved = deleted.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);

  return {
    scoreDeltas,
    deleted, new: newlyFound, changed, unchanged,
    unmatched: { old: unmatchedOld, new: unmatchedNew },
    negativeCounts,
    totalDebtRemoved,
  };
}
