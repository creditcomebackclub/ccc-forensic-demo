import { supabase } from './supabase';

async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

// clientId is the real key — two clients named identically would otherwise
// silently overwrite each other's ID/address documents. Required for both
// uploads and getDocuments (name-only lookup removed).
//
// ownerUserId is optional and only needed when the caller isn't the
// document's owner — e.g. ClientPortal.jsx uploads on behalf of the client,
// but the row (and storage path) must still be rooted under the firm's
// staff user_id, not the client's own auth id, to match staff_all_documents
// RLS and where admin-side uploads already live. Defaults to the current
// session's own id, which is correct for every admin-side caller.
export async function uploadDocument(clientId, clientName, docType, file, ownerUserId) {
  const userId = ownerUserId || await getUserId();
  if (!clientId) throw new Error('uploadDocument requires a clientId');
  const ext = file.name.split('.').pop().toLowerCase();
  const storagePath = `${userId}/${clientId}/${docType}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(storagePath, file, { upsert: true });
  if (uploadError) throw uploadError;

  const { error: dbError } = await supabase.from('documents').upsert({
    user_id: userId,
    client_id: clientId,
    client_name: clientName,
    doc_type: docType,
    file_name: file.name,
    storage_path: storagePath,
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
  const userId = ownerUserId || await getUserId();
  if (!clientId) throw new Error('uploadArbitraryDocument requires a clientId');
  if (!label) throw new Error('uploadArbitraryDocument requires a label');
  const ext = file.name.split('.').pop().toLowerCase();
  const docType = 'other-' + crypto.randomUUID();
  const storagePath = `${userId}/${clientId}/${docType}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('documents')
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
  const userId = await getUserId();
  // Mail/enclosure path requires clientId — name-only lookup can attach the
  // wrong client's ID/address when two clients share a name under one firm.
  if (!clientId) {
    throw new Error('getDocuments requires a clientId');
  }
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('user_id', userId)
    .eq('client_id', clientId);
  if (error) throw error;
  return data || [];
}

export async function getDocumentUrl(storagePath) {
  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export async function getDocumentBase64(storagePath) {
  const { data, error } = await supabase.storage
    .from('documents')
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
// current session — correct for admin DocumentManager deletes.
export async function deleteDocument(clientId, docType, ownerUserId) {
  const userId = ownerUserId || await getUserId();
  if (!clientId) throw new Error('deleteDocument requires a clientId');
  const { data: docs } = await supabase
    .from('documents')
    .select('storage_path')
    .eq('user_id', userId)
    .eq('client_id', clientId)
    .eq('doc_type', docType);

  if (docs && docs[0]) {
    await supabase.storage.from('documents').remove([docs[0].storage_path]);
  }

  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('user_id', userId)
    .eq('client_id', clientId)
    .eq('doc_type', docType);
  if (error) throw error;
}
