#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildDeterministicAudit,
  coerceBureauExtraction,
  computePriorityScore,
  applyFindingAdjudication,
  isAuthorizedFinding,
  challengeStatementFor,
  evidenceQuality,
  REPORT_MAX_AGE_DAYS,
  DETERMINISTIC_AUDIT_SCHEMA_VERSION,
} from '../src/utils/deterministicAudit.js';
import { authorizedFindings as campaignAuthorizedFindings, auditFreshness } from '../src/utils/campaignBlueprint.js';
import { buildRecoveryBlueprintModel } from '../src/utils/recoveryBlueprintModel.js';
import {
  buildNonResponseAnalysis,
  evaluateBureauResponse,
  evaluateFurnisherResponse,
  extractDemandsFromLetterHtml,
  extractDeterministicDemands,
} from '../src/utils/deterministicResponse.js';
import {
  COMBINED_CREDIT_EXTRACTION_SCHEMA,
  CREDIT_BUREAU_EXTRACTION_SCHEMA,
  RESPONSE_EXTRACTION_SCHEMA,
} from '../src/utils/creditExtractionSchemas.js';

const account = (overrides = {}) => ({
  furnisher: 'Example Bank', originalCreditor: null, accountNumber: 'XXXX1234',
  reportedType: 'Installment', portfolioType: 'I', accountType: '00',
  accountStatus: '97', statusText: 'Charge-off', balance: 500, pastDue: 500,
  scheduledMonthlyPayment: 0, originalLoanAmount: 1000, dateOpened: '2020-01-01',
  dofd: '2021-02-01', dateClosed: '2021-08-01', lastPaymentDate: '2020-12-01',
  billingDate: '2026-07-01', paymentHistory: 'CO', specialComment: null,
  complianceConditionCode: null, consumerDisputeIndicator: 'UNKNOWN', remarks: null,
  furnisherAddress: null, explicitlyBlankFields: [], unreadableFields: [], evidence: [],
  ...overrides,
});

const report = (bureau, acct) => ({
  bureau,
  client: { name: 'Alex Example', address: '100 Main St', score: 650 },
  accounts: [acct], inquiries: [],
  personalInfo: { formerAddresses: [], nameVariants: [], formerEmployers: [], dateOfBirth: null, phone: null, currentAddress: '100 Main St' },
});

const audit = buildDeterministicAudit([
  report('equifax', account({ dofd: '2021-02-01' })),
  report('experian', account({ dofd: '2021-03-01' })),
]);
assert.equal(audit.evaluationMode, 'deterministic');
assert.ok(audit.accounts[0].violations.some((v) => v.ruleId === 'CROSS_BUREAU_DOFD_MISMATCH'));
assert.ok(!audit.accounts[0].violations.some((v) => v.ruleId === 'PAID_STATUS_WITH_NONZERO_BALANCE'), 'status 97 may carry a balance');

const ambiguous = buildDeterministicAudit([
  report('equifax', account({ accountNumber: '' })),
  report('experian', account({ accountNumber: '' })),
]);
assert.equal(ambiguous.accounts.length, 2, 'accounts without a stable suffix are not guessed across bureaus');
assert.ok(ambiguous.accounts.every((a) => a.findings.some((f) => f.ruleId === 'ACCOUNT_MATCH_AMBIGUOUS' && f.outcome === 'REVIEW_REQUIRED')));

const suffixCollisionReport = report('equifax', account());
suffixCollisionReport.accounts.push(account({ furnisher: 'Example Bank', accountNumber: 'YYYY1234', balance: 700 }));
const suffixCollision = buildDeterministicAudit([suffixCollisionReport]);
assert.equal(suffixCollision.accounts.length, 2, 'same-bureau suffix collisions are not merged');
assert.ok(suffixCollision.accounts.every((a) => a.findings.some((f) => f.ruleId === 'ACCOUNT_MATCH_AMBIGUOUS')));

const paid = buildDeterministicAudit([report('equifax', account({ accountStatus: '64', statusText: 'Paid charge-off' }))]);
assert.ok(paid.accounts[0].violations.some((v) => v.ruleId === 'PAID_STATUS_WITH_NONZERO_BALANCE'));

const absentField20 = buildDeterministicAudit([report('equifax', account({
  consumerDisputeIndicator: 'PRESENT', complianceConditionCode: null,
}))]);
assert.ok(!absentField20.accounts[0].violations.some((v) => v.ruleId.includes('FIELD_20')), 'not shown is not explicitly blank');

const blankField20 = buildDeterministicAudit([report('equifax', account({
  consumerDisputeIndicator: 'PRESENT', complianceConditionCode: null,
  explicitlyBlankFields: ['complianceConditionCode'],
}))]);
assert.ok(!blankField20.accounts[0].violations.some((v) => v.ruleId === 'DISPUTE_INDICATOR_WITH_EXPLICITLY_BLANK_FIELD_20'));
assert.ok(blankField20.accounts[0].findings.some((v) => v.ruleId === 'DISPUTE_INDICATOR_WITH_EXPLICITLY_BLANK_FIELD_20' && v.outcome === 'REVIEW_REQUIRED'));

