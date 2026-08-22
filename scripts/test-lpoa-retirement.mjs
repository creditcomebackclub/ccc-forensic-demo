import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const retiredSigner = require('../netlify/functions/sign-lpoa.cjs');
const retiredAgreementSigner = require('../netlify/functions/agreement-sign.cjs');
const retiredEnrollmentComplete = require('../netlify/functions/portal-enrollment-complete.cjs');
const retiredLpoaAudit = require('../netlify/functions/record-lpoa-audit.cjs');
const retiredAgreementUrl = require('../netlify/functions/agreement-document-url.cjs');
const agreementResolver = require('../netlify/functions/_agreementDocument.cjs');

const functionResponse = await retiredSigner.handler({ httpMethod: 'POST' });
assert.equal(functionResponse.statusCode, 410);
assert.equal(functionResponse.headers['Content-Type'], 'text/plain; charset=utf-8');
assert.equal(functionResponse.headers['Cache-Control'], 'no-store');
assert.match(functionResponse.body, /secure service-agreement onboarding wizard/i);
assert.equal(
  (await retiredSigner.handler({ httpMethod: 'GET' })).statusCode,
  410,
  'every request method to the retired function must stay gone',
);
const agreementFunctionResponse = await retiredAgreementSigner.handler({ httpMethod: 'POST' });
assert.equal(agreementFunctionResponse.statusCode, 410);
assert.equal(agreementFunctionResponse.headers['Content-Type'], 'text/plain; charset=utf-8');
assert.equal(agreementFunctionResponse.headers['Cache-Control'], 'no-store');
assert.match(agreementFunctionResponse.body, /secure service-agreement onboarding wizard/i);

for (const [name, handler, guidance] of [
  ['portal-enrollment-complete', retiredEnrollmentComplete, /secure service-agreement wizard/i],
  ['record-lpoa-audit', retiredLpoaAudit, /historical authorization evidence/i],
  ['agreement-document-url', retiredAgreementUrl, /active portal document viewer/i],
]) {
  const response = await handler.handler({ httpMethod: 'POST' });
  assert.equal(response.statusCode, 410, `${name} must remain permanently retired`);
  assert.equal(response.headers['Content-Type'], 'text/plain; charset=utf-8');
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.match(response.body, guidance);
  assert.equal((await handler.handler({ httpMethod: 'GET' })).statusCode, 410,
    `${name} must not expose an alternate request method`);
}

const publicPage = readFileSync(new URL('../public/sign-lpoa.html', import.meta.url), 'utf8');
const publicAgreementPage = readFileSync(new URL('../public/sign-agreement.html', import.meta.url), 'utf8');
const netlifyConfig = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
const clientsPage = readFileSync(new URL('../src/components/ClientsPage.jsx', import.meta.url), 'utf8');
const inboxPage = readFileSync(new URL('../src/components/InboxPage.jsx', import.meta.url), 'utf8');
const retiredEscalationPanelUrl = new URL('../src/components/EscalationPanel.jsx', import.meta.url);
const resolverSource = readFileSync(new URL('../netlify/functions/_agreementDocument.cjs', import.meta.url), 'utf8');
const signerSource = readFileSync(new URL('../netlify/functions/sign-lpoa.cjs', import.meta.url), 'utf8');
const agreementSignerSource = readFileSync(new URL('../netlify/functions/agreement-sign.cjs', import.meta.url), 'utf8');
const retiredHandlerSources = [
  '../netlify/functions/portal-enrollment-complete.cjs',
  '../netlify/functions/record-lpoa-audit.cjs',
  '../netlify/functions/agreement-document-url.cjs',
].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'));

