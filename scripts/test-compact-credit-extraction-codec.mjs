#!/usr/bin/env node
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import {
  COMPACT_COMBINED_CREDIT_EXTRACTION_SCHEMA,
  COMPACT_CREDIT_BUREAU_EXTRACTION_SCHEMA,
  COMPACT_EXTRACTED_FIELD_TUPLE_SCHEMA,
  COMPACT_FIELD_STATE_CODES,
  decodeCompactBureauExtraction,
  decodeCompactCombinedExtraction,
  encodeCompactBureauExtraction,
  encodeCompactCombinedExtraction,
} from '../src/utils/compactCreditExtractionCodec.js';
import {
  CREDIT_ACCOUNT_FIELD_NAMES,
  CREDIT_BUREAU_EXTRACTION_SCHEMA,
} from '../src/utils/creditExtractionSchemas.js';
import { zeroCreditBureauExtractions } from './fixtures/ccc-zero-credit-3b.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));
const extractionAccountKeys = Object.keys(
  CREDIT_BUREAU_EXTRACTION_SCHEMA.properties.accounts.items.properties,
);
const schemaOnlyReport = (source) => ({
  ...clone(source),
  accounts: source.accounts.map((account) => Object.fromEntries(
    extractionAccountKeys.map((key) => [key, clone(account[key])]),
  )),
});
const reports = zeroCreditBureauExtractions().map(schemaOnlyReport);
const report = clone(reports[0]);

// Exercise all four states plus nullable/raw/numeric/page/label preservation.
const firstFields = new Map(report.accounts[0].fields.map((field) => [field.name, field]));
Object.assign(firstFields.get('specialComment'), {
  rawValue: null,
  numericValue: null,
  state: 'EXPLICITLY_BLANK',
  page: 7,
  label: 'Special Comment',
});
Object.assign(firstFields.get('complianceConditionCode'), {
  rawValue: null,
  numericValue: null,
  state: 'UNREADABLE',
  page: 8,
  label: 'Compliance Condition Code',
});
Object.assign(firstFields.get('balance'), {
  rawValue: '$684.25',
  numericValue: 684.25,
  state: 'PRESENT',
  page: 9,
  label: 'Current Balance',
});
Object.assign(firstFields.get('termsDuration'), {
  rawValue: null,
  numericValue: null,
  state: 'NOT_SHOWN',
  page: null,
  label: null,
});

assert.equal(CREDIT_ACCOUNT_FIELD_NAMES.length, 21);
assert.deepEqual(COMPACT_FIELD_STATE_CODES, {
  PRESENT: 'P', EXPLICITLY_BLANK: 'B', NOT_SHOWN: 'N', UNREADABLE: 'U',
});
assert.equal(COMPACT_EXTRACTED_FIELD_TUPLE_SCHEMA.minItems, 6);
assert.equal(COMPACT_EXTRACTED_FIELD_TUPLE_SCHEMA.maxItems, 6);
assert.equal(
  COMPACT_CREDIT_BUREAU_EXTRACTION_SCHEMA.properties.accounts.items.properties.fields.minItems,
  21,
);
assert.equal(
  COMPACT_CREDIT_BUREAU_EXTRACTION_SCHEMA.properties.accounts.items.properties.fields.maxItems,
  21,
);
for (const [index, name] of CREDIT_ACCOUNT_FIELD_NAMES.entries()) {
  assert.match(
    COMPACT_CREDIT_BUREAU_EXTRACTION_SCHEMA.properties.accounts.items.properties.fields.description,
    new RegExp(`${index}=${name}`),
  );
}
assert.equal(
  COMPACT_CREDIT_BUREAU_EXTRACTION_SCHEMA.properties.accounts.items.properties.fields.items,
  COMPACT_EXTRACTED_FIELD_TUPLE_SCHEMA,
  'the provider grammar must reuse one bounded tuple schema; exact position is verified locally after decode',
);

// The exported contracts must independently compile under the same strict
// local Ajv posture used by the production structured-output boundary.
const ajv = new Ajv({ allErrors: true, strict: true, validateFormats: false });
const validateBureau = ajv.compile(COMPACT_CREDIT_BUREAU_EXTRACTION_SCHEMA);
const validateCombined = ajv.compile(COMPACT_COMBINED_CREDIT_EXTRACTION_SCHEMA);

