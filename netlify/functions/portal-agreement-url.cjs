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
    .select('client_id, full_name, user_id, lpoa_storage_bucket, lpoa_storage_path')
    .eq('user_id', userData.user.id)
    .limit(1)
    .maybeSingle();

  if (!profile) return json(404, { error: 'Client profile not found.' });

  if (!profile.lpoa_storage_path) {
    return json(404, {
      error: 'No signed agreement file is on file yet. Ask Credit Comeback Club to confirm enrollment documents were saved.',
      available: false,
    });
  }

  const bucket = profile.lpoa_storage_bucket || 'documents';
  const { data: signed, error: signErr } = await admin.storage
    .from(bucket)
    .createSignedUrl(profile.lpoa_storage_path, 60 * 15);
  if (signErr) return json(500, { error: signErr.message });

  return json(200, {
    signedUrl: signed.signedUrl,
    fileName: 'lpoa-signed.html',
    available: true,
  });
};
