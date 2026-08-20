// Partner-facing transactional emails. Staff/system callers only — affiliate
// identity and client details are always loaded from the DB, never trusted
// from free-form browser fields beyond ids / amounts we already wrote.
const https = require('https');
const { requireStaffOrSystem } = require('./_requireAuth.cjs');
const { sendEmail, isConfigured, wrapClientEmail, escapeHtml, BRAND } = require('./_email.cjs');

const EVENTS = [
  'referral_received',
  'enrolled',
  'exited',
  'commission_earned',
  'commission_paid',
  'monthly_summary',
];

const MARKERS = {
  referral_received: 'affiliate_referral_confirm',
  enrolled: 'affiliate_enrolled_notify',
};

const EXIT_REASON_LABELS = {
  graduated: 'Graduated — arc complete',
  non_payment: 'Non-payment',
  dissatisfied: 'Dissatisfied',
  went_dark: 'Went dark',
  client_paused: 'Client requested pause',
  price: 'Price',
  other: 'Other',
};

const DEFAULT_NOTIFS = {
  emailAffiliateReferralConfirm: true,
  emailAffiliateEnrolled: true,
  emailAffiliateExited: true,
  emailAffiliateCommission: true,
  emailAffiliateMonthlySummary: true,
};

function supabaseRequest(path, method, body, url, key, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const u = new URL(url + path);
    const options = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method,
      headers: { apikey: key, Authorization: 'Bearer ' + key, ...extraHeaders },
    };
    if (data != null) {
      options.headers['Content-Type'] = extraHeaders['Content-Type'] || 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = raw;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (_) { /* keep text */ }
        resolve({ status: res.statusCode, body: parsed, raw });
      });
    });
    req.on('error', reject);
    if (data != null) req.write(data);
    req.end();
  });
}

async function loadNotificationSettings(supabaseUrl, serviceKey) {
  try {
    const path = '/storage/v1/object/authenticated/client-docs/admin/settings.json';
    const res = await supabaseRequest(path, 'GET', null, supabaseUrl, serviceKey);
    if (res.status < 200 || res.status >= 300) return { ...DEFAULT_NOTIFS };
    const parsed = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_NOTIFS };
    return { ...DEFAULT_NOTIFS, ...(parsed.notifications || {}) };
  } catch (e) {
    console.warn('notify-affiliate: settings load failed', e.message);
    return { ...DEFAULT_NOTIFS };
  }
}

function settingKeyFor(event) {
  if (event === 'referral_received') return 'emailAffiliateReferralConfirm';
  if (event === 'enrolled') return 'emailAffiliateEnrolled';
  if (event === 'exited') return 'emailAffiliateExited';
  if (event === 'commission_earned' || event === 'commission_paid') return 'emailAffiliateCommission';
  if (event === 'monthly_summary') return 'emailAffiliateMonthlySummary';
  return null;
}

function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '$0.00';
  return '$' + v.toFixed(2);
}

function firstName(name) {
  const part = String(name || '').trim().split(/\s+/)[0];
  return part || 'there';
}

async function loadAffiliate(id, supabaseUrl, serviceKey) {
  if (!id) return null;
  const res = await supabaseRequest(
    '/rest/v1/affiliates?id=eq.' + encodeURIComponent(id)
      + '&select=id,name,email,company,commission_rate&limit=1',
    'GET', null, supabaseUrl, serviceKey
  );
  return Array.isArray(res.body) ? res.body[0] : null;
}

async function loadClient(id, supabaseUrl, serviceKey) {
  if (!id) return null;
  const res = await supabaseRequest(
    '/rest/v1/clients?id=eq.' + encodeURIComponent(id)
      + '&select=id,name,email,phone,status,billing_status,exit_reason,referred_by,referral_fee,ledger,lead_drips_sent,lpoa_signed&limit=1',
    'GET', null, supabaseUrl, serviceKey
  );
  return Array.isArray(res.body) ? res.body[0] : null;
}

