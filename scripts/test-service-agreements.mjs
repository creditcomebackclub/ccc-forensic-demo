import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const agreement = require('../netlify/functions/_serviceAgreement.cjs');
const agreementOnboarding = require('../netlify/functions/agreement-onboarding.cjs');

assert.equal(agreement.AGREEMENT_TEMPLATE_VERSION, 'ccc-service-agreement-v3-no-first-work');
assert.equal(agreement.PRIOR_SERVICE_ONLY_AGREEMENT_TEMPLATE_VERSION, 'ccc-service-agreement-v2-service-only');
assert.equal(agreement.CONTACT.phone, '970-644-0063');
assert.equal(agreement.PRINCIPAL_BUSINESS_ADDRESS, '3088 Colorado Ave, Grand Junction, CO 81504');

const standard = agreement.planSnapshot({ billing_tier: 'Standard', service_agreement_mode: 'tier' });
assert.deepEqual({
  label: standard.label,
  billingTier: standard.billingTier,
  monthlyFee: standard.monthlyFee,
  flatFee: standard.flatFee,
  amount: standard.amount,
}, {
  label: 'Standard', billingTier: 'Standard', monthlyFee: 149, flatFee: null, amount: 149,
});
assert.equal(standard.firstWorkFee, undefined);
assert.match(standard.feeText, /\$149\/month/i);
assert.equal(standard.serviceScopeVersion, agreement.PLAN_SCOPE_VERSION);
assert.equal(standard.serviceScope.correspondenceLimit, 3);
assert.match(standard.serviceScope.includedServices.join(' '), /up to 3 individualized correspondence pieces/i);
assert.doesNotMatch(standard.feeText, /First Work/i);
assert.doesNotMatch(standard.feeText, /audit/i);

const vip = agreement.planSnapshot({ billing_tier: 'VIP', service_agreement_mode: 'tier' }, {
  version: agreement.ACTIVE_PRICING_VERSION,
  tiers: { VIP: { monthlyFee: '319' } },
});
assert.equal(vip.monthlyFee, 319);
assert.equal(vip.firstWorkFee, undefined);
assert.equal(vip.amount, 319);
assert.equal(vip.serviceScope.correspondenceLimit, 5);
assert.match(vip.serviceScope.includedServices.join(' '), /private 1-to-1 strategy call with Chris/i);
assert.match(vip.serviceScope.includedServices.join(' '), /Chris personally reviews, directs, and works/i);
assert.match(vip.serviceScope.includedServices.join(' '), /funding-partner network/i);
assert.match(vip.serviceScope.qualifiers.join(' '), /does not guarantee approval, funding amount, rate, terms, or timing/i);
assert.throws(() => agreement.planSnapshot(
  { billing_tier: 'Standard', service_agreement_mode: 'tier' },
  { version: agreement.ACTIVE_PRICING_VERSION, tiers: { Standard: { monthlyFee: 149, flatFee: 997 } } },
), /cannot contain flatFee or flatMonths/i);
assert.throws(() => agreement.planSnapshot(
  { billing_tier: 'VIP', service_agreement_mode: 'tier' },
  { version: agreement.ACTIVE_PRICING_VERSION, tiers: { VIP: { monthlyFee: 299, flatMonths: 6 } } },
), /cannot contain flatFee or flatMonths/i);
assert.throws(() => agreement.planSnapshot(
  { billing_tier: 'Paid In Full', service_agreement_mode: 'tier' },
  { version: agreement.ACTIVE_PRICING_VERSION, tiers: { 'Paid In Full': { flatFee: 997, flatMonths: 6, monthlyFee: 149 } } },
), /cannot contain a monthlyFee/i);
assert.throws(() => agreement.planSnapshot(
  { billing_tier: 'Paid In Full', service_agreement_mode: 'tier' },
  { version: agreement.ACTIVE_PRICING_VERSION, tiers: { 'Paid In Full': { flatFee: 997, flatMonths: 5 } } },
), /exactly 6 months/i);
assert.throws(() => agreement.planSnapshot(
  { billing_tier: 'Standard', service_agreement_mode: 'tier' },
  { version: agreement.ACTIVE_PRICING_VERSION, tiers: { Standard: { monthlyFee: '149.001' } } },
), /no more than two decimal places/i);
assert.throws(() => agreement.planSnapshot(
  { billing_tier: 'Standard', service_agreement_mode: 'tier' },
  { version: agreement.ACTIVE_PRICING_VERSION, tiers: { Standard: { monthlyFee: Number.MAX_SAFE_INTEGER } } },
), /no more than two decimal places/i);

