const {
  MAX_NOTIFICATION_BODY_BYTES,
  exactNotificationPayload,
  verifyNotification,
} = require('./_publicIntakeNotification.cjs');

const ADMIN_EMAIL = 'chris@cccpartners.co';
const BACKGROUND_FETCH_TIMEOUT_MS = 15_000;

function boundedFetch(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(BACKGROUND_FETCH_TIMEOUT_MS) });
}

function reply(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
    body: JSON.stringify(body),
  };
}

function eventHeader(event, name) {
  const target = name.toLowerCase();
  return String(Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === target)?.[1] || '');
}

function serviceHeaders(serviceKey, hasBody = false) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function parseJsonResponse(response) {
  const raw = await response.text();
  try { return raw ? JSON.parse(raw) : null; }
  catch (_error) { return null; }
}

async function loadNotificationContext(payload, supabaseUrl, serviceKey) {
  const leadResponse = await boundedFetch(
    `${supabaseUrl}/rest/v1/clients?id=eq.${encodeURIComponent(payload.leadId)}`
      + '&select=id,user_id,name,email,lead_phone,lead_notes,referred_by&limit=2',
    { headers: serviceHeaders(serviceKey) },
  );
  const leads = await parseJsonResponse(leadResponse);
  if (!leadResponse.ok || !Array.isArray(leads) || leads.length !== 1) throw new Error('notification lead is unavailable');
  const lead = leads[0];
  if (String(lead.id || '').toLowerCase() !== payload.leadId || !lead.user_id || !lead.name || !lead.email) {
    throw new Error('notification lead is invalid');
  }

  let affiliate = null;
  if (payload.affiliateId) {
    if (String(lead.referred_by || '').toLowerCase() !== payload.affiliateId) {
      throw new Error('notification referral does not match the lead');
    }
    const affiliateResponse = await boundedFetch(
      `${supabaseUrl}/rest/v1/affiliates?id=eq.${encodeURIComponent(payload.affiliateId)}`
        + '&select=id,email,owner_user_id&limit=2',
      { headers: serviceHeaders(serviceKey) },
    );
    const affiliates = await parseJsonResponse(affiliateResponse);
    if (!affiliateResponse.ok || !Array.isArray(affiliates) || affiliates.length !== 1) {
      throw new Error('notification affiliate is unavailable');
    }
    affiliate = affiliates[0];
    if (
      String(affiliate.id || '').toLowerCase() !== payload.affiliateId
      || String(affiliate.owner_user_id || '') !== String(lead.user_id)
      || !affiliate.email
    ) throw new Error('notification affiliate is invalid');
  }

  return { lead, affiliate };
}

async function claimNotification({ eventKey, eventType, recipient, clientId, supabaseUrl, serviceKey }) {
  const response = await boundedFetch(`${supabaseUrl}/rest/v1/rpc/claim_automated_email_send`, {
    method: 'POST',
    headers: serviceHeaders(serviceKey, true),
    body: JSON.stringify({
      p_event_key: eventKey,
      p_event_type: eventType,
      p_recipient: String(recipient).trim().toLowerCase(),
      p_client_id: clientId,
    }),
  });
  const claim = await parseJsonResponse(response);
  if (!response.ok || !claim || typeof claim.claimed !== 'boolean') throw new Error('notification claim failed');
  if (claim.claimed && (!claim.id || !claim.idempotency_key)) throw new Error('notification claim is incomplete');
  return claim;
}

