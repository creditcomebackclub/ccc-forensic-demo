import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
  assembleBoundCccMailpiece,
  canonicalizeCccLetterHtml,
  cccExhibitImageUrl,
  cccLetterBindingInput,
  inspectBoundCccMailpiece,
  parseCccExhibitSections,
  renderCccImageExhibit,
} from '../src/utils/cccMailpieceIntegrity.js';

const require = createRequire(import.meta.url);
const {
  CCC_RETURN_ADDRESS,
  requiredCccAutomaticIdentityIssues,
  signedStorageObjectIdentity,
} = require('../netlify/functions/lob.cjs');

const LETTER_A = '11111111-1111-4111-8111-111111111111';
const LETTER_B = '22222222-2222-4222-8222-222222222222';
const SAVED_CCC_TEXT_ID = 'ricardo-martinez__77777777-7777-4777-8777-777777777777__experian__ccc-accuracy-r1-exp__2026-08-21';
const SCREENSHOT_ID = 'screen-1';
const ID_DOCUMENT = '33333333-3333-4333-8333-333333333333';
const sourceUrl = 'https://project.supabase.co/storage/v1/object/sign/documents/staff/client/dispute-screenshots/batch/screen.png?token=signed';

const storedA = '<!DOCTYPE html><html><head><style>.letter{color:#111}</style></head><body><main class="letter">Reviewed A</main></body></html>';
const storedB = '<!DOCTYPE html><html><head><style>.letter{color:#111}</style></head><body><main class="letter">Reviewed B</main></body></html>';
const canonicalA = canonicalizeCccLetterHtml(storedA);
const shaA = createHash('sha256').update(cccLetterBindingInput(LETTER_A, canonicalA)).digest('hex');
const screenshot = renderCccImageExhibit({
  kind: 'screenshot',
  id: SCREENSHOT_ID,
  heading: 'Credit Report Exhibit — Example Bank — ****1234',
  imageUrl: sourceUrl,
  screenshot: true,
});
const packetA = assembleBoundCccMailpiece({
  letterId: LETTER_A,
  letterHtml: storedA,
  letterSha256: shaA,
  enclosureHtml: screenshot,
});

const exact = inspectBoundCccMailpiece({
  letterId: LETTER_A,
  storedLetterHtml: storedA,
  expectedSha256: shaA,
  uploadedHtml: packetA,
});
assert.deepEqual(exact.issues, [], 'the exact reviewed letter reconstructs byte-for-byte from the uploaded packet');
assert.equal(exact.reconstructedLetterHtml, canonicalA);
assert.equal(exact.enclosureHtml, screenshot);

const savedTextIdSha = createHash('sha256')
  .update(cccLetterBindingInput(SAVED_CCC_TEXT_ID, canonicalA))
  .digest('hex');
const savedTextIdPacket = assembleBoundCccMailpiece({
  letterId: SAVED_CCC_TEXT_ID,
  letterHtml: storedA,
  letterSha256: savedTextIdSha,
  enclosureHtml: screenshot,
});
assert.deepEqual(inspectBoundCccMailpiece({
  letterId: SAVED_CCC_TEXT_ID,
  storedLetterHtml: storedA,
  expectedSha256: savedTextIdSha,
  uploadedHtml: savedTextIdPacket,
}).issues, [], 'Campaign Studio saved text IDs bind the same exact client-attributed packet on client and server');
assert.match(savedTextIdPacket, new RegExp(`CCC-MAILPIECE:V1:LETTER:${SAVED_CCC_TEXT_ID}:SHA256:`));
assert.throws(
  () => cccLetterBindingInput('ricardo-martinez__experian__ccc-accuracy-r1-exp__2026-08-21', canonicalA),
  /canonical CCC letter id/i,
  'text IDs without the saved client UUID cannot weaken packet attribution',
);
assert.throws(
  () => cccLetterBindingInput(`${SAVED_CCC_TEXT_ID}:ENCLOSURES:END--><script>`, canonicalA),
  /canonical CCC letter id/i,
  'text IDs cannot inject packet-boundary markup',
);

const packetAValidatedAsB = inspectBoundCccMailpiece({
  letterId: LETTER_B,
  storedLetterHtml: storedB,
  expectedSha256: createHash('sha256')
    .update(cccLetterBindingInput(LETTER_B, canonicalizeCccLetterHtml(storedB)))
    .digest('hex'),
  uploadedHtml: packetA,
});
assert.match(packetAValidatedAsB.issues.join(' '), /boundary markers.*missing|do not match/i, 'validating letter B can never print uploaded letter A');

const alteredBody = packetA.replace('Reviewed A', 'Different letter');
assert.match(inspectBoundCccMailpiece({
  letterId: LETTER_A,
  storedLetterHtml: storedA,
  expectedSha256: shaA,
  uploadedHtml: alteredBody,
}).issues.join(' '), /byte-for-byte/i, 'changing visible letter content fails the server reconstruction');

const alteredHead = packetA.replace('color:#111', 'display:none');
assert.match(inspectBoundCccMailpiece({
  letterId: LETTER_A,
  storedLetterHtml: storedA,
  expectedSha256: shaA,
  uploadedHtml: alteredHead,
}).issues.join(' '), /byte-for-byte/i, 'changing letter CSS also fails the exact binding');

