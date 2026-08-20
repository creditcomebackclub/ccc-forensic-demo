const { requireAuth } = require('./_requireAuth.cjs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  let caller;
  try { caller = await requireAuth(event); } catch (error) { return error.statusCode ? error : { statusCode: 500, body: JSON.stringify({ error: error.message }) }; }
  if (caller.isSystem) return { statusCode: 403, body: JSON.stringify({ error: 'Client session required' }) };
  const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  try {
    const find = await fetch(url + '/rest/v1/client_profiles?user_id=eq.' + encodeURIComponent(caller.userId) + '&select=id,client_id&limit=1', { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    const profiles = await find.json(); const profile = profiles?.[0];
    if (!profile?.id || !profile.client_id) return { statusCode: 409, body: JSON.stringify({ error: 'Client profile is not linked.' }) };
    const now = new Date().toISOString();
    const updated = await fetch(url + '/rest/v1/client_profiles?id=eq.' + encodeURIComponent(profile.id), { method: 'PATCH', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ onboarding_complete: true, onboarding_step: 4, agreement_signed_at: now, signature_data: null, signature_signed_at: now }) });
    if (!updated.ok) throw new Error('Could not save portal enrollment.');
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ complete: true }) };
  } catch (error) { return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Could not complete enrollment.' }) }; }
};
