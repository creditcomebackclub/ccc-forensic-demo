import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canonicalDeletionBureau,
  combinedDeletionResults,
  normalizeDeletionOutcome,
  standaloneDeletionResults,
} from '../src/utils/deletionOutcomes.js';

assert.equal(canonicalDeletionBureau('TransUnion'), 'TU');
assert.equal(canonicalDeletionBureau('Experian'), 'EXP');
assert.equal(canonicalDeletionBureau('Equifax'), 'EQ');
assert.equal(canonicalDeletionBureau('unknown'), null);

const robert = normalizeDeletionOutcome({
  id: '3b4d2416-fe75-4daa-a9d4-8904a509eb00',
  client_id: 'ea41862f-c22a-4acc-9455-8550556f907d',
  client_account_id: '0c5fcb7e-b09e-4636-84d8-51aeaed84a4c',
  furnisher: 'Small Business Administration',
  account_type: 'SBA loan',
  bureau_code: 'TU',
  account_last4: '8989',
  deletion_confirmed_at: '2026-08-21T02:30:59.276052+00:00',
  source_kind: 'owner_confirmed_historical',
  source_audit_id: 'robert-kerstner__ea41862f-c22a-4acc-9455-8550556f907d__2026-08-07',
  notes: 'must never reach the portal projection',
  fee_amount: 999,
});
assert.equal(robert.bureauLabel, 'TransUnion');
assert.equal(robert.accountLast4, '8989');
assert.equal(Object.hasOwn(robert, 'notes'), false);
assert.equal(Object.hasOwn(robert, 'feeAmount'), false);

const unlinked = standaloneDeletionResults([], [robert]);
assert.equal(unlinked.length, 1);
assert.equal(unlinked[0].source, 'registry');

const deletedLetter = {
  id: 'letter-1',
  furnisher: 'Example Bank',
  clientAccountId: 'account-1',
  targetBureau: 'TU',
  responseOutcome: 'deleted',
  responseDate: '2026-08-19',
};
const linkedRegistry = {
  id: 'deletion-1',
  client_account_id: 'account-1',
  furnisher: 'Example Bank',
  bureau_code: 'TU',
  deletion_confirmed_at: '2026-08-19',
  source_letter_id: 'letter-1',
};
assert.equal(standaloneDeletionResults([deletedLetter], [linkedRegistry]).length, 0,
  'a registry row linked to a deleted letter must not create a second win');
assert.equal(combinedDeletionResults([deletedLetter], [linkedRegistry]).length, 1);

const duplicateAccountBureau = {
  ...robert,
  id: 'duplicate-browser-row',
};
assert.equal(standaloneDeletionResults([], [robert, duplicateAccountBureau]).length, 1,
  'client-account/bureau identity is deduplicated defensively in the UI');
assert.equal(combinedDeletionResults([deletedLetter], [robert]).length, 2,
  'an unlinked historical result remains visible beside a letter deletion');

const migration = readFileSync(new URL('../supabase/migrations/20260820310000_deletion_outcome_registry.sql', import.meta.url), 'utf8');
const portalLockdown = readFileSync(new URL('../supabase/migrations/20260820400000_portal_raw_data_lockdown.sql', import.meta.url), 'utf8');
const storage = readFileSync(new URL('../src/utils/storage.js', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/components/DashboardPage.jsx', import.meta.url), 'utf8');
const portal = readFileSync(new URL('../src/components/ClientPortal.jsx', import.meta.url), 'utf8');

assert.match(migration, /add column if not exists client_id uuid/);
assert.match(migration, /foreign key \(client_id\) references public\.clients\(id\) on delete set null/);
assert.match(migration, /foreign key \(client_account_id\) references public\.client_accounts\(id\) on delete set null/);
assert.match(migration, /foreign key \(source_audit_user_id, source_audit_id\)[\s\S]*public\.audits\(user_id, id\)/);
assert.match(migration, /foreign key \(source_letter_user_id, source_letter_id\)[\s\S]*public\.letters\(user_id, id\)/);
assert.match(migration, /deletions_client_account_bureau_unique/);
assert.match(migration, /ccc_validate_deletion_outcome/);
assert.match(migration, /3b4d2416-fe75-4daa-a9d4-8904a509eb00/);
assert.match(migration, /ea41862f-c22a-4acc-9455-8550556f907d/);
assert.match(migration, /0c5fcb7e-b09e-4636-84d8-51aeaed84a4c/);
assert.match(migration, /account_last4 = '8989'/);
assert.match(migration, /bureau_code = 'TU'/);
assert.match(migration, /robert-kerstner__ea41862f-c22a-4acc-9455-8550556f907d__2026-08-07/);
assert.match(migration, /Preserve the production event row and its original notes\/fee\/name\/bureau/);

assert.match(migration, /drop policy if exists "Client sees own deletions"/);
assert.match(migration, /create or replace function public\.get_my_deletion_outcomes/);
const portalRpc = migration.slice(
  migration.indexOf('create or replace function public.get_my_deletion_outcomes'),
  migration.indexOf('revoke all on function public.get_my_deletion_outcomes'),
);
assert.match(portalRpc, /v_profile_count <> 1 or v_client_id is null/);
assert.match(portalRpc, /v_client_profile_count <> 1/);
assert.doesNotMatch(portalRpc, /notes|fee_amount|fee_charged|account_last4|client_account_id/,
  'the portal RPC must not expose internal notes, fees, or account coordinates');
assert.match(migration, /revoke all on function public\.get_my_deletion_outcomes\(\) from public, anon/);
assert.match(migration, /grant execute on function public\.get_my_deletion_outcomes\(\) to authenticated/);
assert.match(portalLockdown, /revoke all on function public\.get_my_deletion_outcomes\(\)[\s\S]*authenticated/,
  'the browser now receives deletion outcomes only through the active-access portal snapshot');

assert.match(storage, /\.from\('deletions'\)[\s\S]*\.in\('client_id', clientIds\)/,
  'summary hydration must batch-load outcomes by canonical client id');
assert.match(storage, /deletionRegistryUnavailable/);
assert.match(storage, /hydrateClientRecord\(client, audits, letters,[\s\S]*deletions\)/);

const standaloneDashboardBlock = dashboard.slice(
  dashboard.indexOf('// Historical/manual confirmed outcomes'),
  dashboard.indexOf('for (const round of c.rounds'),
);
assert.match(standaloneDashboardBlock, /outcomeCount\+\+/);
assert.match(standaloneDashboardBlock, /deletedAll\+\+/);
assert.match(standaloneDashboardBlock, /deletedThisMonth\+\+/);
assert.match(standaloneDashboardBlock, /recentActivity\.push/);
assert.doesNotMatch(standaloneDashboardBlock, /funnel\.|deleteDays/,
  'an unlinked historical outcome must not alter any letter funnel or mailed-day metric');
assert.doesNotMatch(dashboard, /letter outcomes marked deleted|recorded letter outcomes/);

assert.match(portal, /supabase\.rpc\('get_my_client_portal_snapshot'\)/);
assert.match(portal, /projection\.deletions \|\| \[\]/);
assert.doesNotMatch(portal, /supabase\.rpc\('get_my_deletion_outcomes'\)/,
  'the browser must receive deletions through the single client-safe snapshot boundary');
assert.match(portal, /combinedDeletionResults\(letters, deletionOutcomes\)/);
assert.match(portal, /standaloneDeletionResults\(letters, deletionOutcomes\)/);
assert.match(portal, /confirmed account removal/);

console.log('Standalone deletion registry, dashboard, and portal assertions passed.');
