// Shared billing: gate checks, ledger updates, vault charge + retry scheduling.
const crypto = require('crypto');
const https = require('https');
const { nmiConfig, vaultWithZeroAuth, saleWithVault } = require('./nmi.cjs');

const DEFAULT_TIER_PRICING = {
  Standard: { monthlyFee: 79, firstWorkFee: 75 },
  VIP: { monthlyFee: 149, firstWorkFee: 99 },
  'Paid In Full': { flatFee: 499, flatMonths: 6, firstWorkFee: 0 },
};

// Soft-decline retry offsets in days from first failed attempt (attempt 1 = immediate).
// Attempts 2 and 3 fire at +1 and +3; day-5 pause aligns with existing dunning.
const RETRY_OFFSET_DAYS = [0, 1, 3];
const MAX_ATTEMPTS = 3;

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function supabaseRequest(path, method, body, url, key, extraHeaders) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined && body !== null ? JSON.stringify(body) : null;
    const u = new URL(url + path);
    const headers = {
      apikey: key,
      Authorization: 'Bearer ' + key,
      Prefer: 'return=representation',
      ...(extraHeaders || {}),
    };
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = https.request({
      hostname: u.hostname, port: 443, path: u.pathname + u.search, method, headers,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function getSupabaseEnv() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw Object.assign(new Error('Supabase env missing'), { statusCode: 500 });
  return { url, key };
}

async function fetchClientBundle(clientId) {
  const { url, key } = getSupabaseEnv();
  const clientRes = await supabaseRequest(
    `/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,name,email,user_id,lpoa_signed,billing_status,billing_type,billing_tier,billing_start_date,recurring_active,ledger,exit_reason&limit=1`,
    'GET', null, url, key
  );
  const client = Array.isArray(clientRes.body) ? clientRes.body[0] : null;
  if (!client) return null;

  const profileRes = await supabaseRequest(
    `/rest/v1/client_profiles?client_id=eq.${encodeURIComponent(clientId)}&select=id,user_id,full_name,email,onboarding_complete,nmi_vault_id,nmi_initial_transaction_id,card_last4,card_type,card_expiry,card_vaulted_at&limit=1`,
    'GET', null, url, key
  );
  let profile = Array.isArray(profileRes.body) ? profileRes.body[0] : null;
  if (!profile && client.email) {
    const byEmail = await supabaseRequest(
      `/rest/v1/client_profiles?email=eq.${encodeURIComponent(client.email)}&select=id,user_id,full_name,email,onboarding_complete,nmi_vault_id,nmi_initial_transaction_id,card_last4,card_type,card_expiry,card_vaulted_at&limit=1`,
      'GET', null, url, key
    );
    profile = Array.isArray(byEmail.body) ? byEmail.body[0] : null;
  }

  const auditRes = await supabaseRequest(
    `/rest/v1/audits?client_id=eq.${encodeURIComponent(clientId)}&select=id&limit=1`,
    'GET', null, url, key
  );
  const hasAudit = Array.isArray(auditRes.body) && auditRes.body.length > 0;

  return { client, profile, hasAudit };
}

function assertFirstChargeGate({ client, profile, hasAudit }) {
  if (!client) return { ok: false, reason: 'Client not found' };
  if (!client.lpoa_signed) return { ok: false, reason: 'LPOA not signed' };
  const portalActive = !!(profile && (profile.onboarding_complete || profile.user_id));
  if (!portalActive) return { ok: false, reason: 'Portal not active' };
  if (!hasAudit) return { ok: false, reason: 'No forensic audit delivered' };
  if (!profile?.nmi_vault_id) return { ok: false, reason: 'No card on file' };
  // Staff "Active" is the billing go-switch. Audit/LPOA/vault alone do not charge.
  if (client.billing_status !== 'Active') {
    return { ok: false, reason: 'Billing status is not Active' };
  }
  return { ok: true };
}

function assertVaultChargeable({ client, profile }) {
  if (!client) return { ok: false, reason: 'Client not found' };
  if (!profile?.nmi_vault_id) return { ok: false, reason: 'No card on file' };
  return { ok: true };
}

async function loadTierPricing() {
  const { url, key } = getSupabaseEnv();
  // settings.json lives in storage bucket client-docs/admin/settings.json
  try {
    const res = await supabaseRequest(
      '/storage/v1/object/authenticated/client-docs/admin/settings.json',
      'GET', null, url, key
    );
    // Storage may return the file body directly or error JSON
    let settings = res.body;
    if (typeof settings === 'string') {
      try { settings = JSON.parse(settings); } catch (_) { settings = null; }
    }
    if (!settings || settings.error || settings.statusCode) {
      // Try public path via REST download with service role
      const dl = await new Promise((resolve) => {
        const u = new URL(url + '/storage/v1/object/client-docs/admin/settings.json');
        const req = https.request({
          hostname: u.hostname, port: 443, path: u.pathname, method: 'GET',
          headers: { apikey: key, Authorization: 'Bearer ' + key },
        }, (r) => {
          let raw = '';
          r.on('data', (c) => { raw += c; });
          r.on('end', () => {
            try { resolve(JSON.parse(raw)); } catch (e) { resolve(null); }
          });
        });
        req.on('error', () => resolve(null));
        req.end();
      });
      settings = dl;
    }
    const overrides = (settings && settings.pricing && settings.pricing.tiers) || {};
    const out = {};
    for (const tier of Object.keys(DEFAULT_TIER_PRICING)) {
      out[tier] = { ...DEFAULT_TIER_PRICING[tier], ...(overrides[tier] || {}) };
    }
    return out;
  } catch (e) {
    return { ...DEFAULT_TIER_PRICING };
  }
}

function initialInvoiceForTier(tier, pricing) {
  const p = pricing[tier] || pricing.Standard;
  if (tier === 'Paid In Full') {
    return {
      amount: round2(p.flatFee || 499),
      description: 'Paid In Full Service',
    };
  }
  const monthly = Number(p.monthlyFee) || 0;
  const fwf = Number(p.firstWorkFee) || 0;
  return {
    amount: round2(monthly + fwf),
    description: tier === 'VIP'
      ? 'VIP Initial Month & First Work Fee'
      : 'Initial Month & First Work Fee',
  };
}

function monthlyInvoiceForTier(tier, pricing) {
  const p = pricing[tier] || pricing.Standard;
  if (tier === 'Paid In Full') return null;
  return {
    amount: round2(p.monthlyFee || 0),
    description: tier === 'VIP' ? 'VIP Monthly Service Fee' : 'Standard Monthly Service Fee',
  };
}

function unpaidInvoices(ledger) {
  return (Array.isArray(ledger) ? ledger : []).filter(
    (t) => t.type === 'Invoice' && t.status !== 'Paid'
  );
}

function balanceDue(ledger) {
  return round2(unpaidInvoices(ledger).reduce((s, t) => s + (parseFloat(t.amount) || 0), 0));
}

async function insertPaymentTx(row) {
  const { url, key } = getSupabaseEnv();
  const res = await supabaseRequest('/rest/v1/payment_transactions', 'POST', row, url, key);
  if (res.status >= 400) {
    // Unique idempotency — return existing
    if (res.status === 409 || (res.body && String(res.body.message || '').includes('duplicate'))) {
      const existing = await supabaseRequest(
        `/rest/v1/payment_transactions?idempotency_key=eq.${encodeURIComponent(row.idempotency_key)}&select=*&limit=1`,
        'GET', null, url, key
      );
      return Array.isArray(existing.body) ? existing.body[0] : null;
    }
    throw Object.assign(new Error((res.body && res.body.message) || 'Failed to insert payment_transactions'), { statusCode: 500, detail: res.body });
  }
  return Array.isArray(res.body) ? res.body[0] : res.body;
}

async function updatePaymentTx(id, patch) {
  const { url, key } = getSupabaseEnv();
  const res = await supabaseRequest(
    `/rest/v1/payment_transactions?id=eq.${encodeURIComponent(id)}`,
    'PATCH', patch, url, key
  );
  return Array.isArray(res.body) ? res.body[0] : res.body;
}

async function patchClient(clientId, patch) {
  const { url, key } = getSupabaseEnv();
  await supabaseRequest(
    `/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}`,
    'PATCH', patch, url, key
  );
}

async function patchProfile(profileId, patch) {
  const { url, key } = getSupabaseEnv();
  await supabaseRequest(
    `/rest/v1/client_profiles?id=eq.${encodeURIComponent(profileId)}`,
    'PATCH', patch, url, key
  );
}

function applySuccessfulSaleToLedger(ledger, invoiceIds, amount, nmiTransactionId, paymentTxId) {
  const next = (Array.isArray(ledger) ? ledger : []).map((tx) => {
    if (tx.type === 'Invoice' && invoiceIds.includes(tx.id)) {
      return {
        ...tx,
        status: 'Paid',
        paid_at: new Date().toISOString(),
        nmi_transaction_id: nmiTransactionId,
        payment_transaction_id: paymentTxId,
        source: 'nmi',
        charge_attempts: undefined,
        next_retry_at: null,
        last_decline_code: null,
      };
    }
    return tx;
  });
  next.push({
    id: crypto.randomUUID(),
    date: todayISO(),
    type: 'Payment',
    amount: round2(amount),
    description: 'Card payment (NMI)',
    status: 'Paid',
    paid_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    nmi_transaction_id: nmiTransactionId,
    payment_transaction_id: paymentTxId,
    source: 'nmi',
  });
  return next;
}

function markInvoiceRetry(ledger, invoiceIds, attemptNumber, declineType, declineCode) {
  const nextRetryDay = attemptNumber < MAX_ATTEMPTS
    ? addDaysISO(todayISO(), RETRY_OFFSET_DAYS[attemptNumber] || 3)
    : null;
  return (Array.isArray(ledger) ? ledger : []).map((tx) => {
    if (tx.type === 'Invoice' && invoiceIds.includes(tx.id)) {
      return {
        ...tx,
        charge_attempts: attemptNumber,
        next_retry_at: nextRetryDay,
        last_decline_code: declineCode || null,
        last_decline_type: declineType || null,
      };
    }
    return tx;
  });
}

/**
 * Charge unpaid invoices (or a provided amount) against vault.
 * Respects BILLING_AUTO_CHARGE for cron/audit_delivery paths.
 * staff_activation (flip to Active) uses the first-charge gate and may force.
 */
async function chargeClientDue({
  clientId,
  initiatedBy,
  invoiceIds = null,
  attemptNumber = 1,
  force = false,
}) {
  const cfg = nmiConfig();
  if (!force && (initiatedBy === 'cron' || initiatedBy === 'audit_delivery') && !cfg.autoCharge) {
    return { skipped: true, reason: 'BILLING_AUTO_CHARGE is not enabled' };
  }

  const bundle = await fetchClientBundle(clientId);
  if (!bundle) return { ok: false, error: 'Client not found', statusCode: 404 };

  const firstChargePath = initiatedBy === 'audit_delivery' || initiatedBy === 'staff_activation';
  const gate = firstChargePath
    ? assertFirstChargeGate(bundle)
    : assertVaultChargeable(bundle);
  if (!gate.ok) return { ok: false, error: gate.reason, statusCode: 400 };

  const { client, profile } = bundle;
  let ledger = Array.isArray(client.ledger) ? [...client.ledger] : [];
  let due = unpaidInvoices(ledger);
  if (invoiceIds && invoiceIds.length) {
    due = due.filter((i) => invoiceIds.includes(i.id));
  }
  if (!due.length) return { ok: true, charged: false, reason: 'No unpaid invoices' };

  const amount = round2(due.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0));
  if (amount <= 0) return { ok: true, charged: false, reason: 'Zero balance' };

  const ids = due.map((d) => d.id).sort();
  const idempotencyKey = `sale:${clientId}:${ids.join(',')}:${attemptNumber}`;

  // Fast path: already approved for this key
  const { url, key } = getSupabaseEnv();
  const existingRes = await supabaseRequest(
    `/rest/v1/payment_transactions?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=*&limit=1`,
    'GET', null, url, key
  );
  const existing = Array.isArray(existingRes.body) ? existingRes.body[0] : null;
  if (existing && existing.status === 'approved') {
    return { ok: true, charged: true, alreadyProcessed: true, payment: existing };
  }

  let paymentRow = existing;
  if (!paymentRow) {
    paymentRow = await insertPaymentTx({
      client_id: clientId,
      amount,
      currency: 'USD',
      kind: 'sale',
      status: 'pending',
      nmi_vault_id: profile.nmi_vault_id,
      idempotency_key: idempotencyKey,
      ledger_invoice_ids: ids,
      attempt_number: attemptNumber,
      initiated_by: initiatedBy,
    });
  }

  let parsed;
  try {
    parsed = await saleWithVault({
      customerVaultId: profile.nmi_vault_id,
      amount,
      orderId: idempotencyKey.slice(0, 50),
      initialTransactionId: profile.nmi_initial_transaction_id,
      attemptNumber,
    });
  } catch (e) {
    await updatePaymentTx(paymentRow.id, {
      status: 'error',
      error_message: e.message,
    });
    return { ok: false, error: e.message, statusCode: e.code === 'NMI_NOT_CONFIGURED' ? 503 : 502 };
  }

  if (parsed.approved) {
    await updatePaymentTx(paymentRow.id, {
      status: 'approved',
      nmi_transaction_id: parsed.transactionId,
      raw_response: parsed.trimmed,
      next_retry_at: null,
      decline_type: null,
      error_message: null,
    });
    ledger = applySuccessfulSaleToLedger(ledger, ids, amount, parsed.transactionId, paymentRow.id);
    const patch = { ledger };
    const isRecurringTier = client.billing_type === 'Automated Recurring' && client.billing_tier !== 'Paid In Full';
    if (isRecurringTier) {
      patch.recurring_active = true;
      if (!client.billing_status || client.billing_status === 'Paused') {
        patch.billing_status = 'Active';
        patch.exit_reason = null;
      }
    } else if (client.billing_status === 'Paused' && client.exit_reason === 'non_payment') {
      patch.billing_status = 'Active';
      patch.exit_reason = null;
    }
    if (!client.billing_start_date) patch.billing_start_date = todayISO();
    await patchClient(clientId, patch);
    return {
      ok: true,
      charged: true,
      amount,
      nmiTransactionId: parsed.transactionId,
      paymentId: paymentRow.id,
      recurringActive: !!patch.recurring_active || !!client.recurring_active,
    };
  }

  const declineType = parsed.declineType || 'soft';
  const nextRetry = declineType === 'soft' && attemptNumber < MAX_ATTEMPTS
    ? new Date(addDaysISO(todayISO(), RETRY_OFFSET_DAYS[attemptNumber] || 3) + 'T15:00:00Z').toISOString()
    : null;

  await updatePaymentTx(paymentRow.id, {
    status: 'declined',
    nmi_transaction_id: parsed.transactionId,
    raw_response: parsed.trimmed,
    decline_type: declineType,
    next_retry_at: nextRetry,
    error_message: parsed.responseText || 'Declined',
  });

  ledger = markInvoiceRetry(ledger, ids, attemptNumber, declineType, parsed.responseCode);
  await patchClient(clientId, { ledger });

  return {
    ok: false,
    declined: true,
    declineType,
    error: parsed.responseText || 'Card declined',
    nextRetryAt: nextRetry,
    attemptNumber,
    statusCode: 402,
  };
}

