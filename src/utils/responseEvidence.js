import { supabase } from './supabase';
import { inferMediaType } from './responseFiles';

function responseMetadata(files) {
  return Array.from(files || []).map((file) => ({
    name: file.name,
    contentType: inferMediaType(file.name, file.type),
    size: file.size,
  }));
}

async function callEvidenceEndpoint(body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('You are no longer signed in. Please sign in and try again.');

  const res = await fetch('/.netlify/functions/response-evidence', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  let payload = {};
  try { payload = await res.json(); } catch (e) { /* use generic message below */ }
  if (!res.ok) throw new Error(payload.error || 'Could not process the response upload.');
  return payload;
}

// The client only knows a letter ID and files. The server resolves the
// client/firm/response-kind, issues short-lived signed URLs, and changes the
// letter state only after every expected private object is present.
export async function uploadResponseEvidence(letterId, files) {
  const selected = Array.from(files || []);
  if (!letterId || !selected.length) throw new Error('Choose at least one response file.');

  const prepared = await callEvidenceEndpoint({
    action: 'prepare',
    letterId,
    files: responseMetadata(selected),
  });
  if (!prepared.evidenceId || !Array.isArray(prepared.uploads) || prepared.uploads.length !== selected.length) {
    throw new Error('The response upload could not be prepared.');
  }

  for (let index = 0; index < selected.length; index += 1) {
    const upload = prepared.uploads[index];
    const { error } = await supabase.storage
      .from('responses')
      .uploadToSignedUrl(upload.path, upload.token, selected[index], {
        contentType: upload.contentType,
        upsert: false,
      });
    if (error) throw new Error('Could not upload ' + selected[index].name + ': ' + error.message);
  }

  const completed = await callEvidenceEndpoint({ action: 'complete', evidenceId: prepared.evidenceId });
  return {
    id: completed.evidenceId,
    responseKind: completed.responseKind,
    receivedAt: completed.receivedAt,
    storagePaths: completed.storagePaths || [],
  };
}

// Staff-only through response_evidence RLS. Clients intentionally do not
// query this table; their portal receives the safe lifecycle status on the
// letter record instead of staff notes or model analysis.
export async function listResponseEvidence({ letterId, clientId, clientName } = {}) {
  let query = supabase
    .from('response_evidence')
    .select('*')
    .order('created_at', { ascending: false });
  if (letterId) query = query.eq('letter_id', letterId);
  if (clientId) query = query.eq('client_id', clientId);
  else if (clientName) query = query.eq('client_name', clientName);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function updateResponseEvidenceReview(evidenceId, patch) {
  if (!evidenceId) throw new Error('Response evidence is required for this review.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated.');

  const mapped = {
    review_status: patch.reviewStatus,
    review_notes: patch.reviewNotes || null,
    reviewed_by: user.id,
    reviewed_at: patch.reviewedAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('response_evidence')
    .update(mapped)
    .eq('id', evidenceId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
