// Records an LPOA audit-trail entry for the in-portal onboarding signing
// flow (ClientSetupFlow.jsx), which runs client-side under the signing
// client's own session and writes clients.lpoa_signature_data directly.
// This endpoint exists to capture what that client-side code structurally
// can't provide itself: a server-observed IP and user-agent, and an
// append-only row nothing client-side can overwrite on a later re-sign.
//
// The caller only supplies documentHash/documentUrl/signerName/lpoaType —
// never a client name or id. Which client this audit entry belongs to is
// always resolved server-side from the verified session, so a client can
// only ever create an audit record attributed to themselves.
const https = require('https');
const { requireAuth } = require('./_requireAuth.cjs');

function supabaseRequest(path, method, body, url, key) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(url + path);
    const options = {
      hostname: u.hostname, port: 443, path: u.pathname + u.search, method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': 'Bearer ' + key,
        'Prefer': 'return=representation',
      },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };

  let userId;
  try { ({ userId } = await requireAuth(event)); }
  catch (e) { if (e.statusCode) return e; throw e; }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { documentHash, documentUrl, signerName, lpoaType } = payload;
  if (!documentHash) return { statusCode: 400, body: JSON.stringify({ error: 'documentHash required' }) };

  try {
    // Resolve the caller's own client identity — never trust a client-
    // supplied name/id for whose audit entry this is.
    const profileRes = await supabaseRequest(
      '/rest/v1/client_profiles?user_id=eq.' + encodeURIComponent(userId) + '&select=full_name',
      'GET', null, supabaseUrl, serviceKey
    );
    const profile = Array.isArray(profileRes.body) && profileRes.body[0];
    if (!profile || !profile.full_name) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Client profile not found for this session' }) };
    }
    const clientName = profile.full_name;

    const clientRes = await supabaseRequest(
      '/rest/v1/clients?name=eq.' + encodeURIComponent(clientName) + '&select=id',
      'GET', null, supabaseUrl, serviceKey
    );
    const clientRow = Array.isArray(clientRes.body) && clientRes.body[0];
    const clientId = clientRow ? clientRow.id : null;

    const ip = (event.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
    const userAgent = event.headers['user-agent'] || null;
    const resolvedLpoaType = lpoaType === 'inquiry' ? 'inquiry' : 'standard';

    const auditRes = await supabaseRequest('/rest/v1/lpoa_audit_log', 'POST', {
      client_id: clientId,
      client_name: clientName,
      document_hash: documentHash,
      document_url: documentUrl || null,
      signer_name: signerName || clientName,
      ip,
      user_agent: userAgent,
      lpoa_type: resolvedLpoaType,
      signed_at: new Date().toISOString(),
    }, supabaseUrl, serviceKey);

    if (auditRes.status < 200 || auditRes.status >= 300) {
      console.error('lpoa_audit_log insert failed:', auditRes.status, JSON.stringify(auditRes.body));
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not record audit entry' }) };
    }

    // Best-effort quick-reference hash on the clients row — the audit_log
    // row above is the authoritative record either way.
    if (clientId) {
      await supabaseRequest(
        '/rest/v1/clients?id=eq.' + encodeURIComponent(clientId),
        'PATCH', { lpoa_document_hash: documentHash }, supabaseUrl, serviceKey
      ).catch((e) => console.warn('lpoa_document_hash update failed (non-fatal):', e.message));
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true }),
    };
  } catch (e) {
    console.error('record-lpoa-audit error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Failed to record audit entry' }) };
  }
};
