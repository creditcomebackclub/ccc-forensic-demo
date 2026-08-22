#!/usr/bin/env node
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import {
  assertRecoveryBlueprintReady,
  buildRecoveryBlueprintModel,
  recoveryBlueprintFilename,
} from '../src/utils/recoveryBlueprintModel.js';
import { buildRecoveryBlueprintPdf } from '../src/utils/recoveryBlueprintPdf.js';
import { makeZeroCreditReviewedAudit } from './fixtures/ccc-zero-credit-3b.mjs';

const audit = makeZeroCreditReviewedAudit();
const ready = assertRecoveryBlueprintReady(audit);
assert.equal(ready.plan.needsReview.length, 0);
assert.equal(ready.plan.recommendedLetterCount, 5);

const model = buildRecoveryBlueprintModel(audit, {
  auditRevision: '2026-08-20T19:00:00.000Z',
  auditSha256: 'b'.repeat(64),
});
assert.equal(model.templateVersion, 'recovery_blueprint_v3');
assert.equal(model.pageCount, 7);
assert.equal(model.metrics.accountsReviewed, 3);
assert.equal(model.metrics.disputeEligibleAccounts, 3);
assert.equal(model.metrics.recommendedLetters, 5);
assert.equal(model.recommendations.length, 5);
assert.ok(model.recommendations.every((recommendation) => recommendation.accountIds.length > 0));
assert.ok(model.recommendations.every((recommendation) => !['direct', 'accuracy_solo'].includes(recommendation.flow)));
assert.ok(model.routedAccounts.every((account) => account.id && account.clientAccountId));
assert.equal(model.provenance.auditId, audit.id);
assert.equal(model.provenance.clientId, audit.client.id);
assert.equal(model.provenance.classificationReviewVersion, 1);
assert.equal(model.provenance.auditSha256, 'b'.repeat(64));

assert.equal(
  recoveryBlueprintFilename(model),
  'ccc-recovery-blueprint-jordan-zero-credit-fixture-2026-08-20.pdf',
);

assert.throws(
  () => buildRecoveryBlueprintModel({ ...audit, classificationReview: null }),
  /Confirm and save the exact deterministic classification review/,
);
assert.throws(
  () => buildRecoveryBlueprintModel({
    ...audit,
    classificationReview: { ...audit.classificationReview, clientId: '99999999-9999-4999-8999-999999999999' },
  }),
  /Confirm and save the exact deterministic classification review/,
);
assert.throws(
  () => buildRecoveryBlueprintModel({
    ...audit,
    accounts: audit.accounts.map((account, index) => index === 0
      ? { ...account, clientAccountId: '99999999-9999-4999-8999-999999999999' }
      : account),
  }),
  /changed after the saved staff review|routing facts changed/,
);

const doc = buildRecoveryBlueprintPdf(model);
assert.ok(doc.getNumberOfPages() >= 7);
assert.ok(doc.output('arraybuffer').byteLength > 5_000);

if (process.env.BLUEPRINT_QA_OUTPUT) {
  writeFileSync(process.env.BLUEPRINT_QA_OUTPUT, Buffer.from(doc.output('arraybuffer')));
}

console.log('Recovery Blueprint deterministic review-gate and renderer assertions passed.');