const before = JSON.stringify(report);
const compact = encodeCompactBureauExtraction(report);
assert.equal(JSON.stringify(report), before, 'encoding must not mutate the verbose extraction');
assert.equal(validateBureau(compact), true, JSON.stringify(validateBureau.errors));
assert.deepEqual(
  [...new Set(compact.accounts[0].fields.map((tuple) => tuple[1]))].sort(),
  ['B', 'N', 'P', 'U'],
);
assert.deepEqual(
  compact.accounts[0].fields.map((tuple) => tuple[0]),
  CREDIT_ACCOUNT_FIELD_NAMES.map((_, index) => index),
  'every compact tuple must carry its immutable field position',
);
assert.deepEqual(decodeCompactBureauExtraction(compact), report);
assert.equal(
  JSON.stringify(encodeCompactBureauExtraction(report)),
  JSON.stringify(compact),
  'encoding must be deterministic',
);
const shuffledVerbose = clone(report);
shuffledVerbose.accounts.forEach((account) => account.fields.reverse());
assert.equal(
  JSON.stringify(encodeCompactBureauExtraction(shuffledVerbose)),
  JSON.stringify(compact),
  'fixed tuple positions must be canonical regardless of verbose field order',
);

const verboseFieldBytes = Buffer.byteLength(JSON.stringify(report.accounts.map((account) => account.fields)));
const compactFieldBytes = Buffer.byteLength(JSON.stringify(compact.accounts.map((account) => account.fields)));
const verboseReportBytes = Buffer.byteLength(JSON.stringify(report));
const compactReportBytes = Buffer.byteLength(JSON.stringify(compact));
assert.ok(
  compactFieldBytes <= verboseFieldBytes * 0.45,
  `field payload must shrink by at least 55% (${verboseFieldBytes} -> ${compactFieldBytes})`,
);
assert.ok(
  compactReportBytes <= verboseReportBytes * 0.68,
  `whole extraction must shrink by at least 32% (${verboseReportBytes} -> ${compactReportBytes})`,
);

const combined = { reports: reports.map(clone) };
const compactCombined = encodeCompactCombinedExtraction(combined);
assert.equal(validateCombined(compactCombined), true, JSON.stringify(validateCombined.errors));
assert.deepEqual(decodeCompactCombinedExtraction(compactCombined), combined);

const duplicateVerbose = clone(report);
duplicateVerbose.accounts[0].fields[20] = clone(duplicateVerbose.accounts[0].fields[0]);
assert.throws(
  () => encodeCompactBureauExtraction(duplicateVerbose),
  /duplicate extracted field portfolioType/i,
);

const missingVerbose = clone(report);
missingVerbose.accounts[0].fields.pop();
assert.throws(
  () => encodeCompactBureauExtraction(missingVerbose),
  /must contain exactly one of all 21 extracted fields/i,
);

const missingCompact = clone(compact);
missingCompact.accounts[0].fields.pop();
assert.throws(
  () => decodeCompactBureauExtraction(missingCompact),
  /compact bureau extraction failed strict local validation/i,
);

const extraCompact = clone(compact);
extraCompact.accounts[0].fields.push(clone(extraCompact.accounts[0].fields[0]));
assert.throws(
  () => decodeCompactBureauExtraction(extraCompact),
  /compact bureau extraction failed strict local validation/i,
);

const malformedTuple = clone(compact);
malformedTuple.accounts[0].fields[0][1] = 'X';
assert.throws(
  () => decodeCompactBureauExtraction(malformedTuple),
  /compact bureau extraction failed strict local validation/i,
);

const shortTuple = clone(compact);
shortTuple.accounts[0].fields[0].pop();
assert.throws(
  () => decodeCompactBureauExtraction(shortTuple),
  /compact bureau extraction failed strict local validation/i,
);

const invalidEvidencePage = clone(compact);
invalidEvidencePage.accounts[0].fields[0][4] = 0;
assert.throws(
  () => decodeCompactBureauExtraction(invalidEvidencePage),
  /compact bureau extraction failed strict local validation/i,
);

const reorderedCompact = clone(compact);
[reorderedCompact.accounts[0].fields[0], reorderedCompact.accounts[0].fields[1]] = [
  reorderedCompact.accounts[0].fields[1], reorderedCompact.accounts[0].fields[0],
];
assert.throws(
  () => decodeCompactBureauExtraction(reorderedCompact),
  /compact bureau extraction failed strict local validation|does not match position/i,
  'tuple reordering must never silently relabel credit fields',
);

console.log(
  `Compact credit extraction codec passed: fields ${verboseFieldBytes} -> ${compactFieldBytes} bytes; report ${verboseReportBytes} -> ${compactReportBytes} bytes.`,
);