const recurringOverride = agreement.planSnapshot({
  billing_tier: 'Standard', billing_type: 'Automated Recurring', billing_recurring_amount: '92.50',
  service_agreement_mode: 'tier',
}, { version: agreement.ACTIVE_PRICING_VERSION, tiers: {}, source: 'admin_settings_file', settingsHash: 'a'.repeat(64) });
assert.equal(recurringOverride.monthlyFee, 92.5);
assert.equal(recurringOverride.firstMonthlyPayment, 92.5);
assert.equal(recurringOverride.firstWorkFee, undefined);
assert.equal(recurringOverride.recurringOverrideApplied, true);
assert.equal(recurringOverride.pricingSource, 'admin_settings_file');
assert.equal(recurringOverride.pricingSettingsHash, 'a'.repeat(64));
assert.throws(() => agreement.planSnapshot({
  billing_tier: 'Standard', billing_type: 'Automated Recurring', billing_recurring_amount: '92.501',
  service_agreement_mode: 'tier',
}), /no more than two decimal places/i);

const paid = agreement.planSnapshot({ billing_tier: 'Paid In Full', service_agreement_mode: 'tier' });
assert.equal(paid.flatFee, 997);
assert.equal(paid.flatMonths, 6);
assert.equal(paid.firstWorkFee, undefined);
assert.equal(paid.amount, 997);
assert.equal(paid.serviceTerm, 'six months of Standard service');
assert.equal(paid.serviceScope.scopeBasis, 'Standard');
assert.equal(paid.serviceScope.correspondenceLimit, 3);
assert.match(paid.serviceScope.includedServices.join(' '), /Six months of Standard service/i);

assert.throws(
  () => agreement.planSnapshot({ billing_tier: 'Standard', billing_type: 'Paid in Full', service_agreement_mode: 'tier' }),
  /Standard requires Billing Type/i,
);
assert.throws(
  () => agreement.planSnapshot({ billing_tier: 'Paid In Full', billing_type: 'Automated Recurring', service_agreement_mode: 'tier' }),
  /Paid In Full requires Billing Type/i,
);

assert.throws(() => agreement.planSnapshot({ service_agreement_mode: 'tier' }), /select and save/i);
assert.throws(() => agreement.planSnapshot({ billing_tier: 'Unknown', service_agreement_mode: 'tier' }), /supported billing tier/i);
assert.throws(() => agreement.planSnapshot({ service_agreement_mode: 'custom', service_agreement_fee_text: 'Terms', billing_type: 'Paid in Full' }), /plan label/i);
assert.throws(() => agreement.planSnapshot({ service_agreement_mode: 'custom', service_agreement_label: 'Custom', billing_type: 'Paid in Full' }), /fee terms/i);

const custom = agreement.planSnapshot({
  service_agreement_mode: 'custom', service_agreement_label: 'Custom remediation',
  service_agreement_amount: '325', service_agreement_fee_text: 'Counsel-approved custom milestone terms.',
  billing_type: 'Paid in Full',
});
assert.equal(custom.label, 'Custom remediation');
assert.equal(custom.amount, 325);
assert.equal(custom.flatFee, 325);
assert.equal(custom.feeText, 'Counsel-approved custom milestone terms.');
assert.equal(custom.billingType, 'Paid in Full');
assert.equal(custom.serviceTerm, 'custom one-time service package');
assert.equal(custom.monthlyFee, null);
assert.equal(custom.flatFee, 325);

