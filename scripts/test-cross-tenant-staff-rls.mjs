#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const migrationName = '20260820470000_cross_tenant_staff_rls_lockdown.sql';
const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const read = (name) => readFileSync(new URL(name, migrationsDir), 'utf8');
const migration = read(migrationName);
const executableSql = migration
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ');

function policy(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = migration.match(new RegExp(
    `create policy "${escaped}"[\\s\\S]*?;`,
    'i',
  ));
  assert.ok(match, `policy ${name} must exist`);
  return match[0].replace(/\s+/g, ' ');
}

const furnisher = policy('furnisher_addresses_staff_owner_scope');
assert.match(furnisher, /staff\.role = 'admin'/i);
assert.match(furnisher, /staff\.role = 'auditor' and furnisher_addresses\.user_id = auth\.uid\(\)/i);
assert.match(furnisher, /with check/i);

const accounts = policy('client_accounts_staff_owner_scope');
assert.match(accounts, /staff\.role = 'auditor' and client_accounts\.user_id = auth\.uid\(\)/i);
assert.match(accounts, /client_accounts\.client_id is null or exists/i);
assert.match(accounts, /client\.id = client_accounts\.client_id/i);
assert.match(accounts, /client\.user_id = client_accounts\.user_id and client\.user_id = auth\.uid\(\)/i);
assert.match(accounts, /with check/i);

const evidence = policy('response_evidence_staff_owner_scope');
assert.match(evidence, /response_evidence\.firm_user_id = auth\.uid\(\)/i);
assert.match(evidence, /letter\.id = response_evidence\.letter_id and letter\.user_id = response_evidence\.firm_user_id/i);
assert.match(evidence, /letter\.client_id = response_evidence\.client_id/i);
assert.match(evidence, /client\.id = response_evidence\.client_id and client\.user_id = response_evidence\.firm_user_id/i);
assert.match(evidence, /letter\.client_account_id = response_evidence\.client_account_id/i);
assert.match(evidence, /account\.id = response_evidence\.client_account_id and account\.user_id = response_evidence\.firm_user_id/i);
assert.match(evidence, /account\.client_id = response_evidence\.client_id/i);
assert.match(evidence, /with check/i);
assert.doesNotMatch(evidence, /client_name/i, 'mutable client_name must never establish evidence ownership');

const assessment = policy('response_account_assessment_staff_owner_scope');
assert.match(assessment, /staff\.role = 'admin'/i);
assert.match(assessment, /staff\.role = 'auditor' and response_evidence_account_assessment\.user_id = auth\.uid\(\)/i);
assert.match(assessment, /evidence\.id = response_evidence_account_assessment\.response_evidence_id/i);
assert.match(assessment, /evidence\.firm_user_id = response_evidence_account_assessment\.user_id/i);
assert.match(assessment, /evidence\.letter_id = coverage\.letter_id/i);
assert.match(assessment, /evidence\.client_id = coverage\.client_id/i);
assert.doesNotMatch(
  assessment,
  /evidence\.client_account_id\s*=\s*response_evidence_account_assessment\.client_account_id/i,
  'consolidated evidence names only the first account; exact account identity comes from coverage',
);
assert.match(assessment, /coverage\.user_id = response_evidence_account_assessment\.user_id/i);
assert.match(assessment, /coverage\.client_account_id = response_evidence_account_assessment\.client_account_id/i);
assert.match(assessment, /account\.user_id = response_evidence_account_assessment\.user_id/i);
assert.match(assessment, /account\.client_id = coverage\.client_id/i);
assert.match(assessment, /client\.user_id = response_evidence_account_assessment\.user_id/i);
assert.match(assessment, /dispute_round\.user_id = response_evidence_account_assessment\.user_id/i);
assert.match(assessment, /dispute_round\.client_id = coverage\.client_id/i);
assert.match(assessment, /dispute_round\.client_account_id = response_evidence_account_assessment\.client_account_id/i);
assert.match(assessment, /with check/i);
assert.equal(
  (assessment.match(/evidence\.firm_user_id = response_evidence_account_assessment\.user_id/gi) || []).length,
  2,
  'assessment USING and WITH CHECK must both tenant-bind the evidence row',
);
assert.doesNotMatch(assessment, /client_name/i, 'assessment ownership must never fall back to a mutable name');

const jobInsert = policy('phase2_jobs_insert_staff_owner_scope');
assert.match(jobInsert, /phase2_jobs\.user_id = auth\.uid\(\)/i);
assert.match(jobInsert, /letter\.id = phase2_jobs\.letter_id and \( staff\.role = 'admin' or letter\.user_id = phase2_jobs\.user_id \)/i);
assert.match(jobInsert, /phase2_jobs\.response_evidence_id is null or exists/i);
assert.match(jobInsert, /evidence\.firm_user_id = letter\.user_id and evidence\.letter_id = phase2_jobs\.letter_id/i);