async function ensureInitialInvoice(clientId) {
  const bundle = await fetchClientBundle(clientId);
  if (!bundle) return { ok: false, error: 'Client not found' };
  const { client } = bundle;
  const ledger = Array.isArray(client.ledger) ? [...client.ledger] : [];
  const hasBillingEvent = ledger.some((t) => t.type === 'Invoice' || t.type === 'Payment');
  if (hasBillingEvent) {
    return { ok: true, created: false, ledger, invoiceIds: unpaidInvoices(ledger).map((i) => i.id) };
  }
  const pricing = await loadTierPricing();
  const inv = initialInvoiceForTier(client.billing_tier || 'Standard', pricing);
  const row = {
    id: crypto.randomUUID(),
    date: todayISO(),
    type: 'Invoice',
    amount: inv.amount,
    description: inv.description,
    status: 'Due',
    created_at: new Date().toISOString(),
    source: 'nmi',
  };
  ledger.push(row);
  await patchClient(clientId, {
    ledger,
    billing_start_date: client.billing_start_date || todayISO(),
  });
  return { ok: true, created: true, ledger, invoiceIds: [row.id] };
}

/**
 * First billable sale: create FWF/initial invoice if needed, then charge vault.
 * Used when staff flips Active (primary) or audit lands while already Active (catch-up).
 */