async function appendMarker(clientId, markers, marker, supabaseUrl, serviceKey) {
  if (!clientId || !marker) return;
  if (markers.includes(marker)) return;
  await supabaseRequest(
    '/rest/v1/clients?id=eq.' + encodeURIComponent(clientId),
    'PATCH',
    { lead_drips_sent: [...markers, marker] },
    supabaseUrl,
    serviceKey,
    { Prefer: 'return=minimal' }
  ).catch((e) => console.warn('notify-affiliate: marker write failed', e.message));
}

function partnerShell({ affiliateName, eyebrow, bodyHtml, preheader }) {
  return wrapClientEmail({
    eyebrow,
    preheader,
    bodyHtml: `<p style="margin:0 0 14px;">Hi ${escapeHtml(firstName(affiliateName))},</p>` + bodyHtml
      + `<p style="margin:18px 0 0;font-size:12px;color:${BRAND.muted};">Questions? Reply to this email or call ${BRAND.phone}.</p>`,
    cta: { href: BRAND.portalUrl, label: 'Open Partner Portal →' },
  });
}

async function sendReferralReceived({ affiliate, client }) {
  const subject = `We received your referral: ${client.name}`;
  const html = partnerShell({
    affiliateName: affiliate.name,
    eyebrow: 'Referral Received',
    preheader: `${client.name} is in our pipeline.`,
    bodyHtml:
      `<p style="margin:0 0 14px;">Thanks — <strong>${escapeHtml(client.name)}</strong> is now in the Credit Comeback Club pipeline.</p>`
      + `<table style="width:100%;border-collapse:collapse;margin:0 0 14px;font-size:13px;">`
      + `<tr><td style="padding:8px 0;color:${BRAND.muted};width:110px;">Name</td><td style="padding:8px 0;">${escapeHtml(client.name)}</td></tr>`
      + `<tr><td style="padding:8px 0;color:${BRAND.muted};">Email</td><td style="padding:8px 0;">${escapeHtml(client.email || '—')}</td></tr>`
      + `<tr><td style="padding:8px 0;color:${BRAND.muted};">Phone</td><td style="padding:8px 0;">${escapeHtml(client.phone || '—')}</td></tr>`
      + `</table>`
      + `<p style="margin:0;font-size:13px;color:${BRAND.muted};">We&rsquo;ll handle consultation, enrollment, and the full credit repair process. You&rsquo;ll get another note when they enroll, and commission updates as revenue clears.</p>`,
  });
  await sendEmail({ to: affiliate.email, subject, html, tags: { kind: 'affiliate_referral_received' } });
}

async function sendEnrolled({ affiliate, client }) {
  const subject = `${client.name} enrolled — commission tracking is live`;
  const html = partnerShell({
    affiliateName: affiliate.name,
    eyebrow: 'Client Enrolled',
    preheader: `${client.name} signed authorization and completed enrollment.`,
    bodyHtml:
      `<p style="margin:0 0 14px;"><strong>${escapeHtml(client.name)}</strong> finished enrollment (authorization on file). They&rsquo;re now an active Credit Comeback Club client.</p>`
      + `<p style="margin:0;font-size:13px;color:${BRAND.muted};">Your commission accrues on the First Work Fee and every ongoing monthly payment that clears. Track status anytime in your partner portal.</p>`,
  });
  await sendEmail({ to: affiliate.email, subject, html, tags: { kind: 'affiliate_enrolled' } });
}

async function sendExited({ affiliate, client, billingStatus, exitReason }) {
  const status = billingStatus || client.billing_status || 'Inactive';
  const reasonKey = exitReason || client.exit_reason;
  const reasonLabel = reasonKey ? (EXIT_REASON_LABELS[reasonKey] || reasonKey) : null;
  const subject = `Update on ${client.name}: ${status}`;
  const html = partnerShell({
    affiliateName: affiliate.name,
    eyebrow: 'Referral Status Update',
    preheader: `${client.name} is now ${status}.`,
    bodyHtml:
      `<p style="margin:0 0 14px;">A status change on your referral <strong>${escapeHtml(client.name)}</strong>:</p>`
      + `<table style="width:100%;border-collapse:collapse;margin:0 0 14px;font-size:13px;">`
      + `<tr><td style="padding:8px 0;color:${BRAND.muted};width:110px;">Status</td><td style="padding:8px 0;"><strong>${escapeHtml(status)}</strong></td></tr>`
      + (reasonLabel ? `<tr><td style="padding:8px 0;color:${BRAND.muted};">Reason</td><td style="padding:8px 0;">${escapeHtml(reasonLabel)}</td></tr>` : '')
      + `</table>`
      + `<p style="margin:0;font-size:13px;color:${BRAND.muted};">Commission already earned remains payable. New accrual stops if recurring payments stop.</p>`,
  });
  await sendEmail({ to: affiliate.email, subject, html, tags: { kind: 'affiliate_exited' } });
}

