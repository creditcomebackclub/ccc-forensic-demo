exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  // Only authenticated admins may generate impersonation links.
  const { requireAdmin } = require('./_requireAdmin.cjs');
  try { await requireAdmin(event); }
  catch (e) { if (e.statusCode) return e; throw e; }

  try {
    const { email } = JSON.parse(event.body || '{}');
    if (!email) return { statusCode: 400, body: JSON.stringify({ error: 'Email required' }) };

    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const origin = event.headers.origin || 'https://ccc-forensic-demo.netlify.app';
    const redirectUrl = `${origin}/login`;

    const res = await fetch(`${url}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({ type: 'magiclink', email, redirect_to: redirectUrl }),
    });

    const data = await res.json();

    if (!res.ok) throw new Error(data.message || data.error || 'Failed to generate link');
    if (!data.action_link) throw new Error('No link returned from Supabase');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link: data.action_link }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message || 'Failed' }),
    };
  }
};
