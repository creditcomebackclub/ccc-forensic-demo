#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const migrationName = '20260820390000_portal_profile_insert_lockdown.sql';
const migrationUrl = new URL(`../supabase/migrations/${migrationName}`, import.meta.url);
const migration = readFileSync(migrationUrl, 'utf8');
const agreementMigration = readFileSync(
  new URL('../supabase/migrations/20260820260000_service_agreement_only.sql', import.meta.url),
  'utf8',
);
const provision = readFileSync(
  new URL('../netlify/functions/provision-user.cjs', import.meta.url),
  'utf8',
);

assert.match(
  migration,
  /drop policy if exists "client_profiles_insert_own_or_staff"\s+on public\.client_profiles/i,
  'the known authenticated self-link policy must be removed explicitly',
);
assert.match(migration, /tablename = 'client_profiles'/);
assert.match(migration, /cmd = 'INSERT'/);
for (const role of ['public', 'anon', 'authenticated']) {
  assert.match(
    migration,
    new RegExp(`'${role}'::name`),
    `the policy sweep must include ${role}`,
  );
}
assert.match(
  migration,
  /revoke insert on table public\.client_profiles from public, anon, authenticated/i,
  'browser roles must lose the table-level INSERT privilege',
);
assert.match(
  migration,
  /grant insert on table public\.client_profiles to service_role/i,
  'the controlled server writer must retain INSERT',
);
assert.match(migration, /has_table_privilege\('authenticated', 'public\.client_profiles', 'INSERT'\)/);
assert.match(migration, /has_table_privilege\('anon', 'public\.client_profiles', 'INSERT'\)/);
assert.match(migration, /not pg_catalog\.has_table_privilege\('service_role', 'public\.client_profiles', 'INSERT'\)/);

const linkerBody = agreementMigration.match(
  /create or replace function public\.ccc_link_portal_profile_for_onboarding\([\s\S]*?\nas \$\$([\s\S]*?)\n\$\$;/,
)?.[1] || '';
assert.match(linkerBody, /insert into public\.client_profiles/);
assert.match(linkerBody, /ccc-portal-user:/);
assert.match(linkerBody, /ccc-portal-client:/);
assert.match(linkerBody, /ccc-portal-email:/);
assert.match(
  agreementMigration,
  /revoke all on function public\.ccc_link_portal_profile_for_onboarding\(uuid, uuid, text, text\)\s+from public, anon, authenticated;/,
);
assert.match(
  agreementMigration,
  /grant execute on function public\.ccc_link_portal_profile_for_onboarding\(uuid, uuid, text, text\)\s+to service_role;/,
);
assert.match(provision, /rest\/v1\/rpc\/ccc_link_portal_profile_for_onboarding/);
assert.doesNotMatch(
  provision,
  /rest\/v1\/client_profiles`, \{ method: 'POST'/,
  'the provisioning function must not bypass the controlled linker',
);

const auditBody = migration.match(
  /create or replace function public\.ccc_audit_portal_profile_link_integrity\(\)[\s\S]*?\nas \$\$([\s\S]*?)\n\$\$;/,
)?.[1] || '';
assert.ok(auditBody, 'the service-role release audit must exist');
assert.match(migration, /security definer\s+set search_path = ''/i);
for (const issue of [
  'missing_portal_user_id',
  'auth_user_missing',
  'missing_client_id',
  'client_missing',
  'portal_auth_email_mismatch',
  'portal_client_email_mismatch',
  'duplicate_client_link',
  'duplicate_normalized_email',
  'portal_role_missing',
  'non_client_profile_identity',
  'affiliate_identity_linked',
]) {
  assert.match(auditBody, new RegExp(`'${issue}'`));
}
assert.doesNotMatch(
  auditBody,
  /\b(insert\s+into|update|delete\s+from|merge\s+into|truncate)\b/i,
  'the integrity audit must remain read-only',
);
assert.match(
  migration,
  /revoke all on function public\.ccc_audit_portal_profile_link_integrity\(\)\s+from public, anon, authenticated;/,
);
assert.match(
  migration,
  /grant execute on function public\.ccc_audit_portal_profile_link_integrity\(\)\s+to service_role;/,
);

// Future migrations must not reopen direct browser inserts after this gate.
const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const laterMigrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql') && name.localeCompare(migrationName) > 0)
  .sort();
for (const name of laterMigrations) {
  const source = readFileSync(new URL(name, migrationsDir), 'utf8');
  const executableSql = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/"/g, '')
    .replace(/\s+/g, ' ');
  assert.doesNotMatch(
    executableSql,
    /grant\s+(?:all(?:\s+privileges)?|insert(?:\s*\([^)]*\))?)\s+on(?:\s+table)?\s+(?:public\.)?client_profiles\s+to\s+(?:public|anon|authenticated)/i,
    `${name} regrants direct client_profiles INSERT`,
  );
  assert.doesNotMatch(
    executableSql,
    /create\s+policy\s+\S+\s+on\s+(?:public\.)?client_profiles(?:\s+as\s+\S+)?\s+for\s+insert\b/i,
    `${name} recreates a client_profiles INSERT policy`,
  );
}

console.log('Portal profile self-link RLS lockdown assertions passed.');
