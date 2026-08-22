#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migrationName = '20260820400000_portal_raw_data_lockdown.sql';
const migration = read(`../supabase/migrations/${migrationName}`);
const app = read('../src/App.jsx');
const portal = read('../src/components/ClientPortal.jsx');
const blueprintEndpoint = read('../netlify/functions/portal-blueprint-url.cjs');

assert.match(migration, /create or replace function public\.get_my_client_portal_bootstrap\(\)/);
assert.match(migration, /create or replace function public\.get_my_client_portal_snapshot\(\)/);
assert.match(migration, /create or replace function public\.ccc_client_portal_safe_progress_diff\(p_diff jsonb\)/);
assert.match(migration, /create or replace function public\.ccc_client_portal_identity_is_canonical\(p_profile_id uuid\)/);
assert.match(migration, /security definer\s+set search_path = ''/i);
assert.match(migration, /v_profile_count <> 1/);
assert.match(migration, /v_client_profile_count <> 1/);
assert.match(migration, /public\.ccc_current_client_has_portal_access\(v_profile\.id\)/);
assert.match(migration, /identity_profile\.role = 'client'/);
assert.match(migration, /portal_profile\.email[\s\S]*portal_user\.email[\s\S]*client\.email/);
assert.match(migration, /not exists \([\s\S]*public\.affiliates affiliate/);
assert.match(migration, /public\.get_my_ccc_portal_projection\(\)/);
assert.match(migration, /revoke all on function public\.get_my_ccc_portal_projection\(\)[\s\S]*authenticated/);
assert.match(migration, /revoke all on function public\.get_my_deletion_outcomes\(\)[\s\S]*authenticated/);
assert.match(migration, /revoke select on public\.client_dispute_round_status,[\s\S]*public\.client_packet_account_status[\s\S]*authenticated/);

for (const policy of [
  'client_read_own_meta',
  'client_read_own_audits',
  'client_read_own_letters',
  'client_read_own_documents',
  'client_read_own_progress',
  'client_read_own_recovery_blueprints',
  'client_profiles_select_own_or_staff',
]) {
  assert.match(
    migration,
    new RegExp(`drop policy if exists "${policy}"`),
    `${policy} must be retired`,
  );
}

assert.match(migration, /create policy "client_profiles_staff_read"/);
assert.match(migration, /staff\.role = 'admin'/);
assert.match(migration, /staff\.role = 'auditor'[\s\S]*client\.user_id = auth\.uid\(\)/);
assert.match(migration, /drop policy if exists "client_insert_own_client_docs" on storage\.objects/);
assert.match(migration, /create or replace function public\.ccc_client_portal_can_read_document_path\(object_name text\)/);
assert.match(migration, /document\.storage_path = object_name/);
assert.match(migration, /document\.doc_type in \('id', 'address'\)[\s\S]*document\.doc_type like 'other-%'/);
assert.match(migration, /storage\.foldername\(object_name\)\)\[3\] = 'identity'/);
assert.match(migration, /public\.ccc_current_client_has_portal_access\(portal_profile\.id\)/);
assert.match(migration, /public\.ccc_client_portal_can_read_document_path\(name\)/);
assert.doesNotMatch(
  migration.match(/create policy "client_select_documents_storage"[\s\S]*?\n\);/)?.[0] || '',
  /client_owns_documents_path|dispute-screenshots|not in/,
  'portal storage access must be an exact registry allowlist, not a prefix denylist',
);
assert.match(migration, /authorized_read_recovery_blueprint_files[\s\S]*join public\.profiles staff on staff\.id = auth\.uid\(\)/);
assert.doesNotMatch(
  migration.match(/create policy "authorized_read_recovery_blueprint_files"[\s\S]*?\n\);/)?.[0] || '',
  /client_profiles|client_name/,
  'Recovery Blueprint storage must be staff-only; clients use the exact-auth endpoint',
);

