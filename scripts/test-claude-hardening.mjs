import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generatedLetterValidationError, unauthorizedFieldCitations } from '../src/utils/letterGeneration.js';
import { buildPriorRoundEvidenceDigest, priorLetterPlainText } from '../src/utils/roundEvidence.js';
import { LETTER_CONTENT_SCHEMA, renderStructuredLetter } from '../src/utils/structuredLetter.js';

const content = {
  subject: 'Direct Furnisher Dispute | Account No. XXXX1234',
  summary: 'The account contains conflicting reported values. We are asking the furnisher to investigate and correct the supported inaccuracies.',
  opening: ['This is a direct dispute based on the documented reporting conflicts below.'],
  sections: [{
    heading: 'Supported reporting conflicts',
    paragraphs: ['The record reports a paid status while still reporting an amount past due.'],
    bullets: ['Metro 2 Field 22 — Amount Past Due must be investigated and corrected if inaccurate.'],
  }],
  demands: ['Conduct a reasonable investigation and correct each unsupported value.'],
  closing: 'Please complete the investigation and provide written results within the applicable period.',
};

const html = renderStructuredLetter({
  content,
  client: { name: 'Alex Example', address: '100 Main Street\nDenver, CO 80202', date_of_birth: '01/01/1990' },
  account: {
    furnisher: 'Example Bank',
    furnisherAddress: { name: 'Example Bank', line1: '200 Bank Way', city: 'Dallas', state: 'TX', zip: '75001' },
    accountNumberMasked: 'XXXX1234',
  },
  letter: { client_name: 'Alex Example', furnisher: 'Example Bank', account_id: 'XXXX1234', target_type: 'furnisher', round_number: 2 },
  enclosures: ['Exhibit A: Prior Dispute Letter', 'Exhibit B: Reviewed Response Evidence', 'Exhibit C: Limited Power of Attorney'],
});

assert.equal(generatedLetterValidationError(html, { requireSections: true }), null);
assert.deepEqual(unauthorizedFieldCitations('Field 25 is disputed. Field 21 is also disputed.', {
  findings: [{ outcome: 'FLAG', field: 'Field 25 (Date of First Delinquency)' }],
}), ['Cites Metro 2 Field 21, which is not present in the authorized deterministic findings.']);
assert.deepEqual(unauthorizedFieldCitations('Field 25 is disputed.', { violations: [] }), [], 'legacy accounts remain compatible');
assert.deepEqual(unauthorizedFieldCitations('Field 20 must be reported.', {
  findings: [{ outcome: 'FLAG', field: 'Field 25 (Date of First Delinquency)' }],
}, { additionalAllowed: ['20'] }), []);
assert.match(html, /<div class="date-line">/);
assert.match(html, /<div class="sender-block">Alex Example<br>100 Main Street/);
assert.match(html, /<div class="recipient-block">Example Bank<br>200 Bank Way/);
assert.match(html, /class="section-header"/);
assert.match(html, /Sent via Certified Mail/);
assert.doesNotMatch(html, /undefined|\[object Object\]/);

const injected = renderStructuredLetter({
  content: { ...content, opening: ['<script>alert(1)</script>'] },
  client: { name: 'Alex Example', address: '100 Main Street\nDenver, CO 80202' },
  account: { furnisher: 'Example Bank', furnisherAddress: '200 Bank Way\nDallas, TX 75001' },
  letter: { target_type: 'furnisher' },
});
assert.doesNotMatch(injected, /<script>alert/);
assert.match(injected, /&lt;script&gt;/);

