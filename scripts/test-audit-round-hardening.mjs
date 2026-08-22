#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchAccount } from '../src/utils/accountIdentity.js';
import { buildR1CampaignPlan, deriveFileRoutingOverrides } from '../src/utils/disputeFlow.js';
import { transitionDisputeState } from '../src/utils/disputeState.js';
import { assertRecoveryBlueprintReady, buildRecoveryBlueprintModel } from '../src/utils/recoveryBlueprintModel.js';
import { buildRecoveryBlueprintPdf } from '../src/utils/recoveryBlueprintPdf.js';
import { makeZeroCreditReviewedAudit } from './fixtures/ccc-zero-credit-3b.mjs';

const reportCoverage = {
  complete: true,
  missing: [],
  duplicates: [],
  counts: { EQ: 1, EXP: 1, TU: 1 },
};

function confirmedAccount({ id, clientAccountId, kind, bureaus }) {
  return {
    id,
    clientAccountId,
    furnisher: `${kind} fixture`,
    accountNumberMasked: `XXXX${clientAccountId.slice(0, 4)}`,
    accountKind: kind,
    bureaus,
    routingFacts: {
      status: 'confirmed',
      source: 'staff_review',
      staffAttested: true,
      accountKind: kind,
      blockingCodes: [],
      reportCoverage,
      bureauFacts: Object.fromEntries(bureaus.map((bureauCode) => [bureauCode, {
        accountKind: kind,
        latePaymentCount: null,
        latePaymentBand: 'none',
        latePaymentStatus: 'not_applicable',
      }])),
    },
  };
}

const fileWideMajorityAudit = {
  reportCoverage,
  accounts: [
    confirmedAccount({ id: 'student-eq', clientAccountId: '11111111-1111-4111-8111-111111111111', kind: 'student_loan', bureaus: ['EQ'] }),
    confirmedAccount({ id: 'student-exp', clientAccountId: '22222222-2222-4222-8222-222222222222', kind: 'student_loan', bureaus: ['EXP'] }),
    confirmedAccount({ id: 'collection-tu', clientAccountId: '33333333-3333-4333-8333-333333333333', kind: 'collection', bureaus: ['TU'] }),
  ],
};
const fileOverrides = deriveFileRoutingOverrides(fileWideMajorityAudit.accounts);
assert.equal(fileOverrides.forceConsent, true, 'student-loan majority must be computed across the whole 3B file');
const fileWidePlan = buildR1CampaignPlan(fileWideMajorityAudit);
assert.equal(fileWidePlan.bureaus.find((item) => item.bureau.code === 'TU').recommendations[0].flow, 'consent');
assert.ok(fileWidePlan.accountClassifications.every((item) => item.flow === 'consent'));

const noSuffix = matchAccount({ furnisher: 'Fixture Bank', accountNumberMasked: null }, []);
assert.equal(noSuffix.ambiguous, true);
assert.equal(noSuffix.identityId, null, 'missing report suffix must never mint or select a canonical account id');
const suffixCollision = matchAccount({
  furnisher: 'Unrelated Collector',
  originalCreditor: 'Unrelated Medical Group',
  accountNumberMasked: 'XXXX7788',
}, [{
  id: 'existing-account',
  norm_furnisher: 'frontier bank',
  original_creditor: 'frontier bank',
  account_last4: '7788',
}]);
assert.equal(suffixCollision.ambiguous, true, 'a single suffix collision with two contradictory identity anchors must stop');

