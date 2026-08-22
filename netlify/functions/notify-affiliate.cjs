// Partner-facing transactional emails. Staff/system callers only — affiliate
// identity and client/financial details are always loaded from the DB. The
// caller may identify an exact durable row, but never supplies email facts.
const https = require('https');
const { requireStaffOrSystem } = require('./_requireAuth.cjs');
const { sendEmail, isConfigured, wrapClientEmail, escapeHtml, BRAND } = require('./_email.cjs');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  graduated: 'Service completed',
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
      + '&select=id,name,email,company,commission_rate,owner_user_id&limit=2',
    'GET', null, supabaseUrl, serviceKey
  );
  return Array.isArray(res.body) && res.body.length === 1 ? res.body[0] : null;
}

async function loadClient(id, supabaseUrl, serviceKey) {
  if (!id) return null;
  const res = await supabaseRequest(
    '/rest/v1/clients?id=eq.' + encodeURIComponent(id)
      + '&select=id,name,email,phone,status,billing_status,exit_reason,referred_by,referral_fee,ledger,lead_drips_sent,lpoa_signed,user_id&limit=2',
    'GET', null, supabaseUrl, serviceKey
  );
  return Array.isArray(res.body) && res.body.length === 1 ? res.body[0] : null;
}

async function loadPayout(id, supabaseUrl, serviceKey) {
  if (!id) return null;
  const res = await supabaseRequest(
    '/rest/v1/commission_payouts?id=eq.' + encodeURIComponent(id)
      + '&select=id,affiliate_id,client_id,amount,paid_at,paid_by&limit=2',
    'GET', null, supabaseUrl, serviceKey
  );
  return Array.isArray(res.body) && res.body.length === 1 ? res.body[0] : null;
}

async function hasCompletedEnrollment(client, supabaseUrl, serviceKey) {
  if (!client?.id) return false;
  const res = await supabaseRequest(
    '/rest/v1/client_profiles?client_id=eq.' + encodeURIComponent(client.id)
      + '&select=onboarding_complete,agreement_signed_at&limit=1',
    'GET', null, supabaseUrl, serviceKey
  );
  if (res.status < 200 || res.status >= 300) return false;
  if (Array.isArray(res.body) && res.body.length) {
    const profile = res.body[0];
    return profile.onboarding_complete === true && !!profile.agreement_signed_at;
  }
  // Grandfathered clients may predate the service-agreement wizard. Preserve
  // that historical enrollment signal only when no current profile exists.
  return client.lpoa_signed === true;
}

async function appendMarker(clientId, markers, marker, supabaseUrl, serviceKey) {
  if (!clientId || !marker) return;
  if (markers.includes(marker)) return;
  const result = await supabaseRequest(
    '/rest/v1/clients?id=eq.' + encodeURIComponent(clientId),
    'PATCH',
    { lead_drips_sent: [...markers, marker] },
    supabaseUrl,
    serviceKey,
    { Prefer: 'return=minimal' }
  );
  if (result.status < 200 || result.status >= 300) {
    throw new Error('Could not persist affiliate notification receipt');
  }
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
      + `<p style="margin:0;font-size:13px;color:${BRAND.muted};">CCC will offer a free current three-bureau review and staff-reviewed Recovery Blueprint before engagement. You&rsquo;ll receive another note only if the prospect later completes secure service-agreement onboarding, plus commission updates when eligible revenue clears.</p>`,
  });
  await sendEmail({ to: affiliate.email, subject, html, tags: { kind: 'affiliate_referral_received' } });
}

