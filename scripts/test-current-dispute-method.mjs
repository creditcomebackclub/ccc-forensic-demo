import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const absent = (source, pattern, message) => assert.doesNotMatch(source, pattern, message);

const app = read('src/App.jsx');
const auditResults = read('src/components/AuditResults.jsx');
const methodology = read('src/components/MethodologyPage.jsx');
const upload = read('src/components/UploadZone.jsx');
const api = read('src/utils/api.js');
const auditPrompt = read('src/prompts/masterPrompt.js');
const campaign = read('src/components/DisputeCampaignStudio.jsx');
const mailer = read('src/components/LobMailer.jsx');
const notifications = read('netlify/functions/send-lpoa.cjs');
const dailyCron = read('netlify/functions/daily-cron.cjs');
const lobServer = read('netlify/functions/lob.cjs');
const clientPortal = read('src/components/ClientPortal.jsx');
const clientsPage = read('src/components/ClientsPage.jsx');
const correctionsClient = read('src/utils/recoveryBlueprintApi.js');
const correctionsServer = read('netlify/functions/recovery-blueprint.mjs');

assert.match(methodology, /Consent, Accuracy, Collection, Combo, and Late Pay/);
assert.match(methodology, /Seven-week template review/);
absent(methodology, /every 90 days|Quarterly template review/i, 'the course wording cycle is seven weeks, not a calendar quarter');
assert.match(methodology, /Never backdate a letter/);
assert.match(methodology, /Do not automatically file CFPB complaints/);
absent(methodology, /Setup\s*&\s*Spike/i, 'methodology must not teach the retired method');

assert.match(auditResults, /R1 Start Instructions/);
assert.match(auditResults, /Exactly where this client starts/);
assert.match(auditResults, /Mailing stop/);
assert.match(auditResults, /Open R1 Campaign Builder/);
absent(auditResults, /onGenerateLetter|TypeBadge|Generate Phase 1|generateCombinedCleanupLetter/);

absent(app, /LetterViewer|activeLetter|handleGenerateLetter/);
absent(upload, /Setup\s*&(?:amp;)?\s*Spike/i);
absent(api, /generateLetter|generateCombinedCleanupLetter|generate-letter-background|LETTER_HTML/);

assert.match(auditPrompt, /only job in this workflow is to read consumer credit reports carefully/);
assert.match(auditPrompt, /do not choose a dispute flow/i);
absent(auditPrompt, /LETTER_HTML|Setup\s*&\s*Spike|Phase 1|Metro 2/i);

assert.match(campaign, /CCC Dispute —/);
assert.match(campaign, /Consumer Statement \(required\)/);
assert.match(campaign, /Brief, editable summary of this letter’s confirmed damages, facts, and requested outcome/);
assert.match(campaign, /buildStateDrivenCraWorkItems/);
assert.match(campaign, /Flow and round cannot be changed in this composer/);
assert.match(campaign, /cccAccountTrackSnapshots:\s*currentTrackSnapshots/);
assert.match(campaign, /disputeAutomaticValuesSnapshot:\s*automaticValuesSnapshot/);
assert.match(campaign, /targetType:\s*templateAudience === 'cra' \? 'bureau'/);
assert.match(campaign, /token !== 'optional_strengthener'/);
absent(campaign, /CAMPAIGN_FLOW_CODES|Choose round|Choose flow/);
absent(campaign, /Personal statement \(required\)|personalStatementContractMissing/);
absent(campaign, /`Phase 1 —/);
assert.match(mailer, /ccc_dispute_mailed/);
assert.match(mailer, /requiresCccR1IdentityDocuments/);
assert.match(mailer, /Send First Class/);
assert.match(mailer, /validateDisputeScreenshotManifest/);
assert.match(mailer, /renderCccImageExhibit/);
assert.match(lobServer, /LEGACY MAILING RETIRED/);
assert.match(lobServer, /const mailService = CURRENT_CCC_MAIL_SERVICE/);
absent(lobServer, /extra_service:\s*'certified_return_receipt'/, 'new server mail must be CCC First-Class only');
assert.match(lobServer, /CCC PACKET EXHIBITS INVALID/);
assert.match(lobServer, /dispute_screenshot_manifest/);
assert.match(clientPortal, /USPS First Class/);
absent(clientsPage, /Copy Signature Link|\/sign-lpoa\.html/, 'new clients must use the service-agreement wizard, never the retired public LPOA signer');
assert.match(notifications, /ccc_dispute_mailed:/);
assert.match(notifications, /USPS First-Class Mail/);
assert.match(notifications, /recorded the send date/i);
assert.match(notifications, /document the outcome before selecting a next step/i);
assert.match(dailyCron, /usesHistoricalCampaignDrips = !isStructuredRound && !isCccDispute/);
absent(dailyCron, /updateType:\s*['"]ccc_day(?:7_checkin|30_review)['"]/, 'current CCC mailings must not trigger fixed-day client drips');
assert.match(notifications, /will not (?:assume|infer) a result/i);
for (const field of ['accountKind', 'latePaymentCount', 'latePaymentBand']) {
  assert.match(correctionsClient, new RegExp(field), `client correction payload must include ${field}`);
  assert.match(correctionsServer, new RegExp(field), `server correction handler must persist ${field}`);
}

for (const retiredPath of [
  'src/components/LetterViewer.jsx',
  'src/prompts/letterPrompt.js',
  'netlify/functions/generate-letter-background.mjs',
]) {
  assert.equal(fs.existsSync(new URL(`../${retiredPath}`, import.meta.url)), false, `${retiredPath} must be retired`);
}

console.log('Current CCC dispute-method boundary tests passed.');
