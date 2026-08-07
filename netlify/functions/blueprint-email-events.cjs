const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

// Map Resend event types → delivery_status values stored on recovery_blueprints.
const EVENT_PRIORITY = {
  sent: 1,
  processed: 1,
  delivery_delayed: 2,
  deferred: 2,
  delivered: 3,
  bounced: 4,
  failed: 4,
  complained: 4,
  suppressed: 4,
  blocked: 4,
  dropped: 4,
};

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function signingKey(secret) {
  const raw = String(secret || '').trim();
  if (!raw) throw new Error('RESEND_WEBHOOK_SECRET is not configured.');
  if (raw.startsWith('whsec_')) return Buffer.from(raw.slice(6), 'base64');
  try {
    return Buffer.from(raw, 'base64');
  } catch {
    return Buffer.from(raw, 'utf8');
  }
}

function verifyResendSignature(event) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) throw new Error('RESEND_WEBHOOK_SECRET is not configured.');
  const headers = event.headers || {};
  const id = headers['svix-id'] || headers['Svix-Id'];
  const timestamp = headers['svix-timestamp'] || headers['Svix-Timestamp'];
  const signatureHeader = headers['svix-signature'] || headers['Svix-Signature'];
  if (!id || !timestamp || !signatureHeader) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const payload = String(event.body || '');
  const expected = crypto
    .createHmac('sha256', signingKey(secret))
    .update(`${id}.${timestamp}.${payload}`)
    .digest('base64');

  return String(signatureHeader)
    .split(' ')
    .some((part) => {
      const [version, signature] = part.split(',');
      return version === 'v1' && signature && safeEqual(signature, expected);
    });
}

function normalizeKind(type) {
  const raw = String(type || '').toLowerCase();
  const stripped = raw.startsWith('email.') ? raw.slice(6) : raw;
  if (stripped === 'delivery_delayed') return 'deferred';
  if (stripped === 'failed' || stripped === 'suppressed') return 'dropped';
  if (stripped === 'complained') return 'bounced';
  if (stripped === 'sent') return 'processed';
  return stripped;
}

function artifactIdFrom(payload) {
  const data = payload?.data || payload || {};
  const tags = data.tags || {};
  return tags.recovery_blueprint_id
    || tags.recovery_blueprint
    || data.recovery_blueprint_id
    || null;
}

function emailIdFrom(payload) {
  return payload?.data?.email_id || payload?.email_id || null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    if (!verifyResendSignature(event)) return { statusCode: 401, body: 'Invalid webhook signature' };
    const payload = JSON.parse(event.body || '{}');
    // Resend sends one event object per request (not a SendGrid-style array).
    const items = Array.isArray(payload) ? payload : [payload];

    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase server environment is not configured.');
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: ws } });

    const byArtifact = new Map();
    for (const item of items) {
      const kind = normalizeKind(item?.type || item?.event);
      if (!EVENT_PRIORITY[kind]) continue;
      const id = artifactIdFrom(item);
      const emailId = emailIdFrom(item);
      const keyId = id || (emailId ? `email:${emailId}` : null);
      if (!keyId) continue;
      const current = byArtifact.get(keyId);
      if (!current || EVENT_PRIORITY[kind] >= EVENT_PRIORITY[current.kind]) {
        byArtifact.set(keyId, { kind, item, artifactId: id, emailId });
      }
    }

    for (const entry of byArtifact.values()) {
      const { kind, item, artifactId, emailId } = entry;
      const occurredAt = item.created_at
        ? new Date(item.created_at).toISOString()
        : (item.data?.created_at ? new Date(item.data.created_at).toISOString() : new Date().toISOString());
      const patch = {
        delivery_status: kind,
        delivery_event_at: occurredAt,
        delivery_error: ['bounced', 'blocked', 'dropped'].includes(kind)
          ? String(item.data?.bounce?.message || item.data?.failed?.reason || item.data?.error || kind).slice(0, 1000)
          : null,
        updated_at: new Date().toISOString(),
      };
      if (kind === 'delivered') patch.delivered_at = occurredAt;
      if (emailId) patch.sendgrid_message_id = emailId;

      let query = db.from('recovery_blueprints').update(patch);
      if (artifactId) query = query.eq('id', artifactId);
      else query = query.eq('sendgrid_message_id', emailId);
      const { error } = await query;
      if (error) throw error;
    }

    return { statusCode: 204, body: '' };
  } catch (error) {
    console.error('[blueprint-email-events]', error);
    return { statusCode: 500, body: 'Webhook processing failed' };
  }
};

exports._normalizeKind = normalizeKind;
exports._verifyResendSignature = verifyResendSignature;