async function sendEnrolled({ affiliate, client }) {
  const subject = `${client.name} enrolled — commission tracking is live`;
  const html = partnerShell({
    affiliateName: affiliate.name,
    eyebrow: 'Client Enrolled',
    preheader: `${client.name} completed secure service-agreement onboarding.`,
    bodyHtml:
      `<p style="margin:0 0 14px;"><strong>${escapeHtml(client.name)}</strong> finished the secure disclosure, service-agreement, document-upload, and signature steps. They&rsquo;re now enrolled as a Credit Comeback Club client.</p>`
      + `<p style="margin:0;font-size:13px;color:${BRAND.muted};">Commission applies only to eligible cleared revenue under your saved partner terms. Track the authoritative status and transaction history in your partner portal.</p>`,
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

async function sendMonthlySummaries(supabaseUrl, serviceKey, monthKey) {
  const { computeClientCommission } = await import('../../src/utils/affiliateCommission.js');
  const affRes = await supabaseRequest(
    '/rest/v1/affiliates?select=id,name,email,company,commission_rate,owner_user_id&email=not.is.null&owner_user_id=not.is.null',
    'GET', null, supabaseUrl, serviceKey
  );
  const affiliates = Array.isArray(affRes.body) ? affRes.body : [];
  let sent = 0;

  for (const affiliate of affiliates) {
    if (!affiliate.email) continue;

    const clientsRes = await supabaseRequest(
      '/rest/v1/clients?referred_by=eq.' + encodeURIComponent(affiliate.id)
        + '&user_id=eq.' + encodeURIComponent(affiliate.owner_user_id)
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
      const commission = computeClientCommission(
        c,
        affiliate,
        payouts.filter((p) => p.client_id === c.id),
      );
      earned += commission.earned;
      paid += commission.paid;
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

function previousMonthKey(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7);
}

function exactLedgerTransaction(client, id) {
  if (!id) return null;
  const matches = (Array.isArray(client?.ledger) ? client.ledger : [])
    .filter((transaction) => String(transaction?.id || '') === String(id));
  return matches.length === 1 ? matches[0] : null;
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

  let caller;
  try {
    caller = await requireStaffOrSystem(event);
  } catch (e) {
    if (e.statusCode) return e;
    throw e;
  }
  if (!caller.isSystem && caller.role !== 'admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Owner access required' }) };
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
      if (!caller.isSystem) {
        return { statusCode: 403, body: JSON.stringify({ error: 'System job required' }) };
      }
      const monthKey = previousMonthKey();
      const sent = await sendMonthlySummaries(supabaseUrl, serviceKey, monthKey);
      return { statusCode: 200, body: JSON.stringify({ sent: true, count: sent }) };
    }

    let payout = null;
    let clientId = payload.clientId;
    if (eventType === 'commission_paid') {
      if (!UUID_RE.test(String(payload.payoutId || ''))) {
        return { statusCode: 400, body: JSON.stringify({ error: 'A valid payoutId is required' }) };
      }
      payout = await loadPayout(payload.payoutId, supabaseUrl, serviceKey);
      if (!payout) return { statusCode: 404, body: JSON.stringify({ error: 'Payout not found' }) };
      clientId = payout.client_id;
    }
    if (!UUID_RE.test(String(clientId || ''))) {
      return { statusCode: 400, body: JSON.stringify({ error: 'A valid clientId is required' }) };
    }
    const client = await loadClient(clientId, supabaseUrl, serviceKey);
    if (!client) return { statusCode: 404, body: JSON.stringify({ error: 'Client not found' }) };

    const affiliateId = client.referred_by;
    if (!affiliateId) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'no_affiliate' }) };
    }
    if (payload.affiliateId && String(payload.affiliateId) !== String(affiliateId)) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Affiliate does not own this client' }) };
    }
    const affiliate = await loadAffiliate(affiliateId, supabaseUrl, serviceKey);
    if (!affiliate?.email) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'no_affiliate_email' }) };
    }
    if (String(client.referred_by) !== String(affiliate.id)
        || String(client.user_id || '') !== String(affiliate.owner_user_id || '')) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Affiliate does not own this client' }) };
    }
    if (!caller.isSystem && String(affiliate.owner_user_id || '') !== String(caller.userId || '')) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Owner access required' }) };
    }
    if (payout && (String(payout.affiliate_id) !== String(affiliate.id)
        || String(payout.client_id) !== String(client.id))) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Payout does not match this referral' }) };
    }

    const markers = Array.isArray(client?.lead_drips_sent) ? client.lead_drips_sent : [];
    const onceMarker = MARKERS[eventType];
    if (onceMarker && markers.includes(onceMarker)) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'already_notified' }) };
    }

    if (eventType === 'referral_received') {
      await sendReferralReceived({ affiliate, client });
      await appendMarker(client.id, markers, onceMarker, supabaseUrl, serviceKey);
    } else if (eventType === 'enrolled') {
      if (!(await hasCompletedEnrollment(client, supabaseUrl, serviceKey))) {
        return { statusCode: 409, body: JSON.stringify({ error: 'Client has not enrolled yet' }) };
      }
      await sendEnrolled({ affiliate, client });
      await appendMarker(client.id, markers, onceMarker, supabaseUrl, serviceKey);
    } else if (eventType === 'exited') {
      const status = client.billing_status;
      if (!['Inactive', 'Graduated', 'Paused'].includes(status)) {
        return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'not_exit_status' }) };
      }
      await sendExited({
        affiliate,
        client,
        billingStatus: status,
        exitReason: client.exit_reason,
      });
    } else if (eventType === 'commission_earned') {
      if (!UUID_RE.test(String(payload.ledgerTransactionId || ''))) {
        return { statusCode: 400, body: JSON.stringify({ error: 'A valid ledgerTransactionId is required' }) };
      }
      const { eligibleCollectedAmount, commissionRate } = await import('../../src/utils/affiliateCommission.js');
      const transaction = exactLedgerTransaction(client, payload.ledgerTransactionId);
      const revenueAmount = eligibleCollectedAmount(transaction);
      const amount = revenueAmount * commissionRate(client, affiliate);
      if (!(revenueAmount > 0.004) || !(amount > 0.004)) {
        return { statusCode: 409, body: JSON.stringify({ error: 'The referenced ledger transaction is not eligible cleared revenue' }) };
      }
      const transactionMarker = `affiliate_commission_earned:${transaction.id}`;
      if (markers.includes(transactionMarker)) {
        return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'already_notified' }) };
      }
      await sendCommissionEarned({
        affiliate,
        client,
        amount,
        revenueAmount,
      });
      await appendMarker(client.id, markers, transactionMarker, supabaseUrl, serviceKey);
    } else if (eventType === 'commission_paid') {
      const amount = Number(payout.amount);
      if (!(amount > 0.004) || !payout.paid_at) {
        return { statusCode: 409, body: JSON.stringify({ error: 'The referenced payout is incomplete' }) };
      }
      const payoutMarker = `affiliate_commission_paid:${payout.id}`;
      if (markers.includes(payoutMarker)) {
        return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'already_notified' }) };
      }
      await sendCommissionPaid({
        affiliate,
        client,
        amount,
        paidAt: payout.paid_at,
      });
      await appendMarker(client.id, markers, payoutMarker, supabaseUrl, serviceKey);
    }

    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  } catch (e) {
    console.error('notify-affiliate failed', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Notify failed' }) };
  }
};