async function updateNotificationClaim({ claimId, patch, supabaseUrl, serviceKey }) {
  const response = await boundedFetch(`${supabaseUrl}/rest/v1/automated_email_sends?id=eq.${encodeURIComponent(claimId)}`, {
    method: 'PATCH',
    headers: { ...serviceHeaders(serviceKey, true), Prefer: 'return=minimal' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error('notification receipt update failed');
}

async function runClaimedNotification({ claimInput, invoke, supabaseUrl, serviceKey }) {
  const claim = await claimNotification({ ...claimInput, supabaseUrl, serviceKey });
  if (!claim.claimed) return { duplicate: true };
  try {
    await invoke();
    await updateNotificationClaim({
      claimId: claim.id,
      supabaseUrl,
      serviceKey,
      patch: { send_status: 'sent', sent_at: new Date().toISOString(), delivery_error: null },
    });
    return { sent: true };
  } catch (error) {
    await updateNotificationClaim({
      claimId: claim.id,
      supabaseUrl,
      serviceKey,
      patch: { send_status: 'failed', delivery_error: String(error?.message || error).slice(0, 1000) },
    }).catch((receiptError) => console.error('Public intake notification failure receipt unavailable:', receiptError.message));
    throw error;
  }
}

function selectedTier(leadNotes) {
  const match = /^Selected Tier: (Standard|VIP|Paid In Full)$/.exec(String(leadNotes || '').trim());
  return match ? match[1] : null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed.' });

  const supabaseUrl = String(process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!supabaseUrl || !serviceKey) return reply(503, { error: 'Service temporarily unavailable.' });

  if (event.isBase64Encoded || eventHeader(event, 'content-type').split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    return reply(400, { error: 'Invalid request.' });
  }
  const rawBody = String(event.body || '');
  if (!rawBody || Buffer.byteLength(rawBody) > MAX_NOTIFICATION_BODY_BYTES) return reply(400, { error: 'Invalid request.' });
  if (!verifyNotification(rawBody, eventHeader(event, 'x-ccc-intake-signature'), serviceKey)) {
    return reply(401, { error: 'Unauthorized.' });
  }

  let payload;
  try { payload = exactNotificationPayload(JSON.parse(rawBody)); }
  catch (_error) { return reply(400, { error: 'Invalid request.' }); }

  let context;
  try { context = await loadNotificationContext(payload, supabaseUrl, serviceKey); }
  catch (error) {
    console.error('Public intake notification context rejected:', error.message);
    return reply(403, { error: 'Notification context rejected.' });
  }

  const base = String(process.env.DEPLOY_URL || process.env.URL || 'https://credit-comeback-club.netlify.app').replace(/\/$/, '');
  const failures = [];
  const adminEventKey = `public_intake_admin:${payload.intent}:${context.lead.id}`;
  try {
    await runClaimedNotification({
      claimInput: {
        eventKey: adminEventKey,
        eventType: `public_intake_admin_${payload.intent}`,
        recipient: ADMIN_EMAIL,
        clientId: context.lead.id,
      },
      supabaseUrl,
      serviceKey,
      invoke: async () => {
        const response = await boundedFetch(base + '/.netlify/functions/send-lpoa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({
            action: 'admin_new_lead',
            leadName: context.lead.name,
            leadEmail: context.lead.email,
            leadPhone: context.lead.lead_phone,
            tier: selectedTier(context.lead.lead_notes),
          }),
        });
        if (!response.ok) throw new Error('admin notification delivery failed');
      },
    });
  } catch (error) {
    console.error('Public intake admin notification failed:', error.message);
    failures.push('admin');
  }

  if (context.affiliate) {
    try {
      await runClaimedNotification({
        claimInput: {
          eventKey: `public_intake_affiliate:${context.lead.id}:${context.affiliate.id}`,
          eventType: 'public_intake_affiliate_referral',
          recipient: context.affiliate.email,
          clientId: context.lead.id,
        },
        supabaseUrl,
        serviceKey,
        invoke: async () => {
          const response = await boundedFetch(base + '/.netlify/functions/notify-affiliate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({
              event: 'referral_received',
              clientId: context.lead.id,
              affiliateId: context.affiliate.id,
            }),
          });
          if (!response.ok) throw new Error('affiliate notification delivery failed');
        },
      });
    } catch (error) {
      console.error('Public intake affiliate notification failed:', error.message);
      failures.push('affiliate');
    }
  }

  return failures.length
    ? reply(500, { processed: true, notificationErrors: failures })
    : reply(200, { processed: true });
};

exports._test = {
  ADMIN_EMAIL,
  BACKGROUND_FETCH_TIMEOUT_MS,
  boundedFetch,
  claimNotification,
  loadNotificationContext,
  runClaimedNotification,
  selectedTier,
};