const jobSelect = policy('phase2_jobs_select_staff_owner_scope');
assert.match(jobSelect, /staff\.role = 'admin'/i);
assert.match(jobSelect, /staff\.role = 'auditor' and phase2_jobs\.user_id = auth\.uid\(\)/i);
assert.match(jobSelect, /evidence\.firm_user_id = phase2_jobs\.user_id and evidence\.letter_id = phase2_jobs\.letter_id/i);

const affiliate = policy('affiliate_staff_read');
assert.match(affiliate, /staff\.role = 'admin'/i);
assert.match(affiliate, /staff\.role = 'auditor' and affiliates\.owner_user_id = auth\.uid\(\)/i);
assert.doesNotMatch(affiliate, /role in \('admin', 'auditor'\)/i, 'auditors must not retain global affiliate read');

const affiliateSelfRead = policy('affiliate_read_own');
assert.match(affiliateSelfRead, /affiliates\.user_id = auth\.uid\(\)/i);

const payoutRead = policy('commission_payout_staff_read');
assert.match(payoutRead, /staff\.role = 'admin'/i);
assert.match(payoutRead, /staff\.role = 'auditor' and exists/i);
assert.match(payoutRead, /affiliate\.id = commission_payouts\.affiliate_id/i);
assert.match(payoutRead, /affiliate\.owner_user_id = auth\.uid\(\)/i);
assert.match(payoutRead, /client\.id = commission_payouts\.client_id and client\.referred_by = affiliate\.id/i);
assert.match(payoutRead, /client\.user_id = auth\.uid\(\)/i);

const payoutWrite = policy('commission_payout_owner_write');
assert.match(payoutWrite, /staff\.role = 'admin'/i);
assert.doesNotMatch(payoutWrite, /auditor/i, 'payout mutation must remain admin-only');
assert.match(payoutWrite, /with check/i);

for (const [table, expectedPolicies] of Object.entries({
  furnisher_addresses: ['furnisher_addresses_staff_owner_scope'],
  client_accounts: ['client_accounts_staff_owner_scope'],
  response_evidence: ['response_evidence_staff_owner_scope'],
  response_evidence_account_assessment: ['response_account_assessment_staff_owner_scope'],
  phase2_jobs: ['phase2_jobs_insert_staff_owner_scope', 'phase2_jobs_select_staff_owner_scope'],
  affiliates: ['affiliate_staff_read', 'affiliate_read_own'],
  commission_payouts: ['commission_payout_staff_read', 'commission_payout_owner_write'],
})) {
  assert.match(
    executableSql,
    new RegExp(`alter table public\\.${table} enable row level security`, 'i'),
    `${table} must have RLS enabled`,
  );
  assert.match(
    executableSql,
    new RegExp(`revoke all privileges on table public\\.${table} from public, anon, authenticated`, 'i'),
    `${table} must lose the broad baseline browser grant`,
  );
  assert.match(
    migration,
    new RegExp(`tablename = '${table}'`, 'i'),
    `${table} must be covered by the deployment-time pg_policies probe`,
  );
  for (const policyName of expectedPolicies) {
    assert.match(migration, new RegExp(`'${policyName}'`));
  }
}

assert.match(executableSql, /grant select, insert, update on table public\.furnisher_addresses to authenticated/i);
assert.match(executableSql, /grant select on table public\.client_accounts to authenticated/i);
assert.match(executableSql, /grant select, update on table public\.response_evidence to authenticated/i);
assert.match(executableSql, /grant select on table public\.response_evidence_account_assessment to authenticated/i);
assert.doesNotMatch(
  executableSql,
  /grant (?:insert|update|delete|[^;]*,\s*(?:insert|update|delete))[^;]*on table public\.response_evidence_account_assessment to authenticated/i,
  'assessment writes must stay behind service-role ingestion and the hardened RPC',
);
assert.match(executableSql, /grant select, insert on table public\.phase2_jobs to authenticated/i);
assert.match(executableSql, /grant select on table public\.affiliates to authenticated/i);
assert.match(executableSql, /grant select, insert, update, delete on table public\.commission_payouts to authenticated/i);
assert.match(migration, /has_table_privilege\('anon', 'public\.' \|\| target_table, privilege_name\)/i);
assert.match(migration, /has_table_privilege\('service_role', 'public\.' \|\| target_table, privilege_name\)/i);

for (const table of [
  'furnisher_addresses',
  'client_accounts',
  'response_evidence',
  'response_evidence_account_assessment',
  'phase2_jobs',
  'affiliates',
  'commission_payouts',
]) {
  assert.match(
    executableSql,
    new RegExp(`grant all privileges on table public\\.${table} to service_role`, 'i'),
    `service_role must retain full ${table} access`,
  );
}

