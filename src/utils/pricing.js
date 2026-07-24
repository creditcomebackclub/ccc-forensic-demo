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
