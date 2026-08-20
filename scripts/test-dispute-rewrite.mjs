import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  MAX_SELECTED_TEXT_CHARS,
  canStaffAccessClient,
  hasKnownClientSensitiveData,
  hasProtectedLegalLanguage,
  hasProhibitedSensitiveData,
  normalizeDisputeRewriteRequest,
  redactSensitiveStoryNotes,
  replaceDisputeSelection,
} from '../src/utils/disputeRewriteRules.js';
import {
  decryptClientData,
  encryptClientData,
  matchesClientDataVersion,
  versionClientData,
} from '../netlify/functions/_clientDataCrypto.mjs';

const STORY_NOTES_VERSION = 'a'.repeat(64);

const VALID_REQUEST = {
  clientId: '11111111-1111-4111-8111-111111111111',
  sectionKey: 'damages',
  flow: 'combo',
  round: 1,
  bureau: 'TU',
  selectedText: 'The inaccurate reporting kept me from qualifying for housing.',
  storyNotesVersion: STORY_NOTES_VERSION,
};

const normalized = normalizeDisputeRewriteRequest(VALID_REQUEST);
assert.equal(normalized.flow, 'combo');
assert.equal(normalized.bureau, 'TU');
assert.throws(
  () => normalizeDisputeRewriteRequest({ ...VALID_REQUEST, sectionKey: 'penalty' }),
  /Only the damages section/,
  'the endpoint cannot rewrite a fixed-law-adjacent section',
);
assert.throws(
  () => normalizeDisputeRewriteRequest({ ...VALID_REQUEST, storyNotesVersion: '' }),
  /Approve the current saved story notes/,
  'a rewrite cannot use notes that were not version-bound at approval',
);
const whitespaceSelection = ' Original sentence. ';
assert.equal(
  replaceDisputeSelection(
    `Before.${whitespaceSelection}After.`,
    { start: 7, end: 7 + whitespaceSelection.length, selectedText: whitespaceSelection },
    '  Personalized sentence.  ',
  ),
  'Before. Personalized sentence. After.',
  'selected boundary whitespace is preserved without duplicating provider whitespace',
);
assert.throws(
  () => normalizeDisputeRewriteRequest({ ...VALID_REQUEST, selectedText: 'x'.repeat(MAX_SELECTED_TEXT_CHARS + 1) }),
  /characters or fewer/,
  'oversized selections fail closed',
);
assert.throws(
  () => normalizeDisputeRewriteRequest({ ...VALID_REQUEST, selectedText: 'My rights under 15 USC 1681e(b) were violated.' }),
  /protected legal language/,
  'statutory text cannot enter the rewrite path',
);

const original = 'Before. Losing the apartment caused real stress for my family. After.';
const selectedText = 'Losing the apartment caused real stress for my family.';
const start = original.indexOf(selectedText);
const replaced = replaceDisputeSelection(
  original,
  { start, end: start + selectedText.length, selectedText },
  'Being denied the apartment disrupted my family’s housing plans and caused stress I had not expected.',
);
assert.equal(replaced, 'Before. Being denied the apartment disrupted my family’s housing plans and caused stress I had not expected. After.');
assert.throws(
  () => replaceDisputeSelection(`${original} changed`, { start, end: start + 4, selectedText }, 'Replacement'),
  /no longer matches/,
  'a stale selection cannot overwrite newly edited text',
);
assert.throws(
  () => replaceDisputeSelection(original, { start, end: start + selectedText.length, selectedText }, 'This creates an FCRA violation.'),
  /Protected legal language/,
  'model output cannot introduce protected legal language',
);

