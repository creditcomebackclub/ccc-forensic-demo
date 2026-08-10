#!/usr/bin/env node
import {
  assertFollowUpEnclosureContract,
  buildFollowUpEnclosurePlan,
  extractHtmlBody,
  extractHtmlStyles,
  isPhase3FollowUpLetter,
  validateFollowUpSourceRelationships,
} from '../src/utils/followUpEnclosures.js';
import {
  hasInjectedSignature,
  injectSignatureImage,
} from '../src/utils/signatureInjection.js';

let failed = 0;
function assert(condition, message) {
  if (!condition) {
    failed += 1;
    console.error('FAIL:', message);
  } else {
    console.log('ok:', message);
  }
}

function throwsMessage(fn, substring, message) {
  try {
    fn();
    assert(false, message);
  } catch (error) {
    assert(String(error.message).includes(substring), message);
  }
}

const followUp = {
  id: 'follow-up-1',
  userId: 'firm-1',
  clientId: 'client-1',
  phase: 'Phase 3 — TransUnion (Follow-up)',
  coveredFurnishers: ['Acme Bank'],
  sourcePhase3LetterId: 'phase3-1',
  sourceBureauResponseEvidenceId: '11111111-1111-4111-8111-111111111111',
};
const priorLetter = {
  id: 'phase3-1',
  user_id: 'firm-1',
  client_id: 'client-1',
  phase: 'Phase 3 — TransUnion',
  covered_furnishers: ['Acme Bank'],
  html: '<!doctype html><html><head><style>.section{color:navy}</style></head><body><p>Prior letter</p></body></html>',
};
const evidence = {
  id: '11111111-1111-4111-8111-111111111111',
  firm_user_id: 'firm-1',
  client_id: 'client-1',
  letter_id: 'phase3-1',
  response_kind: 'bureau',
  storage_bucket: 'responses',
  storage_paths: [
    'firm-1/response-evidence/11111111-1111-4111-8111-111111111111/response_01_results.pdf',
  ],
  file_names: ['results.pdf'],
  upload_status: 'received',
};

assert(!isPhase3FollowUpLetter({ phase: 'Phase 3 — TransUnion' }), 'initial Phase 3 is not a follow-up');
assert(isPhase3FollowUpLetter(followUp), 'follow-up phase is detected');
assert(isPhase3FollowUpLetter({ phase: 'Phase 3 — TransUnion', source_phase3_letter_id: 'p3' }), 'source metadata also detects follow-up');

throwsMessage(
  () => assertFollowUpEnclosureContract({ ...followUp, sourcePhase3LetterId: null }),
  'SOURCE MISSING',
  'missing source IDs fail closed'
);
throwsMessage(
  () => assertFollowUpEnclosureContract({ ...followUp, sourcePhase3LetterId: followUp.id }),
  'cannot enclose itself',
  'self-referential source fails closed'
);

const valid = validateFollowUpSourceRelationships({ followUp, priorLetter, evidence });
assert(valid.paths.length === 1 && valid.names[0] === 'results.pdf', 'valid exact source relationships pass');

throwsMessage(
  () => validateFollowUpSourceRelationships({
    followUp,
    priorLetter,
    evidence: { ...evidence, letter_id: 'another-letter' },
  }),
  'EXHIBIT B INVALID',
  'response linked to another letter fails closed'
);
throwsMessage(
  () => validateFollowUpSourceRelationships({
    followUp,
    priorLetter: { ...priorLetter, client_id: 'another-client' },
    evidence,
  }),
  'CLIENT MISMATCH',
  'cross-client prior letter fails closed'
);
throwsMessage(
  () => validateFollowUpSourceRelationships({
    followUp,
    priorLetter: { ...priorLetter, covered_furnishers: ['Another Furnisher'] },
    evidence,
  }),
  'COVERAGE MISMATCH',
  'different furnisher coverage fails closed'
);
throwsMessage(
  () => validateFollowUpSourceRelationships({
    followUp,
    priorLetter,
    evidence: { ...evidence, storage_paths: ['firm-1/unrelated/results.pdf'] },
  }),
  'FILES INVALID',
  'response path outside exact evidence archive fails closed'
);

const plan = buildFollowUpEnclosurePlan(followUp);
assert(
  plan.map((item) => item.kind).join(',') === 'prior_phase3,bureau_response,lpoa',
  'plan contains only prior Phase 3, bureau response, and LPOA in order'
);
assert(
  !plan.some((item) => /phase1|furnisher|identity|address/i.test(item.kind)),
  'plan excludes Phase 1, furnisher responses, and identity documents'
);
assert(extractHtmlBody(priorLetter.html) === '<p>Prior letter</p>', 'prior letter body is extracted without old packet enclosures');
assert(extractHtmlStyles(priorLetter.html).includes('.section{color:navy}'), 'prior letter print styles are preserved');

const signatureUrl = 'https://example.com/signature.png?token=a&b=2';
const placeholderLetter = '<p>___________________________</p><p>Thomas Andrew Kilpatrick</p>';
const injectedPlaceholder = injectSignatureImage(placeholderLetter, signatureUrl, 'Thomas Andrew Kilpatrick');
assert(hasInjectedSignature(injectedPlaceholder, signatureUrl), 'signature replaces underscore placeholder');
assert(injectedPlaceholder.includes('Thomas Andrew Kilpatrick'), 'placeholder injection preserves printed name');
assert(
  injectSignatureImage(injectedPlaceholder, signatureUrl, 'Thomas Andrew Kilpatrick') === injectedPlaceholder,
  'signature injection is idempotent'
);

const structuredLetter = '<div class="signature-block"><p>ROBERT KERSTNER</p></div>';
const injectedStructured = injectSignatureImage(structuredLetter, signatureUrl, 'Robert Kerstner');
assert(
  injectedStructured.indexOf('data-ccc-signature') < injectedStructured.indexOf('ROBERT KERSTNER'),
  'structured signature block injection does not depend on printed-name capitalization'
);

const legacyLetter = '<p>Thomas Andrew Kilpatrick</p><p>Address</p><p>Sincerely,</p><p>Thomas Andrew Kilpatrick</p>';
const injectedLegacy = injectSignatureImage(legacyLetter, signatureUrl, 'Thomas Andrew Kilpatrick');
assert(
  injectedLegacy.indexOf('data-ccc-signature') > injectedLegacy.indexOf('Sincerely'),
  'legacy letter inserts signature at final printed name, not address block'
);
assert(
  injectedLegacy.indexOf('Thomas Andrew Kilpatrick') < injectedLegacy.indexOf('data-ccc-signature'),
  'legacy address name remains before injected signature'
);

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll bureau follow-up enclosure tests passed.');
