#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildDeterministicAudit } from '../src/utils/deterministicAudit.js';
import { buildBureauR1Recommendation, buildR1CampaignPlan, classifyAccountForR1 } from '../src/utils/disputeFlow.js';
import { parseLatePaymentHistory } from '../src/utils/disputeRoutingFacts.js';

const client = { name: 'Fixture Client', address: '100 Main St', score: 650 };

function account(overrides = {}) {
  const row = {
    furnisher: 'Fixture Bank',
    originalCreditor: 'Fixture Bank',
    accountNumber: 'XXXX1234',
    reportedType: 'Installment',
    accountType: '00',
    accountStatus: '11',
    statusText: 'Current',
    dateOpened: '2020-01-01',
    balance: 500,
    paymentHistory: 'OK OK OK',
    remarks: null,
    accountIdentityEvidencePage: 1,
    reportedTypeEvidencePage: 1,
    statusTextEvidencePage: 1,
    remarksEvidencePage: null,
    ...overrides,
  };
  row.accountIdentityEvidencePage = row.furnisher || row.originalCreditor || row.accountNumber ? 1 : null;
  row.reportedTypeEvidencePage = row.reportedType ? 1 : null;
  row.statusTextEvidencePage = row.statusText ? 1 : null;
  row.remarksEvidencePage = row.remarks ? 1 : null;
  if (!Object.prototype.hasOwnProperty.call(overrides, 'evidence')) {
    row.evidence = [
      'furnisher', 'originalCreditor', 'reportedType', 'accountType', 'accountStatus',
      'statusText', 'paymentHistory', 'remarks', 'specialComment', 'paymentRating',
    ].filter((field) => row[field] !== null && row[field] !== undefined && row[field] !== '').map((field) => ({
      field, rawValue: row[field], page: 1, label: field,
    }));
  }
  return row;
}

function report(bureau, accounts = []) {
  return {
    bureau,
    bureauEvidencePage: 1,
    reportDate: '2026-08-20',
    reportDateEvidencePage: 1,
    client: {
      ...client,
      nameEvidencePage: 1,
      addressEvidencePage: 1,
      scoreEvidencePage: 1,
    },
    accounts,
    inquiries: [],
    personalInfo: {
      formerAddresses: [],
      nameVariants: [],
      formerEmployers: [],
      currentAddress: client.address,
      currentAddressEvidencePage: 1,
    },
  };
}

function completeReports(byBureau) {
  return [
    report('equifax', byBureau.EQ || []),
    report('experian', byBureau.EXP || []),
    report('transunion', byBureau.TU || []),
  ];
}

function sameEverywhere(acct) {
  return completeReports({ EQ: [acct], EXP: [acct], TU: [acct] });
}

assert.deepEqual(parseLatePaymentHistory('Jan 2026 OK Feb 2026 30 Mar 2026 60'), {
  status: 'confirmed', count: 2, band: 'two_or_fewer',
  evidence: 'Jan 2026 OK Feb 2026 30 Mar 2026 60', parser: 'recognized_status_grid',
});
assert.equal(parseLatePaymentHistory('30 days late on 01/15/2026').status, 'review_required');
assert.equal(parseLatePaymentHistory('Jan 2026 ???').status, 'review_required');
assert.equal(parseLatePaymentHistory('30 days late: 2 times; 60 days late: 1 time').count, 3, 'visible multiplicities are summed, not phrase-counted');
assert.equal(parseLatePaymentHistory('30 days late; occurred twice').status, 'review_required', 'unbound narrative multiplicity fails closed');
assert.equal(parseLatePaymentHistory('30 days late: 2').status, 'review_required', 'an unlabeled trailing count cannot be silently treated as one occurrence');

const collectionAudit = buildDeterministicAudit(sameEverywhere(account({
  furnisher: 'Fixture Collections LLC',
  originalCreditor: 'Original Bank',
  accountType: '48',
  reportedType: 'Collection account',
  statusText: 'Placed for collection',
})));
assert.equal(collectionAudit.reportCoverage.complete, true);
assert.equal(collectionAudit.accounts[0].accountKind, 'collection');
assert.equal(classifyAccountForR1(collectionAudit.accounts[0], {}, 'EQ').flow, 'collection');

const repoAudit = buildDeterministicAudit(sameEverywhere(account({
  furnisher: 'Auto Finance', reportedType: 'Auto loan repossession', statusText: 'Repossession',
})));
const repoRoute = classifyAccountForR1(repoAudit.accounts[0], {}, 'TU');
assert.equal(repoRoute.flow, 'collection');
assert.equal(repoRoute.specialRule, 'repo');

const bankruptcyAudit = buildDeterministicAudit(sameEverywhere(account({
  remarks: 'Included in Chapter 7 bankruptcy', statusText: 'Discharged in bankruptcy',
})));
assert.equal(classifyAccountForR1(bankruptcyAudit.accounts[0], {}, 'EXP').flow, 'accuracy');

const multiChargeOff = buildDeterministicAudit(sameEverywhere(account({
  accountStatus: '97', statusText: 'Charge-off', paymentHistory: 'CO CO CO',
})));
assert.equal(classifyAccountForR1(multiChargeOff.accounts[0], {}, 'EQ').flow, 'accuracy');

