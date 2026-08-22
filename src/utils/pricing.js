// Single source of truth for tiered service pricing — shared by the client
// agreement, the admin Settings pricing tab
// (SettingsModal.jsx), and revenue reporting (BillingDashboardPage.jsx).
// Previously each of these read from (or hardcoded) a DIFFERENT number, so
// a client's signed agreement could cite a flat fee that didn't match their
// actual assigned billing tier at all — see the Settings audit that led to
// this file. Real pricing is inherently tiered; there is no single "the"
// monthly fee.

export const ACTIVE_PRICING_VERSION = 'ccc-pricing-v2-no-first-work-2026-08-20';

export const DEFAULT_TIER_PRICING = {
  Standard: { monthlyFee: 149 },
  VIP: { monthlyFee: 299 },
  'Paid In Full': { flatFee: 997, flatMonths: 6 },
};

const RECURRING_CHARGE_PATTERN = /monthly|membership/i;
const NON_REVENUE_LEDGER_STATUSES = new Set(['cancelled', 'canceled', 'void', 'voided', 'refunded']);

/**
 * Resolve the monthly fee for a recurring client without coupling MRR to the
 * current invoice balance. Configured agreement/tier pricing wins; legacy
 * accounts without either fall back to their latest monthly ledger charge.
 * Paid and outstanding charges intentionally resolve to the same amount.
 */
export function resolveRecurringMonthlyFee(client, pricing = DEFAULT_TIER_PRICING) {
  if (!client) return 0;
  const billingType = client.billingType || client.billing_type;
  if (billingType !== 'Automated Recurring') return 0;

  const recurringAmount = Number(client.billingRecurringAmount ?? client.billing_recurring_amount);
  if (Number.isFinite(recurringAmount) && recurringAmount > 0) return recurringAmount;

  const tier = client.billingTier || client.billing_tier;
  const tierAmount = Number(pricing?.[tier]?.monthlyFee);
  if (Number.isFinite(tierAmount) && tierAmount > 0) return tierAmount;

  const ledger = Array.isArray(client.ledger) ? client.ledger : [];
  const recurringCharges = ledger
    .filter((entry) => {
      const amount = Number(entry?.amount);
      const status = String(entry?.status || '').toLowerCase();
      return Number.isFinite(amount)
        && amount > 0
        && RECURRING_CHARGE_PATTERN.test(String(entry?.description || ''))
        && !NON_REVENUE_LEDGER_STATUSES.has(status);
    })
    .sort((a, b) => new Date(b?.date || b?.paid_at || 0) - new Date(a?.date || a?.paid_at || 0));

  return recurringCharges.length ? Number(recurringCharges[0].amount) : 0;
}

/** Sum active recurring agreements; ledger balance state never gates inclusion. */
export function calculateActiveRecurringMrr(clients, pricing = DEFAULT_TIER_PRICING) {
  return (Array.isArray(clients) ? clients : []).reduce((total, client) => {
    const status = client?.billingStatus || client?.billing_status;
    return status === 'Active'
      ? total + resolveRecurringMonthlyFee(client, pricing)
      : total;
  }, 0);
}

// Merges any admin-configured overrides (settings.pricing.tiers) over the
// defaults above — same shape, so a partial override (e.g. just Standard's
// monthly fee) doesn't lose the rest.
export function getTierPricing(settings) {
  // Unversioned settings contain the retired $79/$149/$499 + First Work
  // schedule. Never merge those stale values into a new agreement. An owner
  // may edit the active schedule after Settings has saved this exact version.
  const pricing = settings?.pricing || {};
  const overrides = pricing.version === ACTIVE_PRICING_VERSION
    ? (pricing.tiers || {})
    : {};
  const out = {};
  for (const tier of Object.keys(DEFAULT_TIER_PRICING)) {
    const candidate = overrides[tier] || {};
    const allowed = tier === 'Paid In Full'
      ? { flatFee: candidate.flatFee, flatMonths: candidate.flatMonths }
      : { monthlyFee: candidate.monthlyFee };
    out[tier] = {
      ...DEFAULT_TIER_PRICING[tier],
      ...Object.fromEntries(Object.entries(allowed).filter(([, value]) => value != null)),
    };
  }
  return out;
}

// Human-readable fee-schedule line(s) for a specific tier — used verbatim
// in both the signed agreement and its staff-side preview so they can
// never drift from each other.
export function describeTierFee(tier, pricing) {
  const p = pricing[tier];
  if (!p) return null;
  if (tier === 'Paid In Full') {
    return `$${p.flatFee} flat for ${p.flatMonths} months of service (no monthly billing).`;
  }
  return `$${p.monthlyFee}/month.`;
}

export const INQUIRY_ONLY_FEE_TEXT =
  'Personal Information / Inquiry Removal Fee: $50 per bureau, one-time. No monthly service fee. No deletion = no charge.';

/** True when this client has a custom service-agreement fee override saved. */
export function hasCustomServiceAgreement(client) {
  if (!client) return false;
  const mode = client.serviceAgreementMode || client.service_agreement_mode;
  const feeText = client.serviceAgreementFeeText || client.service_agreement_fee_text;
  return mode === 'custom' && !!(feeText && String(feeText).trim());
}

/**
 * Resolve client-facing service-agreement fee prose for a client.
 * Custom agreement wins; otherwise tier text (or inquiry default when requested).
 * `client` may use camelCase (app) or snake_case (DB/API) keys.
 */
export function resolveClientFeeText(client, settings, { lpoaType = 'standard' } = {}) {
  if (hasCustomServiceAgreement(client)) {
    return String(client.serviceAgreementFeeText || client.service_agreement_fee_text).trim();
  }
  if (lpoaType === 'inquiry') return INQUIRY_ONLY_FEE_TEXT;
  const pricing = getTierPricing(settings);
  const tier = client?.billingTier || client?.billing_tier || 'Standard';
  return describeTierFee(tier, pricing) || describeTierFee('Standard', pricing);
}

/** Build Dilian-style late-payment package fee text from staff inputs. */
export function buildLatePaymentPackage({
  perBureau = 75,
  bureauCount = 2,
  includeInquiryPi = true,
} = {}) {
  const per = Number(perBureau) || 0;
  const count = Math.max(1, parseInt(bureauCount, 10) || 1);
  const total = per * count;
  const included = includeInquiryPi
    ? ', including personal information and inquiry cleanup letters'
    : '';
  const label = includeInquiryPi
    ? `Late payment + inquiry/PI (${count} bureau${count === 1 ? '' : 's'})`
    : `Late payment remediation (${count} bureau${count === 1 ? '' : 's'})`;
  const feeText =
    `One-time fee of $${total} ($${per} per bureau × ${count} bureau${count === 1 ? '' : 's'}) ` +
    `for late-payment remediation on the credit-card account${included}. No monthly service fee.`;
  return { label, amount: total, feeText };
}
