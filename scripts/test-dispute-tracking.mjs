import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dateAfterDays, nextTemplateVersionLabel } from '../src/utils/disputeTemplateSelection.js';
import { accountsForTrackedLetter, disputeAccountKey } from '../src/utils/disputeTrackingRules.js';

assert.equal(nextTemplateVersionLabel('v1'), 'v2');
assert.equal(nextTemplateVersionLabel('V12'), 'v13');
assert.equal(nextTemplateVersionLabel('quarterly-rewrite'), 'v2');
assert.equal(dateAfterDays('2026-08-20', 90), '2026-11-18');

assert.equal(disputeAccountKey({ clientAccountId: 'account-uuid' }), 'client-account:account-uuid');
assert.equal(disputeAccountKey({ accountId: 'A-19' }), 'account:A-19');
assert.equal(disputeAccountKey({ furnisher: 'Acme Recovery LLC' }), 'furnisher:acme-recovery-llc');
assert.deepEqual(
  accountsForTrackedLetter({
    dispute_account_snapshot: [{ clientAccountId: 'uuid-1', furnisher: 'Bank One' }],
    covered_furnishers: ['Ignored fallback'],
  }),
  [{ clientAccountId: 'uuid-1', furnisher: 'Bank One', accountKey: 'client-account:uuid-1' }],
);
assert.deepEqual(
  accountsForTrackedLetter({ covered_furnishers: ['Collector One', 'Collector Two'] }).map((item) => item.accountKey),
  ['furnisher:collector-one', 'furnisher:collector-two'],
);

const migration = readFileSync(new URL('../supabase/migrations/20260820130000_dispute_template_tracking.sql', import.meta.url), 'utf8');
assert.match(migration, /review_due_on[\s\S]*\+ 90/, 'quarterly review is 90 days');
assert.doesNotMatch(migration, /cfpb/i, 'CCC tracking must not reintroduce CFPB timing');
for (const result of ['deleted', 'verified', 'updated', 'no_response', 'duplicate']) {
  assert.match(migration, new RegExp(`'${result}'`), `result ${result} must remain available`);
}
assert.match(migration, /enable row level security/i);
assert.match(migration, /security_invoker = true/i, 'performance view must retain caller RLS');
assert.match(
  migration,
  /caller\.role = 'admin' or letter\.user_id = auth\.uid\(\)/i,
  'template performance must stay scoped to the caller-owned letters for auditors',
);
assert.match(migration, /protect_used_dispute_template_version/i, 'used template bodies must be immutable');
assert.match(migration, /activate_dispute_template_version/i, 'new versions must retire the prior version');
assert.match(migration, /unique \(letter_id, account_key\)/i, 'one outcome per covered account and letter');

const studio = readFileSync(new URL('../src/components/DisputeCampaignStudio.jsx', import.meta.url), 'utf8');
assert.match(studio, /FLOW_LETTER_ROUNDS\[flow\]/, 'Campaign Studio must expose later rounds');
assert.match(studio, /disputeRoundNumber: round/, 'saved letters must snapshot the selected round');
assert.match(studio, /disputeTemplateVersionLabel: selectedTemplate\.version/, 'saved letters must snapshot the template version');
assert.match(studio, /disputeAccountSnapshot:/, 'saved letters must snapshot covered accounts');
assert.match(studio, /round,\s*\n\s*bureau:/, 'Claude rewrite requests must receive the selected round');
assert.match(studio, /templateTokens\.includes\('screenshots'\)/, 'screenshot requirements must come from the selected template curly');
assert.doesNotMatch(studio, /screenshotsRequired && !templateTokens\.includes/, 'screenshot validation must not contain an unreachable branch');
assert.match(studio, /ccc-\$\{recommendation\.flow\}-r\$\{round\}/, 'synthetic campaign keys must preserve the selected round');

const tracker = readFileSync(new URL('../src/components/DisputeOutcomeTracker.jsx', import.meta.url), 'utf8');
assert.match(tracker, /Deletion wins/);
assert.match(tracker, /Non-deletion results/);
assert.match(tracker, /Awaiting result/);

console.log('Dispute result tracking and quarterly template-version rules passed.');
