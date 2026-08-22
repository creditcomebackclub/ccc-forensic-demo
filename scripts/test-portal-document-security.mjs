import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const upload = require('../netlify/functions/portal-enroll-upload.cjs');
const resolver = require('../netlify/functions/_agreementDocument.cjs');
const urlEndpoint = require('../netlify/functions/portal-agreement-url.cjs');
const viewEndpoint = require('../netlify/functions/portal-agreement-view.cjs');
const tokenCore = require('../netlify/functions/_agreementViewToken.cjs');
const storagePaths = require('../netlify/functions/_storagePaths.cjs');

const ids = {
  portal: '10000000-0000-4000-8000-000000000001',
  profile: '20000000-0000-4000-8000-000000000002',
  client: '30000000-0000-4000-8000-000000000003',
  firm: '40000000-0000-4000-8000-000000000004',
  agreement: '50000000-0000-4000-8000-000000000005',
};
const hash = 'a'.repeat(64);
const paths = {
  agreement: `${ids.firm}/${ids.client}/agreements/${ids.agreement}/signed-packet.html`,
  disclosure: `${ids.firm}/${ids.client}/agreements/${ids.agreement}/consumer-rights-disclosure.html`,
  cancellation: `${ids.firm}/${ids.client}/agreements/${ids.agreement}/notice-of-cancellation-two-copies.pdf`,
  legacy: `${ids.firm}/${ids.client}/lpoa/lpoa-signed.html`,
};

function fakeAdmin(overrides = {}) {
  const rows = {
    client_profiles: [{
      id: ids.profile, user_id: ids.portal, client_id: ids.client, full_name: 'Jane Client', email: 'jane@example.com',
      lpoa_storage_bucket: 'documents', lpoa_storage_path: paths.legacy,
    }],
    clients: [{ id: ids.client, user_id: ids.firm, email: 'jane@example.com', lpoa_signed: true }],
    client_service_agreements: [{
      id: ids.agreement, client_id: ids.client, user_id: ids.firm, status: 'signed',
      template_version: 'ccc-service-agreement-v2-service-only', signed_at: '2026-08-20T18:00:00.000Z',
      signed_document_path: paths.agreement, signed_document_hash: hash,
      signed_disclosure_path: paths.disclosure, signed_disclosure_hash: hash,
      signed_cancellation_path: paths.cancellation, signed_cancellation_hash: hash,
    }],
    ...overrides,
  };
  const existing = new Set(Object.values(paths));
  return {
    async rpc(name, args) {
      assert.equal(name, 'ccc_resolve_canonical_portal_identity');
      assert.equal(args.p_access_mode, 'active');
      const profiles = (rows.client_profiles || []).filter((row) => row.user_id === args.p_portal_user_id);
      const client = profiles.length === 1
        ? (rows.clients || []).find((row) => row.id === profiles[0].client_id)
        : null;
      const clientPeers = client
        ? (rows.client_profiles || []).filter((row) => row.client_id === client.id)
        : [];
      const active = client && (rows.client_service_agreements || []).some((row) => (
        row.client_id === client.id && row.user_id === client.user_id && row.status === 'signed'
      ));
      if (profiles.length !== 1 || clientPeers.length !== 1 || !client || !active) {
        return { data: null, error: { code: '42501' } };
      }
      return {
        data: { profileId: profiles[0].id, clientId: client.id, firmUserId: client.user_id },
        error: null,
      };
    },
    from(table) {
      const filters = [];
      let ordered = null;
      const chain = {
        select() { return chain; },
        eq(column, value) { filters.push([column, value]); return chain; },
        order(column, options) { ordered = [column, options]; return chain; },
        limit(count) {
          let data = [...(rows[table] || [])].filter((row) => filters.every(([column, value]) => row[column] === value));
          if (ordered) {
            const [column, options] = ordered;
            data.sort((a, b) => String(a[column] || '').localeCompare(String(b[column] || '')) * (options?.ascending === false ? -1 : 1));
          }
          return Promise.resolve({ data: data.slice(0, count), error: null });
        },
      };
      return chain;
    },
    storage: {
      from() {
        return {
          async list(dir, { search }) {
            const full = `${dir}/${search}`;
            return { data: existing.has(full) ? [{ name: search }] : [], error: null };
          },
        };
      },
    },
  };
}

