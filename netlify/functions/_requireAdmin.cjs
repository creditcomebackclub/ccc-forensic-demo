// Shared server-side admin authentication helper for Netlify functions.
// Usage: call requireAdmin(event) at the top of any function handler.
// Throws a structured { statusCode, body } object if the caller is not an
// authenticated admin — the handler should catch it and return it directly.
//
// Pattern:
//   try { await requireAdmin(event); }
//   catch (e) { if (e.statusCode) return e; throw e; }

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

function supabasePost(path, body, supabaseUrl, key) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(supabaseUrl + path);
    const options = {
      hostname: u.hostname, port: 443,
      path: u.pathname + u.search, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': 'Bearer ' + key,
        'Content-Length': Buffer.byteLength(data),
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
    req.write(data);
    req.end();
  });
}

/**
 * Verify that the caller is an authenticated CCC admin.
 *
 * Reads Authorization: Bearer <token> from the request headers,
 * validates the JWT against Supabase auth, then checks that the
 * caller's row in the `profiles` table has role = 'admin'.
 *
 * Throws a { statusCode, body } response object on failure so the
 * caller can do: catch (e) { if (e.statusCode) return e; throw e; }
 *
 * @param {object} event - Netlify function event
 * @returns {Promise<{ userId: string, email: string }>} Verified caller info
 */
async function requireAdmin(event) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey    = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceKey) {
    throw { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  // 1. Extract and validate the bearer token
  const authHeader = (event.headers.authorization || event.headers.Authorization || '');
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    throw { statusCode: 401, body: JSON.stringify({ error: 'Missing Authorization token' }) };
  }

  // 2. Verify the token against Supabase Auth (anon key, not service key)
  const userRes = await supabaseGet('/auth/v1/user', supabaseUrl, anonKey, token);
  if (userRes.status !== 200 || !userRes.body || !userRes.body.id) {
    throw { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  }
  const userId = userRes.body.id;
  const email  = userRes.body.email;

  // 3. Check that this user has admin role in the profiles table
  const profileRes = await supabaseGet(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role&limit=1`,
    supabaseUrl,
    serviceKey
  );
  const profile = Array.isArray(profileRes.body) && profileRes.body.length > 0 ? profileRes.body[0] : null;
  if (!profile || profile.role !== 'admin') {
    throw { statusCode: 403, body: JSON.stringify({ error: 'Admin access required' }) };
  }

  return { userId, email };
}

module.exports = { requireAdmin };
