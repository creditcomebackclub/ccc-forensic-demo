import { supabase } from './supabase';

function slug(s) {
  return String(s || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'unknown';
}

async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

export async function uploadDocument(clientName, docType, file) {
  const userId = await getUserId();
  const ext = file.name.split('.').pop().toLowerCase();
  const storagePath = `${userId}/${slug(clientName)}/${docType}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(storagePath, file, { upsert: true });
  if (uploadError) throw uploadError;

  const { error: dbError } = await supabase.from('documents').upsert({
    user_id: userId,
    client_name: clientName,
    doc_type: docType,
    file_name: file.name,
    storage_path: storagePath,
    uploaded_at: new Date().toISOString(),
  }, { onConflict: 'user_id,client_name,doc_type' });
  if (dbError) throw dbError;

  return storagePath;
}

export async function getDocuments(clientName) {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('user_id', userId)
    .eq('client_name', clientName);
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

export async function deleteDocument(clientName, docType) {
  const userId = await getUserId();
  const { data: docs } = await supabase
    .from('documents')
    .select('storage_path')
    .eq('user_id', userId)
    .eq('client_name', clientName)
    .eq('doc_type', docType);

  if (docs && docs[0]) {
    await supabase.storage.from('documents').remove([docs[0].storage_path]);
  }

  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('user_id', userId)
    .eq('client_name', clientName)
    .eq('doc_type', docType);
  if (error) throw error;
}
