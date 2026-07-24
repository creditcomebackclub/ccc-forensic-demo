// Persistent account identity — resolves each audit tradeline to a stable
// UUID (client_accounts) that survives across audit runs, so Phase 1/Phase 3
// letters and bureau gating never key on the positional acct_N id (which is
// reassigned every audit and silently pointed at the wrong account).
//
// Pure and dependency-free (reuses only diffEngine's normalizers), so the
// same logic runs in the server-side audit ingest and in a Node backfill,
// and is unit-testable against real data before it touches anything.
//
// Join key: last-4 of the masked account number is the ANCHOR (it comes
// straight from the bureau and is stable across pulls and across furnisher
// renames/sales — which is exactly when furnisher NAME is least reliable).
// Furnisher name and original creditor are supporting signals only. Never
// key on name alone: cross-bureau entity-name conflicts and multiple
// tradelines from one furnisher both defeat it.
import { normalizeFurnisher, lastFour, nameSimilarity } from './diffEngine.js';

// Identity fields derived from an audit account. `original_creditor` and
// `account_last4` may be null; matching degrades gracefully when they are.
export function identityFields(account) {
  return {
    norm_furnisher: normalizeFurnisher(account.furnisher),
    display_furnisher: account.furnisher || null,
    original_creditor: account.originalCreditor ? normalizeFurnisher(account.originalCreditor) : null,
    account_last4: lastFour(account.accountNumberMasked),
  };
}

// Match one incoming account against existing identity rows for the SAME
// client. Returns { identityId, ambiguous, reason, basis }.
//   existing: [{ id, norm_furnisher, original_creditor, account_last4 }]
export function matchAccount(account, existing) {
  const f = identityFields(account);
  const candidates = existing || [];

  if (f.account_last4) {
    // Anchor on last-4. This is what lets a renamed/sold tradeline still
    // match its prior identity.
    const l4 = candidates.filter((e) => e.account_last4 && e.account_last4 === f.account_last4);
    if (l4.length === 1) {
      return { identityId: l4[0].id, ambiguous: false, reason: `last-4 ${f.account_last4} exact match`, basis: 'last4' };
    }
    if (l4.length > 1) {
      // Several existing identities share this last-4 — disambiguate by
      // furnisher-name similarity; only accept a clear winner.
      const ranked = l4
        .map((e) => ({ e, sim: nameSimilarity(f.norm_furnisher, e.norm_furnisher || '') }))
        .sort((a, b) => b.sim - a.sim);
      if (ranked[0].sim - (ranked[1] ? ranked[1].sim : 0) >= 0.3) {
        return { identityId: ranked[0].e.id, ambiguous: false, reason: `last-4 + furnisher name`, basis: 'last4+name' };
      }
      return { identityId: null, ambiguous: true, reason: `${l4.length} existing identities share last-4 ${f.account_last4} with indistinguishable names`, basis: 'ambiguous' };
    }
    // No last-4 match. Before minting a new tradeline, try to adopt an
    // existing identity that has NO last-4 recorded yet and matches strongly
    // on furnisher name — this is the common historical case where an
    // earlier audit couldn't extract the account number but a later one can.
    // Adopting keeps the identity stable across that transition and enriches
    // it with the newly-seen number so future matches get the strong anchor.
    const nameable = candidates
      .filter((e) => !e.account_last4)
      .map((e) => ({ e, sim: nameSimilarity(f.norm_furnisher, e.norm_furnisher || '') }))
      .filter((x) => x.sim >= 0.6)
      .sort((a, b) => b.sim - a.sim);
    if (nameable.length === 1 || (nameable.length > 1 && nameable[0].sim - nameable[1].sim >= 0.3)) {
      return { identityId: nameable[0].e.id, ambiguous: false, reason: `furnisher name (enriching identity with newly-seen last-4 ${f.account_last4})`, basis: 'name->enrich', enrichLast4: f.account_last4 };
    }
    if (nameable.length > 1) {
      return { identityId: null, ambiguous: true, reason: `last-4 ${f.account_last4} is new and multiple number-less identities match the name`, basis: 'ambiguous' };
    }
    // Genuinely new tradeline (keeps two different Capital One cards distinct).
    return { identityId: null, ambiguous: false, reason: `last-4 ${f.account_last4} not seen for this client`, basis: 'new' };
  }

  // No last-4 available — fall back to furnisher name + original creditor,
  // with a higher bar since we've lost the strongest signal.
  const scored = candidates
    .map((e) => {
      const sim = nameSimilarity(f.norm_furnisher, e.norm_furnisher || '');
      const ocMatch = f.original_creditor && e.original_creditor && f.original_creditor === e.original_creditor;
      return { e, score: sim + (ocMatch ? 0.2 : 0) };
    })
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { identityId: null, ambiguous: false, reason: 'no existing identities for this client', basis: 'new' };
  const best = scored[0];
  const second = scored[1];
  if (best.score >= 0.8) {
    if (!second || best.score - second.score >= 0.2) {
      return { identityId: best.e.id, ambiguous: false, reason: 'furnisher name / original creditor (no account number)', basis: 'fuzzy' };
    }
    return { identityId: null, ambiguous: true, reason: 'multiple similar candidates and no account number to disambiguate', basis: 'ambiguous' };
  }
  return { identityId: null, ambiguous: false, reason: 'no confident match without an account number', basis: 'new' };
}

