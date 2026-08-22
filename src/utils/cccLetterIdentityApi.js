import { buildCccLetterIdentitySnapshot, normalizeCccLetterIdentity } from './cccLetterIdentity.js';
import { supabase } from './supabase.js';

export async function loadCccLetterIdentity(clientId) {
  if (!clientId) throw new Error('CCC letter identity requires a client ID.');
  const { data, error } = await supabase
    .from('ccc_client_letter_identities')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw error;
  return data ? buildCccLetterIdentitySnapshot(data) : null;
}

export async function loadCccIdentityDocuments(clientId) {
  if (!clientId) throw new Error('CCC identity documents require a client ID.');
  const { data, error } = await supabase
    .from('documents')
    .select('id,user_id,client_id,doc_type,file_name,storage_path,content_type,byte_size,sha256,uploaded_at')
    .eq('client_id', clientId)
    .in('doc_type', ['id', 'address']);
  if (error) throw error;
  return data || [];
}

export async function saveCccLetterIdentity({
  clientId,
  expectedRevision,
  firstName,
  lastName,
  addressLine1,
  addressLine2,
  city,
  state,
  zip,
  identityDocumentId,
  addressDocumentId,
}) {
  const { data, error } = await supabase.rpc('save_ccc_client_letter_identity', {
    p_client_id: clientId,
    p_expected_revision: expectedRevision ?? null,
    p_first_name: firstName,
    p_last_name: lastName,
    p_address_line1: addressLine1,
    p_address_line2: addressLine2 || null,
    p_city: city,
    p_state: state,
    p_zip: zip,
    p_identity_document_id: identityDocumentId,
    p_address_document_id: addressDocumentId,
    p_staff_attested: true,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return buildCccLetterIdentitySnapshot(normalizeCccLetterIdentity(row));
}