assert.match(publicPage, /signing route has retired/i);
assert.match(publicPage, /secure service-agreement onboarding wizard/i);
assert.doesNotMatch(publicPage, /<form|<button|<script|fetch\s*\(|href\s*=/i,
  'the legacy public page must not contain an active signing or navigation control');
assert.match(publicAgreementPage, /signing route has retired/i);
assert.match(publicAgreementPage, /secure service-agreement onboarding wizard/i);
assert.doesNotMatch(publicAgreementPage, /<form|<button|<script|fetch\s*\(|href\s*=/i,
  'the legacy combined-agreement page must not contain an active signing or navigation control');
assert.doesNotMatch(signerSource, /SUPABASE|storage|clients\?|signatureData|lpoa_signed/i,
  'the retired function must not read, write, or mutate historical evidence');
assert.doesNotMatch(agreementSignerSource, /SUPABASE|storage|clients\?|signatureData|lpoa_signed/i,
  'the retired combined-agreement function must not read, write, or mutate historical evidence');
for (const source of retiredHandlerSources) {
  assert.doesNotMatch(source, /requireAuth|SUPABASE|fetch\s*\(|storage|\.from\(|\.rpc\(/i,
    'a retired handler must be a data-free 410 tombstone');
}

const spaFallbackStart = netlifyConfig.indexOf('from = "/*"');
for (const [publicPath, functionName] of [
  ['/sign-lpoa.html', 'sign-lpoa'],
  ['/sign-agreement.html', 'agreement-sign'],
]) {
  const redirectStart = netlifyConfig.indexOf(`from = "${publicPath}"`);
  assert(redirectStart >= 0, `${publicPath} must proxy to its retired function`);
  assert(redirectStart < spaFallbackStart, `${publicPath} must retire before the SPA fallback`);
  const nextBlock = netlifyConfig.indexOf('[[redirects]]', redirectStart);
  const redirectBlock = netlifyConfig.slice(redirectStart, nextBlock < 0 ? spaFallbackStart : nextBlock);
  assert.match(redirectBlock, new RegExp(`to = "\\/\\.netlify\\/functions\\/${functionName}"`));
  assert.match(redirectBlock, /status = 200[\s\S]*force = true/,
    `${publicPath} must be internally rewritten so the function can return HTTP 410`);
}

assert.doesNotMatch(clientsPage,
  /resolveLpoaViewUrl|viewSignedLpoa|View signed LPOA|Copy Signature Link|sign-lpoa\.html|>\s*✓ LPOA\s*</i,
  'the staff client UI must not expose legacy authorization actions or badges');
assert.doesNotMatch(inboxPage, /Needs LPOA|LPOA signature|lpoa_signed/i,
  'the active work queue must be driven by service onboarding, not a retired authorization');
assert.match(inboxPage, /Needs Onboarding/);
assert.match(inboxPage, /engagement_status/);
assert.equal(existsSync(retiredEscalationPanelUrl), false,
  'the retired escalation composer must remain absent from the active application');
assert.doesNotMatch(clientsPage, /EscalationPanel|openEscalation|CFPB \/ State AG Escalation/i,
  'the staff client UI must not import or expose the retired escalation composer');
assert.doesNotMatch(resolverSource,
  /lpoaDocumentPath|lpoa_storage|lpoa_signed|legacy-profile|legacy-portal/i,
  'the active portal agreement resolver must not fall back to historical authorization artifacts');

let storageReads = 0;
const PORTAL_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = '22222222-2222-4222-8222-222222222222';
const CLIENT_ID = '33333333-3333-4333-8333-333333333333';
const FIRM_ID = '44444444-4444-4444-8444-444444444444';
const historicPath = `${FIRM_ID}/${CLIENT_ID}/lpoa/lpoa-signed.html`;
const historicAgreementRows = [];
const historicOnlyAdmin = {
  async rpc(name, params) {
    assert.equal(name, 'ccc_resolve_canonical_portal_identity');
    assert.deepEqual(params, { p_portal_user_id: PORTAL_ID, p_access_mode: 'active' });
    return {
      data: [{ profileId: PROFILE_ID, clientId: CLIENT_ID, firmUserId: FIRM_ID }],
      error: null,
    };
  },
  from(table) {
    const rows = {
      client_profiles: [{
        id: PROFILE_ID, user_id: PORTAL_ID, client_id: CLIENT_ID, full_name: 'Historic Client',
        lpoa_storage_bucket: 'documents', lpoa_storage_path: historicPath,
      }],
      clients: [{ id: CLIENT_ID, user_id: FIRM_ID, lpoa_signed: true }],
      client_service_agreements: historicAgreementRows,
    };
    const filters = [];
    const chain = {
      select() { return chain; },
      eq(column, value) { filters.push([column, value]); return chain; },
      order() { return chain; },
      limit(count) {
        const data = (rows[table] || [])
          .filter((row) => filters.every(([column, value]) => row[column] === value))
          .slice(0, count);
        return Promise.resolve({ data, error: null });
      },
    };
    return chain;
  },
  storage: {
    from() {
      return {
        async list() {
          storageReads += 1;
          return { data: [{ name: 'lpoa-signed.html' }], error: null };
        },
      };
    },
  },
};

const historicOnly = await agreementResolver.resolveAgreementDocument(historicOnlyAdmin, PORTAL_ID, 'agreement');
assert.equal(historicOnly.document, null,
  'historical evidence alone must never become an active portal agreement download');
assert.equal(storageReads, 0,
  'the active resolver must not probe historical authorization storage');

historicAgreementRows.push({
  id: 'legacy-agreement-id',
  client_id: CLIENT_ID,
  user_id: FIRM_ID,
  status: 'signed',
  template_version: 'ccc-service-agreement-v1-draft',
  signed_at: '2026-08-01T12:00:00.000Z',
  signed_document_path: `${FIRM_ID}/${CLIENT_ID}/agreements/legacy-agreement-id/signed-packet.pdf`,
  signed_document_hash: 'a'.repeat(64),
});
const legacyCombined = await agreementResolver.resolveAgreementDocument(historicOnlyAdmin, PORTAL_ID, 'agreement');
assert.equal(legacyCombined.document, null,
  'a historical combined agreement must remain internal evidence, not an active portal download');
assert.equal(legacyCombined.artifactRetired, true);
assert.equal(storageReads, 0,
  'the resolver must reject a retired combined agreement before reading its stored bytes');

console.log('LPOA retirement assertions passed.');
