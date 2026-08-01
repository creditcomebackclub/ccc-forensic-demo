// Primary first-charge trigger: staff flips billing_status to Active after
// setting up the billing profile. Still gated on LPOA + portal + audit + vault.
const { requireStaff } = require('./_requireAuth.cjs');
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
    await requireStaff(event);
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
    // Staff explicitly activated billing — charge even if BILLING_AUTO_CHARGE
    // is still false (controlled cutover / first live client).
    const result = await runFirstBillableCharge(clientId, 'staff_activation', { force: true });
    if (!result.ok && result.statusCode) {
      return json(result.statusCode, { error: result.error, ...result });
    }
    return json(200, result);
  } catch (e) {
    console.error('billing-on-active error:', e);
    return json(500, { error: e.message || 'Activation billing failed' });
  }
};
