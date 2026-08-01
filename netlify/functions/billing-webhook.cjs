// NMI webhook / event callback. Idempotent reconcile by nmi_transaction_id.
const crypto = require('crypto');
const {
  getSupabaseEnv,
  supabaseRequest,
  fetchClientBundle,
  unpaidInvoices,
  patchClient,
  todayISO,
} = require('./_shared/billing-charge-core.cjs');
const { parseNmiResponse } = require('./_shared/nmi.cjs');

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function verifyWebhook(event) {
  const secret = process.env.NMI_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: 'NMI_WEBHOOK_SECRET not configured' };

  const headers = event.headers || {};
  const provided =
    headers['x-nmi-webhook-secret']
    || headers['X-Nmi-Webhook-Secret']
    || headers['x-webhook-secret']
    || (event.queryStringParameters && event.queryStringParameters.secret)
    || '';

  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(secret));
  if (a.length !== b.length) return { ok: false, reason: 'Invalid webhook secret' };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'Invalid webhook secret' };
  return { ok: true };
}

function extractPayload(event) {
  const raw = event.body || '';
  const contentType = (event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || '';
  if (contentType.includes('application/json')) {
    try { return JSON.parse(raw || '{}'); } catch (e) { return {}; }
  }
  // Form-encoded NMI style
  const parsed = parseNmiResponse(raw);
  return {
    transaction_id: parsed.transactionId,
    response: parsed.response,
    responsetext: parsed.responseText,
    customer_vault_id: parsed.customerVaultId,
    amount: parsed.raw && parsed.raw.amount,
    orderid: parsed.orderId,
    event_type: parsed.raw && (parsed.raw.event_type || parsed.raw.eventtype),
    ...parsed.raw,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  const auth = verifyWebhook(event);
  if (!auth.ok) return json(401, { error: auth.reason });

  const payload = extractPayload(event);
  const txnId = payload.transaction_id || payload.transactionid || payload.id;
  if (!txnId) return json(400, { error: 'transaction_id required' });

  const { url, key } = getSupabaseEnv();
  const existingRes = await supabaseRequest(
    `/rest/v1/payment_transactions?nmi_transaction_id=eq.${encodeURIComponent(txnId)}&select=*&limit=1`,
    'GET', null, url, key
  );
  let row = Array.isArray(existingRes.body) ? existingRes.body[0] : null;

  const approved = String(payload.response || payload.condition || '') === '1'
    || String(payload.condition || '').toLowerCase() === 'complete'
    || String(payload.event_type || '').toLowerCase().includes('sale.success');

  if (!row) {
    // Unknown txn — record for audit only if we can map a vault/client
    const vaultId = payload.customer_vault_id || payload.customer_vaultid;
    if (!vaultId) return json(200, { ok: true, ignored: true, reason: 'Unknown transaction' });

    const profileRes = await supabaseRequest(
      `/rest/v1/client_profiles?nmi_vault_id=eq.${encodeURIComponent(vaultId)}&select=client_id&limit=1`,
      'GET', null, url, key
    );
    const profile = Array.isArray(profileRes.body) ? profileRes.body[0] : null;
    if (!profile?.client_id) return json(200, { ok: true, ignored: true, reason: 'No client for vault' });

    const insertRes = await supabaseRequest('/rest/v1/payment_transactions', 'POST', {
      client_id: profile.client_id,
      amount: Number(payload.amount) || 0,
      currency: 'USD',
      kind: 'sale',
      status: approved ? 'approved' : 'declined',
      nmi_transaction_id: txnId,
      nmi_vault_id: vaultId,
      idempotency_key: `webhook:${txnId}`,
      ledger_invoice_ids: [],
      attempt_number: 1,
      initiated_by: 'webhook',
      raw_response: payload,
      error_message: approved ? null : (payload.responsetext || 'Declined'),
    }, url, key);
    row = Array.isArray(insertRes.body) ? insertRes.body[0] : insertRes.body;
  } else if (row.status !== 'approved' && approved) {
    await supabaseRequest(
      `/rest/v1/payment_transactions?id=eq.${encodeURIComponent(row.id)}`,
      'PATCH',
      { status: 'approved', raw_response: payload, error_message: null, next_retry_at: null },
      url, key
    );
  }

  // If approved and we have invoice ids, ensure ledger reflects Paid.
  if (approved && row && row.client_id) {
    const bundle = await fetchClientBundle(row.client_id);
    if (bundle) {
      let ledger = Array.isArray(bundle.client.ledger) ? [...bundle.client.ledger] : [];
      const ids = Array.isArray(row.ledger_invoice_ids) ? row.ledger_invoice_ids : [];
      let changed = false;
      if (ids.length) {
        ledger = ledger.map((tx) => {
          if (tx.type === 'Invoice' && ids.includes(tx.id) && tx.status !== 'Paid') {
            changed = true;
            return {
              ...tx,
              status: 'Paid',
              paid_at: new Date().toISOString(),
              nmi_transaction_id: txnId,
              payment_transaction_id: row.id,
              source: 'nmi',
              next_retry_at: null,
            };
          }
          return tx;
        });
        const hasPayment = ledger.some((t) => t.nmi_transaction_id === txnId && t.type === 'Payment');
        if (!hasPayment) {
          ledger.push({
            id: crypto.randomUUID(),
            date: todayISO(),
            type: 'Payment',
            amount: Number(row.amount) || 0,
            description: 'Card payment (NMI webhook)',
            status: 'Paid',
            paid_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            nmi_transaction_id: txnId,
            payment_transaction_id: row.id,
            source: 'nmi',
          });
          changed = true;
        }
      } else {
        // No invoice linkage — if balance due equals amount, pay oldest dues
        const due = unpaidInvoices(ledger);
        const amt = Number(row.amount) || 0;
        if (due.length && amt > 0) {
          let remaining = amt;
          const covered = [];
          for (const inv of due.sort((a, b) => a.date.localeCompare(b.date))) {
            const invAmt = Number(inv.amount) || 0;
            if (remaining + 0.001 >= invAmt) {
              covered.push(inv.id);
              remaining = Math.round((remaining - invAmt) * 100) / 100;
            }
          }
          if (covered.length) {
            ledger = ledger.map((tx) => {
              if (tx.type === 'Invoice' && covered.includes(tx.id)) {
                changed = true;
                return {
                  ...tx,
                  status: 'Paid',
                  paid_at: new Date().toISOString(),
                  nmi_transaction_id: txnId,
                  payment_transaction_id: row.id,
                  source: 'nmi',
                  next_retry_at: null,
                };
              }
              return tx;
            });
            if (!ledger.some((t) => t.nmi_transaction_id === txnId && t.type === 'Payment')) {
              ledger.push({
                id: crypto.randomUUID(),
                date: todayISO(),
                type: 'Payment',
                amount: amt,
                description: 'Card payment (NMI webhook)',
                status: 'Paid',
                paid_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                nmi_transaction_id: txnId,
                payment_transaction_id: row.id,
                source: 'nmi',
              });
              changed = true;
            }
          }
        }
      }

      if (changed) {
        const patch = { ledger };
        if (bundle.client.billing_status === 'Paused' && bundle.client.exit_reason === 'non_payment') {
          patch.billing_status = 'Active';
          patch.exit_reason = null;
        }
        if (
          bundle.client.billing_type === 'Automated Recurring'
          && bundle.client.billing_tier !== 'Paid In Full'
        ) {
          patch.recurring_active = true;
        }
        await patchClient(row.client_id, patch);
      }
    }
  }

  return json(200, { ok: true, transactionId: txnId });
};