async function runFirstBillableCharge(clientId, initiatedBy, { force = false } = {}) {
  const bundle = await fetchClientBundle(clientId);
  if (!bundle) return { ok: false, error: 'Client not found', statusCode: 404 };

  const gate = assertFirstChargeGate(bundle);
  if (!gate.ok) {
    return { ok: true, skipped: true, reason: gate.reason };
  }

  const inv = await ensureInitialInvoice(clientId);
  if (!inv.ok) return { ok: false, error: inv.error, statusCode: 500 };

  const result = await chargeClientDue({
    clientId,
    initiatedBy,
    invoiceIds: inv.invoiceIds && inv.invoiceIds.length ? inv.invoiceIds : null,
    attemptNumber: 1,
    force,
  });

  return {
    ok: true,
    invoiceCreated: !!inv.created,
    charge: result,
  };
}

async function boardVault({
  clientId,
  paymentToken,
  cardLast4,
  cardType,
  cardExpiry,
  initiatedBy,
  billing,
}) {
  const bundle = await fetchClientBundle(clientId);
  if (!bundle || !bundle.profile) {
    return { ok: false, error: 'Client profile not found', statusCode: 404 };
  }
  const { profile } = bundle;
  const idempotencyKey = `vault:${clientId}:${crypto.createHash('sha256').update(paymentToken).digest('hex').slice(0, 24)}`;

  const { url, key } = getSupabaseEnv();
  const existingRes = await supabaseRequest(
    `/rest/v1/payment_transactions?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=*&limit=1`,
    'GET', null, url, key
  );
  const existing = Array.isArray(existingRes.body) ? existingRes.body[0] : null;
  if (existing && existing.status === 'approved') {
    return {
      ok: true,
      alreadyProcessed: true,
      vaultId: existing.nmi_vault_id || profile.nmi_vault_id,
      cardLast4: profile.card_last4,
    };
  }

  let paymentRow = existing;
  if (!paymentRow) {
    paymentRow = await insertPaymentTx({
      client_id: clientId,
      amount: 0,
      currency: 'USD',
      kind: 'auth',
      status: 'pending',
      nmi_vault_id: profile.nmi_vault_id || null,
      idempotency_key: idempotencyKey,
      ledger_invoice_ids: [],
      attempt_number: 1,
      initiated_by: initiatedBy || 'onboarding',
    });
  }

  let parsed;
  try {
    parsed = await vaultWithZeroAuth({
      paymentToken,
      customerVaultId: profile.nmi_vault_id || undefined,
      billing,
    });
  } catch (e) {
    await updatePaymentTx(paymentRow.id, { status: 'error', error_message: e.message });
    return { ok: false, error: e.message, statusCode: e.code === 'NMI_NOT_CONFIGURED' ? 503 : 502 };
  }

  if (!parsed.approved) {
    await updatePaymentTx(paymentRow.id, {
      status: 'declined',
      nmi_transaction_id: parsed.transactionId,
      raw_response: parsed.trimmed,
      decline_type: parsed.declineType || 'hard',
      error_message: parsed.responseText || 'Card verification failed',
    });
    return { ok: false, error: parsed.responseText || 'Card verification failed', statusCode: 402 };
  }

  const vaultId = parsed.customerVaultId || profile.nmi_vault_id;
  await updatePaymentTx(paymentRow.id, {
    status: 'approved',
    nmi_transaction_id: parsed.transactionId,
    nmi_vault_id: vaultId,
    raw_response: parsed.trimmed,
  });

  await patchProfile(profile.id, {
    nmi_vault_id: vaultId,
    nmi_initial_transaction_id: parsed.transactionId,
    card_last4: cardLast4 || profile.card_last4 || null,
    card_type: cardType || profile.card_type || null,
    card_expiry: cardExpiry || profile.card_expiry || null,
    card_vaulted_at: new Date().toISOString(),
  });

  return {
    ok: true,
    vaultId,
    cardLast4: cardLast4 || null,
    cardType: cardType || null,
    cardExpiry: cardExpiry || null,
    nmiTransactionId: parsed.transactionId,
  };
}

