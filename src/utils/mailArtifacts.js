import { supabase } from './supabase';

// Mail artifacts are immutable copies fetched from Lob by a server function.
// The browser only receives short-lived signed URLs to the private documents
// bucket; it never receives a Lob key or a permanent Lob asset URL.
export async function listMailArtifacts(letterIds) {
  const ids = [...new Set((letterIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('mail_artifacts')
    .select('*')
    .in('letter_id', ids)
    .eq('status', 'archived')
    .order('captured_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getMailArtifactUrl(artifact) {
  if (!artifact?.storage_path) throw new Error('Mail artifact is not available');
  const { data, error } = await supabase.storage
    .from(artifact.storage_bucket || 'documents')
    .createSignedUrl(artifact.storage_path, 15 * 60);
  if (error || !data?.signedUrl) throw error || new Error('Could not open mail artifact');
  return data.signedUrl;
}

export async function archiveHistoricalMailpiece({ letterId, lobId }) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/.netlify/functions/lob', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({ action: 'archive_letter_artifact', letterId, lobId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not archive the Lob mailpiece');
  return data;
}