async function sendCommissionEarned({ affiliate, client, amount, revenueAmount }) {
  const subject = `Commission earned: ${money(amount)} from ${client.name}`;
  const html = partnerShell({
    affiliateName: affiliate.name,
    eyebrow: 'Commission Earned',
    preheader: `You earned ${money(amount)} on ${client.name}.`,
    bodyHtml:
      `<p style="margin:0 0 14px;">Revenue cleared on your referral <strong>${escapeHtml(client.name)}</strong>.</p>`
      + `<table style="width:100%;border-collapse:collapse;margin:0 0 14px;font-size:13px;">`
      + (revenueAmount != null ? `<tr><td style="padding:8px 0;color:${BRAND.muted};width:140px;">Client payment</td><td style="padding:8px 0;">${escapeHtml(money(revenueAmount))}</td></tr>` : '')
      + `<tr><td style="padding:8px 0;color:${BRAND.muted};width:140px;">Your commission</td><td style="padding:8px 0;"><strong>${escapeHtml(money(amount))}</strong></td></tr>`
      + `</table>`
      + `<p style="margin:0;font-size:13px;color:${BRAND.muted};">This amount is owed until Credit Comeback Club records a payout. You&rsquo;ll get a separate email when it&rsquo;s paid.</p>`,
  });
  await sendEmail({ to: affiliate.email, subject, html, tags: { kind: 'affiliate_commission_earned' } });
}

