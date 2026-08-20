import assert from 'node:assert/strict';
import {
  buildR1CampaignPlan,
  cccTransitionStartRound,
  classifyAccountForR1,
  FLOW_SEQUENCES,
  REPO_SEQUENCE,
} from '../src/utils/disputeFlow.js';

assert.equal(cccTransitionStartRound([
  { phase: 'Phase 3', roundNumber: 9 },
  { phase: 'Dispute Fox', roundNumber: 6 },
]), 1, 'legacy campaign history must never advance the CCC transition beyond R1');
import {
  extractTemplateTokens,
  normalizeCourseStyleTemplate,
  renderDisputeTemplate,
  disputeItemsText,
  unknownTemplateTokens,
} from '../src/utils/disputeTemplateEngine.js';
import { templatesForRecommendation } from '../src/utils/disputeTemplateSelection.js';

const account = (overrides) => ({
  id: overrides.id,
  furnisher: overrides.furnisher || overrides.id,
  type: 'A',
  status: '',
  bureaus: ['EQ', 'EXP', 'TU'],
  violations: [],
  ...overrides,
});

assert.equal(classifyAccountForR1(account({ id: 'collection', type: 'C', accountKind: 'collection' })).flow, 'collection');
assert.equal(classifyAccountForR1(account({ id: 'repo', accountKind: 'repossession' })).specialRule, 'repo');
assert.equal(classifyAccountForR1(account({ id: 'bankruptcy', accountKind: 'bankruptcy' })).flow, 'accuracy');
assert.equal(classifyAccountForR1(account({ id: 'chargeoff', accountKind: 'charge_off' })).flow, 'accuracy');
assert.equal(classifyAccountForR1(account({ id: 'solo', accountKind: 'charge_off', bureaus: ['TU'] })).flow, 'consent');
assert.equal(classifyAccountForR1(account({ id: 'two-lates', accountKind: 'late_payment', latePaymentCount: 2 })).flow, 'late_pay');
assert.equal(classifyAccountForR1(account({ id: 'three-lates', accountKind: 'late_payment', latePaymentCount: 3 })).flow, 'accuracy');
assert.equal(classifyAccountForR1(account({ id: 'unknown-lates', accountKind: 'late_payment', latePaymentCount: null })).needsReview, true);
assert.equal(classifyAccountForR1(account({ id: 'student', accountKind: 'student_loan' })).flow, 'consent');
assert.equal(classifyAccountForR1(account({ id: 'healthy', accountKind: 'positive' })).excluded, true);

const audit = {
  accounts: [
    account({ id: 'co', furnisher: 'Chargeoff Bank', accountKind: 'charge_off' }),
    account({ id: 'col', furnisher: 'Collection LLC', type: 'C', accountKind: 'collection', bureaus: ['EQ', 'EXP'] }),
    account({ id: 'late', furnisher: 'Late Bank', accountKind: 'late_payment', latePaymentCount: 1, bureaus: ['TU'] }),
    account({ id: 'solo', furnisher: 'Solo Bank', accountKind: 'charge_off', bureaus: ['TU'] }),
  ],
};
const plan = buildR1CampaignPlan(audit);
assert.equal(plan.bureaus.find((item) => item.bureau.code === 'EQ').primary.flow, 'combo');
assert.equal(plan.bureaus.find((item) => item.bureau.code === 'EXP').primary.flow, 'combo');
assert.deepEqual(
  plan.bureaus.find((item) => item.bureau.code === 'TU').recommendations.map((item) => item.flow),
  ['accuracy'],
);
assert.deepEqual(
  plan.bureaus.find((item) => item.bureau.code === 'TU').deferred.map((item) => item.flow),
  ['late_pay', 'consent'],
  'only one R1 letter is recommended per bureau; lower-priority tracks remain visible for later review',
);
assert.equal(plan.recommendedLetterCount, 3, 'R1 plan produces at most one letter per bureau');

const studentOverride = buildR1CampaignPlan({
  accounts: [
    account({ id: 'student-1', accountKind: 'student_loan' }),
    account({ id: 'student-2', accountKind: 'student_loan' }),
    account({ id: 'collection-1', type: 'C', accountKind: 'collection' }),
    account({ id: 'healthy-student-file', accountKind: 'positive' }),
  ],
});
assert.equal(studentOverride.overrides.forceConsent, true);
assert.equal(studentOverride.bureaus[0].primary.flow, 'consent');
assert.equal(studentOverride.bureaus[0].primary.accounts.length, 3, 'student-loan majority override moves every derogatory account to Consent');
assert.equal(studentOverride.bureaus[0].excluded.length, 1, 'file-level overrides never dispute a healthy tradeline');

const mixedLateOverride = buildR1CampaignPlan({
  accounts: [
    account({ id: 'mixed', accountKind: 'late_payment', latePaymentBand: 'mixed', latePaymentCount: 5 }),
    account({ id: 'long', accountKind: 'late_payment', latePaymentBand: 'three_or_more', latePaymentCount: 4 }),
  ],
});
assert.equal(mixedLateOverride.overrides.forceLatePayForLates, true);
assert.equal(mixedLateOverride.bureaus[0].primary.flow, 'late_pay');
assert.equal(mixedLateOverride.bureaus[0].primary.accounts.length, 2, 'mixed-late override moves every late-pay account to Late Pay');
assert.equal(FLOW_SEQUENCES.collection[5], '15 USC 1692e(10)', 'repo R3 reuses Collection R6');
assert.match(REPO_SEQUENCE[2], /1692e\(10\)/, 'repo R3 shortcut is retained explicitly');

