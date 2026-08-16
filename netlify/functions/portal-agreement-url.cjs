/**
 * Client-authenticated signed URL for their signed LPOA / service agreement.
 * Does not rely on browser storage RLS or client documents SELECT.
 */
const { createClient } = require('@supabase/supabase-js');

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return json(401, { error: 'Not signed in.' });

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return json(500, { error: 'Server is not configured.' });

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json(401, { error: 'Invalid session.' });

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: profile } = await admin
    .from('client_profiles')
    .select('client_id, full_name, user_id')
    .eq('user_id', userData.user.id)
    .limit(1)
    .maybeSingle();

  if (!profile) return json(404, { error: 'Client profile not found.' });

  // Prefer documents table rows; fall back to known storage path pattern.
  let docQuery = admin
    .from('documents')
    .select('id, doc_type, label, file_name, storage_path, uploaded_at')
    .order('uploaded_at', { ascending: false });

  if (profile.client_id) docQuery = docQuery.eq('client_id', profile.client_id);
  else docQuery = docQuery.eq('client_name', profile.full_name);

  const { data: docs, error: docErr } = await docQuery.limit(50);
  if (docErr) console.warn('documents query', docErr.message);

  const rows = docs || [];
  const lpoa = rows.find((d) => {
    const t = `${d.doc_type || ''} ${d.label || ''} ${d.file_name || ''}`.toLowerCase();
    return t.includes('lpoa') || t.includes('agreement') || d.doc_type === 'lpoa' || d.doc_type === 'agreement';
  });

  let storagePath = lpoa?.storage_path || null;

  // Fallback: list storage under firm paths if row missing but file was uploaded
  if (!storagePath && profile.client_id) {
    // documents path pattern from enroll: {firmUserId}/{clientId}/lpoa/lpoa-signed.html
    // We don't always know firmUserId; try match from any doc path for this client
    const anyPath = rows.find((d) => d.storage_path)?.storage_path;
    if (anyPath && anyPath.includes('/')) {
      const firmPrefix = anyPath.split('/')[0];
      const candidate = `${firmPrefix}/${profile.client_id}/lpoa/lpoa-signed.html`;
      const { data: listed } = await admin.storage.from('client-docs').list(`${firmPrefix}/${profile.client_id}/lpoa`);
      if (listed && listed.some((f) => f.name === 'lpoa-signed.html')) {
        storagePath = candidate;
      }
    }
  }

  if (!storagePath) {
    return json(404, {
      error: 'No signed agreement file is on file yet. Ask Credit Comeback Club to confirm enrollment documents were saved.',
      available: false,
    });
  }

  const { data: signed, error: signErr } = await admin.storage
    .from('client-docs')
    .createSignedUrl(storagePath, 60 * 15);
  if (signErr) return json(500, { error: signErr.message });

  return json(200, {
    signedUrl: signed.signedUrl,
    fileName: lpoa?.file_name || 'lpoa-signed.html',
    available: true,
  });
};
