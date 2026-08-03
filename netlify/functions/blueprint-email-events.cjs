const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const EVENT_PRIORITY = {
  processed: 1,
  deferred: 2,
  delivered: 3,
  bounced: 4,
  blocked: 4,
  dropped: 4,
};

function verifySignature(event) {
  const key = process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY;
  if (!key) throw new Error('SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY is not configured.');
  const headers = event.headers || {};
  const signature = headers['x-twilio-email-event-webhook-signature'];
  const timestamp = headers['x-twilio-email-event-webhook-timestamp'];
  if (!signature || !timestamp) return false;
  const verifier = crypto.createVerify('sha256');
  verifier.update(String(timestamp) + String(event.body || ''));
  verifier.end();
  return verifier.verify(key.replace(/\\n/g, '\n'), signature, 'base64');
}

function artifactIdFrom(item) {
  return item?.recovery_blueprint_id
    || item?.custom_args?.recovery_blueprint_id
    || item?.unique_args?.recovery_blueprint_id
    || null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    if (!verifySignature(event)) return { statusCode: 401, body: 'Invalid webhook signature' };
    const events = JSON.parse(event.body || '[]');
    if (!Array.isArray(events)) return { statusCode: 400, body: 'Expected an event array' };

    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase server environment is not configured.');
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    // SendGrid can batch several lifecycle events for the same message. Keep
    // the most meaningful event in this request so a later "processed" row
    // cannot overwrite "delivered" or "bounced" from the same payload.
    const byArtifact = new Map();
    for (const item of events) {
      const id = artifactIdFrom(item);
      const kind = String(item?.event || '').toLowerCase();
      if (!id || !EVENT_PRIORITY[kind]) continue;
      const current = byArtifact.get(id);
      if (!current || EVENT_PRIORITY[kind] >= EVENT_PRIORITY[current.event]) byArtifact.set(id, item);
    }

    for (const [id, item] of byArtifact) {
      const kind = String(item.event).toLowerCase();
      const occurredAt = item.timestamp
        ? new Date(Number(item.timestamp) * 1000).toISOString()
        : new Date().toISOString();
      const patch = {
        delivery_status: kind,
        delivery_event_at: occurredAt,
        delivery_error: ['bounced', 'blocked', 'dropped'].includes(kind)
          ? String(item.reason || item.response || item.status || 'Delivery failed').slice(0, 1000)
          : null,
        updated_at: new Date().toISOString(),
      };
      if (kind === 'delivered') patch.delivered_at = occurredAt;
      const { error } = await db.from('recovery_blueprints').update(patch).eq('id', id);
      if (error) throw error;
    }

    return { statusCode: 204, body: '' };
  } catch (error) {
    console.error('[blueprint-email-events]', error);
    return { statusCode: 500, body: 'Webhook processing failed' };
  }
};