// File bytes, not browser claims, determine what can be stored.
const png = Buffer.alloc(32, 0);
Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
const decodedPng = upload._test.decodeStrictBase64(`data:image/png;base64,${png.toString('base64')}`);
assert.equal(upload._test.detectFile(decodedPng.buffer).contentType, 'image/png');
assert.equal(decodedPng.dataUrlType, 'image/png');
assert.equal(upload._test.detectFile(Buffer.from('<script>not a PDF</script>')), null);
assert.equal(upload._test.normalizeClaimedType('image/jpg; charset=binary'), 'image/jpeg');
assert.throws(() => upload._test.decodeStrictBase64('%%%%'), /valid base64/i);
assert.deepEqual([...upload._test.KINDS].sort(), ['address', 'id']);
assert.equal(upload._test.safeOriginalName('../../unsafe\u0000.pdf', 'id.pdf'), 'unsafe.pdf');
assert.equal(
  storagePaths.identityDocPath(ids.firm, ids.client, 'id', 'png', hash),
  `${ids.firm}/${ids.client}/identity/id-${hash.slice(0, 16)}.png`,
);
assert.equal(
  storagePaths.identityDocPath(ids.firm, ids.client, 'id', 'png'),
  `${ids.firm}/${ids.client}/identity/id.png`,
  'omitting the hash must preserve legacy path compatibility',
);
assert.throws(() => storagePaths.identityDocPath(ids.firm, ids.client, 'id', 'png', 'bad-hash'), /lowercase SHA-256/i);

// One exact Auth profile owns one exact CRM client. Ambiguous/missing linkage
// fails closed, and the latest signed versioned packet wins over legacy LPOA.
const agreement = await resolver.resolveAgreementDocument(fakeAdmin(), ids.portal, 'agreement');
assert.equal(agreement.document.agreementId, ids.agreement);
assert.equal(agreement.document.path, paths.agreement, 'versioned agreement must win over historical LPOA');
assert.equal(agreement.document.legacy, false);
const cancellation = await resolver.resolveAgreementDocument(fakeAdmin(), ids.portal, 'cancellation');
assert.equal(cancellation.document.path, paths.cancellation);
assert.equal(cancellation.document.contentType, 'application/pdf');
assert.equal((await resolver.resolveAgreementDocument(fakeAdmin(), ids.portal, 'lpoa')).invalidKind, true);
const ambiguous = await resolver.resolveAgreementDocument(fakeAdmin({
  client_profiles: [
    { id: ids.profile, user_id: ids.portal, client_id: ids.client },
    { id: '60000000-0000-4000-8000-000000000006', user_id: ids.portal, client_id: '70000000-0000-4000-8000-000000000007' },
  ],
}), ids.portal, 'agreement');
assert.equal(ambiguous.profileMissing, true, 'ambiguous portal identity must not select the first profile');
const crossClient = await resolver.resolveAgreementDocument(fakeAdmin({ clients: [] }), ids.portal, 'agreement');
assert.equal(crossClient.document, null, 'a profile cannot fall back to a different client by name or email');

// The short-lived HMAC covers user + bucket + agreement + kind + path + hash.
const descriptor = urlEndpoint.encodeArtifactDescriptor(cancellation.document);
const signedToken = tokenCore.createAgreementViewToken(ids.portal, 'documents', descriptor, 'test-secret', 1000);
const claims = tokenCore.verifyAgreementViewToken(signedToken, 'test-secret', 1001);
const decodedDescriptor = viewEndpoint.decodeArtifactDescriptor(claims.path);
assert.deepEqual(decodedDescriptor, {
  agreementId: ids.agreement, kind: 'cancellation', path: paths.cancellation, hash,
});
assert.equal(viewEndpoint.sameArtifact(cancellation.document, claims, decodedDescriptor), true);
assert.equal(viewEndpoint.sameArtifact({ ...cancellation.document, path: paths.agreement }, claims, decodedDescriptor), false);
const pdfBytes = Buffer.from('%PDF-1.7\nimmutable cancellation evidence', 'utf8');
const pdfResponse = viewEndpoint.artifactResponse(cancellation.document, pdfBytes);
assert.equal(pdfResponse.statusCode, 200);
assert.equal(pdfResponse.headers['Content-Type'], 'application/pdf');
assert.equal(pdfResponse.isBase64Encoded, true, 'Netlify must decode the PDF body into real binary bytes');
assert.deepEqual(Buffer.from(pdfResponse.body, 'base64'), pdfBytes);
assert.equal(
  viewEndpoint.artifactResponse(cancellation.document, Buffer.from('<html>not pdf</html>')).statusCode,
  409,
  'a cancellation artifact with non-PDF bytes must fail closed',
);
const [signedPayload, signedSignature] = signedToken.split('.');
const tamperedPayload = (signedPayload[0] === 'A' ? 'B' : 'A') + signedPayload.slice(1) + '.' + signedSignature;
assert.equal(tokenCore.verifyAgreementViewToken(tamperedPayload, 'test-secret', 1001), null);

