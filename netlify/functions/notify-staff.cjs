// Staff notification emails triggered by verified client portal actions.
// Caller identity and client details always come from the session + DB —
// never from client-supplied name/email fields (avoids spoofed staff alerts).
const https = require('https');
const { requireAuth } = require('./_requireAuth.cjs');
const { sendEmail, isConfigured, wrapStaffEmail } = require('./_email.cjs');

const ADMIN_EMAIL = 'chris@cccpartners.co';
const ONBOARDING_MARKER = 'staff_onboarding_complete_notify';

function supabaseRequest(path, method, body, url, key, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const u = new URL(url + path);
    const options = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method,
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        ...extraHeaders,
      },
    };
    if (data != null) {
      options.headers['Content-Type'] = extraHeaders['Content-Type'] || 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const text = raw.toString('utf8');
        let parsed = text;
        try { parsed = text ? JSON.parse(text) : null; } catch (_) { /* keep text */ }
        resolve({ status: res.statusCode, body: parsed, raw: text });
      });
    });
    req.on('error', reject);
    if (data != null) req.write(data);
    req.end();
  });
}

async function loadNotificationSettings(supabaseUrl, serviceKey) {
  const defaults = {
    emailNewLeads: true,
    emailClientUploads: true,
    emailEscalations: true,
    emailOnboardingComplete: true,
  };
  try {
    // Authenticated object path — client-docs is private (same as daily-cron.cjs).
    const path = '/storage/v1/object/authenticated/client-docs/admin/settings.json';
    const res = await supabaseRequest(path, 'GET', null, supabaseUrl, serviceKey);
    if (res.status < 200 || res.status >= 300) return defaults;
    const parsed = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    if (!parsed || typeof parsed !== 'object') return defaults;
    return { ...defaults, ...(parsed.notifications || {}) };
  } catch (e) {
    console.warn('notify-staff: could not load settings, using defaults', e.message);
    return defaults;
  }
}

async function resolveClient(userId, supabaseUrl, serviceKey) {
  const profileRes = await supabaseRequest(
    '/rest/v1/client_profiles?user_id=eq.' + encodeURIComponent(userId)
      + '&select=full_name,email,client_id,onboarding_complete,agreement_signed_at,billing_tier',
    'GET', null, supabaseUrl, serviceKey
  );
  const profile = Array.isArray(profileRes.body) && profileRes.body[0];
  if (!profile) return null;

  let client = null;
  if (profile.client_id) {
    const clientRes = await supabaseRequest(
      '/rest/v1/clients?id=eq.' + encodeURIComponent(profile.client_id)
        + '&select=id,name,email,phone,lead_drips_sent,billing_tier,is_vip,referred_by',
      'GET', null, supabaseUrl, serviceKey
    );
    client = Array.isArray(clientRes.body) && clientRes.body[0];
  }
  return { profile, client };
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
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }
  if (!isConfigured()) {
    return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) };
  }

  let userId;
  try { ({ userId } = await requireAuth(event)); }
  catch (e) { if (e.statusCode) return e; throw e; }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (_) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const eventType = String(payload.event || '').trim();
  if (!['onboarding_complete', 'document_upload'].includes(eventType)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown event' }) };
  }

  const resolved = await resolveClient(userId, supabaseUrl, serviceKey);
  if (!resolved) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Client profile not found' }) };
  }
  const { profile, client } = resolved;
  const clientName = (client && client.name) || profile.full_name || 'Client';
  const clientEmail = (client && client.email) || profile.email || null;
  const clientId = (client && client.id) || profile.client_id || null;

  const settings = await loadNotificationSettings(supabaseUrl, serviceKey);

  try {
    if (eventType === 'onboarding_complete') {
      // The canonical wizard marks both fields only after the immutable service
      // agreement, disclosure acknowledgement, ID, and address proof are saved.
      const onboarded = profile.onboarding_complete === true && !!profile.agreement_signed_at;
      if (!onboarded) {
        return { statusCode: 409, body: JSON.stringify({ error: 'Enrollment is not complete yet' }) };
      }

      // Partner milestone is independent of staff email prefs / staff marker.
      if (client?.referred_by && clientId) {
        try {
          const base = process.env.URL || process.env.DEPLOY_URL || 'https://ccc-forensic-demo.netlify.app';
          const partnerRes = await fetch(base + '/.netlify/functions/notify-affiliate', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + serviceKey,
            },
            body: JSON.stringify({
              event: 'enrolled',
              clientId,
              affiliateId: client.referred_by,
            }),
          });
          if (!partnerRes.ok) console.warn('notify-staff: affiliate enrolled email failed', await partnerRes.text());
        } catch (e) {
          console.warn('notify-staff: affiliate enrolled email error', e.message);
        }
      }

      if (settings.emailOnboardingComplete === false) {
        return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'disabled' }) };
      }

      const markers = Array.isArray(client?.lead_drips_sent) ? client.lead_drips_sent : [];
      if (clientId && markers.includes(ONBOARDING_MARKER)) {
        return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'already_notified' }) };
      }

      const html = wrapStaffEmail({
        eyebrow: 'Enrollment Complete',
        title: `${clientName} finished portal onboarding.`,
        rows: [
          ['Name', clientName],
          ['Email', clientEmail],
          ['Phone', client?.phone],
          ['Tier', client?.billing_tier || profile.billing_tier || '—'],
          ['VIP', client?.is_vip ? 'Yes' : 'No'],
          ['Service Agreement', profile.agreement_signed_at ? 'Signed' : 'Pending'],
        ],
        footer: '<p style="font-size:13px;color:#4B5563;">The signed agreement, disclosure receipt, ID, and address proof are on file. Open the client to review the completed onboarding packet.</p>',
      });

      await sendEmail({
        to: ADMIN_EMAIL,
        subject: `✅ Onboarding complete: ${clientName}`,
        html,
        tags: { kind: 'staff_onboarding_complete' },
      });

      if (clientId) {
        await supabaseRequest(
          '/rest/v1/clients?id=eq.' + encodeURIComponent(clientId),
          'PATCH',
          { lead_drips_sent: [...markers, ONBOARDING_MARKER] },
          supabaseUrl,
          serviceKey,
          { Prefer: 'return=minimal' }
        ).catch((e) => console.warn('notify-staff: marker write failed', e.message));
      }

      return { statusCode: 200, body: JSON.stringify({ sent: true }) };
    }

    // document_upload
    if (settings.emailClientUploads === false) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'disabled' }) };
    }

    // Only allow a short allowlist of labels — never free-form subject content from the browser.
    const rawLabel = String(payload.docLabel || payload.docType || 'Document').slice(0, 80);
    const safeLabel = rawLabel.replace(/[<>&"']/g, '') || 'Document';

    const html = wrapStaffEmail({
      eyebrow: 'Client Document Upload',
      title: `${clientName} uploaded a document.`,
      rows: [
        ['Name', clientName],
        ['Email', clientEmail],
        ['Document', safeLabel],
      ],
      footer: '<p style="font-size:13px;color:#4B5563;">Review it under the client&rsquo;s Documents tab.</p>',
    });

    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `📎 Document upload: ${clientName} — ${safeLabel}`,
      html,
      tags: { kind: 'staff_client_upload' },
    });

    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  } catch (e) {
    console.error('notify-staff failed', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Notify failed' }) };
  }
};
