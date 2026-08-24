#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertExtractionPageBounds,
  assertReportCohort,
  buildDeterministicAudit,
  coerceBureauExtraction,
  isAuthorizedFinding,
  mergeBureauExtractions,
  mergeCombinedExtractions,
  rebaseExtractionPageRefs,
} from '../src/utils/deterministicAudit.js';
import { buildCampaignItems } from '../src/utils/campaignItems.js';
import { CREDIT_ACCOUNT_FIELD_NAMES } from '../src/utils/creditExtractionSchemas.js';

const EVALUATED_AT = '2026-08-22T12:00:00.000Z';
const REPORT_DATE = '2026-08-20';

const extractedField = (name, rawValue, { numericValue = null, page = 2, state = 'PRESENT' } = {}) => ({
  name, rawValue: rawValue == null ? null : String(rawValue), numericValue, state, page,
  label: name,
});

function baseAccount(overrides = {}) {
  const { fields: suppliedFields, ...rest } = overrides;
  const defaults = suppliedFields || [
    extractedField('accountStatus', '11'),
    extractedField('accountType', '01'),
    extractedField('portfolioType', 'I'),
    extractedField('balance', '500', { numericValue: 500 }),
    extractedField('dateOpened', '2024-01-01'),
  ];
  const byName = new Map(defaults.map((field) => [field.name, field]));
  return {
    furnisher: 'Shared National Bank',
    furnisherAddress: '100 Main St, Phoenix, AZ 85001',
    originalCreditor: 'Shared National Bank',
    accountNumber: 'XXXX1234',
    accountIdentityEvidencePage: 2,
    reportedType: 'Installment account',
    reportedTypeEvidencePage: 2,
    statusText: 'Current',
    statusTextEvidencePage: 2,
    consumerDisputeIndicator: 'ABSENT',
    consumerDisputeIndicatorEvidencePage: 2,
    remarks: null,
    remarksEvidencePage: null,
    fields: CREDIT_ACCOUNT_FIELD_NAMES.map((name) => byName.get(name) || extractedField(name, null, {
      state: 'NOT_SHOWN', page: null,
    })),
    ...rest,
  };
}

function report(bureau, overrides = {}) {
  const base = {
    bureau,
    bureauEvidencePage: 1,
    reportSectionStart: true,
    reportSectionStartEvidencePage: 1,
    reportDate: REPORT_DATE,
    reportDateRaw: 'August 20, 2026',
    reportDateEvidencePage: 1,
    client: {
      name: 'Chris A. Holland', nameEvidencePage: 1,
      address: '10 Client Way, Phoenix, AZ 85001', addressEvidencePage: 1,
      score: 620, scoreEvidencePage: 1,
    },
    accounts: [baseAccount()],
    inquiries: [{ furnisher: 'Example Auto', date: '2026-08-01', type: 'auto', evidencePage: 2 }],
    personalInfo: {
      formerAddresses: [], formerAddressEvidence: [],
      nameVariants: [], nameVariantEvidence: [],
      formerEmployers: [], formerEmployerEvidence: [],
      dateOfBirth: null, dateOfBirthEvidencePage: null,
      phone: null, phoneEvidencePage: null,
      currentAddress: '10 Client Way, Phoenix, AZ 85001', currentAddressEvidencePage: 1,
    },
  };
  return {
    ...base,
    ...overrides,
    client: { ...base.client, ...(overrides.client || {}) },
    personalInfo: { ...base.personalInfo, ...(overrides.personalInfo || {}) },
    accounts: overrides.accounts || base.accounts,
    inquiries: overrides.inquiries || base.inquiries,
  };
}

const selectedClient = {
  name: 'Chris Holland', date_of_birth: '1980-01-02',
  address: '10 Client Way, Phoenix, AZ 85001',
};
const three = ['equifax', 'experian', 'transunion'].map((bureau, index) => report(bureau, index === 0 ? {
  personalInfo: { dateOfBirth: '1980-01-02', dateOfBirthEvidencePage: 1 },
} : {}));

// Source bureau is evidence, never a browser slot label.
assert.throws(
  () => coerceBureauExtraction(report('experian'), 'equifax'),
  /slot contains a source-identified experian report/i,
);
assert.equal(coerceBureauExtraction(report('equifax'), 'equifax').bureau, 'equifax');
const coercedAccount = coerceBureauExtraction(report('equifax'), 'equifax').accounts[0];
assert.equal(coercedAccount.fields.length, CREDIT_ACCOUNT_FIELD_NAMES.length,
  'coercion preserves the exact field evidence records required by downstream validation');
