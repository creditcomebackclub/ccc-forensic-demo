import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { buildRecoveryBlueprintModel, recoveryBlueprintFilename } from '../src/utils/recoveryBlueprintModel.js';
import { buildRecoveryBlueprintPdf } from '../src/utils/recoveryBlueprintPdf.js';

const fixture = {
  client: { name: 'David Example', address: 'Grand Junction, CO', reportDate: '2026-07-31' },
  scores: { equifax: 571, experian: 589, transunion: 603 },
  executiveSummary: 'The reviewed file contains material reporting inconsistencies across multiple furnishers.',
  accountsScanned: 18,
  accountsTargeted: 3,
  totalViolations: 999,
  accounts: [
    { id: 'a1', furnisher: 'Portfolio Recovery Associates', accountNumberMasked: '***1234', type: 'C', status: 'Collection', balance: 1420, bureaus: ['EQ', 'EXP'], batch: 1, primaryViolation: 'Balance and status reporting conflict across bureaus.', strategy: 'Demand account-level verification of the inconsistent data.', violations: [{ field: 'Balance', issue: 'The reported balances conflict.', statute: 'FCRA', severity: 'high' }] },
    { id: 'a2', furnisher: 'Discover Bank', accountNumberMasked: '***9876', type: 'A', status: 'Charged off', balance: 2840, bureaus: ['EQ', 'EXP', 'TU'], batch: 1, primaryViolation: 'The payment history and status do not align.', strategy: 'Challenge the contradictory payment history.', violations: [{ field: 'Payment history', issue: 'Contradictory history.', statute: 'FCRA', severity: 'high' }, { field: 'Status', issue: 'Conflicting status.', statute: 'Metro 2', severity: 'med' }] },
    { id: 'a3', furnisher: 'USAlliance', accountNumberMasked: '***2222', type: 'A', status: 'Late', balance: 900, bureaus: ['TU'], batch: 2, primaryViolation: 'Dates are inconsistent.', strategy: 'Request correction.', violations: [{ field: 'Dates', issue: 'Dates conflict.', statute: 'FCRA', severity: 'med' }] },
  ],
};

const model = buildRecoveryBlueprintModel(fixture);
assert.equal(model.metrics.priorityTargetCount, 3);
assert.equal(model.metrics.accuracyIssueCount, 4, 'violations must be computed from accounts, not the model summary');
assert.equal(model.metrics.targetedNegativeBalance, 5160);
assert.equal(model.metrics.batch1StrikeZone, 4260);
assert.equal(model.openingMove.id, 'a1', 'existing Claude order must be preserved');
assert.equal(model.batch1Accounts.length, 2);
assert.equal(model.openingMove.addressStatus, undefined, 'internal mail fields must not be exposed');
assert.equal(model.templateVersion, 'recovery_blueprint_v2');
assert.equal(model.pageCount, 9);
assert.ok(model.scoreGap);
assert.ok(Array.isArray(model.accuracyIssues));
assert.ok(model.batch1Accounts[0].routeLabel);
assert.equal(model.recoveryPath[0].title.includes('Forensic') || model.recoveryPath[0].title.includes('audit'), true);

assert.equal(recoveryBlueprintFilename(model), 'ccc-recovery-blueprint-david-example-2026-07-31.pdf');

const doc = buildRecoveryBlueprintPdf(model);
assert.equal(doc.getNumberOfPages(), 9);
assert.ok(doc.output('arraybuffer').byteLength > 5_000);

const overflowFixture = structuredClone(fixture);
overflowFixture.client.name = 'Alexandria Montgomery-Washington-Sanchez';
overflowFixture.accounts = Array.from({ length: 9 }, (_, index) => ({
  ...fixture.accounts[index % fixture.accounts.length],
  id: `overflow-${index}`,
  furnisher: `Very Long Financial Services Furnisher Name ${index + 1}`,
  batch: 1,
  balance: 123456 + index,
  primaryViolation: 'The payment history, account status, balance, and delinquency chronology contain documented inconsistencies across the reviewed bureau files.',
}));
const overflowModel = buildRecoveryBlueprintModel(overflowFixture);
assert.equal(overflowModel.batch1Accounts.length, 9);
assert.equal(overflowModel.openingMove.id, 'overflow-0');
assert.ok(buildRecoveryBlueprintPdf(overflowModel).getNumberOfPages() >= 9, 'large strike lists may add continuation pages but must never be truncated');

if (process.env.BLUEPRINT_QA_OUTPUT) {
  writeFileSync(process.env.BLUEPRINT_QA_OUTPUT, Buffer.from(doc.output('arraybuffer')));
}

console.log('Recovery Blueprint model and nine-page client audit renderer tests passed.');
