import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  buildClassificationReviewSnapshot,
  buildInitialAccountTrackStates,
  buildCccInitializationRpcArgs,
  buildR1CampaignPlan,
  canonicalClassificationReviewSnapshotJson,
  canonicalClassificationRoutesJson,
  classificationRoutesFromStates,
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

const account = (overrides) => {
  const merged = {
    id: overrides.id,
    clientAccountId: Object.prototype.hasOwnProperty.call(overrides, 'clientAccountId') ? overrides.clientAccountId : overrides.id,
    furnisher: overrides.furnisher || overrides.id,
    type: 'A',
    status: '',
    bureaus: ['EQ', 'EXP', 'TU'],
    violations: [],
    ...overrides,
  };
  if (!merged.routingFacts) {
    const count = Number.isInteger(merged.latePaymentCount) ? merged.latePaymentCount : null;
    const band = merged.latePaymentBand || (count === null ? 'unclear' : count === 0 ? 'none' : count <= 2 ? 'two_or_fewer' : 'three_or_more');
    const lateStatus = merged.accountKind === 'late_payment' && count === null ? 'review_required' : 'confirmed';
    merged.routingFacts = {
      version: 'test-routing-facts-v1',
      status: lateStatus === 'confirmed' ? 'confirmed' : 'review_required',
      source: 'staff_review',
      accountKind: merged.accountKind,
      blockingCodes: lateStatus === 'confirmed' ? [] : ['LATE_HISTORY_REVIEW_REQUIRED'],
      reportCoverage: { complete: true, missing: [], duplicates: [], bureauCodes: ['EQ', 'EXP', 'TU'] },
      bureauFacts: Object.fromEntries((merged.bureaus || []).map((code) => [code, {
        accountKind: merged.accountKind,
        latePaymentCount: merged.accountKind === 'late_payment' ? count : null,
        latePaymentBand: merged.accountKind === 'late_payment' ? band : 'none',
        latePaymentStatus: merged.accountKind === 'late_payment' ? lateStatus : 'not_applicable',
      }])),
    };
  }
  return merged;
};

assert.equal(classifyAccountForR1(account({ id: 'collection', type: 'C', accountKind: 'collection' })).flow, 'collection');
assert.equal(classifyAccountForR1(account({ id: 'repo', accountKind: 'repossession' })).specialRule, 'repo');
assert.equal(classifyAccountForR1(account({ id: 'bankruptcy', accountKind: 'bankruptcy' })).flow, 'accuracy');
assert.equal(classifyAccountForR1(account({ id: 'chargeoff', accountKind: 'charge_off' })).flow, 'accuracy');
assert.equal(classifyAccountForR1(account({ id: 'solo', accountKind: 'charge_off', bureaus: ['TU'] })).flow, 'consent');
assert.equal(classifyAccountForR1(account({ id: 'two-lates', accountKind: 'late_payment', latePaymentCount: 2 }), {}, 'EQ').flow, 'late_pay');
assert.equal(classifyAccountForR1(account({ id: 'three-lates', accountKind: 'late_payment', latePaymentCount: 3 }), {}, 'EQ').flow, 'accuracy');
assert.equal(classifyAccountForR1(account({ id: 'unknown-lates', accountKind: 'late_payment', latePaymentCount: null }), {}, 'EQ').needsReview, true);
assert.equal(classifyAccountForR1(account({ id: 'student', accountKind: 'student_loan' })).flow, 'consent');
assert.equal(classifyAccountForR1(account({ id: 'healthy', accountKind: 'positive' })).excluded, true);