assert.equal(coercedAccount.fields.find((field) => field.name === 'balance').page, 2);

// Exact 3B cohort + selected-client identity. Optional DOB visibility may
// differ by bureau, but a conflicting visible DOB must fail closed.
const cohort = assertReportCohort(three, { requireThree: true, selectedClient, now: EVALUATED_AT });
assert.equal(cohort.reportDate, REPORT_DATE);
assert.deepEqual(cohort.bureaus, ['equifax', 'experian', 'transunion']);
assert.equal(cohort.identity.dateOfBirth, '1980-01-02');
assert.doesNotThrow(() => assertReportCohort([
  report('equifax'),
], {
  requireThree: false, selectedClient: { name: 'Chris Holland' }, now: EVALUATED_AT,
}));
assert.doesNotThrow(() => assertReportCohort([
  report('equifax'),
], {
  requireThree: false,
  selectedClient: { name: 'Chris Holland', address: '99 Wrong Way, Phoenix, AZ 85001' },
  now: EVALUATED_AT,
}));
assert.doesNotThrow(() => assertReportCohort([
  report('equifax', { personalInfo: { dateOfBirth: '1980-01-02', dateOfBirthEvidencePage: 1 } }),
  report('experian', { client: { address: '99 Wrong Way, Phoenix, AZ 85001' } }),
  report('transunion', { client: { address: '99 Wrong Way, Phoenix, AZ 85001' } }),
], {
  requireThree: true,
  selectedClient,
  now: EVALUATED_AT,
}));
assert.throws(() => assertReportCohort([
  report('equifax', { personalInfo: { dateOfBirth: '1981-01-02', dateOfBirthEvidencePage: 1 } }),
], {
  requireThree: false,
  selectedClient,
  now: EVALUATED_AT,
}), /date of birth does not match the selected CRM client/i);
assert.throws(() => assertReportCohort([
  three[0], three[1], report('transunion', { personalInfo: { dateOfBirth: '1981-01-02', dateOfBirthEvidencePage: 1 } }),
], { selectedClient, now: EVALUATED_AT }), /conflicting dates of birth/i);
assert.throws(() => assertReportCohort(three, {
  selectedClient: { name: 'Another Consumer' }, now: EVALUATED_AT,
}), /does not match the exact CRM client/i);
assert.throws(() => assertReportCohort([
  three[0], report('experian', { reportDate: '2026-08-19' }), three[2],
], { selectedClient, now: EVALUATED_AT }), /different report dates/i);
assert.throws(() => assertReportCohort([
  report('equifax', { reportDate: '2026-06-01' }),
  report('experian', { reportDate: '2026-06-01' }),
  report('transunion', { reportDate: '2026-06-01' }),
], { selectedClient: { name: 'Chris Holland' }, now: EVALUATED_AT }), /fresh 3B report/i);
assert.throws(() => assertReportCohort(three, { selectedClient }), /immutable evaluation timestamp/i);

// Identity values require their own page anchors; unrelated evidence cannot
// establish client attribution.
assert.throws(() => assertReportCohort([
  report('equifax', { client: { nameEvidencePage: null } }),
], { requireThree: false, selectedClient, now: EVALUATED_AT }), /name must be bound/i);
assert.throws(() => assertReportCohort([
  report('equifax', { personalInfo: { dateOfBirth: '1980-01-02', dateOfBirthEvidencePage: null } }),
], { requireThree: false, selectedClient, now: EVALUATED_AT }), /date of birth must be bound/i);
assert.throws(() => assertReportCohort([
  report('equifax', { personalInfo: { dateOfBirth: 'not-a-date', dateOfBirthEvidencePage: 1 } }),
], { requireThree: false, selectedClient, now: EVALUATED_AT }), /not a valid calendar date/i);

