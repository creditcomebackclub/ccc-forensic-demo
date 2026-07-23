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
// client keeps paying. "Paid" is therefore a ledger of payout events
// (commission_payouts), each covering specific ledger transaction ids, never
// a single permanent boolean — a boolean can't represent "paid through some
// point, still accruing."

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
  const coveredTxIds = new Set((payoutsForClient || []).flatMap((p) => p.covered_tx_ids || []));

  let earned = 0;
  let paid = 0;
  const unpaidTxIds = [];

  for (const tx of recognizedTransactions(client)) {
    const commission = (parseFloat(tx.amount) || 0) * rate;
    earned += commission;
    // A transaction with no stable id can never be marked covered — it
    // always shows as owed rather than being silently treated as paid.
    if (tx.id && coveredTxIds.has(tx.id)) {
      paid += commission;
    } else {
      paid += 0;
      unpaidTxIds.push(tx.id || null);
    }
  }

  return { earned, paid, owed: earned - paid, unpaidTxIds: unpaidTxIds.filter(Boolean) };
}
