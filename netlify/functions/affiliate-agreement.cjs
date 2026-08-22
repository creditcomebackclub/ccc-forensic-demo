const net = require('net');
const { requireAuth } = require('./_requireAuth.cjs');
const { serviceHeaders, readJson, loadAffiliateForUser } = require('./_affiliateAccess.cjs');
const { sha256, stripHtml, buildSignedAgreementPdf } = require('./_affiliateAgreement.cjs');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

function clientIp(event) {
  const candidate = String(event.headers?.['x-nf-client-connection-ip'] || event.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return net.isIP(candidate) ? candidate : null;
}

function encodeStoragePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

async function rpc(url, key, name, body) {
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: serviceHeaders(key, { Prefer: 'return=representation' }), body: JSON.stringify(body),
  });
  const data = await readJson(res, null);
  if (!res.ok) {
    const error = new Error(data?.message || `Database request failed (${res.status})`);
    error.statusCode = res.status === 403 ? 403 : 409;
    throw error;
  }
  return data;
}

async function loadCurrentAgreement(url, key, affiliate) {
  if (!affiliate.current_agreement_id) return null;
  const res = await fetch(`${url}/rest/v1/affiliate_agreements?id=eq.${encodeURIComponent(affiliate.current_agreement_id)}&affiliate_id=eq.${encodeURIComponent(affiliate.id)}&portal_user_id=eq.${encodeURIComponent(affiliate.user_id)}&select=*&limit=1`, { headers: serviceHeaders(key) });
  const rows = await readJson(res, []);
  if (!res.ok) throw new Error('Could not load the partner agreement');
  return Array.isArray(rows) ? rows[0] : null;
}

function normalizeClaimedTimestamp(value) {
  const raw = typeof value === 'string' ? value : value?.signedAt;
  const timestamp = String(raw || '').trim();
  const postgresIsoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
  const parsed = new Date(timestamp);
  if (!postgresIsoTimestamp.test(timestamp) || Number.isNaN(parsed.getTime())) {
    throw new Error('The server returned an invalid signing timestamp');
  }
  // Do not round-trip through Date#toISOString: JavaScript only retains
  // milliseconds, while PostgreSQL timestamptz claims retain microseconds.
  return timestamp;
}