// Every source page is exact and bounded. Chunk-local references are rebased
// to original PDF pages before they can be used as evidence.
assertExtractionPageBounds(report('equifax'), 2);
for (const invalidPage of [0, 1.5, 999]) {
  assert.throws(() => assertExtractionPageBounds(report('equifax', {
    client: { nameEvidencePage: invalidPage },
  }), 2), /outside the valid 1-2 range|no source page reference/i);
}
for (const state of ['PRESENT', 'EXPLICITLY_BLANK']) {
  assert.throws(() => assertExtractionPageBounds(report('equifax', {
    accounts: [baseAccount({ fields: [extractedField('accountStatus', state === 'PRESENT' ? '11' : null, { state, page: null })] })],
  }), 2), /observation has no source page reference/i);
}
assert.throws(() => assertExtractionPageBounds(report('equifax', {
  accounts: [baseAccount({ accountIdentityEvidencePage: null })],
}), 2), /account identity has no source page reference/i);
assert.throws(() => assertExtractionPageBounds(report('equifax', {
  accounts: [baseAccount({ consumerDisputeIndicatorEvidencePage: null })],
}), 2), /consumer dispute indicator has no source page reference/i);
assert.throws(() => assertExtractionPageBounds(report('equifax', {
  inquiries: [{ furnisher: 'Unanchored Inquiry', date: '2026-08-01', type: 'auto', evidencePage: null }],
}), 2), /hard inquiry has no source page reference/i);
assert.throws(() => assertExtractionPageBounds(report('equifax', {
  personalInfo: {
    formerAddresses: ['99 Unanchored Ave'], formerAddressEvidence: [],
  },
}), 2), /former address has no matching source page reference/i);
assert.throws(() => assertExtractionPageBounds(report('equifax', {
  accounts: [{ ...baseAccount(), fields: baseAccount().fields.slice(1) }],
}), 2), /exactly one entry for every allowed/i);
assert.throws(() => assertExtractionPageBounds(report('equifax', {
  accounts: [{ ...baseAccount(), fields: [...baseAccount().fields, extractedField('accountStatus', '71')] }],
}), 2), /exactly one entry for every allowed/i);
const rebased = rebaseExtractionPageRefs(report('equifax'), 3);
assert.equal(rebased.bureauEvidencePage, 4);
assert.equal(rebased.reportSectionStartEvidencePage, 4);
assert.equal(rebased.client.nameEvidencePage, 4);
assert.equal(rebased.accounts[0].fields[0].page, 5);
assert.equal(rebased.accounts[0].accountIdentityEvidencePage, 5);
assert.equal(rebased.accounts[0].consumerDisputeIndicatorEvidencePage, 5);
assert.equal(rebased.inquiries[0].evidencePage, 5);
assertExtractionPageBounds(rebased, 5);

// Overlapping PDF chunks dedupe accounts and inquiries while preserving both
// original-page observations. A metadata-free continuation chunk inherits
// only from the same exact file at merge time.
const chunkOne = report('equifax');
const chunkTwo = rebaseExtractionPageRefs(report('equifax', {
  bureau: null,
  bureauEvidencePage: null,
  reportSectionStart: false,
  reportSectionStartEvidencePage: null,
  reportDate: null,
  reportDateRaw: null,
  reportDateEvidencePage: null,
  client: { name: null, nameEvidencePage: null, address: null, addressEvidencePage: null, score: null, scoreEvidencePage: null },
  personalInfo: { dateOfBirth: null, dateOfBirthEvidencePage: null },
}), 2);
const mergedChunks = mergeBureauExtractions([chunkOne, chunkTwo], 'equifax');
assert.equal(mergedChunks.accounts.length, 1);
assert.equal(mergedChunks.inquiries.length, 1);
assert.ok(mergedChunks.accounts[0].evidence.some((entry) => entry.page === 4), 'chunk page 2 rebases to original page 4');
assert.equal(mergedChunks.reportDate, REPORT_DATE);
assert.equal(mergedChunks.accounts[0].fields.length, CREDIT_ACCOUNT_FIELD_NAMES.length,
  'chunk merge preserves one exact evidence record for every allowed field');
const repeatedOverlapRoot = mergeBureauExtractions([
  chunkOne,
  structuredClone(chunkOne),
], 'equifax');
assert.equal(repeatedOverlapRoot.reportSectionStartEvidencePage, 1,
  'the same visible section header repeated by an overlapping page is one source section');

const orphanPageContinuation = rebaseExtractionPageRefs(report('equifax', {
  bureau: null,
  bureauEvidencePage: null,
  reportSectionStart: false,
  reportSectionStartEvidencePage: null,
  reportDate: null,
  reportDateRaw: null,
  reportDateEvidencePage: null,
  client: { name: null, nameEvidencePage: 2, address: null, addressEvidencePage: null, score: null, scoreEvidencePage: null },
}), 2);
assert.throws(
  () => mergeBureauExtractions([chunkOne, orphanPageContinuation], 'equifax'),
  /consumer name has a source page but no displayed value/i,
  'a page from one PDF chunk cannot be attached to a value extracted from another chunk',
);