async function sendCommissionPaid({ affiliate, client, amount, paidAt }) {
  const paidLabel = paidAt
    ? new Date(paidAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;
  const subject = `Commission paid: ${money(amount)}${client?.name ? ` — ${client.name}` : ''}`;
  const html = partnerShell({
    affiliateName: affiliate.name,
    eyebrow: 'Commission Paid',
    preheader: `${money(amount)} was marked paid to you.`,
    bodyHtml:
      `<p style="margin:0 0 14px;">A commission payout has been recorded for you.</p>`
      + `<table style="width:100%;border-collapse:collapse;margin:0 0 14px;font-size:13px;">`
      + `<tr><td style="padding:8px 0;color:${BRAND.muted};width:110px;">Amount</td><td style="padding:8px 0;"><strong>${escapeHtml(money(amount))}</strong></td></tr>`
      + (client?.name ? `<tr><td style="padding:8px 0;color:${BRAND.muted};">Client</td><td style="padding:8px 0;">${escapeHtml(client.name)}</td></tr>` : '')
      + (paidLabel ? `<tr><td style="padding:8px 0;color:${BRAND.muted};">Paid on</td><td style="padding:8px 0;">${escapeHtml(paidLabel)}</td></tr>` : '')
      + `</table>`
      + `<p style="margin:0;font-size:13px;color:${BRAND.muted};">Full history is available in your partner portal.</p>`,
  });
  await sendEmail({ to: affiliate.email, subject, html, tags: { kind: 'affiliate_commission_paid' } });
}

function isRecognized(tx) {
  return tx && (tx.type === 'Payment' || (tx.type === 'Invoice' && tx.status === 'Paid'));
}

function commissionRate(client, affiliate) {
  const override = client.referral_fee;
  const pct = (override !== null && override !== undefined)
    ? override
    : ((affiliate && affiliate.commission_rate) || 0.20) * 100;
  return pct / 100;
}

async function sendMonthlySummaries(supabaseUrl, serviceKey, monthKey) {
  const affRes = await supabaseRequest(
    '/rest/v1/affiliates?select=id,name,email,company,commission_rate&email=not.is.null',
    'GET', null, supabaseUrl, serviceKey
  );
  const affiliates = Array.isArray(affRes.body) ? affRes.body : [];
  let sent = 0;

  for (const affiliate of affiliates) {
    if (!affiliate.email) continue;

    const clientsRes = await supabaseRequest(
      '/rest/v1/clients?referred_by=eq.' + encodeURIComponent(affiliate.id)
        + '&select=id,name,status,billing_status,referral_fee,ledger,created_at',
      'GET', null, supabaseUrl, serviceKey
    );
    const clients = Array.isArray(clientsRes.body) ? clientsRes.body : [];
    if (!clients.length) continue;

    const payoutsRes = await supabaseRequest(
      '/rest/v1/commission_payouts?affiliate_id=eq.' + encodeURIComponent(affiliate.id)
        + '&select=client_id,amount,paid_at',
      'GET', null, supabaseUrl, serviceKey
    );
    const payouts = Array.isArray(payoutsRes.body) ? payoutsRes.body : [];

    let earned = 0;
    let paid = 0;
    let active = 0;
    let leads = 0;
    for (const c of clients) {
      if (c.status === 'lead') leads += 1;
      else if (!c.billing_status || c.billing_status === 'Active') active += 1;
      const rate = commissionRate(c, affiliate);
      const ledger = Array.isArray(c.ledger) ? c.ledger : [];
      const clientEarned = ledger.filter(isRecognized).reduce((s, tx) => s + (parseFloat(tx.amount) || 0) * rate, 0);
      earned += clientEarned;
      const clientPaid = payouts
        .filter((p) => p.client_id === c.id)
        .reduce((s, p) => s + Math.max(0, parseFloat(p.amount) || 0), 0);
      paid += Math.min(clientEarned, clientPaid);
    }
    const owed = Math.max(0, earned - paid);

    const monthPaid = payouts
      .filter((p) => p.paid_at && String(p.paid_at).slice(0, 7) === monthKey)
      .reduce((s, p) => s + Math.max(0, parseFloat(p.amount) || 0), 0);

    const subject = `Partner summary — ${monthKey}`;
    const html = partnerShell({
      affiliateName: affiliate.name,
      eyebrow: 'Monthly Partner Summary',
      preheader: `${clients.length} referrals · ${money(owed)} outstanding`,
      bodyHtml:
        `<p style="margin:0 0 14px;">Here&rsquo;s your Credit Comeback Club partner snapshot for <strong>${escapeHtml(monthKey)}</strong>.</p>`
        + `<table style="width:100%;border-collapse:collapse;margin:0 0 14px;font-size:13px;">`
        + `<tr><td style="padding:8px 0;color:${BRAND.muted};width:160px;">Total referrals</td><td style="padding:8px 0;">${clients.length}</td></tr>`
        + `<tr><td style="padding:8px 0;color:${BRAND.muted};">Open leads</td><td style="padding:8px 0;">${leads}</td></tr>`
        + `<tr><td style="padding:8px 0;color:${BRAND.muted};">Active clients</td><td style="padding:8px 0;">${active}</td></tr>`
        + `<tr><td style="padding:8px 0;color:${BRAND.muted};">Lifetime earned</td><td style="padding:8px 0;">${escapeHtml(money(earned))}</td></tr>`
        + `<tr><td style="padding:8px 0;color:${BRAND.muted};">Lifetime paid</td><td style="padding:8px 0;">${escapeHtml(money(paid))}</td></tr>`
        + `<tr><td style="padding:8px 0;color:${BRAND.muted};">Outstanding</td><td style="padding:8px 0;"><strong>${escapeHtml(money(owed))}</strong></td></tr>`
        + `<tr><td style="padding:8px 0;color:${BRAND.muted};">Paid this month</td><td style="padding:8px 0;">${escapeHtml(money(monthPaid))}</td></tr>`
        + `</table>`,
    });
    await sendEmail({ to: affiliate.email, subject, html, tags: { kind: 'affiliate_monthly_summary' } });
    sent += 1;
  }
  return sent;
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

  try {
    await requireStaffOrSystem(event);
  } catch (e) {
    if (e.statusCode) return e;
    throw e;
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (_) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const eventType = String(payload.event || '').trim();
  if (!EVENTS.includes(eventType)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown event' }) };
  }

  const settings = await loadNotificationSettings(supabaseUrl, serviceKey);
  const gate = settingKeyFor(eventType);
  if (gate && settings[gate] === false) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'disabled' }) };
  }

  try {
    if (eventType === 'monthly_summary') {
      const monthKey = String(payload.monthKey || new Date().toISOString().slice(0, 7));
      const sent = await sendMonthlySummaries(supabaseUrl, serviceKey, monthKey);
      return { statusCode: 200, body: JSON.stringify({ sent: true, count: sent }) };
    }

    let client = null;
    if (payload.clientId) {
      client = await loadClient(payload.clientId, supabaseUrl, serviceKey);
      if (!client) return { statusCode: 404, body: JSON.stringify({ error: 'Client not found' }) };
    }

    const affiliateId = payload.affiliateId || client?.referred_by;
    if (!affiliateId) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'no_affiliate' }) };
    }
    const affiliate = await loadAffiliate(affiliateId, supabaseUrl, serviceKey);
    if (!affiliate?.email) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'no_affiliate_email' }) };
    }
    if (client && client.referred_by && client.referred_by !== affiliate.id) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Affiliate does not own this client' }) };
    }

    const markers = Array.isArray(client?.lead_drips_sent) ? client.lead_drips_sent : [];
    const onceMarker = MARKERS[eventType];
    if (onceMarker && markers.includes(onceMarker)) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'already_notified' }) };
    }

    if (eventType === 'referral_received') {
      if (!client) return { statusCode: 400, body: JSON.stringify({ error: 'clientId required' }) };
      await sendReferralReceived({ affiliate, client });
      await appendMarker(client.id, markers, onceMarker, supabaseUrl, serviceKey);
    } else if (eventType === 'enrolled') {
      if (!client) return { statusCode: 400, body: JSON.stringify({ error: 'clientId required' }) };
      if (!client.lpoa_signed) {
        return { statusCode: 409, body: JSON.stringify({ error: 'Client has not enrolled yet' }) };
      }
      await sendEnrolled({ affiliate, client });
      await appendMarker(client.id, markers, onceMarker, supabaseUrl, serviceKey);
    } else if (eventType === 'exited') {
      if (!client) return { statusCode: 400, body: JSON.stringify({ error: 'clientId required' }) };
      const status = payload.billingStatus || client.billing_status;
      if (!['Inactive', 'Graduated', 'Paused'].includes(status)) {
        return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'not_exit_status' }) };
      }
      await sendExited({
        affiliate,
        client,
        billingStatus: status,
        exitReason: payload.exitReason || client.exit_reason,
      });
    } else if (eventType === 'commission_earned') {
      if (!client) return { statusCode: 400, body: JSON.stringify({ error: 'clientId required' }) };
      const amount = parseFloat(payload.amount);
      if (!(amount > 0.004)) {
        return { statusCode: 400, body: JSON.stringify({ error: 'amount required' }) };
      }
      await sendCommissionEarned({
        affiliate,
        client,
        amount,
        revenueAmount: payload.revenueAmount != null ? parseFloat(payload.revenueAmount) : null,
      });
    } else if (eventType === 'commission_paid') {
      const amount = parseFloat(payload.amount);
      if (!(amount > 0.004)) {
        return { statusCode: 400, body: JSON.stringify({ error: 'amount required' }) };
      }
      await sendCommissionPaid({
        affiliate,
        client: client || { name: payload.clientName || null },
        amount,
        paidAt: payload.paidAt || null,
      });
    }

    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  } catch (e) {
    console.error('notify-affiliate failed', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Notify failed' }) };
  }
};