const legacy = coerceBureauExtraction({
  bureau: 'Equifax', client: { name: 'Alex', address: null, score: null },
  accounts: [{ furnisher: 'Legacy Bank', accountNumber: 'XX99', status: '97', balance: 100, violations: [{ issue: 'model guess' }] }],
  inquiries: [], personalInfo: {},
});
assert.equal(Object.hasOwn(legacy.accounts[0], 'violations'), false, 'legacy model findings do not enter deterministic extraction');

const compact = coerceBureauExtraction({
  bureau: 'equifax', client: { name: 'Alex', address: null, score: null },
  accounts: [{
    furnisher: 'Compact Bank', furnisherAddress: null, originalCreditor: null,
    accountNumber: 'XX77', reportedType: 'Installment', statusText: 'Paid',
    consumerDisputeIndicator: 'PRESENT', remarks: null,
    fields: [
      { name: 'accountStatus', rawValue: '64', numericValue: null, state: 'PRESENT', page: 3, label: 'Account Status' },
      { name: 'balance', rawValue: '$100', numericValue: 100, state: 'PRESENT', page: 3, label: 'Balance' },
      { name: 'complianceConditionCode', rawValue: null, numericValue: null, state: 'EXPLICITLY_BLANK', page: 3, label: 'Compliance Condition Code' },
    ],
  }],
  inquiries: [], personalInfo: {},
});
assert.equal(compact.accounts[0].accountStatus, '64');
assert.equal(compact.accounts[0].balance, 100);
assert.ok(compact.accounts[0].explicitlyBlankFields.includes('complianceConditionCode'));
assert.equal(compact.accounts[0].evidence.find((item) => item.field === 'balance').page, 3);

const letterText = 'Correct Field 25 Date of First Delinquency to the substantiated value. Provide the records used to investigate Field 25.';
const demands = extractDeterministicDemands(letterText);
assert.equal(demands.length, 2);
const renderedDemands = extractDemandsFromLetterHtml('<table class="demands-table"><tbody><tr><td class="demand-num">1</td><td>Correct Field 25.</td></tr><tr><td>2</td><td>Provide the investigation records.</td></tr></tbody></table>');
assert.deepEqual(renderedDemands.map((d) => d.text), ['Correct Field 25.', 'Provide the investigation records.']);
const extraction = {
  sender: 'Example Bank', responseDate: '2026-08-01',
  claims: [{ type: 'CORRECTION_STATED', fieldNumber: '25', accountSuffix: '1234', value: '2021-02-01', statement: 'We corrected the Date of First Delinquency.', page: 1 }],
  providedDocumentTypes: [],
  documentQuality: { enclosureLegible: true, issues: [] },
};
const response = evaluateFurnisherResponse(letterText, extraction);
assert.equal(response.evaluationMode, 'deterministic');
assert.equal(response.classification, 'PARTIAL_FIX');
assert.equal(response.demandAnalysis[0].outcome, 'ADDRESSED');
assert.equal(response.demandAnalysis[1].outcome, 'IGNORED');

const bureau = evaluateBureauResponse(letterText, extraction);
assert.ok(bureau.reportedChanges[0].includes('verify on a later report'));
assert.equal(bureau.classification, 'PARTIAL_CORRECTION');

const nonresponse = buildNonResponseAnalysis(letterText, { responseDueAt: '2026-07-31' });
assert.equal(nonresponse.classification, 'NON_RESPONSE');
assert.ok(nonresponse.demandAnalysis.every((row) => row.ruleId === 'NO_RESPONSE_DEMAND_UNANSWERED'));

const schemas = JSON.stringify({ COMBINED_CREDIT_EXTRACTION_SCHEMA, CREDIT_BUREAU_EXTRACTION_SCHEMA, RESPONSE_EXTRACTION_SCHEMA });
assert.doesNotMatch(schemas, /violations|strategy|primaryViolation|recommendedNextAction|phase3Leverage/);

const auditWorker = readFileSync(new URL('../netlify/functions/audit-run-background.mjs', import.meta.url), 'utf8');
const responseWorker = readFileSync(new URL('../netlify/functions/phase2-analyze-background.mjs', import.meta.url), 'utf8');
const extractionPrompt = readFileSync(new URL('../src/prompts/extractionPrompts.js', import.meta.url), 'utf8');
assert.match(auditWorker, /buildDeterministicAudit/);
assert.match(auditWorker, /CREDIT_BUREAU_EXTRACTION_SCHEMA/);
assert.doesNotMatch(auditWorker, /schema: AUDIT_SCHEMA|schema: BUREAU_SCHEMA/);
assert.match(responseWorker, /evaluateFurnisherResponse/);
assert.match(responseWorker, /evaluateBureauResponse/);
assert.match(responseWorker, /schema: isBureauFollowUp \? BUREAU_FOLLOW_UP_SCHEMA : RESPONSE_EXTRACTION_SCHEMA/);
assert.doesNotMatch(extractionPrompt, /Perform a full forensic|Identify every violation|Rank top 5|strongest.*leverage/i);