const conflictingScoreContinuation = rebaseExtractionPageRefs(report('equifax', {
  bureau: null,
  bureauEvidencePage: null,
  reportSectionStart: false,
  reportSectionStartEvidencePage: null,
  reportDate: null,
  reportDateRaw: null,
  reportDateEvidencePage: null,
  client: { name: null, nameEvidencePage: null, address: null, addressEvidencePage: null, score: 710, scoreEvidencePage: 1 },
}), 2);
assert.throws(
  () => mergeBureauExtractions([chunkOne, conflictingScoreContinuation], 'equifax'),
  /conflicting consumer score values/i,
  'conflicting scalar observations across overlapping chunks fail closed',
);

const sparseChunk = report('equifax', {
  accounts: [baseAccount({
    fields: [
      extractedField('accountStatus', '11'),
      extractedField('balance', '500', { numericValue: 500 }),
      extractedField('dateOpened', '2024-01-01'),
    ],
  })],
});
const richerContinuation = rebaseExtractionPageRefs(report('equifax', {
  bureau: null,
  bureauEvidencePage: null,
  reportSectionStart: false,
  reportSectionStartEvidencePage: null,
  reportDate: null,
  reportDateRaw: null,
  reportDateEvidencePage: null,
  client: { name: null, nameEvidencePage: null, address: null, addressEvidencePage: null, score: null, scoreEvidencePage: null },
  accounts: [baseAccount({
    fields: [
      extractedField('paymentHistory', '111111'),
      extractedField('portfolioType', 'I'),
      extractedField('accountStatus', '11'),
      extractedField('accountType', '01'),
    ],
  })],
}), 2);
const fieldWiseMerged = mergeBureauExtractions([sparseChunk, richerContinuation], 'equifax');
assert.equal(fieldWiseMerged.accounts[0].balance, 500, 'a sparse continuation cannot null-out an earlier displayed balance');
assert.equal(fieldWiseMerged.accounts[0].dateOpened, '2024-01-01', 'a sparse continuation cannot null-out an earlier displayed date');
assert.equal(fieldWiseMerged.accounts[0].paymentHistory, '111111');
const conflictingContinuation = rebaseExtractionPageRefs(report('equifax', {
  bureau: null,
  bureauEvidencePage: null,
  reportSectionStart: false,
  reportSectionStartEvidencePage: null,
  reportDate: null,
  reportDateRaw: null,
  reportDateEvidencePage: null,
  client: { name: null, nameEvidencePage: null, address: null, addressEvidencePage: null, score: null, scoreEvidencePage: null },
  accounts: [baseAccount({
    fields: [
      extractedField('accountStatus', '71'),
      extractedField('balance', '500', { numericValue: 500 }),
      extractedField('dateOpened', '2024-01-01'),
    ],
  })],
}), 2);
assert.throws(
  () => mergeBureauExtractions([sparseChunk, conflictingContinuation], 'equifax'),
  /conflicting accountStatus values/i,
  'overlap conflicts fail closed instead of citing evidence for a different selected value',
);

const combined = mergeCombinedExtractions([{ reports: three }]);
assert.equal(combined.length, 3);
assert.throws(() => mergeCombinedExtractions([
  { reports: [report('equifax')] },
  { reports: [{ ...report('equifax'), reportSectionStartEvidencePage: 2 }] },
]), /more than one bureau report section/i, 'duplicate combined-report roots cannot collapse into false exact coverage');
assert.throws(() => mergeCombinedExtractions([{ reports: [{
  ...report(null), bureau: null, bureauEvidencePage: null,
}]}]), /without a visible bureau identity/i);

// A standalone report remains useful but incomplete and therefore cannot
// satisfy the Operations/R1 complete-3B gate.
const singleAudit = buildDeterministicAudit([report('equifax')], {
  reportDate: REPORT_DATE, evaluatedAt: EVALUATED_AT,
});
assert.equal(singleAudit.reportCoverage.complete, false);
assert.deepEqual(singleAudit.reportCoverage.missing.sort(), ['EXP', 'TU']);
assert.equal(singleAudit.client.reportDate, REPORT_DATE);
assert.equal(singleAudit.inquiries[0].sourcePage, 2);