const track = (currentFlow, currentRound, extra = {}) => ({
  methodVersion: 'ccc_skool_2026_v1',
  accountKind: 'collection',
  nativeFlow: currentFlow,
  currentFlow,
  currentRound,
  pathRole: 'standard',
  status: 'active',
  cycle: 2,
  revision: 4,
  usedNativeRounds: {},
  ...extra,
});
for (const [flow, round, reviewCode] of [
  ['collection', 10, 'collection_end_cycle_unconfirmed'],
  ['combo', 12, 'combo_end_cycle_unconfirmed'],
  ['accuracy', 12, 'accuracy_end_cycle_unconfirmed'],
  ['accuracy_solo', 1, 'accuracy_solo_extension_unconfirmed'],
]) {
  const next = transitionDisputeState(track(flow, round), { outcome: 'remains' });
  assert.equal(next.status, 'review_required');
  assert.equal(next.currentFlow, flow);
  assert.equal(next.currentRound, round);
  assert.equal(next.cycle, 2, `${flow} must not start an invented new cycle`);
  assert.equal(next.reviewCode, reviewCode);
}

const reviewedAudit = makeZeroCreditReviewedAudit();
const ready = assertRecoveryBlueprintReady(reviewedAudit);
assert.equal(ready.plan.recommendedLetterCount, 5, 'combo and independent Late Pay letters must remain separate');
const model = buildRecoveryBlueprintModel(reviewedAudit, {
  auditRevision: '2026-08-20T19:00:00.000Z',
  auditSha256: 'a'.repeat(64),
});
assert.equal(model.templateVersion, 'recovery_blueprint_v3');
assert.equal(model.recommendations.length, 5);
assert.ok(model.recommendations.every((item) => !['direct', 'accuracy_solo'].includes(item.flow)));
assert.ok(model.recommendations.every((item) => item.accountIds.every(Boolean)));
assert.equal(model.provenance.auditId, reviewedAudit.id);
assert.equal(model.provenance.clientId, reviewedAudit.client.id);
assert.throws(
  () => buildRecoveryBlueprintModel({ ...reviewedAudit, classificationReview: null }),
  /Confirm and save the exact deterministic classification review/,
);
assert.throws(
  () => buildRecoveryBlueprintModel({
    ...reviewedAudit,
    accounts: reviewedAudit.accounts.map((account, index) => index === 0
      ? { ...account, accountKind: 'bankruptcy', routingFacts: { ...account.routingFacts, accountKind: 'bankruptcy' } }
      : account),
  }),
  /changed after the saved staff review/,
);
const pdf = buildRecoveryBlueprintPdf(model);
assert.ok(pdf.getNumberOfPages() >= 7);
assert.ok(pdf.output('arraybuffer').byteLength > 5_000);

const correctionClient = readFileSync(new URL('../src/utils/recoveryBlueprintApi.js', import.meta.url), 'utf8');
const correctionPayload = correctionClient.slice(correctionClient.indexOf('accounts: accounts.map'), correctionClient.indexOf('})),', correctionClient.indexOf('accounts: accounts.map')) + 4);
for (const field of ['balance:', 'status:', 'accountNumberMasked:', 'originalCreditor:', 'findings:', 'strategy:']) {
  assert.doesNotMatch(correctionPayload, new RegExp(field), `browser classification payload must not rewrite source fact ${field}`);
}

const endpoint = readFileSync(new URL('../netlify/functions/recovery-blueprint.mjs', import.meta.url), 'utf8');
assert.match(endpoint, /assertExactActionRevision\(payload, auditRow\)/);
assert.match(endpoint, /assertRecoveryBlueprintReady\(exactAudit/);
assert.match(endpoint, /action === 'preview'[\s\S]*?assertExactActionRevision/);
assert.match(endpoint, /action === 'approve'[\s\S]*?assertExactActionRevision/);
assert.match(endpoint, /action === 'send'[\s\S]*?assertExactActionRevision/);

const migration = readFileSync(new URL('../supabase/migrations/20260820340000_fail_closed_end_cycle_transitions.sql', import.meta.url), 'utf8');
for (const code of [
  'collection_end_cycle_unconfirmed',
  'combo_end_cycle_unconfirmed',
  'accuracy_end_cycle_unconfirmed',
  'accuracy_solo_extension_unconfirmed',
]) assert.match(migration, new RegExp(code));
assert.doesNotMatch(migration, /collection_restart|combo_restart|accuracy_to_consent/);

console.log('Audit and round-pipeline hardening assertions passed.');