// ─── v3: prioritization, adjudication, challenge statements, citation debt ───
assert.equal(DETERMINISTIC_AUDIT_SCHEMA_VERSION, 'deterministic-audit-v3');
assert.equal(REPORT_MAX_AGE_DAYS, 45);
assert.equal(auditFreshness('2026-01-01', { now: new Date('2026-03-01') }).maxAgeDays, REPORT_MAX_AGE_DAYS);

const ranked = buildDeterministicAudit([
  report('equifax', account({
    furnisher: 'Collector Co', accountType: '48', remarks: 'collection agency',
    accountNumber: 'XXXX1111', balance: 5000, dofd: '2021-01-01',
  })),
  report('experian', account({
    furnisher: 'Collector Co', accountType: '48', remarks: 'collection agency',
    accountNumber: 'XXXX1111', balance: 5000, dofd: '2021-06-01',
  })),
  report('equifax', account({
    furnisher: 'Small Bank', accountNumber: 'XXXX2222', balance: 50, dofd: '2021-01-01',
  })),
  report('experian', account({
    furnisher: 'Small Bank', accountNumber: 'XXXX2222', balance: 50, dofd: '2021-02-01',
  })),
]);
assert.ok(ranked.accounts.every((a) => typeof a.priorityScore === 'number'));
assert.ok(ranked.accounts[0].priorityScore >= ranked.accounts[ranked.accounts.length - 1].priorityScore
  || ranked.accounts.filter((a) => a.violations.length).length < 2,
  'accounts with violations are ordered by priorityScore');
assert.ok(ranked.accounts[0].findings.every((f) => f.adjudication && f.adjudication.status));
assert.ok(ranked.accounts[0].violations.every((v) => v.challengeStatement));
assert.ok(ranked.citationDebt && typeof ranked.citationDebt.count === 'number');

const dofdFinding = ranked.accounts.flatMap((a) => a.findings)
  .find((f) => f.ruleId === 'CROSS_BUREAU_DOFD_MISMATCH');
assert.ok(dofdFinding, 'cross-bureau DOFD mismatch still produced');
assert.match(challengeStatementFor(dofdFinding), /Bureaus report conflicting/i);
assert.ok(['page_backed', 'value_only', 'insufficient'].includes(evidenceQuality(dofdFinding.evidenceRefs)));

// Adjudication: suppressing a FLAG removes it from violations / campaign authorized set
const suppressed = applyFindingAdjudication(dofdFinding, {
  status: 'suppressed', reason: 'client confirmed intentional difference', by: 'tester',
});
assert.equal(suppressed.adjudication.status, 'suppressed');
assert.equal(isAuthorizedFinding(suppressed), false);
assert.equal(isAuthorizedFinding(dofdFinding), true);

const campaignItem = {
  snapshot: {
    findings: [dofdFinding, suppressed],
    violations: [dofdFinding, suppressed].filter((f) => f.outcome === 'FLAG'),
  },
};
assert.equal(campaignAuthorizedFindings(campaignItem).length, 1, 'suppressed findings excluded from campaign routing');

// Blueprint consumes challenge statements and priority scores
const blueprintModel = buildRecoveryBlueprintModel(ranked);
assert.ok(blueprintModel.openingMove);
assert.ok(blueprintModel.openingMove.primaryChallengeStatement);
assert.equal(typeof blueprintModel.metrics.citationDebtCount, 'number');
assert.ok(blueprintModel.batch1Accounts.every((a) => a.batch === 1));

// Multi-signal: last-4 alone with weak name should not fold different furnishers
const weakName = buildDeterministicAudit([
  report('equifax', account({ furnisher: 'Alpha Financial Services', accountNumber: 'XXXX9999', dateOpened: '2018-01-01', balance: 100 })),
  report('experian', account({ furnisher: 'Zeta Motors LLC', accountNumber: 'XXXX9999', dateOpened: '2024-06-01', balance: 9000 })),
]);
// If they fold, both variants exist under one account; if not, two accounts.
// Multi-signal requires supporting signals beyond last-4; these should stay separate.
assert.ok(
  weakName.accounts.length === 2
  || (weakName.accounts.length === 1 && Object.keys(weakName.accounts[0].extractedByBureau || {}).length <= 1),
  'weak name + divergent open date/balance should not confidently merge on last-4 alone',
);

console.log('All deterministic pipeline assertions passed.');