const cleanupAudit = buildDeterministicAudit([report('equifax', {
  personalInfo: {
    formerAddresses: ['99 Old Ave, Phoenix, AZ 85001'],
    formerAddressEvidence: [{ value: '99 Old Ave, Phoenix, AZ 85001', page: 2 }],
  },
})], { reportDate: REPORT_DATE, evaluatedAt: EVALUATED_AT });
const cleanupItems = buildCampaignItems({ audit: cleanupAudit });
assert.equal(cleanupItems.filter((item) => item.item_kind === 'personal_info').length, 1);
assert.deepEqual(cleanupItems.find((item) => item.item_kind === 'personal_info').snapshot.sourceEvidence, [{ bureau: 'EQ', page: 2 }]);
assert.equal(cleanupItems.filter((item) => item.item_kind === 'inquiry').length, 1);
assert.equal(cleanupItems.find((item) => item.item_kind === 'inquiry').snapshot.sourcePage, 2);

// Re-running identical source input at the same immutable job timestamp is
// bit-for-bit reproducible; no wall clock participates in the builder.
const auditA = buildDeterministicAudit(three, { reportDate: REPORT_DATE, evaluatedAt: EVALUATED_AT });
const auditB = buildDeterministicAudit(three, { reportDate: REPORT_DATE, evaluatedAt: EVALUATED_AT });
assert.deepEqual(auditA, auditB);

// Pending-current-edition doctrine is review-visible but never automatically
// authorized, even when all cited fields are page-backed.
const collector = report('equifax', { accounts: [baseAccount({
  reportedType: 'Debt purchaser collection agency',
  fields: [
    extractedField('accountStatus', '11'),
    extractedField('accountType', '01'),
    extractedField('portfolioType', 'R'),
    extractedField('balance', '500', { numericValue: 500 }),
    extractedField('dateOpened', '2024-01-01'),
  ],
})] });
const collectorAudit = buildDeterministicAudit([collector], { reportDate: REPORT_DATE, evaluatedAt: EVALUATED_AT });
const pending = collectorAudit.accounts[0].findings.find((entry) => entry.ruleId.startsWith('DEBT_PURCHASER_'));
assert.ok(pending);
assert.equal(pending.outcome, 'REVIEW_REQUIRED');
assert.equal(pending.adjudication.status, 'needs_client_fact');
assert.equal(isAuthorizedFinding(pending), false);

// Rule authorization binds only exact input fields. An unrelated balance page
// cannot page-back a scheduled-payment rule; adding the three exact field
// pages makes the current, non-pending rule eligible.
const unrelatedOnly = report('equifax', { accounts: [baseAccount({
  portfolioType: 'O', accountStatus: '11', scheduledMonthlyPayment: 50,
  fields: [extractedField('balance', '500', { numericValue: 500 })],
})] });
const weakRule = buildDeterministicAudit([unrelatedOnly], { reportDate: REPORT_DATE, evaluatedAt: EVALUATED_AT })
  .accounts[0].findings.find((entry) => entry.ruleId === 'SCHEDULED_PAYMENT_ON_OPEN_PORTFOLIO');
assert.equal(weakRule, undefined, 'unobserved load-bearing fields must not create even a review finding');

const exactRuleInput = report('equifax', { accounts: [baseAccount({
  fields: [
    extractedField('portfolioType', 'O'),
    extractedField('accountStatus', '11'),
    extractedField('scheduledMonthlyPayment', '50', { numericValue: 50 }),
    extractedField('balance', '500', { numericValue: 500 }),
    extractedField('dateOpened', '2024-01-01'),
  ],
})] });
const strongRule = buildDeterministicAudit([exactRuleInput], { reportDate: REPORT_DATE, evaluatedAt: EVALUATED_AT })
  .accounts[0].findings.find((entry) => entry.ruleId === 'SCHEDULED_PAYMENT_ON_OPEN_PORTFOLIO');
assert.equal(strongRule.outcome, 'FLAG');
assert.equal(strongRule.adjudication.status, 'authorized');
assert.ok(strongRule.evidenceRefs.every((entry) => entry.page === 2));
assert.equal(isAuthorizedFinding({ ...strongRule, adjudication: undefined }), false, 'missing adjudication is never authority');

