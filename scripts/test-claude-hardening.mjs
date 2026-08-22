import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { generatedLetterValidationError, unauthorizedFieldCitations } from '../src/utils/letterGeneration.js';
import { buildPriorRoundEvidenceDigest, priorLetterPlainText } from '../src/utils/roundEvidence.js';
import { LETTER_CONTENT_SCHEMA, renderStructuredLetter } from '../src/utils/structuredLetter.js';

const currentShape = '<!doctype html><html><body><div class="enclosures">Reviewed exhibits</div></body></html>';
assert.equal(generatedLetterValidationError(currentShape, { requireSections: true }), null,
  'current validation no longer requires a signature or certified-mail notation');
assert.throws(() => renderStructuredLetter(), /renderer is retired.*template library/i,
  'the former free-form letter renderer fails closed');
assert.deepEqual(unauthorizedFieldCitations('Field 25 is disputed. Field 21 is also disputed.', {
  findings: [{ outcome: 'FLAG', field: 'Field 25 (Date of First Delinquency)' }],
}), ['Cites Metro 2 Field 21, which is not present in the authorized deterministic findings.']);
assert.deepEqual(unauthorizedFieldCitations('Field 25 is disputed.', { violations: [] }), [], 'legacy accounts remain compatible');
assert.deepEqual(unauthorizedFieldCitations('Field 20 must be reported.', {
  findings: [{ outcome: 'FLAG', field: 'Field 25 (Date of First Delinquency)' }],
}, { additionalAllowed: ['20'] }), []);
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

const retiredGenerator = new URL('../netlify/functions/generate-letter-background.mjs', import.meta.url);
const retiredLetterPrompt = new URL('../src/prompts/letterPrompt.js', import.meta.url);
const runtime = readFileSync(new URL('../netlify/functions/_claudeRuntime.mjs', import.meta.url), 'utf8');
const audit = readFileSync(new URL('../netlify/functions/audit-run-background.mjs', import.meta.url), 'utf8');
const phase2 = readFileSync(new URL('../netlify/functions/phase2-analyze-background.mjs', import.meta.url), 'utf8');
const followUpPrompt = readFileSync(new URL('../src/prompts/bureauFollowUpPrompt.js', import.meta.url), 'utf8');
const phase4 = readFileSync(new URL('../netlify/functions/phase4-generate-background.mjs', import.meta.url), 'utf8');
const intake = readFileSync(new URL('../netlify/functions/response-evidence.cjs', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260811020000_claude_generation_hardening.sql', import.meta.url), 'utf8');
const masterPrompt = readFileSync(new URL('../src/prompts/masterPrompt.js', import.meta.url), 'utf8');

assert.equal(existsSync(retiredGenerator), false, 'the retired Claude letter generator must stay deleted');
assert.equal(existsSync(retiredLetterPrompt), false, 'the retired letter-generation prompt must stay deleted');
assert.match(runtime, /maxRetries: 2/);
assert.match(runtime, /timeout: 8 \* 60 \* 1000/);
assert.match(runtime, /messages\.countTokens/);
assert.match(audit, /effort: 'medium'/);
assert.match(audit, /preflightTokenCount/);
assert.match(phase2, /MAX_TOTAL_RESPONSE_BYTES/);
assert.match(phase2, /splitPdfByPages/);
assert.match(phase2, /preflightTokenCount/);
assert.match(phase2, /LEGACY FOLLOW-UP GENERATION RETIRED/);
assert.match(phase2, /Do not draft correspondence/);
assert.doesNotMatch(phase2, /renderFollowUpLetter|BUREAU_FOLLOW_UP_SCHEMA|normalizeFollowUpPresentation/);
assert.match(followUpPrompt, /letterContent/);
assert.doesNotMatch(followUpPrompt, /letterHtml|complete HTML document/);
assert.match(phase4, /LEGACY PHASE 4 GENERATION RETIRED/);
assert.match(phase4, /statusCode: 410/);
assert.match(phase4, /requireStaff\(event\)/);
assert.doesNotMatch(phase4, /@anthropic-ai|preflightTokenCount|messages\.(?:stream|create)|output_config|const (?:MODEL|EFFORT)\b/,
  'the retired Phase 4 endpoint must not retain a model-generation path');
assert.match(intake, /MAX_TOTAL_FILE_SIZE = 18 \* 1024 \* 1024/);
assert.match(migration, /create table if not exists public\.claude_call_logs/);
assert.match(migration, /generation_context jsonb/);
assert.doesNotMatch(migration, /prompt text|response text|document_content/);
assert.doesNotMatch(masterPrompt, /<MODE>LETTER_HTML<\/MODE>/);
assert.doesNotMatch(JSON.stringify(LETTER_CONTENT_SCHEMA), /maxItems|minItems|maxLength|minLength/);

console.log('All Claude hardening assertions passed.');
