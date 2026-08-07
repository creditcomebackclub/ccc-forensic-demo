// Staff notification emails triggered by verified client portal actions.
// Caller identity and client details always come from the session + DB —
// never from client-supplied name/email fields (avoids spoofed staff alerts).
const https = require('https');
const { requireAuth } = require('./_requireAuth.cjs');
const { sendEmail, isConfigured } = require('./_email.cjs');

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

function wrapHtml({ eyebrow, title, rows, footer }) {
  const rowHtml = (rows || []).map(([k, v]) => (
    `<tr><td style="padding:10px 14px;font-weight:600;width:140px;border-bottom:1px solid #F3F4F6;">${k}</td>`
    + `<td style="padding:10px 14px;border-bottom:1px solid #F3F4F6;">${v || '—'}</td></tr>`
  )).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#111;">
  <div style="background:#1B2A4A;padding:24px 32px;border-radius:4px 4px 0 0;">
    <h1 style="color:#C9A84C;margin:0;font-size:20px;">Credit Comeback Club</h1>
    <p style="color:#fff;margin:4px 0 0;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">${eyebrow}</p>
  </div>
  <div style="border:1px solid #ddd;border-top:none;padding:24px 32px;border-radius:0 0 4px 4px;">
    <p><strong>${title}</strong></p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">${rowHtml}</table>
    ${footer || ''}
    <div style="text-align:center;margin:28px 0 8px;">
      <a href="https://ccc-forensic-demo.netlify.app" style="background:#1B2A4A;color:#C9A84C;padding:12px 28px;text-decoration:none;border-radius:4px;font-weight:bold;font-size:13px;display:inline-block;">Open CRM &#8594;</a>
    </div>
  </div>
</body></html>`;
}

async function resolveClient(userId, supabaseUrl, serviceKey) {
  const profileRes = await supabaseRequest(
    '/rest/v1/client_profiles?user_id=eq.' + encodeURIComponent(userId)
      + '&select=full_name,email,client_id,onboarding_complete,billing_tier',
    'GET', null, supabaseUrl, serviceKey
  );
  const profile = Array.isArray(profileRes.body) && profileRes.body[0];
  if (!profile) return null;

  let client = null;
  if (profile.client_id) {
    const clientRes = await supabaseRequest(
      '/rest/v1/clients?id=eq.' + encodeURIComponent(profile.client_id)
        + '&select=id,name,email,phone,lead_drips_sent,lpoa_signed,billing_tier,is_vip',
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
      if (settings.emailOnboardingComplete === false) {
        return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'disabled' }) };
      }
      // Require enrollment actually complete (or LPOA signed) — don't trust the client flag alone.
      const onboarded = profile.onboarding_complete === true || (client && client.lpoa_signed === true);
      if (!onboarded) {
        return { statusCode: 409, body: JSON.stringify({ error: 'Enrollment is not complete yet' }) };
      }

      const markers = Array.isArray(client?.lead_drips_sent) ? client.lead_drips_sent : [];
      if (clientId && markers.includes(ONBOARDING_MARKER)) {
        return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'already_notified' }) };
      }

      const html = wrapHtml({
        eyebrow: 'Enrollment Complete',
        title: `${clientName} finished portal onboarding.`,
        rows: [
          ['Name', clientName],
          ['Email', clientEmail],
          ['Phone', client?.phone],
          ['Tier', client?.billing_tier || profile.billing_tier || '—'],
          ['VIP', client?.is_vip ? 'Yes' : 'No'],
          ['LPOA', client?.lpoa_signed ? 'Signed' : 'Pending'],
        ],
        footer: '<p style="font-size:13px;color:#4B5563;">ID, address proof, signature, and LPOA should now be on file. Open the client to review documents and start the campaign.</p>',
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

    const html = wrapHtml({
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
