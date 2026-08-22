import { supabase } from './supabase';
import { DOCUMENTS_BUCKET, identityDocPath } from './storagePaths';

// Canonical layout (documents bucket):
//   {firmUid}/{clientId}/identity/{docType}.{ext}
//   {firmUid}/{clientId}/lpoa/…          (see storagePaths.js / ClientSetupFlow)
//   {firmUid}/mail-artifacts/{lobId}/…
//   {firmUid}/temp/{kind}/{batchId}/…

async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

async function resolveDocumentOwnerId(clientId, explicitOwnerUserId) {
  if (explicitOwnerUserId) return explicitOwnerUserId;
  await getUserId();
  const { data, error } = await supabase.from('clients').select('id,user_id').eq('id', clientId).maybeSingle();
  if (error) throw error;
  if (!data?.user_id) throw new Error('The client document owner could not be resolved.');
  return data.user_id;
}

// clientId is the real key — two clients named identically would otherwise
// silently overwrite each other's ID/address documents. Required for both
// uploads and getDocuments (name-only lookup removed).
//
// ownerUserId is optional and only needed when the caller isn't the
// document's owner — e.g. ClientPortal.jsx uploads on behalf of the client,
// but the row (and storage path) must still be rooted under the firm's
// staff user_id, not the client's own auth id, to match staff_all_documents
// RLS and where admin-side uploads already live. Staff callers resolve the
// canonical clients.user_id so a global admin cannot accidentally re-root an
// auditor-owned client's evidence under the admin account.
export async function uploadDocument(clientId, clientName, docType, file, ownerUserId) {
  if (!clientId) throw new Error('uploadDocument requires a clientId');
  const userId = await resolveDocumentOwnerId(clientId, ownerUserId);
  if (!['id', 'address'].includes(docType)) throw new Error('Only government ID and proof-of-address slots use uploadDocument.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > 4 * 1024 * 1024) throw new Error('Identity documents must be 4 MB or smaller.');
  const starts = (...values) => values.every((value, index) => bytes[index] === value);
  let detected;
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) detected = { ext: 'pdf', contentType: 'application/pdf' };
  else if (starts(0xff, 0xd8, 0xff)) detected = { ext: 'jpg', contentType: 'image/jpeg' };
  else if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) detected = { ext: 'png', contentType: 'image/png' };
  else if (bytes.byteLength >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') detected = { ext: 'webp', contentType: 'image/webp' };
  if (!detected) throw new Error('Upload a valid PDF, JPG, PNG, or WebP document.');
  if (file.type && file.type !== 'application/octet-stream' && file.type !== detected.contentType) {
    throw new Error('The identity-document bytes do not match the selected file type.');
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const storagePath = identityDocPath(userId, clientId, docType, detected.ext, sha256);

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, file, { upsert: false, contentType: detected.contentType });
  if (uploadError) {
    const { data: existing, error: existingError } = await supabase.storage.from(DOCUMENTS_BUCKET).download(storagePath);
    if (existingError || !existing) throw uploadError;
    const existingDigest = await crypto.subtle.digest('SHA-256', await existing.arrayBuffer());
    const existingSha256 = [...new Uint8Array(existingDigest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    if (existingSha256 !== sha256) throw new Error('The stored identity document failed its integrity check.');
  }

  const { error: dbError } = await supabase.from('documents').upsert({
    user_id: userId,
    client_id: clientId,
    client_name: clientName,
    doc_type: docType,
    file_name: file.name,
    storage_path: storagePath,
    content_type: detected.contentType,
    byte_size: bytes.byteLength,
    sha256,
    uploaded_at: new Date().toISOString(),
  }, { onConflict: 'user_id,client_id,doc_type' });
  if (dbError) throw dbError;

  return storagePath;
}

// Arbitrary document upload — a dropdown category (or free-typed "Other"
// text) rather than one of the two fixed slots ('id'/'address'). Unlike
// uploadDocument, this must never collide with a prior upload of the same
// category (a client should be able to upload three "Bank Statement"s), so
// doc_type here is a synthetic, always-unique value — label is what's
// actually displayed. Same clientId/ownerUserId contract as uploadDocument.
export async function uploadArbitraryDocument(clientId, clientName, label, file, ownerUserId) {
  if (!clientId) throw new Error('uploadArbitraryDocument requires a clientId');
  const userId = await resolveDocumentOwnerId(clientId, ownerUserId);
  if (!label) throw new Error('uploadArbitraryDocument requires a label');
  const ext = file.name.split('.').pop().toLowerCase();
  const docType = 'other-' + crypto.randomUUID();
  const storagePath = identityDocPath(userId, clientId, docType, ext);

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, file, { upsert: true });
  if (uploadError) throw uploadError;

  const { error: dbError } = await supabase.from('documents').insert({
    user_id: userId,
    client_id: clientId,
    client_name: clientName,
    doc_type: docType,
    label,
    file_name: file.name,
    storage_path: storagePath,
    uploaded_at: new Date().toISOString(),
  });
  if (dbError) throw dbError;

  return storagePath;
}

// deleteDocument keys on (clientId, docType) — arbitrary uploads' doc_type
// is already unique per row, so it works unchanged for these too.

export async function getDocuments(clientName, clientId) {
  await getUserId();
  // Mail/enclosure path requires clientId — name-only lookup can attach the
  // wrong client's ID/address when two clients share a name under one firm.
  if (!clientId) {
    throw new Error('getDocuments requires a clientId');
  }
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('client_id', clientId);
  if (error) throw error;
  return data || [];
}

export async function getDocumentUrl(storagePath) {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export async function getDocumentBase64(storagePath) {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .download(storagePath);
  if (error) throw error;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(data);
  });
}

// ownerUserId matches uploadDocument: portal callers must pass the firm's
// staff user_id (documents.user_id / storage path root). Defaults to the
// exact client row; optional ownerUserId narrows legacy portal callers.
export async function deleteDocument(clientId, docType, ownerUserId) {
  await getUserId();
  if (!clientId) throw new Error('deleteDocument requires a clientId');
  let lookup = supabase
    .from('documents')
    .select('user_id,storage_path')
    .eq('client_id', clientId)
    .eq('doc_type', docType);
  if (ownerUserId) lookup = lookup.eq('user_id', ownerUserId);
  const { data: docs } = await lookup;

  if (docs && docs[0]) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([docs[0].storage_path]);
  }

  let deletion = supabase
    .from('documents')
    .delete()
    .eq('client_id', clientId)
    .eq('doc_type', docType);
  if (ownerUserId) deletion = deletion.eq('user_id', ownerUserId);
  const { error } = await deletion;
  if (error) throw error;
}
