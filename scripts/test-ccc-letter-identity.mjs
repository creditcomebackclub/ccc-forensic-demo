import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
  buildCccLetterIdentitySnapshot,
  cccLetterIdentityAutomaticValues,
  cccLetterIdentityDocumentIssues,
  cccLetterIdentityIssues,
  formatCccLetterAddress,
} from '../src/utils/cccLetterIdentity.js';
import { buildAutomaticTemplateValues } from '../src/utils/disputeTemplateEngine.js';

const require = createRequire(import.meta.url);
const { cccCraSensitiveAutomaticValueIssues } = require('../netlify/functions/lob.cjs');

const snapshot = {
  revision: 2,
  userId: '11111111-1111-4111-8111-111111111111',
  clientId: '22222222-2222-4222-8222-222222222222',
  firstName: 'Mary Ann',
  lastName: 'Van Buren',
  addressLine1: '123 Main Street',
  addressLine2: 'Unit 4',
  city: 'Grand Junction',
  state: 'CO',
  zip: '81504',
  identityDocumentId: '33333333-3333-4333-8333-333333333333',
  identityDocumentSha256: 'a'.repeat(64),
  identityDocumentStoragePath: '111/222/identity/id-aaaaaaaaaaaaaaaa.pdf',
  addressDocumentId: '44444444-4444-4444-8444-444444444444',
  addressDocumentSha256: 'b'.repeat(64),
  addressDocumentStoragePath: '111/222/identity/address-bbbbbbbbbbbbbbbb.pdf',
  verifiedBy: '55555555-5555-4555-8555-555555555555',
  verifiedAt: '2026-08-20T12:00:00.000Z',
};

assert.deepEqual(cccLetterIdentityIssues(snapshot), []);
assert.deepEqual(buildCccLetterIdentitySnapshot(snapshot), snapshot);
assert.equal(formatCccLetterAddress(snapshot), '123 Main Street\nUnit 4\nGrand Junction, CO 81504');
assert.deepEqual(cccLetterIdentityAutomaticValues(snapshot), {
  firstName: 'Mary Ann',
  lastName: 'Van Buren',
  name: 'Mary Ann Van Buren',
  address: '123 Main Street\nUnit 4\nGrand Junction, CO 81504',
});

const exactValues = buildAutomaticTemplateValues({
  identity: { ...cccLetterIdentityAutomaticValues(snapshot), ssnLast4: '6789', dateOfBirth: '1980-01-02' },
  audit: { client: { name: 'Wrongly Split CRM Name', address: 'Wrong report address' } },
  strictIdentity: true,
});
assert.equal(exactValues.client_first_name, 'Mary Ann');
assert.equal(exactValues.client_last_name, 'Van Buren');
assert.equal(exactValues.client_address, '123 Main Street\nUnit 4\nGrand Junction, CO 81504');
const missingStrict = buildAutomaticTemplateValues({
  identity: {},
  audit: { client: { name: 'Must Not Split', address: 'Must Not Use' } },
  strictIdentity: true,
});
assert.equal(missingStrict.client_first_name, '');
assert.equal(missingStrict.client_last_name, '');
assert.equal(missingStrict.client_address, '');

const documents = [
  { id: snapshot.identityDocumentId, doc_type: 'id', sha256: snapshot.identityDocumentSha256, storage_path: snapshot.identityDocumentStoragePath, byte_size: 100 },
  { id: snapshot.addressDocumentId, doc_type: 'address', sha256: snapshot.addressDocumentSha256, storage_path: snapshot.addressDocumentStoragePath, byte_size: 200 },
];
assert.deepEqual(cccLetterIdentityDocumentIssues(snapshot, documents), []);
assert.match(cccLetterIdentityDocumentIssues(snapshot, [{ ...documents[0], sha256: 'c'.repeat(64) }, documents[1]]).join(' '), /government ID changed/i);
assert.match(cccLetterIdentityIssues({ ...snapshot, firstName: '' }).join(' '), /legal first name/i);
assert.match(cccLetterIdentityIssues({ ...snapshot, zip: '8150' }).join(' '), /ZIP/i);