async function uploadImmutablePdf(url, key, path, bytes, expectedHash) {
  const res = await fetch(`${url}/storage/v1/object/documents/${encodeStoragePath(path)}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/pdf', 'Content-Length': String(bytes.length), 'x-upsert': 'false' },
    body: bytes,
  });
  if (res.ok) return { reused: false };

  const detail = await res.text().catch(() => '');
  const isExistingObject = res.status === 409 || (res.status === 400 && /already exists|duplicate/i.test(detail));
  if (!isExistingObject) throw new Error(`Could not store the immutable signed agreement (${res.status})`);

  const existing = await fetch(`${url}/storage/v1/object/documents/${encodeStoragePath(path)}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!existing.ok) throw new Error('Could not verify the existing immutable signed agreement');
  const existingBytes = Buffer.from(await existing.arrayBuffer());
  if (existingBytes.length !== bytes.length || sha256(existingBytes) !== expectedHash) {
    throw new Error('The existing signed agreement does not match this signing claim');
  }
  return { reused: true };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  let caller;
  try { caller = await requireAuth(event); }
  catch (error) { return error.statusCode ? error : json(500, { error: 'Authorization failed' }); }
  if (caller.isSystem) return json(403, { error: 'A partner session is required' });
  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  const action = payload.action || 'load';
  if (!['load', 'sign'].includes(action)) return json(400, { error: 'Unknown agreement action' });
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json(500, { error: 'Server not configured' });

  try {
    const affiliate = await loadAffiliateForUser({ url, key, userId: caller.userId });
    if (!affiliate) return json(403, { error: 'Partner identity is not linked.' });
    const agreement = await loadCurrentAgreement(url, key, affiliate);
    if (!agreement) return json(409, { error: 'No current partner agreement is available.' });
    const safeAgreement = {
      id: agreement.id,
      status: agreement.status,
      templateVersion: agreement.template_version,
      applicantName: agreement.applicant_snapshot?.name,
      company: agreement.applicant_snapshot?.company,
      commissionRate: agreement.compensation_snapshot?.commissionRate,
      compensationTerms: agreement.compensation_snapshot?.compensationTerms,
      agreementText: stripHtml(agreement.document_snapshot?.bodyHtml),
      sentAt: agreement.sent_at,
      viewedAt: agreement.viewed_at,
      signingExpiresAt: agreement.signing_expires_at,
      signedAt: agreement.signed_at,
      activatedAt: agreement.activated_at,
      programStatus: affiliate.program_status,
      hasPortalAccess: ['legacy_active', 'active'].includes(affiliate.program_status),
    };
    if (action === 'load') {
      if (!agreement.viewed_at && ['sent', 'signed', 'activated'].includes(agreement.status)) {
        const viewed = await rpc(url, key, 'ccc_mark_affiliate_agreement_viewed', {
          p_agreement_id: agreement.id, p_portal_user_id: caller.userId,
        });
        safeAgreement.viewedAt = viewed?.viewedAt || new Date().toISOString();
      }
      return json(200, safeAgreement);
    }
    if (!['sent', 'signed'].includes(agreement.status)) return json(409, { error: 'This agreement is not open for signing.' });
    if (agreement.status === 'sent' && new Date(agreement.signing_expires_at).getTime() <= Date.now()) return json(409, { error: 'This agreement expired. Ask Credit Comeback Club for a new packet.' });
    const signerName = String(payload.signerName || '').trim();
    if (signerName.length < 2 || signerName.length > 160) return json(400, { error: 'Enter your full legal name.' });
    const acknowledgements = payload.acknowledgements || {};
    if (acknowledgements.affiliate_agreement !== true || acknowledgements.compensation_terms !== true || acknowledgements.electronic_records !== true) {
      return json(400, { error: 'Accept the agreement, compensation terms, and electronic-signature disclosure.' });
    }
    const canonicalAcknowledgements = {
      affiliate_agreement: true,
      compensation_terms: true,
      electronic_records: true,
    };
    const signingMaterial = Buffer.from(JSON.stringify({
      agreementId: agreement.id,
      signerName,
      acknowledgements: canonicalAcknowledgements,
    }), 'utf8');
    const signingMaterialHash = sha256(signingMaterial);
    const claimedAt = await rpc(url, key, 'ccc_claim_affiliate_agreement_signing', {
      p_agreement_id: agreement.id,
      p_portal_user_id: caller.userId,
      p_signing_material_sha256: signingMaterialHash,
    });
    const signedAt = normalizeClaimedTimestamp(claimedAt);
    const ip = clientIp(event);
    const signatureClaim = Buffer.from(JSON.stringify({
      agreementId: agreement.id,
      signerName,
      signedAt,
      acknowledgements: canonicalAcknowledgements,
      signingMaterialHash,
    }), 'utf8');
    const signatureHash = sha256(signatureClaim);
    const pdf = await buildSignedAgreementPdf({ agreement, signerName, signedAt, ipAddress: ip });
    const path = `affiliate-agreements/${agreement.owner_user_id}/${affiliate.id}/${agreement.id}/${pdf.hash}-signed.pdf`;
    await uploadImmutablePdf(url, key, path, pdf.bytes, pdf.hash);
    const eventData = {
      acknowledgements: canonicalAcknowledgements,
      acceptedAt: signedAt,
      signatureMethod: 'typed_legal_name_with_explicit_electronic_consent',
      sourceDocumentHash: agreement.document_snapshot?.contentSha256,
      signingMaterialHash,
    };
    const completed = await rpc(url, key, 'ccc_complete_affiliate_agreement', {
      p_agreement_id: agreement.id,
      p_portal_user_id: caller.userId,
      p_signed_at: signedAt,
      p_signer_name: signerName,
      p_signer_ip: ip,
      p_user_agent: event.headers?.['user-agent'] || null,
      p_signing_material_sha256: signingMaterialHash,
      p_signature_sha256: signatureHash,
      p_signed_document_path: path,
      p_signed_document_hash: pdf.hash,
      p_event_data: eventData,
    });
    return json(200, { ...completed, signedAt, awaitingActivation: true });
  } catch (error) {
    console.error('affiliate-agreement:', error.message);
    return json(error.statusCode || 500, { error: error.message || 'Could not complete the affiliate agreement.' });
  }
};

exports._test = { clientIp, encodeStoragePath, normalizeClaimedTimestamp, uploadImmutablePdf };
