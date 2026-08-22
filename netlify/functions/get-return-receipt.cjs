const https = require('https');
const { requireAuth } = require('./_requireAuth.cjs');
const { archiveLobArtifact } = require('./_lobArtifacts.cjs');

const CERTIFIED_RETURN_RECEIPT = 'usps_first_class_certified_return_receipt';
const LOB_ID_RE = /^ltr_[A-Za-z0-9_-]{1,200}$/;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function exactlyOne(rows) {
  return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
}

function httpsReceiptUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function receiptUrlFromLob(letter) {
  return httpsReceiptUrl(letter?.return_receipt?.url || letter?.return_receipt_url);
}

function canonicalPortalIdentity({ caller, bootstrap, userProfile, clientProfile, identity, client, affiliates }) {
  if (caller?.isSystem || !caller?.userId || !bootstrap?.has_portal_access) return false;
  if (!bootstrap?.profile?.id || bootstrap.profile.id !== userProfile?.id) return false;
  if (!userProfile?.client_id || userProfile.user_id !== caller.userId) return false;
  if (!clientProfile || clientProfile.id !== userProfile.id || clientProfile.client_id !== userProfile.client_id) return false;
  if (!identity || identity.id !== caller.userId || identity.role !== 'client') return false;
  if (!client || client.id !== userProfile.client_id) return false;
  if (!Array.isArray(affiliates) || affiliates.length !== 0) return false;

  const expectedEmail = normalizeEmail(caller.email);
  if (!expectedEmail) return false;
  const requiredEmails = [bootstrap.profile.email, userProfile.email, clientProfile.email, client.email];
  if (requiredEmails.some((email) => normalizeEmail(email) !== expectedEmail)) return false;
  if (identity.email && normalizeEmail(identity.email) !== expectedEmail) return false;
  return true;
}

function eligibleHistoricalLetter(letter, { lobId, clientId }) {
  return Boolean(
    letter?.id
      && letter.lob_id === lobId
      && letter.client_id === clientId
      && letter.mail_service === CERTIFIED_RETURN_RECEIPT
  );
}

