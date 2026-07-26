import { supabase } from './supabase';

async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

// clientId is the real key — two clients named identically (which does
// happen) would otherwise silently overwrite each other's ID/address
// documents, since slug(clientName) collapses to the same storage path and
// the old upsert conflicted on client_name. clientId is required for
// uploads; it's optional on getDocuments only because LobMailer's caller
// doesn't have one on hand (letters rows aren't client_id-keyed) and falls
// back to the pre-existing name-based lookup there.
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

export async function getDocuments(clientName, clientId) {
  const userId = await getUserId();
  let query = supabase.from('documents').select('*').eq('user_id', userId);
  query = clientId ? query.eq('client_id', clientId) : query.eq('client_name', clientName);
  const { data, error } = await query;
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

export async function deleteDocument(clientId, docType) {
  const userId = await getUserId();
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