const customMonthly = agreement.planSnapshot({
  service_agreement_mode: 'custom', service_agreement_label: 'Custom monthly support',
  service_agreement_amount: '225', service_agreement_fee_text: '$225 per monthly service cycle.',
  billing_type: 'Automated Recurring', billing_recurring_amount: '225',
});
assert.equal(customMonthly.monthlyFee, 225);
assert.equal(customMonthly.flatFee, null);
assert.equal(customMonthly.firstMonthlyPayment, 225);
assert.equal(customMonthly.serviceTerm, 'custom monthly service plan');
assert.equal(customMonthly.amount, customMonthly.monthlyFee);
assert.throws(() => agreement.planSnapshot({
  service_agreement_mode: 'custom', service_agreement_label: 'Bad monthly setup',
  service_agreement_amount: '225', service_agreement_fee_text: '$225 monthly.',
  billing_type: 'Automated Recurring', billing_recurring_amount: '199',
}), /must match the saved recurring billing amount/i);
assert.throws(() => agreement.planSnapshot({
  service_agreement_mode: 'custom', service_agreement_label: 'Sub-cent one-time',
  service_agreement_amount: '325.001', service_agreement_fee_text: 'Exact custom terms.',
  billing_type: 'Paid in Full',
}), /no more than two decimal places/i);
assert.throws(() => agreement.planSnapshot({
  service_agreement_mode: 'custom', service_agreement_label: 'Sub-cent recurring',
  service_agreement_amount: '225.00', service_agreement_fee_text: 'Exact custom monthly terms.',
  billing_type: 'Automated Recurring', billing_recurring_amount: '225.001',
}), /no more than two decimal places/i);

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({
  ok: true, status: 200,
  text: async () => JSON.stringify({ pricing: { version: agreement.ACTIVE_PRICING_VERSION, tiers: { VIP: { monthlyFee: 377 } } } }),
});
const storedPricing = await agreementOnboarding._test.loadPricingSettings('https://example.supabase.co', 'service-key');
assert.equal(storedPricing.tiers.VIP.monthlyFee, 377);
assert.equal(storedPricing.source, 'admin_settings_file');
assert.equal(storedPricing.settingsHash.length, 64);
globalThis.fetch = async () => ({
  ok: true, status: 200,
  text: async () => JSON.stringify({ pricing: { tiers: { Standard: { monthlyFee: 79, firstWorkFee: 75 } } } }),
});
const retiredStoredPricing = await agreementOnboarding._test.loadPricingSettings('https://example.supabase.co', 'service-key');
assert.deepEqual(retiredStoredPricing.tiers, {});
assert.equal(retiredStoredPricing.version, agreement.ACTIVE_PRICING_VERSION);
assert.equal(retiredStoredPricing.source, 'owner_approved_defaults_retired_legacy_settings');
globalThis.fetch = async () => ({ ok: false, status: 404, text: async () => 'Object not found' });
assert.deepEqual(
  await agreementOnboarding._test.loadPricingSettings('https://example.supabase.co', 'service-key'),
  { version: agreement.ACTIVE_PRICING_VERSION, tiers: {}, source: 'default_settings', settingsHash: null },
);
globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '{broken' });
await assert.rejects(
  agreementOnboarding._test.loadPricingSettings('https://example.supabase.co', 'service-key'),
  /malformed JSON/i,
);
globalThis.fetch = originalFetch;

const blocked = agreement.templateLiveReadiness({
  version: agreement.AGREEMENT_TEMPLATE_VERSION,
  packet_kind: agreement.SERVICE_ONLY_PACKET_KIND,
  legal_status: 'counsel_review',
  body_html: '<p>Pending agreement.</p>',
  consumer_disclosure_html: '<p>Disclosure</p>',
  cancellation_notice_html: '<p>{{cancellation_date}}</p>',
  cancellation_calendar_kind: 'pending_counsel',
});
assert.equal(blocked.ready, false);
assert(blocked.blockers.includes('COUNSEL_APPROVAL_REQUIRED'));
assert(blocked.blockers.includes('CANCELLATION_CALENDAR_COUNSEL_APPROVAL_REQUIRED'));

const ready = agreement.templateLiveReadiness({
  version: agreement.AGREEMENT_TEMPLATE_VERSION,
  packet_kind: agreement.SERVICE_ONLY_PACKET_KIND,
  legal_status: 'approved',
  body_html: '<p>Approved versioned agreement.</p>',
  consumer_disclosure_html: '<p>Exact disclosure.</p>',
  cancellation_notice_html: '<p>Deadline {{cancellation_date}}</p>',
  cancellation_calendar_kind: agreement.CANCELLATION_CALENDAR_KIND,
});
assert.deepEqual(ready, { ready: true, blockers: [] });

assert.throws(() => agreement.calculateCancellationWindow('2026-08-17T17:00:00.000Z', 'pending_counsel'), /signing is blocked/i);
const mondayWindow = agreement.calculateCancellationWindow('2026-08-17T17:00:00.000Z', agreement.CANCELLATION_CALENDAR_KIND);
assert.equal(mondayWindow.cancellationDate, '2026-08-20');
assert.equal(mondayWindow.cancellationDeadline, '2026-08-21T07:00:00.000Z');
const fridayWindow = agreement.calculateCancellationWindow('2026-08-21T17:00:00.000Z', agreement.CANCELLATION_CALENDAR_KIND);
assert.equal(fridayWindow.cancellationDate, '2026-08-26');
assert.equal(fridayWindow.serviceEligibleAt, '2026-08-27T07:00:00.000Z');