const duplicatedBoundary = packetA.replace('</body>', packetA.match(/<!--CCC-MAILPIECE:V1:[\s\S]*?:ENCLOSURES:START-->/)[0] + '</body>');
assert.match(inspectBoundCccMailpiece({
  letterId: LETTER_A,
  storedLetterHtml: storedA,
  expectedSha256: shaA,
  uploadedHtml: duplicatedBoundary,
}).issues.join(' '), /missing, duplicated/i, 'duplicate packet boundaries fail closed');

const parsed = parseCccExhibitSections(exact.enclosureHtml);
assert.deepEqual(parsed.issues, []);
assert.deepEqual(parsed.sections.map(({ kind, id }) => ({ kind, id })), [{ kind: 'screenshot', id: SCREENSHOT_ID }]);
assert.equal(cccExhibitImageUrl(parsed.sections[0].html), sourceUrl);
assert.match(parseCccExhibitSections(screenshot + screenshot).issues.join(' '), /duplicated/i, 'duplicate exhibits are visible instead of hidden in a Set');
assert.match(parseCccExhibitSections(`<p>unbound</p>${screenshot}`).issues.join(' '), /outside a bound exhibit/i);

const identity = renderCccImageExhibit({
  kind: 'identity-id',
  id: ID_DOCUMENT,
  heading: 'Enclosure — Government-Issued Photo ID',
  imageUrl: sourceUrl,
});
assert.deepEqual(parseCccExhibitSections(identity).sections.map(({ kind, id }) => ({ kind, id })), [
  { kind: 'identity-id', id: ID_DOCUMENT },
]);
assert.throws(() => cccExhibitImageUrl('<img src="https://one"><img src="https://two">'), /exactly one/i);

assert.deepEqual(signedStorageObjectIdentity(sourceUrl, 'https://project.supabase.co'), {
  bucket: 'documents',
  path: 'staff/client/dispute-screenshots/batch/screen.png',
});
assert.throws(
  () => signedStorageObjectIdentity('https://attacker.example/file.png', 'https://project.supabase.co'),
  /outside this project/i,
);

const expectedIdentity = {
  client_first_name: 'Jordan',
  client_last_name: 'Richardson',
  client_name: 'Jordan Richardson',
  client_address: '1 Main St\nGrand Junction, CO 81504',
};
assert.deepEqual(requiredCccAutomaticIdentityIssues({}, expectedIdentity, expectedIdentity), []);
assert.match(
  requiredCccAutomaticIdentityIssues({}, { client_first_name: 'Jordan' }, expectedIdentity).join(' '),
  /client_last_name.*missing.*client_address.*missing/i,
  'first name, last name, and address are always mandatory automatic values',
);
assert.match(
  requiredCccAutomaticIdentityIssues({ dispute_template_snapshot: 'Hello {client_name}' }, {
    client_first_name: 'Jordan',
    client_last_name: 'Richardson',
    client_address: expectedIdentity.client_address,
  }, expectedIdentity).join(' '),
  /client_name.*missing/i,
  'client_name becomes mandatory only when the frozen template uses it',
);

assert.deepEqual(CCC_RETURN_ADDRESS, {
  name: 'Credit Comeback Club',
  line1: '3088 Colorado Ave',
  line2: '',
  city: 'Grand Junction',
  state: 'CO',
  zip: '81504',
});

const lobSource = readFileSync(new URL('../netlify/functions/lob.cjs', import.meta.url), 'utf8');
const mailerSource = readFileSync(new URL('../src/components/LobMailer.jsx', import.meta.url), 'utf8');
const renderedGate = lobSource.indexOf('const renderedPacketIssues = await validateCccRenderedMailpiece');
const lobSend = lobSource.indexOf("lobRequest('/v1/letters'");
assert.ok(renderedGate > 0 && lobSend > renderedGate, 'exact packet and source bytes fail closed before /v1/letters');
assert.match(lobSource, /file: scannedMailpiece\.html/, 'Lob receives the exact CCC HTML already re-read by the server');
assert.match(lobSource, /sourceSha256 !== spec\.sha256/);
assert.match(lobSource, /signedSha256 !== sourceSha256/);
assert.match(lobSource, /signedObject\.path !== spec\.path/);
assert.match(lobSource, /normalizedAddressKey\(fromAddress\) !== normalizedAddressKey\(CCC_RETURN_ADDRESS\)/);
assert.match(mailerSource, /must be JPG, PNG, or WebP before this CCC packet can be mailed/);
assert.match(mailerSource, /signedSourceMailImage\(verifiedImage\.storagePath, DISPUTE_SCREENSHOT_BUCKET\)/);
assert.match(mailerSource, /\[idDoc, 'identity-id'/);
assert.match(mailerSource, /\[addressDoc, 'identity-address'/);
assert.match(mailerSource, /kind: 'optional'/);

console.log('CCC exact mailpiece, exhibit-byte, automatic-identity, and return-address integrity passed.');
