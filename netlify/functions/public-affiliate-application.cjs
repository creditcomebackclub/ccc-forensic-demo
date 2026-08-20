const { sendEmail, wrapClientEmail, wrapStaffEmail, escapeHtml } = require('./_email.cjs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function response(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function cleanText(value, max) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : null;
}

function normalizeWebsite(value) {
  const raw = cleanText(value, 500);
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
  } catch (_error) {
    return null;
  }
}

function normalizeApplication(payload = {}) {
  const name = cleanText(payload.name, 120);
  const email = String(payload.email || '').trim().toLowerCase().slice(0, 254);
  const phone = cleanText(payload.phone, 40);
  const company = cleanText(payload.company, 160);
  const websiteUrl = normalizeWebsite(payload.websiteUrl);
  const referralNotes = cleanText(payload.referralNotes, 1200);
  if (!name) return { error: 'Your name is required.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'A valid email is required.' };
  if (payload.websiteUrl && !websiteUrl) return { error: 'Enter a valid website or LinkedIn URL.' };
  if (payload.acknowledged !== true) return { error: 'Please confirm that you understand applications require approval.' };
  return { value: { name, email, phone, company, website_url: websiteUrl, referral_notes: referralNotes } };
}

async function rest(url, key, path, options = {}) {
  const result = await fetch(url + '/rest/v1/' + path, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await result.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_error) { body = text; }
  return { ok: result.ok, status: result.status, body };
}

async function applyRateLimit(event, supabaseUrl, serviceKey) {
  const ip = String(event.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const insert = await rest(supabaseUrl, serviceKey, 'public_intake_attempts', {
    method: 'POST', body: JSON.stringify({ ip }),
  });
  if (!insert.ok) throw new Error('Could not record intake attempt');
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const recent = await rest(
    supabaseUrl,
    serviceKey,
    `public_intake_attempts?ip=eq.${encodeURIComponent(ip)}&created_at=gte.${encodeURIComponent(since)}&select=id`
  );
  if (!recent.ok) throw new Error('Could not verify intake rate');
  return Array.isArray(recent.body) && recent.body.length > 5;
}

async function sendApplicationEmails(application) {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'creditcomebackclub@gmail.com';
  const staffHtml = wrapStaffEmail({
    eyebrow: 'Partner Program',
    title: 'New Affiliate Application',
    rows: [
      ['Name', application.name],
      ['Company', application.company || '—'],
      ['Email', application.email],
      ['Phone', application.phone || '—'],
      ['Website', application.website_url || '—'],
      ['Referral plan', application.referral_notes || '—'],
    ],
    footer: '<p style="font-size:13px;color:#444;margin:0;">Review this application in the Affiliates dashboard. Portal access has not been created or sent.</p>',
    ctaLabel: 'Review Application →',
  });
  const applicantHtml = wrapClientEmail({
    eyebrow: 'Partner Application Received',
    bodyHtml: `<p style="margin:0 0 14px;">Hi ${escapeHtml(application.name)},</p>`
      + '<p style="margin:0 0 14px;">Thanks for applying to partner with Credit Comeback Club. We received your application and will review it before activating any affiliate account.</p>'
      + '<p style="margin:0 0 14px;">If approved, you will receive a separate secure invitation to the partner portal with your confirmed commission rate and referral tools.</p>'
      + '<p style="margin:0;font-size:12px;color:#6B7280;">Submitting an application does not create portal access or guarantee acceptance into the program.</p>',
    cta: null,
  });
  await Promise.all([
    sendEmail({ to: adminEmail, subject: `New affiliate application: ${application.name}`, html: staffHtml }),
    sendEmail({ to: application.email, subject: 'We received your Credit Comeback Club partner application', html: applicantHtml }),
  ]);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return response(500, { error: 'Server not configured' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (_error) { return response(400, { error: 'Invalid application data' }); }

  // Silent honeypot success prevents simple form bots from adapting their payload.
  if (payload.faxNumber) return response(200, { success: true });

  const normalized = normalizeApplication(payload);
  if (normalized.error) return response(400, { error: normalized.error });
  const application = normalized.value;

  try {
    try {
      if (await applyRateLimit(event, supabaseUrl, serviceKey)) {
        return response(429, { error: 'Too many submissions—please try again later.' });
      }
    } catch (error) {
      // Netlify also applies an edge limit. Persistent bookkeeping remains
      // best-effort so a database hiccup does not discard a legitimate application.
      console.warn('Affiliate application rate-limit check failed:', error.message);
    }

    const adminResult = await rest(supabaseUrl, serviceKey, 'profiles?role=eq.admin&select=id&limit=1');
    const admin = Array.isArray(adminResult.body) ? adminResult.body[0] : null;
    if (!admin?.id) return response(500, { error: 'Partner applications are temporarily unavailable.' });

    // Public responses never reveal whether the email already belongs to an
    // affiliate or an existing application. Duplicate submissions are idempotent.
    const encodedEmail = encodeURIComponent(application.email);
    const [affiliateResult, pendingResult] = await Promise.all([
      rest(supabaseUrl, serviceKey, `affiliates?email=eq.${encodedEmail}&select=id&limit=1`),
      rest(supabaseUrl, serviceKey, `affiliate_applications?email=eq.${encodedEmail}&status=eq.pending&select=id&limit=1`),
    ]);
    if ((Array.isArray(affiliateResult.body) && affiliateResult.body.length)
      || (Array.isArray(pendingResult.body) && pendingResult.body.length)) {
      return response(200, { success: true });
    }

    const inserted = await rest(supabaseUrl, serviceKey, 'affiliate_applications', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ user_id: admin.id, ...application, source: 'public_link' }),
    });
    if (!inserted.ok) {
      const duplicate = inserted.status === 409 || /duplicate|unique/i.test(JSON.stringify(inserted.body || ''));
      if (duplicate) return response(200, { success: true });
      console.error('Affiliate application insert failed:', inserted.body);
      return response(500, { error: 'Could not submit your application. Please try again.' });
    }
    const saved = Array.isArray(inserted.body) ? inserted.body[0] : null;
    if (!saved) return response(500, { error: 'Could not submit your application. Please try again.' });

    try { await sendApplicationEmails(saved); }
    catch (error) {
      // The durable pending application is authoritative. Staff can still see
      // and approve it if an email provider is temporarily unavailable.
      console.warn('Affiliate application email failed:', error.message);
    }
    return response(200, { success: true });
  } catch (error) {
    console.error('Public affiliate application failed:', error.message);
    return response(500, { error: 'Could not submit your application. Please try again.' });
  }
};

exports._test = { cleanText, normalizeWebsite, normalizeApplication };
