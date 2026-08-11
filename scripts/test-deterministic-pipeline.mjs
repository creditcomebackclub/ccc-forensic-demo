#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildDeterministicAudit,
  coerceBureauExtraction,
} from '../src/utils/deterministicAudit.js';
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

console.log('All deterministic pipeline assertions passed.');
