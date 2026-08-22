/**
 * Token-authenticated proxy for signed enrollment artifacts. HTML is rendered
 * under a locked-down sandbox; PDFs are returned as real binary (base64 in the
 * Netlify response envelope). Every request re-resolves portal ownership and
 * compares the signed agreement/kind/path/hash descriptor before storage read.
 */
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { verifyAgreementViewToken } = require('./_agreementViewToken.cjs');
const { isAgreementArtifactKind, resolveAgreementDocument } = require('./_agreementDocument.cjs');

function text(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    body,
  };
}

function decodeArtifactDescriptor(value) {
  try {
    const descriptor = JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8'));
    if (!descriptor || typeof descriptor !== 'object') return null;
    if (!descriptor.agreementId || !isAgreementArtifactKind(descriptor.kind) || !descriptor.path) return null;
    if (descriptor.path.startsWith('/') || descriptor.path.includes('..')) return null;
    if (descriptor.hash !== null && descriptor.hash !== undefined && !/^[0-9a-f]{64}$/.test(descriptor.hash)) return null;
    return { agreementId: String(descriptor.agreementId), kind: descriptor.kind, path: descriptor.path, hash: descriptor.hash || null };
  } catch {
    return null;
  }
}

function sameArtifact(document, claims, descriptor) {
  return document.bucket === claims.bucket
    && document.agreementId === descriptor.agreementId
    && document.kind === descriptor.kind
    && document.path === descriptor.path
    && (document.hash || null) === descriptor.hash;
}

function artifactResponse(document, bytes) {
  const commonHeaders = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Disposition': `inline; filename="${document.fileName.replace(/[^A-Za-z0-9._-]/g, '-')}"`,
  };
  if (document.kind === 'cancellation') {
    if (bytes.length < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
      return text(409, 'The cancellation notice is not a valid PDF. Contact Credit Comeback Club.');
    }
    return {
      statusCode: 200,
      headers: { ...commonHeaders, 'Content-Type': 'application/pdf' },
      body: bytes.toString('base64'),
      isBase64Encoded: true,
    };
  }

  return {
    statusCode: 200,
    headers: {
      ...commonHeaders,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
    body: bytes.toString('utf8'),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return text(405, 'Method not allowed');

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return text(500, 'Server is not configured.');

  const claims = verifyAgreementViewToken(event.queryStringParameters?.token, service);
  const descriptor = claims ? decodeArtifactDescriptor(claims.path) : null;
  if (!claims || !descriptor) return text(403, 'This document link is invalid or has expired. Please reopen it from your portal.');

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  let resolved;
  try { resolved = await resolveAgreementDocument(admin, claims.userId, descriptor.kind); }
  catch (error) {
    console.error('portal-agreement-view resolve failed', error);
    return text(500, 'Could not verify this signed document.');
  }
  if (!resolved.document) return text(404, 'No signed document is on file yet.');
  if (!sameArtifact(resolved.document, claims, descriptor)) {
    return text(403, 'This document link is no longer valid. Please reopen it from your portal.');
  }

  const { data: blob, error } = await admin.storage.from(resolved.document.bucket).download(resolved.document.path);
  if (error || !blob) return text(404, 'Could not load your signed document.');
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (resolved.document.hash) {
    const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== resolved.document.hash) {
      console.error('portal-agreement-view integrity mismatch', resolved.document.agreementId, resolved.document.kind);
      return text(409, 'This document failed its integrity check. Contact Credit Comeback Club.');
    }
  }

  return artifactResponse(resolved.document, bytes);
};

module.exports.decodeArtifactDescriptor = decodeArtifactDescriptor;
module.exports.sameArtifact = sameArtifact;
module.exports.artifactResponse = artifactResponse;
