// Shared server-side authentication helper for Netlify functions.
// Validates the Supabase JWT and returns the user object.
// Allows both clients and admins to authenticate. Functions that perform
// staff-only work (especially paid AI work) must use requireStaff() instead
// of relying on a client-supplied userId or a service-role token.

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
  const headers = event.headers || {};
  const authHeader = headers['authorization'] || headers['Authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw { statusCode: 401, body: JSON.stringify({ error: 'Missing or invalid Authorization header' }) };
  }
  const token = authHeader.replace('Bearer ', '').trim();

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey) {
    throw { statusCode: 500, body: JSON.stringify({ error: 'Supabase env vars missing' }) };
  }

  // Trusted server-to-server calls (e.g. audit-run-background.mjs triggering
  // progress-narrative-background.mjs right after saving a new audit) present
  // the service role key directly as the bearer token — only server code ever
  // holds that secret, so it's safe to trust without a user JWT. There's no
  // JWT to derive a user from in this case, so the caller must supply userId
  // explicitly in the request body.
  if (serviceKey && token === serviceKey) {
    let bodyUserId = null;
    try { bodyUserId = JSON.parse(event.body || '{}').userId || null; } catch (e) { /* fall through to the error below */ }
    if (!bodyUserId) throw { statusCode: 400, body: JSON.stringify({ error: 'userId required when authenticating with the service role key' }) };
    return { userId: bodyUserId, email: null, token, isSystem: true };
  }

  // Fetch the user using the client's token to verify it's valid
  const userRes = await supabaseGet('/auth/v1/user', supabaseUrl, anonKey, token);
  if (userRes.status !== 200 || !userRes.body || !userRes.body.id) {
    throw { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  }

  return { userId: userRes.body.id, email: userRes.body.email, token };
}

/**
 * Require a real Supabase session for a member of the CCC staff.
 *
 * `requireAuth()` deliberately supports a service-role bearer token for one
 * tightly scoped internal workflow. That shortcut must never authorize a
 * public, paid endpoint, so reject it here and require an actual JWT whose
 * profile role is admin or auditor.
 */
async function requireStaff(event) {
  const caller = await requireAuth(event);
  if (caller.isSystem) {
    throw { statusCode: 403, body: JSON.stringify({ error: 'Staff session required' }) };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  const profileRes = await supabaseGet(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(caller.userId)}&select=role&limit=1`,
    supabaseUrl,
    serviceKey
  );
  const profile = Array.isArray(profileRes.body) ? profileRes.body[0] : null;
  if (!profile || !['admin', 'auditor'].includes(profile.role)) {
    throw { statusCode: 403, body: JSON.stringify({ error: 'Staff access required' }) };
  }

  return { ...caller, role: profile.role };
}

// Some staff-only serverless workflows are also invoked by trusted internal
// jobs (for example, daily-cron). Keep that exception explicit instead of
// teaching each function to treat a service key like a browser session.
async function requireStaffOrSystem(event) {
  const headers = event.headers || {};
  const authHeader = headers.authorization || headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey && token === serviceKey) {
    return { userId: 'system', email: 'system@cccpartners.co', isSystem: true, role: 'system' };
  }
  return requireStaff(event);
}

module.exports = { requireAuth, requireStaff, requireStaffOrSystem, supabaseGet };