const reviewFunction = (migration.match(
  /create or replace function public\.review_packet_account_assessment\([\s\S]*?\n\$\$;/i,
)?.[0] || '').replace(/\s+/g, ' ');
assert.ok(reviewFunction, 'the packet review SECURITY DEFINER must be replaced');
assert.match(reviewFunction, /security definer/i);
assert.match(reviewFunction, /v_role is null or v_role not in \('admin', 'auditor'\)/i);
assert.match(reviewFunction, /v_role = 'auditor' and v_assessment\.user_id is distinct from v_caller/i);
assert.match(
  reviewFunction,
  /where id = p_assessment_id and \(v_role = 'admin' or user_id = v_caller\) for update/i,
  'auditors must not lock or inspect a foreign assessment before the owner check',
);
for (const [rowVariable, table] of [
  ['v_assessment', 'response_evidence_account_assessment'],
  ['v_evidence', 'response_evidence'],
  ['v_coverage', 'letter_account_coverage'],
  ['v_account', 'client_accounts'],
  ['v_client', 'clients'],
  ['v_round', 'dispute_rounds'],
]) {
  assert.match(
    reviewFunction,
    new RegExp(`select \\* into ${rowVariable} from public\\.${table}[\\s\\S]*?for update`, 'i'),
    `the review RPC must lock ${table} before mutation`,
  );
}
for (const binding of [
  /v_evidence\.firm_user_id is distinct from v_assessment\.user_id/i,
  /v_evidence\.letter_id is distinct from v_coverage\.letter_id/i,
  /v_evidence\.client_id is distinct from v_coverage\.client_id/i,
  /v_coverage\.user_id is distinct from v_assessment\.user_id/i,
  /v_coverage\.client_account_id is distinct from v_assessment\.client_account_id/i,
  /v_account\.user_id is distinct from v_assessment\.user_id/i,
  /v_account\.client_id is distinct from v_coverage\.client_id/i,
  /v_client\.user_id is distinct from v_assessment\.user_id/i,
  /v_round\.user_id is distinct from v_assessment\.user_id/i,
  /v_round\.client_id is distinct from v_coverage\.client_id/i,
  /v_round\.client_account_id is distinct from v_assessment\.client_account_id/i,
]) {
  assert.match(reviewFunction, binding);
}
assert.match(reviewFunction, /where id = v_coverage\.id[\s\S]*and user_id = v_assessment\.user_id[\s\S]*and client_id = v_client\.id/i);
assert.match(reviewFunction, /where id = v_round\.id[\s\S]*and user_id = v_assessment\.user_id[\s\S]*and client_account_id = v_account\.id/i);
assert.match(reviewFunction, /where id = v_evidence\.id[\s\S]*and firm_user_id = v_assessment\.user_id[\s\S]*and letter_id = v_coverage\.letter_id/i);
assert.match(
  migration,
  /revoke all on function public\.review_packet_account_assessment\(uuid, text, text, text, text\)[\s\S]*from public, anon, authenticated, service_role;/i,
);
assert.match(
  migration,
  /grant execute on function public\.review_packet_account_assessment\(uuid, text, text, text, text\)[\s\S]*to authenticated, service_role;/i,
);
assert.match(migration, /has_function_privilege\([\s\S]*'anon'[\s\S]*review_packet_account_assessment/i);
assert.match(
  migration,
  /has_table_privilege\([\s\S]*'public\.response_evidence_account_assessment'[\s\S]*'SELECT'/i,
);
assert.match(migration, /assessment browser privileges must be SELECT-only/i);
assert.match(migration, /left join public\.response_evidence evidence/i);
assert.match(migration, /left join public\.letter_account_coverage coverage/i);
assert.match(migration, /left join public\.client_accounts account/i);
assert.match(migration, /left join public\.clients client/i);
assert.match(migration, /left join public\.dispute_rounds dispute_round/i);
assert.match(migration, /Cross-tenant response account assessment graph requires manual remediation/);

// A later migration must not silently recreate one of the retired global-staff
// policies or restore anon/authenticated ALL table privileges.
for (const name of readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith('.sql') && entry.localeCompare(migrationName) > 0)
  .sort()) {
  const sql = read(name)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ');
  assert.doesNotMatch(
    sql,
    /create policy "?(?:furnisher_addresses_staff_all|staff_all_client_accounts|staff_all_response_evidence|staff_manage_response_account_assessment|staff_all_commission_payouts)"?/i,
    `${name} recreates a retired global-auditor policy`,
  );
  assert.doesNotMatch(
    sql,
    /grant all(?: privileges)? on(?: table)? public\.(?:furnisher_addresses|client_accounts|response_evidence|phase2_jobs|affiliates|commission_payouts) to (?:anon|authenticated)/i,
    `${name} restores a broad browser table grant`,
  );
  assert.doesNotMatch(
    sql,
    /grant\s+(?:insert|update|delete|[^;]*,\s*(?:insert|update|delete))[^;]*on(?: table)? public\.response_evidence_account_assessment to authenticated/i,
    `${name} restores direct authenticated assessment mutation`,
  );
  assert.doesNotMatch(
    sql,
    /create or replace function public\.review_packet_account_assessment\(/i,
    `${name} replaces the tenant-validated packet review RPC without updating this gate`,
  );
}

console.log('Cross-tenant staff RLS lockdown assertions passed.');
