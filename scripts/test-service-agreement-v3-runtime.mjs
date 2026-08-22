#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const identity = require('../netlify/functions/_portalIdentity.cjs');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20260820420000_service_agreement_v3_and_portal_identity_gate.sql');
const upload = read('../netlify/functions/portal-enroll-upload.cjs');
const signing = read('../netlify/functions/portal-service-agreement.cjs');
const blueprint = read('../netlify/functions/portal-blueprint-url.cjs');
const agreementDocument = read('../netlify/functions/_agreementDocument.cjs');

const functionBody = (name) => migration.match(
  new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\nas \\$\\$([\\s\\S]*?)\\n\\$\\$;`),
)?.[1] || '';

const approvalBody = functionBody('ccc_approve_service_agreement_template');
const claimBody = functionBody('ccc_claim_portal_service_agreement_signing');
const finalizeBody = functionBody('ccc_finalize_portal_service_agreement');
const identityBody = functionBody('ccc_resolve_canonical_portal_identity');

for (const body of [approvalBody, claimBody, finalizeBody]) {
  assert.match(body, /ccc-service-agreement-v3-no-first-work/);
  assert.doesNotMatch(body, /ccc-service-agreement-v2-service-only/,
    'retired v2 may remain historical evidence but cannot enter a current approval/signing path');
}
assert.match(approvalBody, /weekdays_only_counsel_approved/);
assert.match(approvalBody, /legal_status = 'counsel_review'/);
assert.match(approvalBody, /approval_reference/);
assert.match(claimBody, /ccc_resolve_canonical_portal_identity\(p_portal_user_id, 'pre_sign_v3'\)/);
assert.match(finalizeBody, /ccc_resolve_canonical_portal_identity\(p_portal_user_id, 'canonical'\)/);
assert.match(finalizeBody, /status not in \('sent', 'signed'\)/);

assert.match(identityBody, /where profile\.user_id = p_portal_user_id/);
assert.match(identityBody, /where peer\.client_id = v_profile\.client_id/);
assert.match(identityBody, /identity_profile\.role = 'client'/);
assert.match(identityBody, /auth\.users/);
assert.match(identityBody, /lower\(btrim\(v_profile\.email\)\) <> v_auth_email/);
assert.match(identityBody, /lower\(btrim\(v_profile\.email\)\) <> v_identity_email/);
assert.match(identityBody, /lower\(btrim\(v_profile\.email\)\) <> lower\(btrim\(coalesce\(v_client\.email/);
assert.match(identityBody, /public\.affiliates/);
assert.match(identityBody, /p_access_mode = 'pre_sign_v3'/);
assert.match(identityBody, /v_sent_v3_count <> 1/);
assert.match(identityBody, /p_access_mode = 'active'/);
assert.match(identityBody, /legacy_service_grandfathering/);
assert.match(migration, /revoke all on function public\.ccc_resolve_canonical_portal_identity[\s\S]*from public, anon, authenticated/);

assert.match(upload, /p_access_mode: 'pre_sign_v3'/);
assert.match(upload, /caller\.isSystem/);
assert.match(signing, /resolvePortalIdentityWithRest\([\s\S]*?'canonical'/);
assert.match(signing, /resolvePortalIdentityWithRest\(deps\.rest, caller\.userId, 'pre_sign_v3'/);
assert.match(signing, /template_version=eq\.' \+ encodeURIComponent\(AGREEMENT_TEMPLATE_VERSION\)/);
assert.match(blueprint, /resolvePortalIdentityWithAdmin\(admin, userId, 'active'\)/);
assert.match(blueprint, /\.eq\('client_id', identity\.clientId\)[\s\S]*\.eq\('user_id', identity\.firmUserId\)/);
assert.match(agreementDocument, /resolvePortalIdentityWithAdmin\(admin, userId, 'active'\)/);
assert.match(agreementDocument, /PORTAL_SERVICE_AGREEMENT_VERSIONS/,
  'signed v2/v3 artifacts stay readable only after the active canonical portal gate');
assert.match(agreementDocument, /!\/\^\[0-9a-f\]\{64\}\$\/\.test\(hash \|\| ''\)/,
  'every exposed signed agreement artifact requires an immutable SHA-256');

const good = {
  profileId: '10000000-0000-4000-8000-000000000001',
  clientId: '20000000-0000-4000-8000-000000000002',
  firmUserId: '30000000-0000-4000-8000-000000000003',
};
assert.deepEqual(identity.normalizePortalIdentity(good), good);
assert.throws(() => identity.normalizePortalIdentity({ ...good, clientId: 'not-a-uuid' }), /could not be verified/i);
await assert.rejects(
  identity.resolvePortalIdentityWithAdmin({ rpc: async () => ({ data: null, error: { code: '42501' } }) }, good.profileId, 'active'),
  (error) => error.status === 403,
);
await assert.rejects(
  identity.resolvePortalIdentityWithAdmin({ rpc: async () => ({ data: null, error: { code: 'XX000' } }) }, good.profileId, 'active'),
  (error) => error.status === 503,
);

console.log('Service-agreement v3 runtime and canonical portal gate assertions passed.');
