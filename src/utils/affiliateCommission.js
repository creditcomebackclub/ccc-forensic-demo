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
//
// Cash recognition must count each real cash event once. Live NMI sales mark
// Invoice(s) Paid AND append a Payment for the same amount — counting both
// would 2× commission and revenue. Prefer Payments; keep standalone Paid
// Invoices (legacy "Mark as Paid" with no matching Payment).

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function dayKey(tx) {
  if (!tx) return '';
  if (tx.type === 'Invoice') return String(tx.paid_at || tx.date || '').slice(0, 10);
  return String(tx.date || tx.paid_at || '').slice(0, 10);
}

/**
 * Cash-recognized ledger rows for commission / lifetime revenue.
 * - All Payment rows count.
 * - Paid Invoices count only when not already covered by a Payment
 *   (shared payment_transaction_id / nmi_transaction_id, or same-day
 *   same-amount match for loosely linked entries).
 */
export function recognizedTransactions(client) {
  const ledger = Array.isArray(client?.ledger) ? client.ledger : [];
  const payments = ledger.filter((tx) => tx && tx.type === 'Payment');

  const coveredKeys = new Set();
  for (const p of payments) {
    if (p.payment_transaction_id) coveredKeys.add(`pt:${p.payment_transaction_id}`);
    if (p.nmi_transaction_id) coveredKeys.add(`nmi:${p.nmi_transaction_id}`);
  }

  // Consume Payments once for amount+date matching so one Payment cannot
  // suppress two unrelated Paid Invoices of the same amount on the same day.
  const matchSlots = payments.map((p) => ({
    amount: round2(p.amount),
    day: dayKey(p),
    used: false,
  }));

  const standalonePaidInvoices = [];
  for (const tx of ledger) {
    if (!tx || tx.type !== 'Invoice' || tx.status !== 'Paid') continue;

    if (tx.payment_transaction_id && coveredKeys.has(`pt:${tx.payment_transaction_id}`)) continue;
    if (tx.nmi_transaction_id && coveredKeys.has(`nmi:${tx.nmi_transaction_id}`)) continue;

    const invAmount = round2(tx.amount);
    const invDay = dayKey(tx);
    const invoiceDate = String(tx.date || '').slice(0, 10);
    const slot = matchSlots.find((s) => (
      !s.used
      && Math.abs(s.amount - invAmount) < 0.005
      && (s.day === invDay || s.day === invoiceDate)
    ));
    if (slot) {
      slot.used = true;
      continue;
    }

    standalonePaidInvoices.push(tx);
  }

  return [...payments, ...standalonePaidInvoices];
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
