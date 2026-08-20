const { requireAuth } = require('./_requireAuth.cjs');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  let caller;
  try { caller = await requireAuth(event); } catch (error) { return error.statusCode ? error : json(500, { error: error.message }); }
  if (caller.isSystem) return json(403, { error: 'Client session required' });
  const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json(500, { error: 'Server not configured' });
  try {
    const cpRes = await fetch(url + '/rest/v1/client_profiles?user_id=eq.' + encodeURIComponent(caller.userId) + '&select=client_id&limit=1', { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    const profiles = await cpRes.json(); const clientId = profiles?.[0]?.client_id;
    if (!clientId) return json(404, { error: 'Client profile is not linked to an agreement.' });
    const agreementRes = await fetch(url + '/rest/v1/client_service_agreements?client_id=eq.' + encodeURIComponent(clientId) + '&status=eq.signed&select=signed_document_path&order=signed_at.desc&limit=1', { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    const agreements = await agreementRes.json(); const path = agreements?.[0]?.signed_document_path;
    if (!path) return json(404, { error: 'No signed agreement is available.' });
    const signRes = await fetch(url + '/storage/v1/object/sign/documents/' + path.split('/').map(encodeURIComponent).join('/'), { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 600 }) });
    const signed = await signRes.json();
    if (!signRes.ok || !signed?.signedURL) throw new Error('Could not create document link.');
    return json(200, { url: url + '/storage/v1' + signed.signedURL });
  } catch (error) { return json(500, { error: error.message || 'Could not load agreement.' }); }
};