for (const [expectedFlow, sample] of [
  ['accuracy', account({ id: 'only-accuracy', accountKind: 'bankruptcy', bureaus: ['EQ'] })],
  ['collection', account({ id: 'only-collection', accountKind: 'collection', type: 'C', bureaus: ['EQ'] })],
  ['consent', account({ id: 'only-consent', accountKind: 'student_loan', bureaus: ['EQ'] })],
  ['late_pay', account({ id: 'only-late', accountKind: 'late_payment', latePaymentCount: 1, bureaus: ['EQ'] })],
]) {
  const onlyPlan = buildR1CampaignPlan({ accounts: [sample] });
  assert.equal(onlyPlan.bureaus[0].recommendations[0].flow, expectedFlow, `${expectedFlow} must remain an independent R1 group`);
}

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
  ['accuracy', 'late_pay', 'consent'],
  'compatible Accuracy, Late Pay, and Consent R1 letters are all recommended for the bureau',
);
assert.deepEqual(
  plan.bureaus.find((item) => item.bureau.code === 'TU').deferred.map((item) => item.flow),
  [],
  'deterministically routed accounts must not be silently deferred',
);
assert.equal(plan.recommendedLetterCount, 5, 'R1 plan counts every compatible bureau letter');

const initialStates = buildInitialAccountTrackStates(audit);
assert.equal(initialStates.find((item) => item.clientAccountId === 'co' && item.bureauCode === 'EQ').currentFlow, 'combo');
assert.equal(initialStates.find((item) => item.clientAccountId === 'co' && item.bureauCode === 'TU').currentFlow, 'accuracy', 'each bureau owns an independent logical state');
assert.deepEqual(
  initialStates.filter((item) => item.bureauCode === 'TU').map((item) => item.currentFlow),
  ['accuracy', 'late_pay', 'consent'],
  'each independent TU R1 recommendation becomes an account-level track',
);
assert.ok(initialStates.every((item) => item.currentRound === 1 && item.revision === 0 && item.cycle === 1));
const rpcAuditBase = { ...audit, id: 'audit-1', client: { id: 'client-1' } };
const rpcRoutes = classificationRoutesFromStates(buildInitialAccountTrackStates(rpcAuditBase));
const rpcRoutingSnapshot = buildClassificationReviewSnapshot(rpcAuditBase, rpcRoutes);
const rpcRoutingSnapshotCanonical = canonicalClassificationReviewSnapshotJson(rpcRoutingSnapshot);
const rpcAudit = {
  ...rpcAuditBase,
  classificationReview: {
    status: 'confirmed',
    auditId: 'audit-1',
    clientId: 'client-1',
    reviewedAt: '2026-08-20T12:00:00.000Z',
    reviewedBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    methodVersion: 'ccc_skool_2026_v1',
    version: 1,
    routesSha256: crypto.createHash('sha256').update(canonicalClassificationRoutesJson(rpcRoutes)).digest('hex'),
    routes: rpcRoutes,
    routingSnapshot: rpcRoutingSnapshot,
    routingSnapshotCanonical: rpcRoutingSnapshotCanonical,
    routingSnapshotSha256: crypto.createHash('sha256').update(rpcRoutingSnapshotCanonical).digest('hex'),
  },
};
const rpcArgs = buildCccInitializationRpcArgs(rpcAudit);
assert.equal(rpcArgs.p_client_id, 'client-1');
assert.equal(rpcArgs.p_audit_id, 'audit-1');
assert.deepEqual(rpcArgs.p_classifications.filter((item) => item.client_account_id === 'col').map((item) => item.bureaus), [['EQ'], ['EXP']]);
assert.ok(rpcArgs.p_classifications.every((item) => item.direct_track === false));
assert.throws(
  () => buildCccInitializationRpcArgs(rpcAudit, { directAccountIds: ['col'] }),
  /Direct debt-verification tracks are gated/,
);
assert.throws(
  () => buildCccInitializationRpcArgs({
    ...rpcAudit,
    classificationReview: { ...rpcAudit.classificationReview, routes: rpcAudit.classificationReview.routes.slice(1) },
  }),
  /changed after the saved staff review/,
  'missing or tampered reviewed routes fail closed',
);
assert.throws(
  () => buildInitialAccountTrackStates({ accounts: [account({ id: 'not-canonical', clientAccountId: null, accountKind: 'collection' })] }),
  /exact clientAccountId/,
  'new state must never fall back to a report id, name, or furnisher',
);