const uploadSource = readFileSync(new URL('../netlify/functions/portal-enroll-upload.cjs', import.meta.url), 'utf8');
const resolverSource = readFileSync(new URL('../netlify/functions/_agreementDocument.cjs', import.meta.url), 'utf8');
const urlSource = readFileSync(new URL('../netlify/functions/portal-agreement-url.cjs', import.meta.url), 'utf8');
const viewSource = readFileSync(new URL('../netlify/functions/portal-agreement-view.cjs', import.meta.url), 'utf8');
const portalSource = readFileSync(new URL('../src/components/ClientPortal.jsx', import.meta.url), 'utf8');
const documentsSource = readFileSync(new URL('../src/components/client-portal/DocumentsTab.jsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260820275000_portal_document_integrity.sql', import.meta.url), 'utf8');

assert.doesNotMatch(uploadSource, /client_profiles\?email=|clients\?email=|clients\?name=|limit=1/);
assert.doesNotMatch(uploadSource, /lpoa_signed|lpoaSignaturePath|lpoaDocumentPath|buildLpoaSignatureRecord|attorney/i);
assert.match(uploadSource, /content_type:\s*detected\.contentType[\s\S]*byte_size:\s*buffer\.length[\s\S]*sha256/);
assert.match(uploadSource, /'x-upsert':\s*'false'/);
assert.match(uploadSource, /existingHash !== sha256/);
assert.match(resolverSource, /\.eq\('user_id', client\.user_id\)/);
assert.match(urlSource, /agreementId:[\s\S]*kind:[\s\S]*path:[\s\S]*hash:/);
assert.match(viewSource, /isBase64Encoded:\s*true/);
assert.match(viewSource, /actualHash !== resolved\.document\.hash/);
assert.match(portalSource, /SIGNED_ARTIFACT_KINDS = \['agreement', 'disclosure', 'cancellation'\]/);
assert.doesNotMatch(portalSource, /signedAgreementAvailable=\{true\}/);
assert.match(documentsSource, /Cancellation Notice \(2 copies\)/);
assert.doesNotMatch(documentsSource, /LPOA|Power of Attorney/i);
assert.match(migration, /add column if not exists content_type text/);
assert.match(migration, /add column if not exists byte_size bigint/);
assert.match(migration, /add column if not exists sha256 text/);
assert.match(migration, /\^\[0-9a-f\]\{64\}\$/);
assert.match(migration, /ccc_is_immutable_portal_artifact_path/);
assert.match(migration, /\[3\] = 'agreements'/);
assert.match(migration, /\[3\] = 'identity'[\s\S]*storage\.filename\(object_name\)[\s\S]*\^\(id\|address\)-\[0-9a-f\]\{16\}/);
assert.match(migration, /drop policy if exists "client_insert_documents_storage"/);
assert.match(migration, /drop policy if exists "client_update_documents_storage"/);
assert.match(migration, /drop policy if exists "client_delete_documents_storage"/);
assert.match(migration, /staff_update_documents_storage[\s\S]*not public\.ccc_is_immutable_portal_artifact_path\(name\)/);
assert.match(migration, /staff_delete_documents_storage[\s\S]*not public\.ccc_is_immutable_portal_artifact_path\(name\)/);
assert.match(migration, /client_select_documents_storage[\s\S]*\[3\] is distinct from 'agreements'/);

console.log('Portal document security assertions passed.');
