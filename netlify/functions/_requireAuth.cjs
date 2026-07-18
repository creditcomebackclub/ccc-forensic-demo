// Shared server-side authentication helper for Netlify functions.
// Validates the Supabase JWT and returns the user object.
// Allows both clients and admins to authenticate.

const https = require('https');

function supabaseGet(path, supabaseUrl, apiKey, authToken) {
  return new Promise((resolve, reject) => {
    const u = new URL(supabaseUrl + path);
    const options = {
      hostname: u.hostname, port: 443,
      path: u.pathname + u.search, method: 'GET',
      headers: {
        'apikey': apiKey,
        'Authorization': 'Bearer ' + (authToken || apiKey),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function requireAuth(event) {
  const authHeader = event.headers['authorization'] || event.headers['Authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw { statusCode: 401, body: JSON.stringify({ error: 'Missing or invalid Authorization header' }) };
  }
  const token = authHeader.replace('Bearer ', '').trim();

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw { statusCode: 500, body: JSON.stringify({ error: 'Supabase env vars missing' }) };
  }

  // Fetch the user using the client's token to verify it's valid
  const userRes = await supabaseGet('/auth/v1/user', supabaseUrl, anonKey, token);
  if (userRes.status !== 200 || !userRes.body || !userRes.body.id) {
    throw { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  }
  
  return { userId: userRes.body.id, email: userRes.body.email, token };
}

module.exports = { requireAuth, supabaseGet };
