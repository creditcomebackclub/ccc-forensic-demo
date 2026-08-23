const crypto = require('node:crypto');
const { createGuideDownloadToken } = require('./_guideDownloadToken.cjs');
const { exactNotificationPayload, signNotification } = require('./_publicIntakeNotification.cjs');

const MAX_BODY_BYTES = 4_096;
const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_RETENTION_SECONDS = 24 * 60 * 60;
const ALLOWED_KEYS = new Set(['name', 'email', 'phone', 'tier', 'ref', 'intent', 'website']);
const ALLOWED_TIERS = new Set(['Standard', 'VIP', 'Paid In Full']);
const ALLOWED_INTENTS = new Set(['consultation', 'guide_download']);
const REF_PATTERN = /^[0-9a-f]{6,36}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/;
const SENSITIVE_PATTERNS = [
  /\b\d{3}[- ]\d{2}[- ]\d{4}\b/,
  /\b(?:\d[ -]*?){13,19}\b/,
  /\b(?:ssn|social security|account number|routing number|password|passcode|date of birth|dob)\b/i,
];

const JSON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const CORS_HEADERS = {
  ...JSON_HEADERS,
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(statusCode, body, headers = JSON_HEADERS) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function eventHeader(event, name) {
  const target = name.toLowerCase();
  return String(Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === target)?.[1] || '');
}

function normalizeIntent(value) {
  if (value === undefined) return 'consultation';
  if (typeof value !== 'string') return null;
  const intent = value.trim().toLowerCase();
  return ALLOWED_INTENTS.has(intent) ? intent : null;
}

function intakeLeadFields(intent, affiliateLabel, tier) {
  const isGuide = intent === 'guide_download';
  return {
    lead_source: affiliateLabel ? `Affiliate: ${affiliateLabel}` : (isGuide ? 'Free Guide' : 'Website Intake'),
    lead_notes: isGuide ? 'Requested the free credit report accuracy guide' : (tier ? `Selected Tier: ${tier}` : null),
    consultation_status: isGuide ? null : 'requested',
    ...(isGuide ? { tags: ['source:freeguide'] } : {}),
  };
}

function rawBody(event) {
  const encoded = String(event.body || '');
  const body = event.isBase64Encoded ? Buffer.from(encoded, 'base64') : Buffer.from(encoded, 'utf8');
  if (!body.length || body.length > MAX_BODY_BYTES) throw new TypeError('invalid request');
  return body.toString('utf8');
}

function scalar(payload, key, { required = false, max, allowEmpty = true } = {}) {
  const value = payload[key];
  if (value === undefined) {
    if (required) throw new TypeError('invalid request');
    return '';
  }
  if (typeof value !== 'string') throw new TypeError('invalid request');
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > max || CONTROL_PATTERN.test(normalized)) {
    throw new TypeError('invalid request');
  }
  return normalized;
}

function isValidEmail(email) {
  if (!EMAIL_PATTERN.test(email)) return false;
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (!domain || domain.length > 253 || domain.includes('..')) return false;
  const labels = domain.split('.');
  return labels.length >= 2 && labels.every((label) => (
    label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  ));
}

function parsePayload(event) {
  const contentType = eventHeader(event, 'content-type').toLowerCase();
  if (contentType.split(';', 1)[0].trim() !== 'application/json') throw new TypeError('invalid request');

  let payload;
  try { payload = JSON.parse(rawBody(event)); }
  catch (_error) { throw new TypeError('invalid request'); }
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw new TypeError('invalid request');
  if (Object.keys(payload).some((key) => !ALLOWED_KEYS.has(key))) throw new TypeError('invalid request');

  const name = scalar(payload, 'name', { required: true, max: 120, allowEmpty: false }).replace(/\s+/g, ' ');
  const email = scalar(payload, 'email', { required: true, max: 254, allowEmpty: false }).toLowerCase();
  const phone = scalar(payload, 'phone', { max: 40 });
  const tier = scalar(payload, 'tier', { max: 20 });
  const ref = scalar(payload, 'ref', { max: 36 });
  const website = scalar(payload, 'website', { max: 200 });
  const intent = normalizeIntent(payload.intent);

  if (!isValidEmail(email) || !intent) throw new TypeError('invalid request');
  if (tier && !ALLOWED_TIERS.has(tier)) throw new TypeError('invalid request');
  if (ref && !REF_PATTERN.test(ref)) throw new TypeError('invalid request');
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(name) || pattern.test(phone))) {
    throw new TypeError('invalid request');
  }

  return { name, email, phone, tier, ref: ref.toLowerCase(), intent, website };
}

function clientRateKey(event, secret) {
  const ip = eventHeader(event, 'x-nf-client-connection-ip')
    || eventHeader(event, 'x-forwarded-for').split(',')[0].trim()
    || 'unknown';
  return 'intake:' + crypto.createHmac('sha256', secret).update(ip).digest('hex');
}

async function parseJsonResponse(response) {
  const raw = await response.text();
  try { return raw ? JSON.parse(raw) : null; }
  catch (_error) { return null; }
}

