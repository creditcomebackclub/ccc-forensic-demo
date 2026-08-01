// Catch-up only: if staff already flipped billing to Active before the audit
// landed, create the first invoice and charge once the remaining gates pass.
// Primary first-charge trigger is billing-on-active (staff → Active).
const { requireStaffOrSystem } = require('./_requireAuth.cjs');
const { runFirstBillableCharge } = require('./_shared/billing-charge-core.cjs');

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
    return {
      statusCode: e.statusCode || 401,
      headers: { 'Content-Type': 'application/json' },
      body: e.body || JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  const { clientId } = payload;
  if (!clientId) return json(400, { error: 'clientId required' });

  try {
    const result = await runFirstBillableCharge(clientId, 'audit_delivery', { force: false });
    return json(200, result);
  } catch (e) {
    console.error('billing-on-audit-delivered error:', e);
    return json(500, { error: e.message || 'Billing trigger failed' });
  }
};
