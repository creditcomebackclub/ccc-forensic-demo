// Canonical Supabase Storage path contract for client documents.
//
// documents/{firmUid}/
//   {clientId}/identity/{docType}.{ext}
//   {clientId}/lpoa/signature.png | lpoa-signed.html
//   mail-artifacts/{lobId}/…
//   temp/{kind}/{batchId}/…
// responses/{firmUid}/{clientId}/response-evidence/{evidenceId}/…
// recovery-blueprints/{firmUid}/{clientId}/{auditId}/vN-{sha}.pdf
// client-docs/  — firm assets only (admin/settings.json, firm/attorney-signature.png)

export const DOCUMENTS_BUCKET = 'documents';
export const RESPONSES_BUCKET = 'responses';
export const BLUEPRINTS_BUCKET = 'recovery-blueprints';
export const FIRM_ASSETS_BUCKET = 'client-docs';
export const FIRM_ATTORNEY_SIG_PATH = 'firm/attorney-signature.png';

const ATTORNEY_BOLD_FALLBACK_RE = /<span style="font-size:14px;font-weight:bold;">Christopher Holland<\/span>/g;

export function attorneySignatureImgTag(dataUrl) {
  return `<img src="${dataUrl}" style="max-height:56px;max-width:220px;" alt="Christopher Holland signature" />`;
}

export function lpoaHtmlNeedsAttorneySignature(html) {
  return typeof html === 'string' && ATTORNEY_BOLD_FALLBACK_RE.test(html);
}

/** Swap the bold-text attorney fallback for the real signature image. */
export function injectAttorneySignatureHtml(html, dataUrl) {
  if (!html || !dataUrl) return html;
  if (!ATTORNEY_BOLD_FALLBACK_RE.test(html)) return html;
  ATTORNEY_BOLD_FALLBACK_RE.lastIndex = 0;
  return html.replace(ATTORNEY_BOLD_FALLBACK_RE, attorneySignatureImgTag(dataUrl));
}

/**
 * Staff-only: load firm attorney signature for LPOA packing / CRM preview.
 * Portal clients cannot read client-docs/firm/* after the storage reorg.
 */
export async function loadAttorneySignatureDataUrl(supabase) {
  const { data, error } = await supabase.storage.from(FIRM_ASSETS_BUCKET).download(FIRM_ATTORNEY_SIG_PATH);
  if (error || !data) throw error || new Error('Attorney signature not found');
  const buf = await data.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:image/png;base64,${btoa(binary)}`;
}

export function identityDocPath(firmUserId, clientId, docType, ext) {
  return `${firmUserId}/${clientId}/identity/${docType}.${ext}`;
}

export function lpoaSignaturePath(firmUserId, clientId) {
  return `${firmUserId}/${clientId}/lpoa/signature.png`;
}

export function lpoaDocumentPath(firmUserId, clientId) {
  return `${firmUserId}/${clientId}/lpoa/lpoa-signed.html`;
}

export function serviceAgreementDocumentPath(firmUserId, clientId, agreementId, extension = 'pdf') {
  if (!agreementId) throw new Error('serviceAgreementDocumentPath requires agreementId');
  return `${firmUserId}/${clientId}/agreements/${agreementId}/signed-packet.${extension}`;
}

export function responseEvidencePrefix(firmUserId, clientId, evidenceId) {
  if (!clientId) throw new Error('responseEvidencePrefix requires clientId');
  return `${firmUserId}/${clientId}/response-evidence/${evidenceId}`;
}

/** Dual-read: accept pre-reorg firm/response-evidence/{id}/ and canonical firm/clientId/… */
export function responseEvidencePrefixes(firmUserId, clientId, evidenceId) {
  const out = [`${firmUserId}/response-evidence/${evidenceId}/`];
  if (clientId) out.unshift(`${firmUserId}/${clientId}/response-evidence/${evidenceId}/`);
  return out;
}

export function recoveryBlueprintPath(firmUserId, clientId, auditId, version, sha12) {
  if (!clientId) throw new Error('recoveryBlueprintPath requires clientId');
  return `${firmUserId}/${clientId}/${auditId}/v${version}-${sha12}.pdf`;
}

export function tempLetterAssetsPrefix(firmUserId, batchId) {
  return `${firmUserId}/temp/letter-assets/${batchId}`;
}

export function tempLetterPath(firmUserId, batchId, fileName) {
  return `${firmUserId}/temp/letters/${batchId}/${fileName}`;
}

/** Build LPOA metadata written to clients.lpoa_signature_data after private upload. */
export function buildLpoaSignatureRecord({
  firmUserId,
  clientId,
  signedAt,
  method,
  documentHash,
  lpoaType,
  ip,
  // Optional legacy public URLs kept during cutover only
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

/**
 * Load LPOA HTML text. Prefers private documents path; falls back to legacy public URL.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object|null} lpoaData — clients.lpoa_signature_data
 */
export async function fetchLpoaHtml(supabase, lpoaData) {
  if (!lpoaData) return null;
  const path = lpoaData.lpoaPath || null;
  const bucket = lpoaData.storageBucket || DOCUMENTS_BUCKET;
  if (path) {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (!error && data) return await data.text();
  }
  if (lpoaData.lpoaUrl) {
    const res = await fetch(lpoaData.lpoaUrl);
    if (res.ok) return await res.text();
  }
  return null;
}

/**
 * Load LPOA HTML for Lob/print and ensure the attorney signature image is
 * present. Older portal enrollments fell back to bold text when clients
 * couldn't read firm assets after the storage reorg.
 */
export async function fetchLpoaHtmlForPrint(supabase, lpoaData) {
  const html = await fetchLpoaHtml(supabase, lpoaData);
  if (!html || !lpoaHtmlNeedsAttorneySignature(html)) return html;
  try {
    const dataUrl = await loadAttorneySignatureDataUrl(supabase);
    return injectAttorneySignatureHtml(html, dataUrl);
  } catch (e) {
    console.warn('Could not inject attorney signature into LPOA:', e?.message || e);
    return html;
  }
}

/**
 * Resolve a viewable URL for the signed LPOA (CRM "View signed LPOA").
 * Prefers signed URL from private path; falls back to legacy public URL.
 */
export async function resolveLpoaViewUrl(supabase, lpoaData, expiresIn = 3600) {
  if (!lpoaData) return null;
  const path = lpoaData.lpoaPath || null;
  const bucket = lpoaData.storageBucket || DOCUMENTS_BUCKET;
  if (path) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
    if (!error && data?.signedUrl) return data.signedUrl;
  }
  return lpoaData.lpoaUrl || null;
}

/**
 * Resolve a viewable URL for the client signature image.
 */
export async function resolveSignatureViewUrl(supabase, lpoaData, expiresIn = 3600) {
  if (!lpoaData) return null;
  const path = lpoaData.signaturePath || null;
  const bucket = lpoaData.storageBucket || DOCUMENTS_BUCKET;
  if (path) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
    if (!error && data?.signedUrl) return data.signedUrl;
  }
  return lpoaData.signatureUrl || null;
}