function serviceHeaders(serviceKey, hasBody = false) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function enforcePersistentRateLimit(event, supabaseUrl, serviceKey) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_public_intake_rate_limit`, {
    method: 'POST',
    headers: serviceHeaders(serviceKey, true),
    body: JSON.stringify({
      p_rate_key: clientRateKey(event, serviceKey),
      p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
      p_max_attempts: RATE_LIMIT_MAX,
      p_retention_seconds: RATE_LIMIT_RETENTION_SECONDS,
    }),
  });
  const result = await parseJsonResponse(response);
  if (!response.ok || !result || typeof result.allowed !== 'boolean') throw new Error('rate limiter unavailable');
  return result.allowed;
}

async function resolveOwnerUserId(supabaseUrl, serviceKey) {
  const configured = String(process.env.PUBLIC_INTAKE_OWNER_USER_ID || '').trim();
  if (configured && !UUID_PATTERN.test(configured)) throw new Error('public intake owner is invalid');
  const query = configured
    ? `profiles?id=eq.${encodeURIComponent(configured)}&role=eq.admin&select=id&limit=2`
    : 'profiles?role=eq.admin&select=id&limit=2';
  const response = await fetch(`${supabaseUrl}/rest/v1/${query}`, { headers: serviceHeaders(serviceKey) });
  const rows = await parseJsonResponse(response);
  if (!response.ok || !Array.isArray(rows) || rows.length !== 1 || !UUID_PATTERN.test(String(rows[0]?.id || ''))) {
    throw new Error('public intake owner is not uniquely configured');
  }
  return rows[0].id;
}

async function upsertLead({ payload, ownerUserId, supabaseUrl, serviceKey }) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/create_or_reuse_public_intake_lead`, {
    method: 'POST',
    headers: serviceHeaders(serviceKey, true),
    body: JSON.stringify({
      p_owner_user_id: ownerUserId,
      p_name: payload.name,
      p_email: payload.email,
      p_phone: payload.phone || null,
      p_tier: payload.tier || null,
      p_ref: payload.ref || null,
      p_intent: payload.intent,
    }),
  });
  const result = await parseJsonResponse(response);
  if (!response.ok || !result?.lead?.id || !result.lead.email) throw new Error('lead persistence failed');
  return result;
}

async function enqueueLeadNotifications({ result, intent, base, serviceKey }) {
  const notification = exactNotificationPayload({
    leadId: result.lead.id,
    affiliateId: result.attribution_added && result.affiliate?.id ? result.affiliate.id : null,
    intent,
  });
  const body = JSON.stringify(notification);
  const response = await fetch(base + '/.netlify/functions/public-intake-notify-background', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CCC-Intake-Signature': signNotification(body, serviceKey),
    },
    body,
    // The endpoint is a Netlify background function and should acknowledge
    // with 202 immediately. Never let a failed dispatch turn a durable lead
    // save into a false browser failure.
    signal: AbortSignal.timeout(1_500),
  });
  if (response.status !== 202) throw new Error('notification dispatch rejected');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed.' });

  let payload;
  try { payload = parsePayload(event); }
  catch (_error) { return reply(400, { error: 'Invalid request.' }); }

  // Keep the trap opaque: a filled honeypot gets the same public success
  // shape without touching the limiter, CRM, referral records, or email.
  if (payload.website) return reply(200, { success: true });

  const supabaseUrl = String(process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!supabaseUrl || !serviceKey) return reply(503, { error: 'Service temporarily unavailable.' });

  try {
    const allowed = await enforcePersistentRateLimit(event, supabaseUrl, serviceKey);
    if (!allowed) return reply(429, { error: 'Too many requests. Please try again later.' });
  } catch (_error) {
    console.error('Public intake rate limiter unavailable.');
    return reply(503, { error: 'Service temporarily unavailable.' });
  }

  try {
    const ownerUserId = await resolveOwnerUserId(supabaseUrl, serviceKey);
    const result = await upsertLead({ payload, ownerUserId, supabaseUrl, serviceKey });
    const lead = result.lead;
    const base = String(process.env.DEPLOY_URL || process.env.URL || 'https://ccc-forensic-demo.netlify.app').replace(/\/$/, '');

    // This call reaches a Netlify background function, whose only synchronous
    // work is accepting the job. Email delivery and affiliate notification
    // happen after this function returns and can never roll back the saved lead.
    try { await enqueueLeadNotifications({ result, intent: payload.intent, base, serviceKey }); }
    catch (_error) { console.error('Public intake notification dispatch unavailable.'); }

    return reply(200, {
      success: true,
      ...(payload.intent === 'guide_download'
        ? { downloadUrl: '/api/guide-download?token=' + encodeURIComponent(createGuideDownloadToken(lead.id, serviceKey)) }
        : {}),
    });
  } catch (_error) {
    console.error('Public intake persistence unavailable.');
    return reply(503, { error: 'Service temporarily unavailable.' });
  }
};

exports._test = {
  ALLOWED_TIERS,
  MAX_BODY_BYTES,
  clientRateKey,
  intakeLeadFields,
  isValidEmail,
  normalizeIntent,
  parsePayload,
  enqueueLeadNotifications,
};