const craLetter = {
  phase: 'CCC Dispute — Accuracy R1 — Equifax',
  target_type: 'bureau',
  dispute_automatic_values_snapshot: {
    bdate: 'January 2, 1980',
    ss_number: '***-**-6789',
  },
};
assert.deepEqual(
  await cccCraSensitiveAutomaticValueIssues(craLetter, {
    dateOfBirth: '1980-01-02',
    ssnLast4: '6789',
  }),
  [],
  'the exact current DOB and SSN last-four should match the frozen CRA curlys',
);
assert.match(
  (await cccCraSensitiveAutomaticValueIssues(craLetter, {
    dateOfBirth: '1980-01-03',
    ssnLast4: '6789',
  })).join(' '),
  /\{bdate\}.*no longer matches/i,
  'a stale frozen DOB must fail closed',
);
assert.match(
  (await cccCraSensitiveAutomaticValueIssues(craLetter, {
    dateOfBirth: '1980-01-02',
    ssnLast4: '6790',
  })).join(' '),
  /\{ss_number\}.*no longer matches/i,
  'a stale frozen SSN last-four must fail closed',
);
assert.match(
  (await cccCraSensitiveAutomaticValueIssues(craLetter, {
    dateOfBirth: '',
    ssnLast4: '6789',
  })).join(' '),
  /date of birth is missing or malformed/i,
  'a missing current DOB must fail closed',
);
assert.match(
  (await cccCraSensitiveAutomaticValueIssues(craLetter, {
    dateOfBirth: '1980-02-31',
    ssnLast4: '***-**-6789',
  })).join(' '),
  /date of birth is missing or malformed.*SSN last four is missing or malformed/i,
  'malformed current DOB and SSN data must fail closed',
);
assert.match(
  (await cccCraSensitiveAutomaticValueIssues({
    ...craLetter,
    dispute_automatic_values_snapshot: { bdate: 'January 2, 1980' },
  }, {
    dateOfBirth: '1980-01-02',
    ssnLast4: '6789',
  })).join(' '),
  /frozen \{ss_number\} value is missing/i,
  'a missing frozen SSN curly must fail closed',
);
assert.deepEqual(
  await cccCraSensitiveAutomaticValueIssues({
    ...craLetter,
    target_type: 'furnisher',
    dispute_flow_code: 'direct',
    dispute_automatic_values_snapshot: {},
  }, {}),
  [],
  'CCC direct templates must remain outside the CRA DOB/SSN gate',
);

const migration = readFileSync(new URL('../supabase/migrations/20260820285000_ccc_letter_identity_preflight.sql', import.meta.url), 'utf8');
const operationsMigration = readFileSync(new URL('../supabase/migrations/20260820290000_new_method_operations.sql', import.meta.url), 'utf8');
const studio = readFileSync(new URL('../src/components/DisputeCampaignStudio.jsx', import.meta.url), 'utf8');
const storage = readFileSync(new URL('../src/utils/storage.js', import.meta.url), 'utf8');
const lob = readFileSync(new URL('../netlify/functions/lob.cjs', import.meta.url), 'utf8');
const documentsSource = readFileSync(new URL('../src/utils/documents.js', import.meta.url), 'utf8');

assert.match(migration, /create table if not exists public\.ccc_client_letter_identities/);
assert.match(migration, /save_ccc_client_letter_identity/);
assert.match(migration, /p_staff_attested is not true/);
assert.match(migration, /identity_document_sha256/);
assert.match(migration, /prevent_mailed_ccc_letter_identity_rewrite/);
assert.match(operationsMigration, /ccc_letter_identity_snapshot_matches_current/);
assert.match(studio, /strictIdentity: true/);
assert.match(studio, /cccLetterIdentitySnapshot: currentLetterIdentitySnapshot/);
assert.match(storage, /ccc_letter_identity_snapshot: cccLetterIdentitySnapshot/);
assert.match(documentsSource, /identityDocPath\(userId, clientId, docType, detected\.ext, sha256\)/);
assert.match(documentsSource, /upsert: false/);
const identityGate = lob.indexOf('const cccIdentityIssues = await validateCccLetterIdentityPreflight');
const sensitiveCurlyGate = lob.indexOf('const cccSensitiveCurlyIssues = await validateCccCraSensitiveAutomaticValuesPreflight');
const lobSend = lob.indexOf("lobRequest('/v1/letters'");
assert.ok(identityGate > 0 && lobSend > identityGate, 'identity/document integrity must fail before the irreversible Lob call');
assert.ok(sensitiveCurlyGate > identityGate && lobSend > sensitiveCurlyGate,
  'current DOB and encrypted SSN curlys must be verified before the irreversible Lob call');
assert.match(lob, /actualSha256 !== expected\.sha256/);
assert.match(lob, /identity_document_sha256/);
assert.match(lob, /\/rest\/v1\/clients\?id=eq\.[\s\S]*select=id,user_id,date_of_birth/);
assert.match(lob, /\/rest\/v1\/client_sensitive_data\?client_id=eq\.[\s\S]*select=client_id,ssn_last4/);
assert.match(lob, /decryptClientData\(sensitiveRow\.ssn_last4\)/);
assert.match(lob, /buildAutomaticTemplateValues\(\{[\s\S]*identity: \{ dateOfBirth, ssnLast4 \}/);

console.log('CCC letter identity tests passed');
