import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const portal = require('../netlify/functions/portal-service-agreement.cjs');
const agreementCore = require('../netlify/functions/_serviceAgreement.cjs');
const { PDFDocument } = require('pdf-lib');

const ids = {
  portalUser: '10000000-0000-4000-8000-000000000001',
  profile: '20000000-0000-4000-8000-000000000002',
  client: '30000000-0000-4000-8000-000000000003',
  firm: '40000000-0000-4000-8000-000000000004',
  agreement: '50000000-0000-4000-8000-000000000005',
  template: '60000000-0000-4000-8000-000000000006',
};
const template = {
  id: ids.template,
  version: agreementCore.AGREEMENT_TEMPLATE_VERSION,
  title: 'CCC Client Service Agreement',
  legal_status: 'approved',
  packet_kind: agreementCore.SERVICE_ONLY_PACKET_KIND,
  body_html: '<h2>Approved terms</h2><p>Exact agreement body.</p>',
  consumer_disclosure_html: '<h2>Consumer Credit File Rights</h2><p>Exact separate disclosure.</p>',
  cancellation_notice_html: '<h2>Notice of Cancellation</h2><p>Cancel before {{cancellation_date}}.</p>',
  cancellation_calendar_kind: agreementCore.CANCELLATION_CALENDAR_KIND,
};
const snapshot = {
  templateVersion: template.version,
  packetKind: template.packet_kind,
  agreementBodyHtml: template.body_html,
  consumerDisclosureHtml: template.consumer_disclosure_html,
  cancellationNoticeHtml: template.cancellation_notice_html,
  cancellationCalendarKind: template.cancellation_calendar_kind,
  agreementBodyHash: agreementCore.sha256(template.body_html),
  consumerDisclosureHash: agreementCore.sha256(template.consumer_disclosure_html),
  cancellationNoticeHash: agreementCore.sha256(template.cancellation_notice_html),
  preparedAt: '2026-08-20T12:00:00.000Z',
};
const plan = {
  mode: 'tier', billingTier: 'Standard', label: 'Standard', amount: 149,
  monthlyFee: 149, flatFee: null, flatMonths: null, firstMonthlyPayment: 149,
  feeText: '$149/month.',
  serviceTerm: 'month-to-month service plan',
  pricingVersion: agreementCore.ACTIVE_PRICING_VERSION,
};
const preparedAgreement = {
  id: ids.agreement,
  user_id: ids.firm,
  client_id: ids.client,
  template_id: ids.template,
  template_version: template.version,
  status: 'sent',
  plan_snapshot: plan,
  client_snapshot: { name: 'Jane Client', email: 'jane@example.com', phone: null, address: null },
  document_snapshot: snapshot,
  signing_expires_at: '2099-08-27T12:00:00.000Z',
  sent_at: '2026-08-20T12:00:00.000Z',
};
const idHash = 'a'.repeat(64);
const addressHash = 'b'.repeat(64);
const documentRows = [
  { id: '70000000-0000-4000-8000-000000000007', user_id: ids.firm, client_id: ids.client, doc_type: 'id', storage_path: `${ids.firm}/${ids.client}/identity/id-${idHash.slice(0, 16)}.png`, content_type: 'image/png', byte_size: 1234, sha256: idHash },
  { id: '80000000-0000-4000-8000-000000000008', user_id: ids.firm, client_id: ids.client, doc_type: 'address', storage_path: `${ids.firm}/${ids.client}/identity/address-${addressHash.slice(0, 16)}.pdf`, content_type: 'application/pdf', byte_size: 2345, sha256: addressHash },
];

const VALID_SIGNATURE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAADwAAAASAQMAAAA9lC93AAAABlBMVEUPFyoAAABJfg/SAAAAAnRSTlP/AOW3MEoAAAA9SURBVHicRY3BEQBABAPTgf671EGOCOdh1g4BUJVAGBIGjioY1V2qQUqt1U2zWepOHIe4XAOB/5yruGrhAe+sd5h85pHqAAAAAElFTkSuQmCC';

function pngDataUrl() {
  return `data:image/png;base64,${VALID_SIGNATURE_PNG_BASE64}`;
}

