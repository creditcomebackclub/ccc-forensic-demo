#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const concierge = read('../agents/concierge_agent.py');
const sensitive = read('../netlify/functions/client-sensitive-data.mjs');
const migration = read('../supabase/migrations/20260820430000_portal_canonical_runtime_hardening.sql');

assert.match(concierge, /ccc_resolve_canonical_portal_identity/);
assert.match(concierge, /"p_access_mode": "active"/);
assert.match(concierge, /portal_user_id, client_id, firm_user_id = _resolve_caller/);
assert.match(concierge, /\.eq\("id", client_id\)[\s\S]*?\.eq\("user_id", firm_user_id\)/,
  'service-role case reads must remain bound to the canonical client and firm');
assert.doesNotMatch(concierge, /_memory_rate_limit|_rate_events/,
  'production concierge may not fall back to a per-process limiter');

assert.match(sensitive, /ccc_resolve_canonical_portal_identity/);
assert.match(sensitive, /p_access_mode: 'active'/);
assert.match(sensitive, /String\(identity\.clientId\) !== clientRow\.id/);
assert.doesNotMatch(sensitive, /clientRow\.email\.toLowerCase\(\) === caller\.email\.toLowerCase\(\)/,
  'duplicate emails must never authorize an encrypted client-data write');
assert.match(sensitive, /if \(!isStaff\) \{[\s\S]*?isOwnRecord = true;/);

const limiterBody = migration.match(
  /create or replace function public\.ccc_begin_portal_concierge_request\([\s\S]*?as \$\$([\s\S]*?)\n\$\$;/,
)?.[1] || '';
assert.match(limiterBody, /ccc_resolve_canonical_portal_identity\([\s\S]*?'active'/);
assert.match(limiterBody, /v_canonical_client_id is distinct from p_client_id/);
assert.match(limiterBody, /event\.client_id = v_canonical_client_id/);
assert.match(migration, /revoke all on function public\.ccc_begin_portal_concierge_request[\s\S]*from public, anon, authenticated/);
assert.match(migration, /grant execute[\s\S]*to service_role/);

console.log('Canonical active portal authorization assertions passed.');
