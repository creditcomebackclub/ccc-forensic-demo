// Triggered after a forensic audit is saved. Creates the first invoice (if
// needed) and attempts the first live sale when the charge gate passes.
const { requireStaffOrSystem } = require('./_requireAuth.cjs');
const {
  ensureInitialInvoice,
  chargeClientDue,
  assertFirstChargeGate,
  fetchClientBundle,
} = require('./_shared/billing-charge-core.cjs');

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (e) { return json(400, { error: 'Invalid JSON' }); }

  try {
    await requireStaffOrSystem(event);
  } catch (e) {
    return { statusCode: e.statusCode || 401, headers: { 'Content-Type': 'application/json' }, body: e.body || JSON.stringify({ error: 'Unauthorized' }) };
  }

  const { clientId } = payload;
  if (!clientId) return json(400, { error: 'clientId required' });

  try {
    const bundle = await fetchClientBundle(clientId);
    if (!bundle) return json(404, { error: 'Client not found' });

    const gate = assertFirstChargeGate(bundle);
    if (!gate.ok) {
      // Not an error — audit saved before LPOA/vault; cron/manual will catch up.
      return json(200, { ok: true, skipped: true, reason: gate.reason });
    }

    const inv = await ensureInitialInvoice(clientId);
    if (!inv.ok) return json(500, { error: inv.error });

    const invoiceIds = inv.invoiceIds && inv.invoiceIds.length
      ? inv.invoiceIds
      : null;

    const result = await chargeClientDue({
      clientId,
      initiatedBy: 'audit_delivery',
      invoiceIds,
      attemptNumber: 1,
    });

    return json(200, {
      ok: true,
      invoiceCreated: !!inv.created,
      charge: result,
    });
  } catch (e) {
    console.error('billing-on-audit-delivered error:', e);
    return json(500, { error: e.message || 'Billing trigger failed' });
  }
};
