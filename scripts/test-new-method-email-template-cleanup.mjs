import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const cron = read('netlify/functions/daily-cron.cjs');
const narrativePrompt = read('src/prompts/progressNarrativePrompt.js');
const migration = read('supabase/migrations/20260820330000_new_method_email_template_cleanup.sql');

// A report-diff narrative must stay inside the evidence it actually receives.
// The examples are the strongest behavioral influence on the model, so prove
// they cannot teach an invented delivery date, fixed response period, or next
// round promise.
assert.match(narrativePrompt, /Your Story\. The Facts\. The Pressure\./);
assert.match(narrativePrompt, /JSON does not contain reliable mailing, receipt, or response evidence/i);
assert.match(narrativePrompt, /never means a guaranteed deletion, legal penalty, lawsuit, or payment/i);
const promptExamples = narrativePrompt.slice(narrativePrompt.indexOf('FEW-SHOT EXAMPLE 1'));
assert.doesNotMatch(promptExamples, /\b30[ -]?days?\b|response window|letters? (?:was|were) delivered|we(?:'ll| will) move/i);
assert.match(promptExamples, /current comparison point/i);

// Fixed-day sends remain available only for explicitly historical campaign
// rows. Current CCC rows use event-driven milestone emails instead.
assert.match(cron, /usesHistoricalCampaignDrips = !isStructuredRound && !isCccDispute/);
assert.match(cron, /updateType: 'day7_checkin'/);
assert.match(cron, /updateType: 'day30_approaching'/);
assert.doesNotMatch(cron, /ccc_day7_checkin|ccc_day30_review/);

const pausedStatusSection = cron.slice(
  cron.indexOf('// --- 2.5 Paused Client Winback Sweep'),
  cron.indexOf('// --- 3. Gather Business Metrics')
);
assert.match(pausedStatusSection, /Your Story\. The Facts\. The Pressure\./);
assert.match(pausedStatusSection, /recorded send date/i);
assert.match(pausedStatusSection, /does not claim delivery or receipt/i);
assert.doesNotMatch(pausedStatusSection, /active statutory deadlines|<th[^>]*>Deadline<|<th[^>]*>Remaining</i);

// The migration changes only the known seeded name/event pairs in place. It
// neither deletes templates nor rewrites the already-snapshotted client email
// history, and its replacement seed function cannot recreate the retired copy.
assert.match(migration, /update public\.client_email_templates as template/);
assert.match(migration, /template\.name = replacement\.name/);
assert.match(migration, /template\.event_type is not distinct from replacement\.event_type/);
assert.match(migration, /template\.subject_template = replacement\.old_subject/);
assert.match(migration, /template\.body_template = replacement\.old_body/);
assert.match(migration, /Preserve that customized row and its references/i);
assert.match(migration, /set\s+is_active = false,/i);
assert.doesNotMatch(migration, /delete\s+from\s+public\.client_email_templates/i);
assert.match(migration, /Historical client_emails already contain immutable subject\/body/i);
assert.match(migration, /snapshots, so these targeted in-place replacements preserve every sent/i);

const currentSeedFunction = migration.slice(migration.indexOf('create or replace function public.seed_client_email_templates'));
assert.match(currentSeedFunction, /Your Story\. The Facts\. The Pressure\./);
assert.match(currentSeedFunction, /USPS First-Class Mail/);
assert.match(currentSeedFunction, /recorded the send date/i);
assert.match(currentSeedFunction, /on conflict \(user_id, name\) do nothing/);
assert.doesNotMatch(currentSeedFunction, /certified(?: mail)?|response window|direct-furnisher|Metro\s*2|LPOA/i);

for (const eventType of [
  'file_cleanup_mailed',
  'next_round_prepared',
  'round_mailed:furnisher',
  'round_mailed:bureau',
  'first_response_received',
  'documents_needed',
  'round_resolved',
  'escalation_ready',
]) {
  assert.ok(currentSeedFunction.includes(`'${eventType}'`), `Current seed copy is missing ${eventType}.`);
}

console.log('New-method email-template cleanup tests passed.');