// Orchestrates a whole audit's accounts against the existing identities,
// generating one UUID per real tradeline. Handles the case the spec calls
// out — an ambiguous match must be flagged, never auto-resolved — AND the
// intra-audit collision case (two accounts in the SAME audit resolving to
// one identity, e.g. two AMEX cards sharing a masked number): both are
// flagged for review rather than silently merged.
//
//   accounts:  audit.accounts (each gets a `clientAccountId` assigned)
//   existing:  current client_accounts rows for this client
//   newId:     () => uuid   (injected so this stays pure/testable)
// Returns { assignments: Map(account.id -> uuid|null),
//           creates:  [{ id, ...identityFields }],
//           enriches: [{ id, account_last4 }]   (existing rows to update),
//           reviews:  [{ accountId, identityId, reason }] }
export function resolveAuditIdentities(accounts, existing, newId) {
  const assignments = new Map();
  const creates = [];
  const enriches = [];
  const reviews = [];
  // Work against a growing pool so a second account in this same audit can
  // match an identity created earlier in this same run (which then surfaces
  // as a collision, below).
  const pool = existing.slice();
  const claimedBy = new Map(); // identityId -> first accountId that claimed it

  for (const acct of accounts) {
    const m = matchAccount(acct, pool);

    if (m.ambiguous) {
      assignments.set(acct.id, null);
      reviews.push({ accountId: acct.id, identityId: null, reason: m.reason });
      continue;
    }

    if (m.identityId) {
      if (claimedBy.has(m.identityId)) {
        // Two accounts in one audit map to the same identity — do not merge.
        assignments.set(acct.id, null);
        reviews.push({ accountId: acct.id, identityId: m.identityId, reason: `collides with account ${claimedBy.get(m.identityId)} on the same identity (${m.reason}) — needs manual review` });
        continue;
      }
      claimedBy.set(m.identityId, acct.id);
      assignments.set(acct.id, m.identityId);
      if (m.enrichLast4) {
        enriches.push({ id: m.identityId, account_last4: m.enrichLast4 });
        const row = pool.find((e) => e.id === m.identityId);
        if (row) row.account_last4 = m.enrichLast4; // so intra-audit siblings see it
      }
      continue;
    }

    // New tradeline → mint an identity and add it to the pool.
    const id = newId();
    const fields = identityFields(acct);
    creates.push({ id, ...fields });
    pool.push({ id, ...fields });
    claimedBy.set(id, acct.id);
    assignments.set(acct.id, id);
  }

  return { assignments, creates, enriches, reviews };
}