function malformedPngDataUrl() {
  const bytes = Buffer.alloc(140, 1);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function makeHarness({ templateOverride = {}, documents = documentRows } = {}) {
  const uploads = [];
  const rpcCalls = [];
  const claimCalls = [];
  const identityModes = [];
  const rest = async (path, method, body) => {
    if (path === '/rest/v1/rpc/ccc_resolve_canonical_portal_identity' && method === 'POST') {
      identityModes.push(body.p_access_mode);
      return { profileId: ids.profile, clientId: ids.client, firmUserId: ids.firm };
    }
    if (path.includes('/client_profiles?')) return [{
      id: ids.profile, user_id: ids.portalUser, client_id: ids.client,
      full_name: 'Jane Client', email: 'jane@example.com', onboarding_complete: false, agreement_signed_at: null,
    }];
    if (path.includes('/clients?')) return [{ id: ids.client, user_id: ids.firm }];
    if (path.includes('/client_service_agreements?') && path.includes('status=eq.signed')) return [];
    if (path.includes('/client_service_agreements?') && path.includes('status=eq.sent')) return [preparedAgreement];
    if (path.includes('/service_agreement_templates?')) return [{ ...template, ...templateOverride }];
    if (path.includes('/documents?')) return documents;
    if (path === '/rest/v1/rpc/ccc_claim_portal_service_agreement_signing' && method === 'POST') {
      claimCalls.push(body);
      return '2026-08-20T18:00:00.000Z';
    }
    if (path === '/rest/v1/rpc/ccc_finalize_portal_service_agreement' && method === 'POST') {
      rpcCalls.push(body);
      return ids.agreement;
    }
    throw new Error(`Unexpected REST call: ${method} ${path}`);
  };
  const handler = portal._test.createPortalServiceAgreementHandler({
    requireAuth: async () => ({ userId: ids.portalUser, email: 'jane@example.com' }),
    rest,
    upload: async (path, bytes, contentType) => uploads.push({ path, bytes, contentType }),
    objectExists: async () => true,
    objectIntegrity: async (path) => {
      const row = documents.find((document) => document.storage_path === path);
      return row ? { byteSize: Number(row.byte_size), sha256: row.sha256, contentType: row.content_type } : null;
    },
    now: () => '2026-08-20T18:00:00.000Z',
    buildCancellationPdf: async () => Buffer.from('%PDF-1.7\nTWO COMPLETED COPIES'),
  });
  return { handler, uploads, rpcCalls, claimCalls, identityModes };
}

function request(action, extra = {}) {
  return {
    httpMethod: 'POST',
    headers: {
      authorization: 'Bearer verified-client-session',
      'user-agent': 'CCC test',
      'x-nf-client-connection-ip': '198.51.100.77',
      'x-forwarded-for': '203.0.113.4, 10.0.0.2',
    },
    body: JSON.stringify({ action, ...extra }),
  };
}

const priorUrl = process.env.VITE_SUPABASE_URL;
const priorKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';

try {
  assert.equal((await portal._test.signaturePngBytes(pngDataUrl()))?.length, 150,
    'a fully decodable signature PNG containing visible ink must be accepted');
  assert.equal(await portal._test.signaturePngBytes(malformedPngDataUrl()), null,
    'a header-only payload without decodable PNG chunks must be rejected');
  assert.equal(portal._test.requestClientIp({
    headers: {
      'x-nf-client-connection-ip': '198.51.100.77',
      'x-forwarded-for': '203.0.113.4, 10.0.0.2',
    },
  }), '198.51.100.77', 'Netlify\'s canonical client IP must win over proxy-chain input');
  assert.equal(portal._test.requestClientIp({
    headers: { 'x-nf-client-connection-ip': 'not-an-ip', 'x-forwarded-for': '203.0.113.4, invalid' },
  }), '203.0.113.4', 'the proxy-chain fallback must accept only a syntactically valid IP');
  assert.equal(portal._test.requestClientIp({
    headers: { 'x-nf-client-connection-ip': 'not-an-ip', 'x-forwarded-for': 'also-invalid' },
  }), null, 'invalid audit IP evidence must be omitted rather than persisted');

  assert.equal(portal._test.canonicalIdentityDocument(documentRows[0], {
    firmUserId: ids.firm, clientId: ids.client, kind: 'id',
  }), true);
  assert.equal(portal._test.canonicalIdentityDocument({ ...documentRows[0], storage_path: `${ids.firm}/${ids.client}/identity/id.png` }, {
    firmUserId: ids.firm, clientId: ids.client, kind: 'id',
  }), false, 'new signed packets must reject overwriteable legacy identity paths');
  assert.equal(portal._test.canonicalIdentityDocument({ ...documentRows[0], sha256: 'c'.repeat(64) }, {
    firmUserId: ids.firm, clientId: ids.client, kind: 'id',
  }), false, 'the path prefix must be bound to the full registry digest');

  const cancellationPdf = await portal._test.buildCancellationPdf({
    clientName: 'Jane Client',
    signedAt: '2026-08-20T18:00:00.000Z',
    cancellationDateLabel: 'August 25, 2026',
    noticeHtml: template.cancellation_notice_html,
  });
  assert.match(cancellationPdf.subarray(0, 8).toString('ascii'), /^%PDF-/);
  assert.equal((await PDFDocument.load(cancellationPdf)).getPageCount(), 2, 'the cancellation artifact must contain two completed copies');

  const loadHarness = makeHarness();
  const loaded = await loadHarness.handler(request('load'));
  assert.equal(loaded.statusCode, 200);
  const loadedBody = JSON.parse(loaded.body);
  assert.equal(loadedBody.agreement.id, ids.agreement);
  assert.equal(loadedBody.agreement.clientName, 'Jane Client');
  assert.deepEqual(loadedBody.agreement.plan, plan, 'the prepared price snapshot must be returned exactly');
  assert.equal(loadedBody.agreement.serviceAgreementHtml, snapshot.agreementBodyHtml);
  assert.equal(loadedBody.agreement.consumerDisclosureHtml, snapshot.consumerDisclosureHtml);
  assert.equal(loadedBody.agreement.cancellationNoticeHtml, snapshot.cancellationNoticeHtml);
  assert.deepEqual(loadedBody.agreement.acknowledgementRequired, portal._test.REQUIRED_ACKNOWLEDGEMENTS);
  assert.deepEqual(loadHarness.identityModes, ['canonical', 'pre_sign_v3'],
    'wizard source data requires both the canonical identity gate and one exact sent v3 packet');

  const missingAck = await makeHarness().handler(request('sign', {
    agreementId: ids.agreement,
    templateVersion: template.version,
    hashes: {
      agreementBodyHash: snapshot.agreementBodyHash,
      consumerDisclosureHash: snapshot.consumerDisclosureHash,
      cancellationNoticeHash: snapshot.cancellationNoticeHash,
    },
    acknowledgements: { service_agreement: true, consumer_rights_disclosure: true, electronic_records: true },
    signatureData: pngDataUrl(),
  }));
  assert.equal(missingAck.statusCode, 400, 'both cancellation copies must be acknowledged');

  const noAddressHarness = makeHarness({ documents: documentRows.slice(0, 1) });
  const noAddress = await noAddressHarness.handler(request('sign', {
    agreementId: ids.agreement,
    templateVersion: template.version,
    hashes: {
      agreementBodyHash: snapshot.agreementBodyHash,
      consumerDisclosureHash: snapshot.consumerDisclosureHash,
      cancellationNoticeHash: snapshot.cancellationNoticeHash,
    },
    acknowledgements: Object.fromEntries(portal._test.REQUIRED_ACKNOWLEDGEMENTS.map((name) => [name, true])),
    signatureData: pngDataUrl(),
  }));
  assert.equal(noAddress.statusCode, 409, 'proof of address must be present server-side');
  assert.equal(noAddressHarness.uploads.length, 0);
  assert.equal(noAddressHarness.rpcCalls.length, 0);

  const blocked = await makeHarness({ templateOverride: { legal_status: 'counsel_review' } }).handler(request('load'));
  assert.equal(blocked.statusCode, 409, 'unapproved template must fail closed');

  const successHarness = makeHarness();
  const signed = await successHarness.handler(request('sign', {
    agreementId: ids.agreement,
    templateVersion: template.version,
    hashes: {
      agreementBodyHash: snapshot.agreementBodyHash,
      consumerDisclosureHash: snapshot.consumerDisclosureHash,
      cancellationNoticeHash: snapshot.cancellationNoticeHash,
    },
    acknowledgements: Object.fromEntries(portal._test.REQUIRED_ACKNOWLEDGEMENTS.map((name) => [name, true])),
    signatureData: pngDataUrl(),
    clientId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    plan: { label: 'Attacker plan' },
    serviceAgreementHtml: '<p>Attacker body</p>',
  }));
  assert.equal(signed.statusCode, 200);
  const signedBody = JSON.parse(signed.body);
  assert.equal(signedBody.paymentCollected, false);
  assert.equal(signedBody.documents.agreement.contentType, 'text/html');
  assert.equal(signedBody.documents.disclosure.contentType, 'text/html');
  assert.equal(signedBody.documents.cancellation.contentType, 'application/pdf');
  assert.ok(signedBody.documents.cancellation.dataBase64, 'the client must receive the two-copy cancellation PDF immediately');
  assert.equal(successHarness.uploads.length, 3, 'agreement, disclosure, and two-copy cancellation PDF must all be stored');
  assert.equal(new Set(successHarness.uploads.map((item) => item.path)).size, 3, 'signed artifact paths must be distinct');
  for (const upload of successHarness.uploads) {
    assert.match(upload.path, new RegExp(`^${ids.firm}/${ids.client}/agreements/${ids.agreement}/`));
  }
  assert.equal(successHarness.uploads.filter((item) => item.contentType === 'application/pdf').length, 1);
  assert.equal(successHarness.claimCalls.length, 1, 'the immutable signing time/signature hash must be claimed before uploads');
  assert.deepEqual(successHarness.identityModes, ['canonical', 'pre_sign_v3']);
  assert.equal(successHarness.claimCalls[0].p_portal_user_id, ids.portalUser);
  assert.match(successHarness.claimCalls[0].p_signature_sha256, /^[0-9a-f]{64}$/);
  assert.equal(successHarness.rpcCalls.length, 1);
  const final = successHarness.rpcCalls[0];
  assert.equal(final.p_portal_user_id, ids.portalUser);
  assert.equal(final.p_profile_id, ids.profile);
  assert.equal(final.p_client_id, ids.client, 'canonical profile client id must win over request data');
  assert.equal(final.p_plan_snapshot, plan, 'prepared plan must win over request data');
  assert.equal(final.p_document_snapshot, snapshot, 'prepared document snapshot must be finalized byte-for-byte');
  assert.equal(final.p_signed_at, '2026-08-20T18:00:00.000Z', 'finalization must use the server-claimed signing time');
  assert.equal(final.p_ip_address, '198.51.100.77', 'immutable signing evidence must use Netlify\'s validated client IP');
  assert.equal(final.p_event_data.signatureSha256, successHarness.claimCalls[0].p_signature_sha256);
  assert.equal(final.p_event_data.acknowledgements.cancellation_notices_received, true);
  assert.equal(final.p_event_data.cancellationCopiesDelivered, 2);
  assert.equal(final.p_event_data.paymentCollected, false, 'onboarding must never trigger payment');
  assert.deepEqual(final.p_event_data.identityDocuments.governmentId, {
    id: documentRows[0].id,
    path: documentRows[0].storage_path,
    contentType: documentRows[0].content_type,
    byteSize: documentRows[0].byte_size,
    sha256: documentRows[0].sha256,
  });

  const componentSource = fs.readFileSync(new URL('../src/components/ClientSetupFlow.jsx', import.meta.url), 'utf8');
  const endpointSource = fs.readFileSync(new URL('../netlify/functions/portal-service-agreement.cjs', import.meta.url), 'utf8');
  assert.doesNotMatch(componentSource, /skip for now/i, 'required document steps cannot be skipped');
  assert.doesNotMatch(componentSource, /limited power of attorney|certified mail|480-913-9172/i);
  assert.doesNotMatch(endpointSource, /lpoaSignaturePath|lpoaDocumentPath|lpoa_signed|certified mail/i);
  assert.ok(
    endpointSource.indexOf('ccc_claim_portal_service_agreement_signing') < endpointSource.indexOf('await deps.upload(signedDocumentPath'),
    'the signing claim must be established before any immutable artifact upload',
  );
  assert.match(endpointSource, /storage\/v1\/object\/authenticated/);
  assert.match(endpointSource, /timingSafeEqual/);
  assert.match(componentSource, /kind:\s*'id'/);
  assert.match(componentSource, /kind:\s*'address'/);
  assert.doesNotMatch(componentSource, /kind:\s*'signature'|kind:\s*'lpoa'/);
  assert.match(componentSource, /970-644-0063/);
  assert.match(componentSource, /sanitizeDisclosurePresentationHtml/);
  assert.match(componentSource, /ccc-statutory-disclosure/);
  assert.equal(
    (componentSource.match(/<AgreementDocument title="Client Service Agreement"/g) || []).length,
    1,
    'the agreement must render exactly once in wizard step 1',
  );

  console.log('Portal service-agreement assertions passed.');
} finally {
  if (priorUrl === undefined) delete process.env.VITE_SUPABASE_URL;
  else process.env.VITE_SUPABASE_URL = priorUrl;
  if (priorKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = priorKey;
}