const serviceOnlyHtml = agreement.renderServiceAgreementOnlyPacket({
  client: { name: 'Jane Client' }, plan: standard, signedAt: '2026-08-17T17:00:00.000Z',
  clientSignatureHtml: '<img alt="Client signature">', approved: true,
  approvedTermsHtml: `<p><strong>Service Provider:</strong> Credit Comeback Club</p><p><strong>Principal business address:</strong> ${agreement.PRINCIPAL_BUSINESS_ADDRESS}</p>`,
});
assert.match(serviceOnlyHtml, /Client Service Agreement/);
assert.match(serviceOnlyHtml, /970-644-0063/);
assert.match(serviceOnlyHtml, /3088 Colorado Ave/);
assert.match(serviceOnlyHtml, /3rd business day/i);
assert.match(serviceOnlyHtml, /font-size:14px;font-weight:bold[^>]*>You may cancel this contract/i,
  'the cancellation statement immediately before signature must be bold and at least 10-point-equivalent');
assert.match(serviceOnlyHtml, /Monthly service price[\s\S]*\$149\.00/i);
assert.match(serviceOnlyHtml, /Included service scope/i);
assert.match(serviceOnlyHtml, /Up to 3 individualized correspondence pieces/i);
assert.doesNotMatch(serviceOnlyHtml, /First Work Fee/i);
assert.doesNotMatch(serviceOnlyHtml, /Limited Power of Attorney|certified mail|480-913-9172/i);
assert.doesNotMatch(serviceOnlyHtml, /Christopher Holland[^<]*— Credit Comeback Club/);
const footer = serviceOnlyHtml.match(/<div class="footer">([\s\S]*?)<\/div>/)?.[1] || '';
assert.doesNotMatch(footer, /3088|Grand Junction|81504/);

const hostileDisclosureHtml = '<style>.copy p{font-size:8px!important;font-weight:400!important}</style><p style="font-size:8px!important;font-weight:400!important">Exact approved disclosure body.</p>';
assert.equal(
  agreement.sanitizeDisclosurePresentationHtml(hostileDisclosureHtml),
  '<p>Exact approved disclosure body.</p>',
  'only semantic disclosure markup may survive into the signed artifact',
);
const disclosureHtml = agreement.renderConsumerDisclosure({
  client: { name: 'Jane Client' }, signedAt: '2026-08-17T17:00:00.000Z',
  clientSignatureHtml: '<img alt="Client signature">',
  disclosureHtml: hostileDisclosureHtml,
});
assert.match(disclosureHtml, /Exact approved disclosure body/);
assert.match(disclosureHtml, /separate document before executing/i);
assert.doesNotMatch(disclosureHtml, /&lt;p&gt;/);
assert.doesNotMatch(disclosureHtml, /\.copy p\{font-size:8px|<p\s+style\s*=/i,
  'approved disclosure markup cannot override the statutory presentation');
assert.match(
  disclosureHtml,
  /\.copy,\.copy \*\{[^}]*font-size:14px!important;[^}]*font-weight:700!important/,
  'the separate CROA disclosure must render in boldface at a minimum 10-point-equivalent size',
);

const cancellationHtml = agreement.renderCancellationNotices({
  client: { name: 'Jane Client' }, signedAt: '2026-08-17T17:00:00.000Z',
  cancellationDateLabel: mondayWindow.cancellationDateLabel,
  noticeHtml: `<p>Cancel at ${agreement.PRINCIPAL_BUSINESS_ADDRESS} before {{cancellation_date}}.</p>`,
});
assert.match(cancellationHtml, /Consumer copy 1 of 2/);
assert.match(cancellationHtml, /Consumer copy 2 of 2/);
assert.match(cancellationHtml, /August 20, 2026/);
assert.equal((cancellationHtml.match(/<section class="notice">/g) || []).length, 2);

const legacy = agreement.renderPacket({ client: { name: 'Legacy Client' }, plan: standard, approved: false });
assert.match(legacy, /Limited Power of Attorney/);
assert.match(agreement.renderLpoaOnly({
  client: { name: 'Legacy Client' }, plan: standard, signedAt: '2026-08-08T12:00:00.000Z',
  clientSignatureHtml: '<img>', attorneySignatureHtml: '<img>',
}), /Limited Power of Attorney/);