async function processDueRetries(today = todayISO()) {
  const { url, key } = getSupabaseEnv();
  const cfg = nmiConfig();
  if (!cfg.autoCharge) return { skipped: true, processed: 0 };

  // Find clients with Due invoices that have next_retry_at <= today
  const clientsRes = await supabaseRequest(
    '/rest/v1/clients?billing_status=eq.Active&select=id,ledger&order=id.asc',
    'GET', null, url, key
  );
  const clients = Array.isArray(clientsRes.body) ? clientsRes.body : [];
  let processed = 0;
  for (const c of clients) {
    const ledger = Array.isArray(c.ledger) ? c.ledger : [];
    const retryable = unpaidInvoices(ledger).filter((inv) => {
      if (!inv.next_retry_at) return false;
      return String(inv.next_retry_at).slice(0, 10) <= today;
    });
    if (!retryable.length) continue;
    const attempt = Math.max(...retryable.map((i) => Number(i.charge_attempts) || 1)) + 1;
    if (attempt > MAX_ATTEMPTS) continue;
    const result = await chargeClientDue({
      clientId: c.id,
      initiatedBy: 'cron',
      invoiceIds: retryable.map((i) => i.id),
      attemptNumber: attempt,
    });
    processed += 1;
    if (result.declined && (result.declineType === 'hard' || attempt >= MAX_ATTEMPTS)) {
      // Pause will be handled by dunning day-5 path; no-op here.
    }
  }
  return { processed };
}

module.exports = {
  DEFAULT_TIER_PRICING,
  MAX_ATTEMPTS,
  RETRY_OFFSET_DAYS,
  round2,
  todayISO,
  addDaysISO,
  getSupabaseEnv,
  supabaseRequest,
  fetchClientBundle,
  assertFirstChargeGate,
  assertVaultChargeable,
  loadTierPricing,
  initialInvoiceForTier,
  monthlyInvoiceForTier,
  unpaidInvoices,
  balanceDue,
  chargeClientDue,
  ensureInitialInvoice,
  runFirstBillableCharge,
  boardVault,
  processDueRetries,
  patchClient,
  nmiConfig,
};
