// Retention Build 5 — in-flight letter tracker. Shared data layer: used by
// the operator view (LetterTrackerPage.jsx) AND by Build 6's winback sweep
// (a Netlify function, hence this module has zero Supabase/browser
// dependency — pure functions over already-fetched data, importable from
// either side exactly like diffEngine.js).
//
// Display and navigation only — nothing here triggers Phase 2 analysis or
// any other action; it only reads letters/accounts that already exist.

const RESPONSE_WINDOW_DAYS = 30; // Furnisher disputes (Phase 1 / 2)
const CRA_RESPONSE_WINDOW_DAYS = 45; // Direct CRA disputes (Phase 3)

function isPhase3(phase) {
  return String(phase || '').startsWith('Phase 3');
}

function responseWindowDays(phase) {
  return isPhase3(phase) ? CRA_RESPONSE_WINDOW_DAYS : RESPONSE_WINDOW_DAYS;
}

function bureauFromPhase(phase) {
  if (!phase) return null;
  const lower = phase.toLowerCase();
  if (lower.includes('equifax')) return 'Equifax';
  if (lower.includes('experian')) return 'Experian';
  if (lower.includes('transunion')) return 'TransUnion';
  return null;
}

function lastFour(masked) {
  const digits = (masked || '').replace(/[^0-9]/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

// letters: normalized letter objects (mailedDate, deliveredAt,
// responseOutcome, bureauReviewStatus, furnisher, phase, accountId, id — the shape
// normalizeLetter() in storage.js already produces).
// latestAuditAccounts: the `accounts` array from the client's most recent
// audit, used only to resolve accountId -> accountNumberMasked for display
// (same cross-reference ClientsPage.jsx's account-timeline view already
// does) — last-4 is cosmetic here, never used for matching.
export function inFlightLettersForClient(clientName, letters, latestAuditAccounts, clientId = null) {
  const now = new Date();
  const accountsById = new Map((latestAuditAccounts || []).map((a) => [a.id, a]));

  return (letters || [])
    // Mailed but unresolved: a mail date exists and no response has been
    // logged yet (received / no_response / deleted / etc. all count as
    // resolved and drop out of the tracker).
    .filter((l) => {
      if (!l.mailedDate || l.responseOutcome) return false;
      // A Phase 3 bureau response must be reviewed by staff before the next
      // path is selected. Once that decision is recorded, it is no longer an
      // unresolved mailing-clock item even if its original response field is
      // intentionally retained for audit history.
      return !isPhase3(l.phase) || !l.bureauReviewStatus || l.bureauReviewStatus === 'not_reviewed';
    })
    .map((l) => {
      // Deadline computes from delivery date, not mail date — the
      // statutory basis of the whole non-response argument. No delivery
      // yet means no deadline yet either (still in transit).
      const deliveryDate = l.deliveredAt || null;
      const windowDays = responseWindowDays(l.phase);
      const deadline = deliveryDate ? new Date(new Date(deliveryDate).getTime() + windowDays * 86400000) : null;
      const daysRemaining = deadline ? Math.ceil((deadline - now) / 86400000) : null;

      let status;
      if (!deliveryDate) status = 'in_transit';
      else if (daysRemaining <= 0) status = 'overdue'; // §1681s-2(b) non-response — Phase 3 eligible
      else if (daysRemaining <= 5) status = 'due_soon';
      else status = 'awaiting';

      const account = accountsById.get(l.accountId) || null;

      return {
        clientName: l.clientName || clientName,
        clientId: l.clientId || clientId,
        letterId: l.id,
        furnisher: l.furnisher,
        accountLast4: account ? lastFour(account.accountNumberMasked) : null,
        phase: l.phase,
        bureau: bureauFromPhase(l.phase),
        mailDate: l.mailedDate,
        deliveryDate,
        deadline: deadline ? deadline.toISOString().slice(0, 10) : null,
        responseWindowDays: windowDays,
        daysRemaining,
        status,
      };
    });
}
