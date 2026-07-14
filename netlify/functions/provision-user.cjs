// Provision a portal user server-side with the service role: ensure the auth
// user exists and link it to its client_profiles/affiliates row BEFORE any
// magic link is sent. This closes the race where a client's first login found
// no linked profile row and loadUser misclassified them.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  // Only authenticated admins may provision portal users.
  const { requireAdmin } = require('./_requireAdmin.cjs');
  try { await requireAdmin(event); }
  catch (e) { if (e.statusCode) return e; throw e; }

  try {
    const { email, fullName, kind } = JSON.parse(event.body || '{}');
    if (!email) return { statusCode: 400, body: JSON.stringify({ error: 'Email required' }) };
    const normEmail = String(email).trim().toLowerCase();

    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
    };

    // 1. Ensure the auth user exists and resolve its id
    let userId = null;
    const createRes = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: normEmail,
        email_confirm: true,
        user_metadata: fullName ? { full_name: fullName } : {},
      }),
    });
    const created = await createRes.json();
    if (createRes.ok) {
      userId = created.id;
    } else {
      // Already registered — resolve the id via generate_link (sends no email)
      const linkRes = await fetch(`${url}/auth/v1/admin/generate_link`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ type: 'magiclink', email: normEmail }),
      });
      const linkData = await linkRes.json();
      if (!linkRes.ok) throw new Error(linkData.message || linkData.error || created.message || 'Could not resolve auth user');
      userId = linkData.id || (linkData.user && linkData.user.id);
    }
    if (!userId) throw new Error('Could not resolve auth user id');

    // 2. Link the profile row, creating it for clients if missing
    if (kind === 'affiliate') {
      const patchRes = await fetch(`${url}/rest/v1/affiliates?email=eq.${encodeURIComponent(normEmail)}`, {
        method: 'PATCH',
        headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify({ user_id: userId }),
      });
      const patched = await patchRes.json();
      if (!patchRes.ok) throw new Error('Could not link affiliate row');
      if (!Array.isArray(patched) || patched.length === 0) throw new Error('No affiliate row found for ' + normEmail);
    } else {
      const getRes = await fetch(`${url}/rest/v1/client_profiles?email=eq.${encodeURIComponent(normEmail)}&select=id,user_id&limit=1`, { headers });
      const rows = await getRes.json();
      const existing = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
      if (existing) {
        // Never touch onboarding_complete here — resending a link must not reset an enrolled client
        const patchRes = await fetch(`${url}/rest/v1/client_profiles?email=eq.${encodeURIComponent(normEmail)}`, {
          method: 'PATCH',
          headers: { ...headers, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ user_id: userId, ...(fullName ? { full_name: fullName } : {}) }),
        });
        if (!patchRes.ok) throw new Error('Could not update client profile');
      } else {
        const insRes = await fetch(`${url}/rest/v1/client_profiles`, {
          method: 'POST',
          headers: { ...headers, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ email: normEmail, full_name: fullName || normEmail, user_id: userId, onboarding_complete: false }),
        });
        if (!insRes.ok) throw new Error('Could not create client profile');
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message || 'Provisioning failed' }),
    };
  }
};
