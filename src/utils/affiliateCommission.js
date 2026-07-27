// Shared affiliate commission calculation. Pure, dependency-free — same
// pattern as diffEngine.js and inFlightLetters.js: usable directly from the
// frontend and from a .cjs Netlify function via dynamic import(). Single
// source of truth replacing six independent reimplementations of the same
// "lifetime revenue × rate" formula (AffiliateProfilePanel.jsx,
// AffiliatePortal.jsx, App.jsx, ClientBillingPanel.jsx,
// BillingDashboardPage.jsx, and affiliate-portal-data.cjs).
//
// Commission is genuinely recurring — 20% (or a per-client override) of the
// First Work Fee AND every month of ongoing revenue, for as long as the
// client keeps paying. "Paid" is therefore the sum of durable payout events,
// never a single permanent boolean. The old implementation treated an entire
// transaction as paid merely because its id appeared in covered_tx_ids. That
// made a $1 partial payout appear to settle every transaction it referenced.
// Dollar amounts are now the source of truth; covered_tx_ids remains only a
// legacy/audit hint while manual billing is still backed by the JSON ledger.

function isRecognized(tx) {
  return tx.type === 'Payment' || (tx.type === 'Invoice' && tx.status === 'Paid');
}

export function recognizedTransactions(client) {
  const ledger = Array.isArray(client.ledger) ? client.ledger : [];
  return ledger.filter(isRecognized);
}

export function recognizedTotal(client) {
  return recognizedTransactions(client).reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);
}

// client.referral_fee is a percentage-point override (e.g. 25 for 25%);
// affiliate.commission_rate is stored as a decimal (e.g. 0.20) — this
// reconciles the two storage conventions in one place instead of five.
export function commissionRate(client, affiliate) {
  const override = client.referral_fee;
  const pct = (override !== null && override !== undefined) ? override : ((affiliate && affiliate.commission_rate) || 0.20) * 100;
  return pct / 100;
}

// payoutsForClient: commission_payouts rows already scoped to this one
// client (caller filters by client_id before calling).
export function computeClientCommission(client, affiliate, payoutsForClient) {
  const rate = commissionRate(client, affiliate);
  const rows = recognizedTransactions(client)
    .map((tx) => ({ tx, commission: (parseFloat(tx.amount) || 0) * rate }))
    .sort((a, b) => String(a.tx.date || '').localeCompare(String(b.tx.date || '')) || String(a.tx.id || '').localeCompare(String(b.tx.id || '')));
  const earned = rows.reduce((sum, row) => sum + row.commission, 0);

  // A payout row represents cash actually paid to the affiliate. Clamp its
  // aggregate to earned commission so a legacy over-entry can never make the
  // dashboard show a negative payable. New UI writes reject overpayments.
  const payoutTotal = (payoutsForClient || []).reduce((sum, payout) => sum + Math.max(0, parseFloat(payout.amount) || 0), 0);
  const paid = Math.min(earned, payoutTotal);
  const owed = Math.max(0, earned - paid);

  // Allocate payout credit oldest-first solely to retain a useful legacy
  // covered_tx_ids audit trail on the next manual payout. Financial totals do
  // not depend on this list anymore, which is what makes partial payouts safe.
  let remainingCredit = paid;
  const unpaidTxIds = [];
  for (const row of rows) {
    const settled = Math.min(row.commission, remainingCredit);
    remainingCredit -= settled;
    if (row.commission - settled > 0.005 && row.tx.id) unpaidTxIds.push(row.tx.id);
  }

  return { earned, paid, owed, unpaidTxIds };
}