const oldHtml = '<html><head><style>secret css</style></head><body><p>Supported dispute fact.</p><div class="signature-block"><img src="data:image/png;base64,SECRET">Alex</div><div class="mail-notation">mail</div><div class="enclosures">docs</div></body></html>';
const normalized = priorLetterPlainText(oldHtml);
assert.equal(normalized, 'Supported dispute fact.');
const digest = buildPriorRoundEvidenceDigest({
  priorTargetType: 'furnisher', nextTargetType: 'bureau', priorLetterHtml: oldHtml,
  priorLetterSummary: 'Prior dispute summary', analysis: { classification: 'INCOMPLETE', summary: 'Response missed the balance conflict', ignoredSecret: 'omit me' },
});
assert.equal(digest.analysis.classification, 'INCOMPLETE');
assert.equal(Object.hasOwn(digest.analysis, 'ignoredSecret'), false);
assert.doesNotMatch(JSON.stringify(digest), /SECRET|secret css|data:image/);

const generator = readFileSync(new URL('../netlify/functions/generate-letter-background.mjs', import.meta.url), 'utf8');
const context = readFileSync(new URL('../netlify/functions/_letterContext.mjs', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../netlify/functions/_claudeRuntime.mjs', import.meta.url), 'utf8');
const audit = readFileSync(new URL('../netlify/functions/audit-run-background.mjs', import.meta.url), 'utf8');
const phase2 = readFileSync(new URL('../netlify/functions/phase2-analyze-background.mjs', import.meta.url), 'utf8');
const followUpPrompt = readFileSync(new URL('../src/prompts/bureauFollowUpPrompt.js', import.meta.url), 'utf8');
const phase4 = readFileSync(new URL('../netlify/functions/phase4-generate-background.mjs', import.meta.url), 'utf8');
const intake = readFileSync(new URL('../netlify/functions/response-evidence.cjs', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260811020000_claude_generation_hardening.sql', import.meta.url), 'utf8');
const letterPrompt = readFileSync(new URL('../src/prompts/letterPrompt.js', import.meta.url), 'utf8');
const masterPrompt = readFileSync(new URL('../src/prompts/masterPrompt.js', import.meta.url), 'utf8');

assert.match(generator, /Exactly one letterId is required/);
assert.doesNotMatch(generator, /payload\.jobs|MAX_JOBS_PER_REQUEST/);
assert.match(generator, /output_config:[\s\S]*effort: LETTER_EFFORT[\s\S]*json_schema/);
assert.match(generator, /renderStructuredLetter/);
assert.match(context, /buildPriorRoundEvidenceDigest/);
assert.match(context, /campaign_letter_routes/);
assert.match(context, /source\.user_id !== letter\.user_id/);
assert.match(context, /evidence\.firm_user_id !== letter\.user_id/);
assert.match(runtime, /maxRetries: 2/);
assert.match(runtime, /timeout: 8 \* 60 \* 1000/);
assert.match(runtime, /messages\.countTokens/);
assert.match(audit, /effort: 'medium'/);
assert.match(audit, /preflightTokenCount/);
assert.match(phase2, /MAX_TOTAL_RESPONSE_BYTES/);
assert.match(phase2, /splitPdfByPages/);
assert.match(phase2, /preflightTokenCount/);
assert.match(phase2, /renderFollowUpLetter/);
assert.match(followUpPrompt, /letterContent/);
assert.doesNotMatch(followUpPrompt, /letterHtml|complete HTML document/);
assert.match(phase4, /const EFFORT = 'high'/);
assert.match(phase4, /preflightTokenCount/);
assert.match(intake, /MAX_TOTAL_FILE_SIZE = 18 \* 1024 \* 1024/);
assert.match(migration, /create table if not exists public\.claude_call_logs/);
assert.match(migration, /generation_context jsonb/);
assert.doesNotMatch(migration, /prompt text|response text|document_content/);
assert.doesNotMatch(letterPrompt, /complete HTML dispute letters|OUTPUT HTML REQUIREMENTS/);
assert.doesNotMatch(masterPrompt, /<MODE>LETTER_HTML<\/MODE>/);
assert.doesNotMatch(JSON.stringify(LETTER_CONTENT_SCHEMA), /maxItems|minItems|maxLength|minLength/);

console.log('All Claude hardening assertions passed.');
