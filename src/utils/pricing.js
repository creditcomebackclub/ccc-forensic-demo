// Single source of truth for tiered service pricing — shared by the LPOA/
// client agreement (ClientSetupFlow.jsx), the admin Settings pricing tab
// (SettingsModal.jsx), and revenue reporting (BillingDashboardPage.jsx).
// Previously each of these read from (or hardcoded) a DIFFERENT number, so
// a client's signed LPOA could cite a flat fee that didn't match their
// actual assigned billing tier at all — see the Settings audit that led to
// this file. Real pricing is inherently tiered; there is no single "the"
// monthly fee.

export const DEFAULT_TIER_PRICING = {
  Standard: { monthlyFee: 79, firstWorkFee: 75 },
  VIP: { monthlyFee: 149, firstWorkFee: 99 },
  'Paid In Full': { flatFee: 499, flatMonths: 6, firstWorkFee: 0 },
};

// Merges any admin-configured overrides (settings.pricing.tiers) over the
// defaults above — same shape, so a partial override (e.g. just Standard's
// monthly fee) doesn't lose the rest.
export function getTierPricing(settings) {
  const overrides = (settings && settings.pricing && settings.pricing.tiers) || {};
  const out = {};
  for (const tier of Object.keys(DEFAULT_TIER_PRICING)) {
    out[tier] = { ...DEFAULT_TIER_PRICING[tier], ...(overrides[tier] || {}) };
  }
  return out;
}

// Human-readable fee-schedule line(s) for a specific tier — used verbatim
// in both the signed LPOA and the setup-flow agreement preview so they can
// never drift from each other.
export function describeTierFee(tier, pricing) {
  const p = pricing[tier];
  if (!p) return null;
  if (tier === 'Paid In Full') {
    return `$${p.flatFee} flat for ${p.flatMonths} months of service (no monthly billing)${p.firstWorkFee ? `, plus a $${p.firstWorkFee} First Work Fee` : ' — First Work Fee waived'}.`;
  }
  return `$${p.monthlyFee}/month, plus a $${p.firstWorkFee} First Work Fee due after audit delivery.`;
}

export const INQUIRY_ONLY_FEE_TEXT =
  'Personal Information / Inquiry Removal Fee: $50 per bureau, one-time. No monthly service fee. No deletion = no charge.';

/** True when this client has a custom LPOA fee override saved. */
export function hasCustomServiceAgreement(client) {
  if (!client) return false;
  const mode = client.serviceAgreementMode || client.service_agreement_mode;
  const feeText = client.serviceAgreementFeeText || client.service_agreement_fee_text;
  return mode === 'custom' && !!(feeText && String(feeText).trim());
}

/**
 * Resolve LPOA Section 4 fee prose for a client.
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
