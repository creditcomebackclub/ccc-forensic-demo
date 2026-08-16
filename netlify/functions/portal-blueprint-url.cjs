/**
 * Client-authenticated signed URL for their Recovery Blueprint PDF.
 * Browser storage RLS on recovery-blueprints is not reliable for clients.
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

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON.' }); }

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json(401, { error: 'Invalid session.' });

  const userId = userData.user.id;
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: profile } = await admin
    .from('client_profiles')
    .select('client_id, full_name')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (!profile) return json(404, { error: 'Client profile not found.' });

  let query = admin
    .from('recovery_blueprints')
    .select('id, storage_path, file_name, status, version')
    .in('status', ['approved', 'sent'])
    .order('approved_at', { ascending: false })
    .limit(1);

  if (body.blueprintId) {
    query = admin
      .from('recovery_blueprints')
      .select('id, storage_path, file_name, status, version')
      .eq('id', body.blueprintId)
      .in('status', ['approved', 'sent'])
      .limit(1);
  }

  if (profile.client_id) {
    query = query.eq('client_id', profile.client_id);
  } else {
    query = query.eq('client_name', profile.full_name);
  }

  const { data: rows, error: bpErr } = await query;
  if (bpErr) return json(500, { error: bpErr.message });
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row?.storage_path) return json(404, { error: 'No signed blueprint file is available yet.' });

  const { data: signed, error: signErr } = await admin.storage
    .from('recovery-blueprints')
    .createSignedUrl(row.storage_path, 60 * 15);
  if (signErr) return json(500, { error: signErr.message });

  return json(200, {
    signedUrl: signed.signedUrl,
    fileName: row.file_name,
    version: row.version,
  });
};
