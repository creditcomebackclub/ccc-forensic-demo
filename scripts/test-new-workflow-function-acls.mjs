#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/20260820540000_new_workflow_function_acl_lockdown.sql', import.meta.url),
  'utf8',
);

const serviceOnly = [
  'claim_ccc_track_revisions_for_mail',
  'release_ccc_track_revision_mail_claims',
  'ccc_operations_deterministic_audit_valid',
  'ccc_operations_fresh_r1_audit_valid',
  'ccc_operations_lifecycle_audit_valid',
  'ccc_claim_audit_job',
  'ccc_claim_next_audit_checkpoint',
  'ccc_complete_audit_checkpoint',
  'ccc_split_audit_checkpoint',
  'ccc_release_audit_job',
  'ccc_finish_audit_job',
  'ccc_reclaim_stale_audit_jobs',
  'ccc_claim_orphan_audit_upload_cleanup',
];

for (const name of serviceOnly) {
  const block = migration.slice(
    migration.indexOf(`revoke all on function public.${name}`),
    migration.indexOf(';', migration.indexOf(`grant execute on function public.${name}`)) + 1,
  );
  assert.match(block, /from public, anon, authenticated, service_role/);
  assert.match(block, /to service_role/);
}

assert.match(migration, /ccc_create_or_resume_audit_job[\s\S]*from public, anon, authenticated, service_role[\s\S]*to authenticated, service_role/);
assert.match(migration, /ccc_round_reason_snapshot_valid_or_legacy[\s\S]*to authenticated, service_role/);
assert.match(migration, /ccc_storage_object_has_active_mail_claim[\s\S]*to authenticated, service_role/);
assert.match(migration, /has_function_privilege\('anon'/);
assert.match(migration, /has_function_privilege\('authenticated'/);
assert.match(migration, /has_function_privilege\('service_role'/);

console.log('New workflow function ACL lockdown contracts passed.');