async function supabaseJson(path, { url, key, token = key, method = 'GET', body }) {
  const response = await fetch(url + path, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let parsed = null;
  try { parsed = await response.json(); } catch { /* invalid upstream body fails closed */ }
  return { status: response.status, body: parsed };
}

function lobRequest(path, apiKey) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(apiKey + ':').toString('base64');
    const req = https.request({
      hostname: 'api.lob.com',
      port: 443,
      path,
      method: 'GET',
      headers: {
        Authorization: 'Basic ' + auth,
        'Content-Type': 'application/json',
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: null }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function authorizeHistoricalReceipt({ caller, lobId, supabaseUrl, anonKey, serviceKey }) {
  const bootstrapRes = await supabaseJson('/rest/v1/rpc/get_my_client_portal_bootstrap', {
    url: supabaseUrl,
    key: anonKey,
    token: caller.token,
    method: 'POST',
    body: {},
  });
  const bootstrap = bootstrapRes.status === 200 ? bootstrapRes.body : null;
  if (!bootstrap?.has_portal_access || !bootstrap?.profile?.id) return null;

  const userProfileRes = await supabaseJson(
    `/rest/v1/client_profiles?user_id=eq.${encodeURIComponent(caller.userId)}&select=id,client_id,user_id,email&limit=2`,
    { url: supabaseUrl, key: serviceKey }
  );
  const userProfile = userProfileRes.status === 200 ? exactlyOne(userProfileRes.body) : null;
  if (!userProfile?.client_id) return null;

  const clientId = userProfile.client_id;
  const [clientProfileRes, identityRes, clientRes, affiliateRes] = await Promise.all([
    supabaseJson(
      `/rest/v1/client_profiles?client_id=eq.${encodeURIComponent(clientId)}&select=id,client_id,user_id,email&limit=2`,
      { url: supabaseUrl, key: serviceKey }
    ),
    supabaseJson(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(caller.userId)}&select=id,email,role&limit=2`,
      { url: supabaseUrl, key: serviceKey }
    ),
    supabaseJson(
      `/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,email&limit=2`,
      { url: supabaseUrl, key: serviceKey }
    ),
    supabaseJson(
      `/rest/v1/affiliates?user_id=eq.${encodeURIComponent(caller.userId)}&select=id&limit=1`,
      { url: supabaseUrl, key: serviceKey }
    ),
  ]);

  const clientProfile = clientProfileRes.status === 200 ? exactlyOne(clientProfileRes.body) : null;
  const identity = identityRes.status === 200 ? exactlyOne(identityRes.body) : null;
  const client = clientRes.status === 200 ? exactlyOne(clientRes.body) : null;
  const affiliates = affiliateRes.status === 200 && Array.isArray(affiliateRes.body) ? affiliateRes.body : null;
  if (!canonicalPortalIdentity({ caller, bootstrap, userProfile, clientProfile, identity, client, affiliates })) {
    return null;
  }

  const letterRes = await supabaseJson(
    `/rest/v1/letters?lob_id=eq.${encodeURIComponent(lobId)}&client_id=eq.${encodeURIComponent(clientId)}`
      + '&select=id,client_id,lob_id,mail_service,return_receipt_url&limit=2',
    { url: supabaseUrl, key: serviceKey }
  );
  const letter = letterRes.status === 200 ? exactlyOne(letterRes.body) : null;
  return eligibleHistoricalLetter(letter, { lobId, clientId }) ? letter : null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let caller;
  try { caller = await requireAuth(event); }
  catch (error) { return error?.statusCode ? error : json(401, { error: 'Invalid session.' }); }
  if (caller.isSystem) return json(403, { error: 'Receipt access unavailable.' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid receipt request.' }); }
  const lobId = typeof payload.lobId === 'string' ? payload.lobId.trim() : '';
  if (!LOB_ID_RE.test(lobId)) return json(400, { error: 'Invalid receipt request.' });

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceKey) return json(500, { error: 'Server is not configured.' });

  let letter;
  try {
    letter = await authorizeHistoricalReceipt({ caller, lobId, supabaseUrl, anonKey, serviceKey });
  } catch {
    return json(503, { error: 'Receipt access is temporarily unavailable.' });
  }
  if (!letter) return json(404, { error: 'Return receipt not available.' });

  let receiptUrl = httpsReceiptUrl(letter.return_receipt_url);
  const mode = process.env.LOB_MODE || 'test';
  const apiKey = mode === 'live' ? process.env.LOB_LIVE_KEY : process.env.LOB_TEST_KEY;

  if (!receiptUrl) {
    if (!apiKey) return json(500, { error: 'Mail provider is not configured.' });
    try {
      const result = await lobRequest('/v1/letters/' + encodeURIComponent(lobId), apiKey);
      if (result.status !== 200) return json(502, { error: 'Return receipt is temporarily unavailable.' });
      receiptUrl = receiptUrlFromLob(result.body);
    } catch {
      return json(502, { error: 'Return receipt is temporarily unavailable.' });
    }
  }

  if (!receiptUrl) return json(404, { error: 'Return receipt not available.' });

  if (apiKey) {
    try {
      await archiveLobArtifact({
        lobId,
        letterId: letter.id,
        artifactType: 'return_receipt',
        sourceUrl: receiptUrl,
        apiKey,
        supabaseUrl,
        serviceKey,
      });
    } catch {
      // Retrieval remains available; archival is independently retried by the historical mail job.
      console.error('Historical return receipt archival failed.');
    }
  }

  return json(200, { return_receipt_url: receiptUrl });
};

module.exports._test = {
  CERTIFIED_RETURN_RECEIPT,
  canonicalPortalIdentity,
  eligibleHistoricalLetter,
  httpsReceiptUrl,
  receiptUrlFromLob,
};
