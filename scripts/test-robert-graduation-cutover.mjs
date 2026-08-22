import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260820320000_robert_graduation_cutover.sql', import.meta.url), 'utf8');

assert.match(sql, /ea41862f-c22a-4acc-9455-8550556f907d/);
assert.match(sql, /lower\(trim\(name\)\)\s*=\s*'robert kerstner'/i);
assert.match(sql, /engagement_status\s*=\s*'graduated'/i);
assert.match(sql, /billing_status\s*=\s*'Graduated'/);
assert.match(sql, /exit_reason\s*=\s*'graduated'/i);
assert.doesNotMatch(sql, /delete\s+from/i, 'graduation must preserve Robert\'s historical records');
assert.doesNotMatch(sql, /update\s+public\.ccc_account_tracks/i, 'graduation must not rewrite account-track history');

console.log('Robert graduation cutover contract passed.');