const snapshotBody = migration.match(
  /create or replace function public\.get_my_client_portal_snapshot\(\)[\s\S]*?as \$\$([\s\S]*?)\n\$\$;/,
)?.[1] || '';
assert.ok(snapshotBody, 'the safe snapshot body must be extractable');
assert.match(
  snapshotBody,
  /v_bootstrap ->> 'has_portal_access'[\s\S]*?is not true[\s\S]*?errcode = '42501'/,
  'the full portal snapshot must enforce signed or grandfathered access itself',
);
for (const forbiddenKey of [
  'html',
  'phase2_analysis',
  'bureau_review_notes',
  'classification_snapshot',
  'source_audit_snapshot',
  'ssn_last4',
  'monitoring_password',
  'lpoa_signature_data',
  'sign_token',
  'file_sha256',
  'audit_sha256',
]) {
  assert.doesNotMatch(
    snapshotBody,
    new RegExp(`'${forbiddenKey}'\\s*,`),
    `${forbiddenKey} must not be emitted by the portal snapshot`,
  );
}
assert.match(snapshotBody, /when letter\.phase ilike 'CCC Dispute —%' then 'CCC Dispute — Account Case'/);
assert.match(snapshotBody, /when letter\.mail_service = 'usps_first_class_certified_return_receipt' then letter\.delivered_at[\s\S]*else null/);
assert.match(snapshotBody, /when letter\.mail_service = 'usps_first_class_certified_return_receipt' then letter\.response_due_at[\s\S]*else null/);
assert.match(snapshotBody, /join public\.letters letter[\s\S]*letter\.id = status\.letter_id/);
assert.match(snapshotBody, /when letter\.tracking_status = 'Failed' then 'failed'/);
assert.match(snapshotBody, /jsonb_typeof\(client\.ledger\) = 'array'/);
assert.doesNotMatch(snapshotBody, /'source'\s*,\s*entry\.value/);
assert.match(snapshotBody, /public\.ccc_client_portal_safe_progress_diff\(progress\.diff\)/);
assert.doesNotMatch(snapshotBody, /'phase_progress'\s*,\s*progress\.phase_progress/);

const progressProjector = migration.match(
  /create or replace function public\.ccc_client_portal_safe_progress_diff\(p_diff jsonb\)[\s\S]*?as \$\$([\s\S]*?)\n\$\$;/,
)?.[1] || '';
assert.ok(progressProjector, 'the nested progress allowlist must be extractable');
for (const forbiddenNestedKey of [
  'clientAccountId',
  'accountNumberMasked',
  'violations',
  'statute',
  'oldViolations',
  'newViolations',
  'accountKey',
  'phase',
]) {
  assert.doesNotMatch(
    progressProjector,
    new RegExp(`'${forbiddenNestedKey}'\\s*,`),
    `${forbiddenNestedKey} must not be emitted inside a client progress diff`,
  );
}
assert.match(progressProjector, /'furnisher'/);
assert.match(progressProjector, /'scoreDeltas'/);
assert.match(progressProjector, /'negativeCounts'/);
assert.match(progressProjector, /'totalDebtRemoved'/);

assert.match(app, /rest\/v1\/rpc\/get_my_client_portal_bootstrap/);
assert.doesNotMatch(app, /rest\/v1\/client_profiles\?email=/);
assert.doesNotMatch(app, /from\('client_profiles'\)\.select\('\*'\)\.eq\('email'/);
assert.doesNotMatch(app, /body:\s*JSON\.stringify\(\{ user_id: session\.user\.id \}\)/);

assert.match(portal, /rpc\('get_my_client_portal_snapshot'\)/);
for (const rawTable of ['client_profiles', 'clients', 'audits', 'letters', 'documents', 'progress_updates', 'recovery_blueprints']) {
  assert.doesNotMatch(
    portal,
    new RegExp(`\\.from\\(['"]${rawTable}['"]\\)`),
    `ClientPortal must not query raw ${rawTable}`,
  );
}
assert.doesNotMatch(portal, /get_my_deletion_outcomes/);
assert.match(portal, /\/\.netlify\/functions\/portal-blueprint-url/);
assert.doesNotMatch(portal, /\.storage[\s\S]*?\.from\('recovery-blueprints'\)/);

const progressTab = read('../src/components/client-portal/ProgressTab.jsx');
assert.doesNotMatch(progressTab, /update\.phase_progress|clientCampaignLabel|accountKey/);
assert.match(progressTab, /phaseProgress: \[\]/);

assert.match(blueprintEndpoint, /resolvePortalIdentityWithAdmin\(admin, userId, 'active'\)/);
assert.match(blueprintEndpoint, /\.eq\('client_id', identity\.clientId\)[\s\S]*?\.eq\('user_id', identity\.firmUserId\)/);
assert.doesNotMatch(blueprintEndpoint, /query\.eq\('client_name'/);
assert.doesNotMatch(blueprintEndpoint, /bpErr\.message|signErr\.message/);

// Future migrations cannot silently reopen the retired raw browser policies.
const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
for (const name of readdirSync(migrationsDir).filter((entry) => entry.endsWith('.sql') && entry.localeCompare(migrationName) > 0)) {
  const sql = readFileSync(new URL(name, migrationsDir), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ');
  assert.doesNotMatch(
    sql,
    /create policy\s+"?client_(?:read_own|profiles_select|insert_own_client_docs)/i,
    `${name} reopens a retired portal raw-data policy`,
  );
}

console.log('Portal raw-data, legal-artifact, and exact-auth projection assertions passed.');