const partiallyBackedInput = report('equifax', { accounts: [baseAccount({
  fields: [
    extractedField('portfolioType', 'O'),
    extractedField('accountStatus', '11', { page: null }),
    extractedField('scheduledMonthlyPayment', '50', { numericValue: 50 }),
  ],
})] });
assert.throws(() => assertExtractionPageBounds(partiallyBackedInput, 2), /accountStatus observation has no source page reference/i);
assert.throws(
  () => buildDeterministicAudit([partiallyBackedInput], { reportDate: REPORT_DATE, evaluatedAt: EVALUATED_AT }),
  /accountStatus observation has no source page reference/i,
  'the pure builder also fails closed before an unbacked multi-field rule can exist',
);

// Structural regressions for worker/DB invariants that cannot be exercised
// without storage/model calls in this pure suite.
const worker = readFileSync(new URL('../netlify/functions/audit-run-background.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(worker, /job\.created_at\s*\|\|\s*new Date/, 'audit evaluation never falls back to wall clock');
assert.match(worker, /__' \+ job\.id|__\$\{job\.id\}/, 'same-day audit ids bind the unique source execution');
assert.match(worker, /from\('audits'\)\.insert\(/, 'audit persistence inserts instead of overwriting');
assert.match(worker, /from\('audit_bureau_parses'\)\.insert\(row\)/, 'staged parses are versioned inserts');
assert.doesNotMatch(worker, /from\('audit_bureau_parses'\)[\s\S]{0,120}\.delete\(/, 'worker never replaces staging by deletion');
assert.match(worker, /row\.provenance\.sources/, 'merge revalidates exact staged source provenance');
assert.match(worker, /const rebased = rebaseExtractionPageRefs[\s\S]*assertExtractionPageBounds\(rebased, chunk\.totalPages\)/,
  'every bureau chunk is page-validated before merge/coercion');
assert.match(worker, /for \(const extractedReport of rebased\?\.reports \|\| \[\]\)[\s\S]*assertExtractionPageBounds\(extractedReport, chunk\.totalPages\)/,
  'every combined-report chunk is page-validated before merge/coercion');

const migration = readFileSync(new URL('../supabase/migrations/20260820520000_deterministic_audit_provenance.sql', import.meta.url), 'utf8');
const strictBody = migration.slice(
  migration.indexOf('create or replace function public.ccc_operations_deterministic_audit_valid'),
  migration.indexOf('create or replace function public.ccc_operations_lifecycle_audit_valid'),
);
assert.doesNotMatch(strictBody, /from public\.audits|ccc_account_tracks/, 'generic validity has no copied-JSON legacy exemption');
assert.match(migration, /audit_row\.id = p_audit_id[\s\S]*audit_row\.client_id = p_client_id[\s\S]*audit_row\.audit = p_audit/, 'legacy compatibility binds exact audit row, client, and JSON');
assert.match(migration, /prevent_versioned_bureau_parse_mutation/, 'provenance-bearing parse rows are database-immutable');
assert.match(migration, /lifecycle_audit_valid\(audit_row\.id, p_client_id, audit_row\.audit\)/, 'readiness uses row-bound compatibility only for lifecycle source');
assert.match(migration, /revoke insert, update on public\.audits from anon, authenticated/i, 'browser roles cannot forge or rewrite audit provenance');
assert.match(migration, /Fresh R1 initialization requires a source-bound deterministic 3B audit/i, 'fresh initializer fails provenance-less legacy audits');
assert.match(migration, /ccc_operations_fresh_r1_audit_valid\(v_audit\.audit\)/, 'fresh initializer enforces the 45-day R1 report gate');
assert.match(migration, /grandfathered provenance-less lifecycle cannot initialize new account\/bureau tracks/i, 'legacy replay cannot expand an existing lifecycle');
assert.match(migration, /Could not rank complete 3B audits in client summaries/, 'client summaries cannot let a newer single-bureau audit replace the latest operational 3B baseline');

const blueprintHandler = readFileSync(new URL('../netlify/functions/recovery-blueprint.mjs', import.meta.url), 'utf8');
const correctionGate = blueprintHandler.slice(
  blueprintHandler.indexOf("if (action === 'save_corrections')"),
  blueprintHandler.indexOf("if (action === 'preview')"),
);
assert.match(correctionGate, /ccc_operations_fresh_r1_audit_valid/, 'confirmed-review save calls the strict provenance and 45-day validator');
assert.match(correctionGate, /legacy, stale, or incomplete audit remains readable but cannot start R1/i, 'confirmed-review save fails closed for legacy, stale, or forged audits');

console.log('All deterministic ingestion/provenance hardening assertions passed.');