const anchor = account({
  furnisher: 'Positive Anchor', originalCreditor: 'Positive Anchor', accountNumber: 'XXXX9000',
  statusText: 'Current pays as agreed', paymentHistory: 'OK OK OK',
});
const soloChargeOff = account({
  furnisher: 'Solo Chargeoff', originalCreditor: 'Solo Chargeoff', accountNumber: 'XXXX4444',
  accountStatus: '97', statusText: 'Charge-off', paymentHistory: 'CO CO CO',
});
const soloAudit = buildDeterministicAudit(completeReports({
  EQ: [soloChargeOff, anchor], EXP: [anchor], TU: [anchor],
}));
const soloAccount = soloAudit.accounts.find((item) => item.accountNumberMasked.endsWith('4444'));
assert.equal(classifyAccountForR1(soloAccount, {}, 'EQ').flow, 'consent');

const perBureauLates = buildDeterministicAudit(completeReports({
  EQ: [account({ statusText: 'Current with historical late', paymentHistory: 'OK 30 OK' })],
  EXP: [account({ statusText: 'Current with historical late', paymentHistory: '30 60 90' })],
  TU: [account({ statusText: 'Current with historical late', paymentHistory: 'OK OK 30 60' })],
}));
const lateAccount = perBureauLates.accounts[0];
assert.equal(classifyAccountForR1(lateAccount, {}, 'EQ').flow, 'late_pay');
assert.equal(classifyAccountForR1(lateAccount, {}, 'EXP').flow, 'accuracy');
assert.equal(classifyAccountForR1(lateAccount, {}, 'TU').flow, 'late_pay');
const latePlan = buildR1CampaignPlan(perBureauLates);
assert.equal(latePlan.bureaus.find((item) => item.bureau.code === 'EQ').recommendations[0].flow, 'late_pay');
assert.equal(latePlan.bureaus.find((item) => item.bureau.code === 'EXP').recommendations[0].flow, 'accuracy');

const studentOne = account({ furnisher: 'Navient', originalCreditor: 'Department of Education', accountNumber: 'XXXX1111', reportedType: 'Student loan' });
const studentTwo = account({ furnisher: 'Nelnet', originalCreditor: 'Department of Education', accountNumber: 'XXXX2222', reportedType: 'Student loan' });
const chargeOff = account({ furnisher: 'Bank Three', originalCreditor: 'Bank Three', accountNumber: 'XXXX3333', accountStatus: '97', statusText: 'Charge-off', paymentHistory: 'CO' });
const studentMajority = buildDeterministicAudit(sameEverywhere(studentOne).map((row) => ({ ...row, accounts: [studentOne, studentTwo, chargeOff] })));
const studentPlan = buildBureauR1Recommendation(studentMajority, 'EQ');
assert.equal(studentPlan.overrides.forceConsent, true);
assert.ok(studentPlan.classifications.every((item) => item.flow === 'consent'));

const unknown = account({ furnisher: 'Unclear Co', originalCreditor: null, accountNumber: 'XXXX7777', reportedType: null, accountStatus: null, statusText: 'Not displayed', paymentHistory: null, evidence: [] });
const blockedMajority = buildDeterministicAudit(sameEverywhere(studentOne).map((row) => ({ ...row, accounts: [studentOne, studentTwo, unknown] })));
const blockedPlan = buildBureauR1Recommendation(blockedMajority, 'EQ');
assert.equal(blockedPlan.overrides.forceConsent, false, 'unknown negative data prevents a file-wide majority override');
assert.ok(blockedPlan.needsReview.length > 0);

const incomplete = buildDeterministicAudit([
  report('equifax', [soloChargeOff]),
  report('experian', [soloChargeOff]),
]);
assert.equal(incomplete.reportCoverage.complete, false);
assert.ok(incomplete.accounts[0].routingFacts.blockingCodes.includes('INCOMPLETE_3B'));
assert.equal(classifyAccountForR1(incomplete.accounts[0], {}, 'EQ').needsReview, true);

const suffixAmbiguity = buildDeterministicAudit(completeReports({
  EQ: [account({ furnisher: 'Alpha Bank', originalCreditor: 'Alpha Bank', accountNumber: 'XXXX8888', dateOpened: '2018-01-01', balance: 100 })],
  EXP: [account({ furnisher: 'Zeta Motors', originalCreditor: 'Zeta Motors', accountNumber: 'YYYY8888', dateOpened: '2024-01-01', balance: 9000 })],
  TU: [],
}));
assert.equal(suffixAmbiguity.accounts.length, 2);
assert.ok(suffixAmbiguity.accounts.every((item) => item.routingFacts.blockingCodes.includes('ACCOUNT_MATCH_AMBIGUOUS')));

const narrativeOnly = account({
  furnisher: 'Narrative Collector', accountType: null, accountStatus: null,
  reportedType: 'Collection account', statusText: 'Placed for collection', evidence: [],
});
narrativeOnly.reportedTypeEvidencePage = null;
narrativeOnly.statusTextEvidencePage = null;
assert.throws(
  () => buildDeterministicAudit(sameEverywhere(narrativeOnly)),
  /has no source page reference/,
  'narrative-only account labels cannot enter classification without exact page evidence',
);

const zeroLate = {
  ...lateAccount,
  routingFacts: {
    ...lateAccount.routingFacts,
    status: 'confirmed',
    blockingCodes: [],
    bureauFacts: {
      ...lateAccount.routingFacts.bureauFacts,
      EQ: { accountKind: 'late_payment', latePaymentCount: 0, latePaymentBand: 'none', latePaymentStatus: 'confirmed' },
    },
  },
};
assert.equal(classifyAccountForR1(zeroLate, {}, 'EQ').needsReview, true, 'zero late markers can never authorize a late-payment route');

console.log('All deterministic CCC R1 classification assertions passed.');
