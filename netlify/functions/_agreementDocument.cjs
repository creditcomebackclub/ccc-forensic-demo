const { DOCUMENTS_BUCKET } = require('./_storagePaths.cjs');
const { resolvePortalIdentityWithAdmin } = require('./_portalIdentity.cjs');
const {
  AGREEMENT_TEMPLATE_VERSION,
  PRIOR_SERVICE_ONLY_AGREEMENT_TEMPLATE_VERSION,
} = require('./_serviceAgreement.cjs');

const PORTAL_SERVICE_AGREEMENT_VERSIONS = new Set([
  AGREEMENT_TEMPLATE_VERSION,
  PRIOR_SERVICE_ONLY_AGREEMENT_TEMPLATE_VERSION,
]);

const AGREEMENT_ARTIFACT_KINDS = Object.freeze(['agreement', 'disclosure', 'cancellation']);
const KIND_CONFIG = Object.freeze({
  agreement: {
    pathColumn: 'signed_document_path',
    hashColumn: 'signed_document_hash',
    contentType: 'text/html; charset=utf-8',
    fileName: 'CCC-Client-Service-Agreement.html',
  },
  disclosure: {
    pathColumn: 'signed_disclosure_path',
    hashColumn: 'signed_disclosure_hash',
    contentType: 'text/html; charset=utf-8',
    fileName: 'CCC-Consumer-Rights-Disclosure.html',
  },
  cancellation: {
    pathColumn: 'signed_cancellation_path',
    hashColumn: 'signed_cancellation_hash',
    contentType: 'application/pdf',
    fileName: 'CCC-Notice-of-Cancellation-Two-Copies.pdf',
  },
});

function isAgreementArtifactKind(kind) {
  return AGREEMENT_ARTIFACT_KINDS.includes(String(kind || ''));
}

async function objectExists(admin, bucket, path) {
  if (!bucket || !path || path.startsWith('/') || path.includes('..')) return false;
  const parts = path.split('/');
  const name = parts.pop();
  const dir = parts.join('/');
  const { data, error } = await admin.storage.from(bucket).list(dir, { search: name, limit: 100 });
  if (error) return false;
  return (data || []).some((file) => file.name === name);
}

async function latestSignedAgreement(admin, client) {
  const { data, error } = await admin
    .from('client_service_agreements')
    .select('id, client_id, user_id, template_version, signed_at, signed_document_path, signed_document_hash, signed_disclosure_path, signed_disclosure_hash, signed_cancellation_path, signed_cancellation_hash')
    .eq('client_id', client.id)
    .eq('user_id', client.user_id)
    .eq('status', 'signed')
    .order('signed_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length === 1 ? data[0] : null;
}

/**
 * Resolve one allowlisted signed artifact for exactly one authenticated portal
 * owner. Only a signed, versioned service-agreement row can resolve here.
 * Historical authorization artifacts remain stored as evidence, but they are
 * intentionally not exposed through the active portal agreement routes.
 */
async function resolveAgreementDocument(admin, userId, kind = 'agreement') {
  if (!isAgreementArtifactKind(kind)) return { invalidKind: true, profileMissing: false, document: null };

  let identity;
  try {
    identity = await resolvePortalIdentityWithAdmin(admin, userId, 'active');
  } catch (error) {
    if (error?.status === 403) return { profileMissing: true, document: null };
    throw error;
  }
  const client = { id: identity.clientId, user_id: identity.firmUserId };

  const agreement = await latestSignedAgreement(admin, client);
  if (agreement) {
    if (!PORTAL_SERVICE_AGREEMENT_VERSIONS.has(agreement.template_version)) {
      return { profileMissing: false, document: null, agreementId: agreement.id, artifactRetired: true };
    }
    const config = KIND_CONFIG[kind];
    const path = agreement[config.pathColumn];
    const hash = agreement[config.hashColumn];
    const expectedPrefix = `${client.user_id}/${client.id}/agreements/${agreement.id}/`;
    if (!path || !path.startsWith(expectedPrefix) || !/^[0-9a-f]{64}$/.test(hash || '')
      || !(await objectExists(admin, DOCUMENTS_BUCKET, path))) {
      return { profileMissing: false, document: null, agreementId: agreement.id, artifactMissing: true };
    }
    return {
      profileMissing: false,
      document: {
        bucket: DOCUMENTS_BUCKET,
        path,
        hash: hash || null,
        kind,
        agreementId: agreement.id,
        templateVersion: agreement.template_version,
        contentType: config.contentType,
        fileName: config.fileName,
        legacy: false,
      },
    };
  }

  return { profileMissing: false, document: null };
}

module.exports = {
  AGREEMENT_ARTIFACT_KINDS,
  KIND_CONFIG,
  isAgreementArtifactKind,
  resolveAgreementDocument,
  objectExists,
};
