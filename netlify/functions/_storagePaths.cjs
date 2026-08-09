// Canonical Supabase Storage path contract (server). Keep in sync with
// src/utils/storagePaths.js.

const DOCUMENTS_BUCKET = 'documents';
const RESPONSES_BUCKET = 'responses';
const BLUEPRINTS_BUCKET = 'recovery-blueprints';
const FIRM_ASSETS_BUCKET = 'client-docs';
const FIRM_ATTORNEY_SIG_PATH = 'firm/attorney-signature.png';

function identityDocPath(firmUserId, clientId, docType, ext) {
  return `${firmUserId}/${clientId}/identity/${docType}.${ext}`;
}

function lpoaSignaturePath(firmUserId, clientId) {
  return `${firmUserId}/${clientId}/lpoa/signature.png`;
}

function lpoaDocumentPath(firmUserId, clientId) {
  return `${firmUserId}/${clientId}/lpoa/lpoa-signed.html`;
}

function serviceAgreementDocumentPath(firmUserId, clientId, agreementId, extension = 'pdf') {
  if (!agreementId) throw new Error('serviceAgreementDocumentPath requires agreementId');
  return `${firmUserId}/${clientId}/agreements/${agreementId}/signed-packet.${extension}`;
}

function responseEvidencePrefix(firmUserId, clientId, evidenceId) {
  if (!clientId) throw new Error('responseEvidencePrefix requires clientId');
  return `${firmUserId}/${clientId}/response-evidence/${evidenceId}`;
}

function responseEvidencePrefixes(firmUserId, clientId, evidenceId) {
  const out = [`${firmUserId}/response-evidence/${evidenceId}/`];
  if (clientId) out.unshift(`${firmUserId}/${clientId}/response-evidence/${evidenceId}/`);
  return out;
}

function recoveryBlueprintPath(firmUserId, clientId, auditId, version, sha12) {
  if (!clientId) throw new Error('recoveryBlueprintPath requires clientId');
  return `${firmUserId}/${clientId}/${auditId}/v${version}-${sha12}.pdf`;
}

function buildLpoaSignatureRecord({
  firmUserId,
  clientId,
  signedAt,
  method,
  documentHash,
  lpoaType,
  ip,
  signatureUrl = null,
  lpoaUrl = null,
}) {
  return {
    storageBucket: DOCUMENTS_BUCKET,
    signaturePath: lpoaSignaturePath(firmUserId, clientId),
    lpoaPath: lpoaDocumentPath(firmUserId, clientId),
    signatureUrl: signatureUrl || null,
    lpoaUrl: lpoaUrl || null,
    signedAt: signedAt || new Date().toISOString(),
    method: method || null,
    documentHash: documentHash || null,
    ...(lpoaType ? { lpoaType } : {}),
    ...(ip ? { ip } : {}),
  };
}

module.exports = {
  DOCUMENTS_BUCKET,
  RESPONSES_BUCKET,
  BLUEPRINTS_BUCKET,
  FIRM_ASSETS_BUCKET,
  FIRM_ATTORNEY_SIG_PATH,
  identityDocPath,
  lpoaSignaturePath,
  lpoaDocumentPath,
  serviceAgreementDocumentPath,
  responseEvidencePrefix,
  responseEvidencePrefixes,
  recoveryBlueprintPath,
  buildLpoaSignatureRecord,
};