assert.equal(canStaffAccessClient('admin', 'admin-1', 'auditor-1'), true);
assert.equal(canStaffAccessClient('auditor', 'auditor-1', 'auditor-1'), true);
assert.equal(canStaffAccessClient('auditor', 'auditor-2', 'auditor-1'), false);
assert.equal(canStaffAccessClient('client', 'client-1', 'client-1'), false);
assert.equal(hasProtectedLegalLanguage('This hurt my ability to find housing.'), false);
assert.equal(hasProtectedLegalLanguage('15 U.S.C. § 1681e(b)'), true);
assert.equal(hasProhibitedSensitiveData('SSN: 123-45-6789'), true);
assert.equal(hasProhibitedSensitiveData('Account number: 123456789'), true);
assert.equal(hasProhibitedSensitiveData('[REDACTED SSN]'), true);
assert.equal(hasProhibitedSensitiveData('123456789'), true);
assert.equal(hasProhibitedSensitiveData('DOB was 01/02/1990'), true);
assert.equal(hasProhibitedSensitiveData('The event happened July 5, 2026'), true);
assert.equal(hasProhibitedSensitiveData('Account ending ****1234'), true);
assert.equal(hasProhibitedSensitiveData('The client described a medical diagnosis.'), true);
assert.equal(hasProhibitedSensitiveData('Visa 4111 1111 1111 1111'), true);
assert.equal(hasProhibitedSensitiveData('Credential is hunter2'), true);
assert.equal(hasProhibitedSensitiveData('Password hunter2'), true);
assert.equal(hasProhibitedSensitiveData('SSN ending in 6789'), true);
assert.equal(hasProhibitedSensitiveData('Account ending in 1234'), true);
assert.equal(hasProhibitedSensitiveData('DOB Jan 2'), true);
assert.equal(hasProhibitedSensitiveData('Client had heart surgery'), true);
assert.equal(hasProhibitedSensitiveData('Mail goes to PO Box 123'), true);
assert.equal(hasProhibitedSensitiveData('The denial disrupted my housing search.'), false);

const knownClientData = {
  name: 'Ricardo Martinez',
  address: '123 Desert View Road',
  dateOfBirth: '01/02/1990',
  email: 'ricardo@example.com',
  phone: '(602) 555-0199',
  monitoringEmail: 'ricardo.monitor@example.com',
  ssnLast4: '6789',
  monitoringPassword: 'Hunter2!',
};
assert.equal(hasKnownClientSensitiveData('Ricardo was denied housing.', knownClientData), true);
assert.equal(hasKnownClientSensitiveData('Martinez was denied housing.', knownClientData), true);
assert.equal(hasKnownClientSensitiveData('My SSN ends in 6789.', knownClientData), true);
assert.equal(hasKnownClientSensitiveData('The login was hunter2!.', knownClientData), true);
assert.equal(hasKnownClientSensitiveData('My address is 123 Desert View Road.', knownClientData), true);
assert.equal(hasKnownClientSensitiveData('My DOB is 01/02/1990.', knownClientData), true);
assert.equal(hasKnownClientSensitiveData('Mail me at 123 Desert View Rd.', knownClientData), false, 'generic street DLP catches address variants separately');
assert.equal(hasKnownClientSensitiveData('The denial disrupted my housing search.', knownClientData), false);
assert.equal(hasKnownClientSensitiveData('Li was denied housing.', { name: 'Mei Li' }), true);
assert.equal(hasKnownClientSensitiveData('Amy was denied housing.', { name: 'Amy Wu' }), true);
assert.equal(hasKnownClientSensitiveData('Jose was denied housing.', { name: 'José Núñez' }), true);

const redacted = redactSensitiveStoryNotes('SSN: 123-45-6789; DOB: 01/02/1990; Password: secret-value');
assert.doesNotMatch(redacted, /123-45-6789|01\/02\/1990|secret-value/);

process.env.CLIENT_DATA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
const privateNotes = 'Client described a housing denial and two weeks in a hotel.';
const ciphertext = encryptClientData(privateNotes);
assert.notEqual(ciphertext, privateNotes);
assert.equal(decryptClientData(ciphertext), privateNotes);
const notesVersion = versionClientData(privateNotes);
assert.match(notesVersion, /^[a-f0-9]{64}$/);
assert.equal(matchesClientDataVersion(privateNotes, notesVersion), true);
assert.equal(matchesClientDataVersion(`${privateNotes} Changed.`, notesVersion), false);

console.log('Selected-damages rewrite safety tests passed.');