const studentOverride = buildR1CampaignPlan({
  accounts: [
    account({ id: 'student-1', accountKind: 'student_loan' }),
    account({ id: 'student-2', accountKind: 'student_loan' }),
    account({ id: 'collection-1', type: 'C', accountKind: 'collection' }),
    account({ id: 'healthy-student-file', accountKind: 'positive' }),
  ],
});
assert.equal(studentOverride.overridesByBureau.EQ.forceConsent, true);
assert.equal(studentOverride.bureaus[0].primary.flow, 'consent');
assert.equal(studentOverride.bureaus[0].primary.accounts.length, 3, 'student-loan majority override moves every derogatory account to Consent');
assert.equal(studentOverride.bureaus[0].excluded.length, 1, 'file-level overrides never dispute a healthy tradeline');

const mixedLateOverride = buildR1CampaignPlan({
  accounts: [
    account({ id: 'mixed', accountKind: 'late_payment', latePaymentBand: 'mixed', latePaymentCount: 5 }),
    account({ id: 'long', accountKind: 'late_payment', latePaymentBand: 'three_or_more', latePaymentCount: 4 }),
  ],
});
assert.equal(mixedLateOverride.overridesByBureau.EQ.forceLatePayForLates, true);
assert.equal(mixedLateOverride.bureaus[0].primary.flow, 'late_pay');
assert.equal(mixedLateOverride.bureaus[0].primary.accounts.length, 2, 'mixed-late override moves every late-pay account to Late Pay');
assert.equal(FLOW_SEQUENCES.collection[5], '15 USC 1692e(10)', 'repo R3 reuses Collection R6');
assert.match(REPO_SEQUENCE[2], /1692e\(10\)/, 'repo R3 shortcut is retained explicitly');

const repoPlan = buildR1CampaignPlan({
  accounts: [
    account({ id: 'repo-primary', accountKind: 'repossession', bureaus: ['EQ'] }),
    account({ id: 'repo-collection', accountKind: 'collection', type: 'C', bureaus: ['EQ'] }),
    account({ id: 'repo-accuracy', accountKind: 'bankruptcy', bureaus: ['EQ'] }),
  ],
});
const repoEq = repoPlan.bureaus.find((item) => item.bureau.code === 'EQ');
assert.deepEqual(repoEq.recommendations.map((item) => item.flow), ['collection', 'accuracy']);
assert.equal(repoEq.recommendations[0].trackCode, 'repo', 'Repo stays a logical track code, not a physical template flow');
assert.equal(repoEq.recommendations[0].templateFlow, 'collection');
assert.equal(repoEq.recommendations[0].accountRoles['repo-primary'], 'repo_primary');
assert.equal(repoEq.recommendations[0].accountRoles['repo-collection'], 'repo_companion');
assert.deepEqual(repoEq.deferred, []);

const repoStates = buildInitialAccountTrackStates({ accounts: repoPlan.accountClassifications.map((item) => item.account) });
assert.equal(repoStates.find((item) => item.clientAccountId === 'repo-primary')?.nativeFlow, 'repo');
assert.equal(repoStates.find((item) => item.clientAccountId === 'repo-collection')?.pathRole, 'repo_companion');

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
  ['accuracy-r5'],
  'Combo R5 is the canonical Accuracy R5 template, not an ad hoc Combo override',
);

const latePayFallbackTemplates = [
  { id: 'consent-r2', flow: 'consent', round: 2, bureau: 'ALL', active: true, updatedAt: '2026-08-20T00:00:00Z' },
];
assert.deepEqual(
  templatesForRecommendation(latePayFallbackTemplates, { flow: 'late_pay', round: 2 }, 'EQ').map((item) => item.id),
  ['consent-r2'],
  'Late Pay R2 reuses the course Consent R2 law/template before switching to Accuracy',
);

const repoTemplates = [
  { id: 'collection-r6', flow: 'collection', round: 6, bureau: 'ALL', active: true },
  { id: 'repo-r3-ad-hoc', flow: 'repo', round: 3, bureau: 'ALL', active: true },
];
assert.deepEqual(
  templatesForRecommendation(repoTemplates, { flow: 'collection', trackCode: 'repo', round: 3 }, 'TU').map((item) => item.id),
  ['collection-r6'],
  'Repo logical R3 resolves only to the course Collection R6 template',
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