const migration = readFileSync(new URL('../supabase/migrations/20260820260000_service_agreement_only.sql', import.meta.url), 'utf8');
const noFirstWorkMigration = readFileSync(new URL('../supabase/migrations/20260820360000_retire_first_work_fee.sql', import.meta.url), 'utf8');
const scopeAlignmentMigration = readFileSync(new URL('../supabase/migrations/20260820460000_signed_plan_scope_alignment.sql', import.meta.url), 'utf8');
const customInvoiceMigration = readFileSync(new URL('../supabase/migrations/20260820480000_custom_billing_invoice_integrity.sql', import.meta.url), 'utf8');
assert.match(migration, /'ccc-service-agreement-v2-service-only'/);
assert.match(migration, /'counsel_review'/);
assert.match(migration, /3088 Colorado Ave, Grand Junction, CO 81504/);
assert.match(migration, /consumer_disclosure_html/);
assert.match(migration, /signed_cancellation_path/);
assert.match(migration, /cancellationCopiesDelivered', 2/);
assert.match(migration, /update public\.client_service_agreements[\s\S]*set status = 'signed'/i);
assert.match(migration, /Government ID and proof of address are required/i);
assert.match(migration, /revoke all on function public\.ccc_finalize_portal_service_agreement[\s\S]*from public, anon, authenticated/i);
assert.match(migration, /ccc_approve_service_agreement_template/);
assert.match(migration, /approved_by[\s\S]*approved_at[\s\S]*approval_reference/i);
assert.match(migration, /staff_read_service_agreement_templates/);
assert.match(migration, /Signed agreement evidence must be retained and cannot be deleted/i);
assert.match(migration, /ccc_link_portal_profile_for_onboarding/);
assert.match(migration, /staff or affiliate identity cannot be linked/i);
assert.match(migration, /signing_started_at/);
assert.match(migration, /signing_signature_sha256/);
assert.match(migration, /ccc_claim_portal_service_agreement_signing/);
assert.match(migration, /A different signature is already bound/i);
assert.match(migration, /p_signed_at is distinct from v_agreement\.signing_started_at/);
assert.match(migration, /'signatureHash', v_agreement\.signing_signature_sha256/);
assert.match(migration, /Free pre-client assessment/i);
const billingTerms = migration.match(/<h3>7\. FEES[\s\S]*?<h3>9\./i)?.[0] || '';
assert.doesNotMatch(billingTerms, /due at enrollment|collected at enrollment|fees are due in advance|not charged in advance/i);
assert.match(billingTerms, /does not itself initiate an automatic charge/i);
const v2Terms = migration.match(/\$agreement\$([\s\S]*?)\$agreement\$/)?.[1] || '';
assert.match(v2Terms, /directly to furnishers or debt collectors/i);
assert.match(v2Terms, /recipient, timing, and sequence/i);
assert.match(v2Terms, /12\. DISPUTE PROCESS ACKNOWLEDGMENT/i);
assert.doesNotMatch(v2Terms, /Limited Power of Attorney|Metro 2|e-OSCAR|furnisher-direct|certified mail|480-913-9172/i);
assert.doesNotMatch(v2Terms, /Up to [0-9]+|letters?\/month|monthly letter limit|437\+|\$6\.2M|150\+|<table>/i);
const statutoryDisclosure = migration.match(/\$disclosure\$([\s\S]*?)\$disclosure\$/)?.[1] || '';
assert.match(statutoryDisclosure, /Consumer Credit File Rights Under State and Federal Law/);
assert.match(statutoryDisclosure, /neither you nor any "credit repair" company/i);
assert.match(statutoryDisclosure, /The Public Reference Branch/);
assert.match(migration, /service_eligible_at = v_service_eligible_at/);
assert.doesNotMatch(migration, /update public\.clients[\s\S]{0,150}engagement_status = 'active'/i);
assert.match(noFirstWorkMigration, /'ccc-service-agreement-v3-no-first-work'/);
assert.match(noFirstWorkMigration, /'counsel_review'/);
assert.match(noFirstWorkMigration, /on conflict \(version\) do nothing/i);
assert.match(noFirstWorkMigration, /v_agreement\.template_version = 'ccc-service-agreement-v2-service-only'/);
assert.match(noFirstWorkMigration, /New agreement snapshots cannot contain a retired First Work Fee/);
assert.match(noFirstWorkMigration, /first_monthly_payment/);
assert.match(noFirstWorkMigration, /Paid In Full Service/);
assert.doesNotMatch(noFirstWorkMigration, /set legal_status = 'approved'/i);
assert.match(scopeAlignmentMigration, /plan-specific included services/i);
assert.match(scopeAlignmentMigration, /correspondence limit/i);
assert.match(scopeAlignmentMigration, /maximum, not a guaranteed quantity/i);
assert.match(scopeAlignmentMigration, /Funding-partner access or referral/i);
assert.match(scopeAlignmentMigration, /legal_status <> 'counsel_review'/i);
assert.match(scopeAlignmentMigration, /position\(v_new in v_template\.body_html\) > 0[\s\S]*return;/i,
  'scope-alignment migration must accept the exact already-aligned body during a partial-rollout retry');
assert.doesNotMatch(scopeAlignmentMigration, /set legal_status\s*=\s*'approved'/i);
assert.match(customInvoiceMigration, /v_billing_type = 'Automated Recurring'/);
assert.match(customInvoiceMigration, /custom_first_monthly_payment/);
assert.match(customInvoiceMigration, /v_custom_schedule_amount is distinct from v_custom_amount/);
assert.match(customInvoiceMigration, /v_billing_type = 'Paid in Full'/);
assert.match(customInvoiceMigration, /custom_paid_in_full_service/);
assert.match(customInvoiceMigration, /firstMonthlyPayment'[\s\S]*\[0-9\]\{1,2\}/,
  'new monthly snapshots must be cent-exact at the authoritative RPC');
assert.match(customInvoiceMigration, /flatFee'[\s\S]*\[0-9\]\{1,2\}/,
  'new paid-in-full snapshots must be cent-exact at the authoritative RPC');
assert.match(customInvoiceMigration, /Legacy agreement First Work amount/,
  'signed v2 First Work history must retain its compatibility branch');
assert.match(customInvoiceMigration, /Paid In Full must cover exactly 6 months of Standard service/);
assert.match(customInvoiceMigration, /#>> '\{serviceScope,scopeBasis\}' is distinct from 'Standard'/);
assert.match(customInvoiceMigration, /never charges, emails, activates, pauses/i);
assert.match(customInvoiceMigration, /v_role is distinct from 'admin'/);
assert.doesNotMatch(customInvoiceMigration, /grant execute[\s\S]*to (?:anon|service_role)/i);
assert.doesNotMatch(migration, /FIRST_WORK_PERFORMANCE_MILESTONE_REQUIRED|PAID_IN_FULL_PERFORMANCE_MILESTONE_REQUIRED/);

const onboardingSource = readFileSync(new URL('../netlify/functions/agreement-onboarding.cjs', import.meta.url), 'utf8');
assert.match(onboardingSource, /redirectTo: `\$\{origin\.replace\([\s\S]*?\}\/login`/);
assert.match(onboardingSource, /delivery: 'portal_magic_link'/);
assert.doesNotMatch(onboardingSource, /sign-agreement\.html/);
assert.doesNotMatch(onboardingSource, /Limited Power of Attorney/);
assert.match(onboardingSource, /signing_token_hash: null/);
assert.match(onboardingSource, /document_snapshot: documentSnapshot/);
assert.match(onboardingSource, /clientName: clientSnapshot\.name/);
assert.match(onboardingSource, /storage\/v1\/object\/authenticated\/client-docs\/admin\/settings\.json/);
assert.match(onboardingSource, /billing_recurring_amount/);
assert.match(onboardingSource, /plan\.billingType !== plan\.expectedBillingType/);
assert.match(onboardingSource, /ccc_link_portal_profile_for_onboarding/);
assert.doesNotMatch(onboardingSource, /rest\/v1\/settings/);
assert.match(onboardingSource, /return json\(action === 'start' \? 409 : 200, \{/,
  'an unapproved agreement must fail the Start Onboarding action instead of returning a false success');

const signingPage = readFileSync(new URL('../public/sign-agreement.html', import.meta.url), 'utf8');
assert.match(signingPage, /signing route has retired/i);
assert.match(signingPage, /secure service-agreement onboarding wizard/i);
assert.doesNotMatch(signingPage, /<form|<button|<script|fetch\s*\(|href\s*=/i);

const one = agreement.randomToken(); const two = agreement.randomToken();
assert.notEqual(one, two);
assert.equal(agreement.sha256(one).length, 64);

console.log('Service-agreement v3 retirement and legacy compatibility assertions passed.');
