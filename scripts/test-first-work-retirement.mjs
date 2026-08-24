import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  ACTIVE_PRICING_VERSION,
  DEFAULT_TIER_PRICING,
  describeTierFee,
  getTierPricing,
} from '../src/utils/pricing.js';
import {
  collectedTotal,
  computeClientCommission,
  eligibleCollectedAmount,
  recognizedTotal,
} from '../src/utils/affiliateCommission.js';
import { agreementOpeningInvoicePreview } from '../src/utils/manualBilling.js';

const require = createRequire(import.meta.url);
const agreement = require('../netlify/functions/_serviceAgreement.cjs');

assert.deepEqual(DEFAULT_TIER_PRICING, {
  Standard: { monthlyFee: 149 },
  VIP: { monthlyFee: 299 },
  'Paid In Full': { flatFee: 849, flatMonths: 6 },
});
assert.equal(ACTIVE_PRICING_VERSION, 'ccc-pricing-v3-pif-849-2026-08-23');
assert.equal(ACTIVE_PRICING_VERSION, agreement.ACTIVE_PRICING_VERSION);

const retiredSettings = getTierPricing({
  pricing: {
    tiers: {
      Standard: { monthlyFee: 79, firstWorkFee: 75 },
      VIP: { monthlyFee: 149, firstWorkFee: 99 },
      'Paid In Full': { flatFee: 499, flatMonths: 6, firstWorkFee: 0 },
    },
  },
});
assert.deepEqual(retiredSettings, DEFAULT_TIER_PRICING, 'unversioned saved settings must not revive retired pricing');

const priorVersionSettings = getTierPricing({
  pricing: {
    version: 'ccc-pricing-v2-no-first-work-2026-08-20',
    tiers: {
      Standard: { monthlyFee: 149 },
      VIP: { monthlyFee: 299 },
      'Paid In Full': { flatFee: 997, flatMonths: 6 },
    },
  },
});
assert.deepEqual(priorVersionSettings, DEFAULT_TIER_PRICING, 'saved v2 pricing must not override the new $849 schedule');

const activeOverride = getTierPricing({
  pricing: {
    version: ACTIVE_PRICING_VERSION,
    tiers: { Standard: { monthlyFee: 175, firstWorkFee: 500 } },
  },
});
assert.equal(activeOverride.Standard.monthlyFee, 175);
assert.equal(Object.hasOwn(activeOverride.Standard, 'firstWorkFee'), false);
assert.equal(activeOverride.VIP.monthlyFee, 299);
assert.doesNotMatch(describeTierFee('Standard', retiredSettings), /First Work/i);
assert.equal(describeTierFee('Standard', retiredSettings), '$149/month.');
assert.equal(describeTierFee('Paid In Full', retiredSettings), '$849 flat for 6 months of service (no monthly billing).');

const standardPlan = agreement.planSnapshot({ billing_tier: 'Standard', service_agreement_mode: 'tier' });
const vipPlan = agreement.planSnapshot({ billing_tier: 'VIP', service_agreement_mode: 'tier' });
const paidPlan = agreement.planSnapshot({ billing_tier: 'Paid In Full', service_agreement_mode: 'tier' });
const migratedLegacyPlan = agreement.planSnapshot(
  { billing_tier: 'Standard', service_agreement_mode: 'tier' },
  { tiers: { Standard: { monthlyFee: 79, firstWorkFee: 75 } }, source: 'admin_settings_file' },
);
assert.equal(standardPlan.monthlyFee, 149);
assert.equal(vipPlan.monthlyFee, 299);
assert.equal(paidPlan.flatFee, 849);
assert.equal(migratedLegacyPlan.monthlyFee, 149);
assert.equal(migratedLegacyPlan.pricingSource, 'owner_approved_defaults_retired_legacy_settings');
for (const plan of [standardPlan, vipPlan, paidPlan]) {
  assert.equal(Object.hasOwn(plan, 'firstWorkFee'), false);
  assert.doesNotMatch(plan.feeText, /First Work/i);
  assert.equal(plan.pricingVersion, ACTIVE_PRICING_VERSION);
}

const newMonthlyInvoice = agreementOpeningInvoicePreview(standardPlan);
assert.equal(newMonthlyInvoice.total, 149);
assert.deepEqual(newMonthlyInvoice.lineItems, [
  { code: 'first_monthly_payment', description: 'First Monthly Payment', amount: 149 },
]);
const legacyInvoice = agreementOpeningInvoicePreview({
  mode: 'tier', billingTier: 'Standard', label: 'Standard',
  firstWorkFee: 75, firstMonthlyPayment: 79,
});
assert.equal(legacyInvoice.total, 154);
assert.deepEqual(legacyInvoice.lineItems.map((item) => item.code), ['first_work_fee', 'first_monthly_payment']);
assert.equal(agreementOpeningInvoicePreview(paidPlan).total, 849);

const revenueLedger = [
  { id: 'paid-invoice', type: 'Invoice', status: 'Paid', amount: 149 },
  { id: 'legacy-payment', type: 'Payment', amount: 50 },
  { id: 'due-invoice', type: 'Invoice', status: 'Due', amount: 299 },
  { id: 'refunded-payment', type: 'Payment', status: 'Refunded', amount: 100 },
  { id: 'forecast', type: 'Forecast', status: 'Paid', amount: 849 },
  { id: 'excluded', type: 'Payment', status: 'Paid', amount: 25, commission_eligible: false },
];
assert.equal(eligibleCollectedAmount(revenueLedger[0]), 149);
assert.equal(eligibleCollectedAmount(revenueLedger[2]), 0);
assert.equal(recognizedTotal({ ledger: revenueLedger }), 199);
assert.equal(collectedTotal({ ledger: revenueLedger }), 224, 'commission exclusion does not erase collected revenue from client billing totals');
assert.equal(
  computeClientCommission({ ledger: revenueLedger }, { commission_rate: 0.20 }, []).earned,
  39.8,
);

const settingsUi = readFileSync(new URL('../src/components/SettingsModal.jsx', import.meta.url), 'utf8');
const affiliatePortal = readFileSync(new URL('../src/components/AffiliatePortal.jsx', import.meta.url), 'utf8');
const affiliateInvite = readFileSync(new URL('../netlify/functions/provision-user.cjs', import.meta.url), 'utf8');
const sop = readFileSync(new URL('../src/utils/sopContent.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260820360000_retire_first_work_fee.sql', import.meta.url), 'utf8');
assert.doesNotMatch(settingsUi, /First Work Fee \(\$\)/i);
assert.doesNotMatch(affiliatePortal, /of the First Work Fee/i);
assert.doesNotMatch(affiliateInvite, /of the First Work Fee/i);
assert.match(affiliatePortal, /actual eligible client revenue recorded as collected/i);
assert.match(sop, /Standard at \$149 per month, VIP at \$299 per month, or Paid In Full at \$849/i);
assert.match(migration, /V3 starts in counsel_review/i);
assert.doesNotMatch(migration, /set legal_status = 'approved'/i);
assert.doesNotMatch(migration, /update public\.client_service_agreements\s+set plan_snapshot/i);
assert.doesNotMatch(migration, /update public\.clients\s+set ledger\s*=\s*'\[\]'/i);

console.log('First Work Fee retirement, mixed-version billing, and eligible-revenue contracts passed.');
