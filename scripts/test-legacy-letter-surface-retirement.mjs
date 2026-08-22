import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { USPS_FIRST_CLASS } from '../src/utils/cccMailRules.js';
import { canMailLetter, generatedLetterValidationError } from '../src/utils/letterGeneration.js';
import { renderStructuredLetter } from '../src/utils/structuredLetter.js';
import {
  assertFollowUpEnclosureContract,
  buildFollowUpEnclosurePlan,
  validateFollowUpSourceRelationships,
} from '../src/utils/followUpEnclosures.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const current = {
  phase: 'CCC Dispute — Accuracy R1 — Equifax',
  html: '<!doctype html><html><body>Current CCC letter</body></html>',
};

assert.equal(canMailLetter(current), true, 'an unsigned current CCC letter can enter the mailer');
assert.equal(canMailLetter({ ...current, mail_service: USPS_FIRST_CLASS }), true);
assert.equal(canMailLetter({ ...current, mail_service: 'usps_first_class_certified_return_receipt' }), false,
  'a current letter with stale certified service metadata fails closed');
assert.equal(canMailLetter({ phase: 'Phase 1 — Direct', html: current.html }), false,
  'a legacy unmailed letter cannot enter any active mail action');
assert.equal(generatedLetterValidationError('<!doctype html><html><body><div class="enclosures">Files</div></body></html>', { requireSections: true }), null,
  'new correspondence requires neither signature markup nor a certified notation');
assert.equal(generatedLetterValidationError('<!doctype html><html><body>Reviewed CCC template text</body></html>', { requireSections: true }), null,
  'stored CCC template HTML does not need packet exhibits before Lob assembly');

assert.throws(() => renderStructuredLetter(), /renderer is retired.*template library/i);
for (const operation of [
  () => assertFollowUpEnclosureContract({ phase: 'Phase 3 — Experian (Follow-up)' }),
  () => validateFollowUpSourceRelationships({}),
  () => buildFollowUpEnclosurePlan({}),
]) assert.throws(operation, /read-only.*CCC Consent \/ Accuracy \/ Collection/i);

const lobMailer = read('src/components/LobMailer.jsx');
assert.match(lobMailer, /isCurrentCccLetter = isCccDisputePhase/);
assert.match(lobMailer, /MAIL SERVICE BLOCKED.*USPS First-Class Mail/);
assert.match(lobMailer, /Read-only historical record/);
assert.match(lobMailer, /Send First Class/);
assert.doesNotMatch(lobMailer, /fetchLpoaHtmlForPrint|lpoa_signature_data|buildFollowUpEnclosurePlan|listMailArtifacts/);
assert.doesNotMatch(lobMailer, /Send Certified Mail|certified letter with return receipt/);

for (const path of [
  'src/components/StartRoundPanel.jsx',
  'src/components/client-detail/ClientCampaignWorkspace.jsx',
]) {
  const source = read(path);
  assert.match(source, /read-only/i);
  assert.match(source, /R1/i);
  assert.doesNotMatch(source, /generateRoundLetter|generateInterimLetter|generateCampaignAccountRoute|regenerateUnmailedRoundLetters|retryFailedRoundLetters/);
  assert.doesNotMatch(source, /lpoa_signature_data|resolveSignatureViewUrl|TargetPicker/);
}

const promptRules = read('src/prompts/phase3CitationRules.js');
assert.match(promptRules, /RETIRED WORKFLOW — DO NOT DRAFT A LETTER/);
assert.doesNotMatch(promptRules, /certified-mail notation|Limited Power of Attorney/);

const clientsPage = read('src/components/ClientsPage.jsx');
assert.match(clientsPage, /Historical record · read only/);
assert.doesNotMatch(clientsPage, /BureauFollowUpPanel|setFollowUpBureauLetter|lpoa_signature_data|injectSignatureImage/);

const inboxPage = read('src/components/InboxPage.jsx');
assert.match(inboxPage, /\.like\('phase', 'CCC Dispute —%'\)/);
assert.match(inboxPage, /isCccDisputePhase\(letter\?\.phase\)/);

const responseWorker = read('netlify/functions/phase2-analyze-background.mjs');
assert.match(responseWorker, /LEGACY FOLLOW-UP GENERATION RETIRED/);
assert.match(responseWorker, /statusCode: 410/);
assert.doesNotMatch(responseWorker, /renderFollowUpLetter|BUREAU_FOLLOW_UP_SCHEMA|collectBureauFollowUpProblems/);

const mailRules = read('src/utils/cccMailRules.js');
assert.match(mailRules, /isCccDisputePhase\(letter\?\.phase\)[\s\S]*\? USPS_FIRST_CLASS[\s\S]*: null/);

console.log('Legacy letter generation, enclosure, signature, and mail surfaces are retired.');
