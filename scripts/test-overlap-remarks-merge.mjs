#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mergeOverlappingAccountExtracts } from '../src/utils/deterministicAudit.js';

function account(remarks, page) {
  return {
    furnisher: 'Example Furnisher',
    accountNumber: '****1234',
    remarks,
    remarksEvidencePage: page,
    evidence: [],
    fields: [],
    explicitlyBlankFields: [],
    unreadableFields: [],
  };
}

const complete = account('Account information disputed by consumer', 11);
const overlap = account('consumer', 11);
const originals = structuredClone([complete, overlap]);
const merged = mergeOverlappingAccountExtracts(complete, overlap);
assert.equal(merged.remarks, complete.remarks,
  'same-page overlap keeps the complete token-sequence superset');
assert.equal(merged.remarksEvidencePage, 11);
assert.deepEqual([complete, overlap], originals, 'overlap reconciliation does not mutate source extracts');

assert.throws(
  () => mergeOverlappingAccountExtracts(
    account('Account information disputed by consumer', 11),
    account('Closed at consumer request', 11),
  ),
  /conflicting remarks values/i,
  'unrelated same-page remarks remain a hard conflict',
);
assert.throws(
  () => mergeOverlappingAccountExtracts(
    account('Account information disputed by consumer', 11),
    account('consumer', 12),
  ),
  /conflicting remarks values/i,
  'a substring on a different page cannot be treated as overlap truncation',
);
assert.throws(
  () => mergeOverlappingAccountExtracts(account('***', 11), account('---', 11)),
  /conflicting remarks values/i,
  'punctuation-only remarks cannot collapse into an empty-token match',
);
assert.throws(
  () => mergeOverlappingAccountExtracts(account('é', 11), account('ü', 11)),
  /conflicting remarks values/i,
  'distinct Unicode remarks remain a hard conflict',
);

console.log('Overlap remark reconciliation assertions passed.');
