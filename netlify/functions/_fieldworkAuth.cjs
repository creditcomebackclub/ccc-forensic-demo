/**
 * Auth for Fieldwork functions only — validates JWT against the Fieldwork
 * Supabase project (FIELDWORK_SUPABASE_*), never the CCC project keys.
 */

const https = require('https');
const { fieldworkSupabase } = require('./_fieldworkEnv.cjs');

function httpJson(method, urlString, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const data = body == null ? null : JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method,
      headers: {
        ...headers,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = raw;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { /* keep string */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function requireFieldworkUser(event) {
  const headers = event.headers || {};
  const authHeader = headers.authorization || headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const err = new Error('Missing Authorization bearer token');
    err.statusCode = 401;
    throw err;
  }
  const token = authHeader.slice(7).trim();
  const { url, anonKey } = fieldworkSupabase();

  const userRes = await httpJson('GET', `${url}/auth/v1/user`, {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
  });

  if (userRes.status !== 200 || !userRes.body?.id) {
    const err = new Error('Invalid or expired Fieldwork session');
    err.statusCode = 401;
    throw err;
  }

  return {
    userId: userRes.body.id,
    email: userRes.body.email || '',
    token,
  };
}

async function fwRest(path, method, serviceKey, url, body, extraHeaders = {}) {
  return httpJson(method, `${url}${path}`, {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Prefer: 'return=representation',
    ...extraHeaders,
  }, body);
}

async function getOrCreateSubscriber(caller, profile = {}) {
  const { url, serviceKey } = fieldworkSupabase();
  const existing = await fwRest(
    `/rest/v1/fieldwork_subscribers?user_id=eq.${caller.userId}&select=*`,
    'GET',
    serviceKey,
    url,
  );
  if (existing.status >= 200 && existing.status < 300 && Array.isArray(existing.body) && existing.body[0]) {
    return existing.body[0];
  }

  const planId = profile.plan_id || 'pro';
  const credits = planId === 'starter' ? 2 : planId === 'unlimited' ? 10 : 5;
  const row = {
    user_id: caller.userId,
    email: profile.email || caller.email,
    full_name: profile.full_name || '',
    address_line1: profile.address_line1 || '',
    address_city: profile.address_city || '',
    address_state: profile.address_state || '',
    address_zip: profile.address_zip || '',
    plan_id: planId,
    mail_credits: credits,
  };

  const created = await fwRest('/rest/v1/fieldwork_subscribers', 'POST', serviceKey, url, row);
  if (created.status >= 200 && created.status < 300 && Array.isArray(created.body) && created.body[0]) {
    return created.body[0];
  }
  const err = new Error(
    (created.body && created.body.message) || 'Could not create Fieldwork subscriber',
  );
  err.statusCode = 500;
  throw err;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

module.exports = {
  requireFieldworkUser,
  getOrCreateSubscriber,
  fwRest,
  httpJson,
  json,
};