const comboFallbackTemplates = [
  { id: 'accuracy-r5', flow: 'accuracy', round: 5, bureau: 'ALL', active: true, updatedAt: '2026-08-20T00:00:00Z' },
  { id: 'combo-r5-custom', flow: 'combo', round: 5, bureau: 'TU', active: true, updatedAt: '2026-08-19T00:00:00Z' },
];
assert.deepEqual(
  templatesForRecommendation(comboFallbackTemplates, { flow: 'combo', round: 5 }, 'EQ').map((item) => item.id),
  ['accuracy-r5'],
  'Combo R5-R7 reuse the canonical Accuracy templates when no Combo override exists',
);
assert.deepEqual(
  templatesForRecommendation(comboFallbackTemplates, { flow: 'combo', round: 5 }, 'TU').map((item) => item.id),
  ['combo-r5-custom', 'accuracy-r5'],
  'an explicit Combo template remains preferred over the Accuracy fallback',
);

const latePayFallbackTemplates = [
  { id: 'consent-r2', flow: 'consent', round: 2, bureau: 'ALL', active: true, updatedAt: '2026-08-20T00:00:00Z' },
];
assert.deepEqual(
  templatesForRecommendation(latePayFallbackTemplates, { flow: 'late_pay', round: 2 }, 'EQ').map((item) => item.id),
  ['consent-r2'],
  'Late Pay R2 reuses the course Consent R2 law/template before switching to Accuracy',
);

const courseDraft = `Header\n\n►► WRITE THIS — DAMAGES (opens the letter)\nInstructions\nEXAMPLE OF THE RIGHT LENGTH AND SHAPE — replace every word:\nExample\n\n— — — FACTS (do not change this section) — — —\nFixed facts.\n\n►► WRITE THIS — LIST OF EXACT INACCURACIES (accuracy + combo only)\nInstructions\nExample\n\n►► WRITE THIS — PENALTY (closes the argument)\nInstructions\nExample\n\n— — — DELETION LIST (do not change this line) — — —\nDelete:\n{dispute_item_and_explanation}\n\n►► WRITE THIS — CONSUMER STATEMENT\nInstructions\nExample\n\n— — — SCREENSHOTS — ACCURACY / COMBO ONLY — — —\nText\n►► PASTE SCREENSHOTS HERE — one per account\n►► ATTACH ID + PROOF OF ADDRESS ON THE PAGE AFTER THE SCREENSHOTS.`;
const normalized = normalizeCourseStyleTemplate(courseDraft);
assert.match(normalized, /\{damages\}/);
assert.match(normalized, /Fixed facts\./, 'fixed facts must survive authoring-block conversion');
assert.match(normalized, /\{personalization\}/);
assert.match(normalized, /\{penalty\}/);
assert.match(normalized, /\{consumer_statement\}/);
assert.match(normalized, /\{screenshots\}/);
assert.doesNotMatch(normalized, /EXAMPLE OF THE RIGHT LENGTH/);
assert.doesNotMatch(normalized, /ATTACH ID/);

const consentDraft = `Fixed facts.\n►► OPTIONAL STRENGTHENER — only if confirmed\nInstructions\nExample sentence.\n►► WRITE THIS — PENALTY (closes the argument)\nPenalty instructions\n— — — DELETION LIST (do not change this line) — — —`;
const normalizedConsent = normalizeCourseStyleTemplate(consentDraft);
assert.match(normalizedConsent, /\{optional_strengthener\}/);
assert.match(normalizedConsent, /\{penalty\}/);
assert.doesNotMatch(normalizedConsent, /Example sentence/);

const template = '{client_first_name}\n{damages}\n{screenshots}\n{unsupported_field}';
assert.deepEqual(extractTemplateTokens(template), ['client_first_name', 'damages', 'screenshots', 'unsupported_field']);
assert.deepEqual(unknownTemplateTokens(template, { client_first_name: 'Jordan', damages: 'Story', screenshots: '' }), ['unsupported_field']);
const rendered = renderDisputeTemplate(template, {
  client_first_name: '<Jordan>',
  damages: 'Real & confirmed',
  screenshots: '<img src="data:image/png;base64,abc">',
}, ['screenshots']);
assert.match(rendered, /&lt;Jordan&gt;/, 'normal merge fields must be HTML-escaped');
assert.match(rendered, /Real &amp; confirmed/);
assert.match(rendered, /<img src=/, 'only explicitly safe screenshot HTML may pass through');
assert.match(rendered, /data-missing-token="unsupported_field"/);

const disputeItems = disputeItemsText([{ furnisher: 'Example Bank', accountNumberMasked: '***1234', violations: [{ field: 'Balance', issue: 'Bureaus disagree.', currentlyReports: 'TU $100; EQ $200', shouldReport: 'Reinvestigate the conflict' }] }]);
assert.match(disputeItems, /Currently reports: TU \$100; EQ \$200/);
assert.match(disputeItems, /Should report: Reinvestigate the conflict/);

console.log('Deterministic dispute flow and template merge tests passed.');
