const { requireAuth, requireStaff, supabaseGet } = require('./_requireAuth.cjs');
const {
  chargeClientDue,
  fetchClientBundle,
  getSupabaseEnv,
  supabaseRequest,
  unpaidInvoices,
} = require('./_shared/billing-charge-core.cjs');

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

async function authorize(event, clientId) {
  const { url, key } = getSupabaseEnv();
  const clientRes = await supabaseRequest(
    `/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,email,billing_status,exit_reason&limit=1`,
    'GET', null, url, key
  );
  const client = Array.isArray(clientRes.body) ? clientRes.body[0] : null;
  if (!client) throw { statusCode: 404, body: JSON.stringify({ error: 'Client not found' }) };

  try {
    const staff = await requireStaff(event);
    return { client, initiatedBy: 'staff', caller: staff, force: true };
  } catch (e) {
    if (e.statusCode !== 403 && e.statusCode !== 401) throw e;
  }

  const caller = await requireAuth(event);
  const profileRes = await supabaseGet(
    `/rest/v1/client_profiles?user_id=eq.${encodeURIComponent(caller.userId)}&select=client_id,email&limit=1`,
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  );
  const profile = Array.isArray(profileRes.body) ? profileRes.body[0] : null;
  const owns = (profile && profile.client_id === client.id)
    || (client.email && caller.email && client.email.toLowerCase() === caller.email.toLowerCase());
  if (!owns) throw { statusCode: 403, body: JSON.stringify({ error: 'Not authorized' }) };

  // Clients may pay to recover from non_payment pause.
  return { client, initiatedBy: 'client', caller, force: true };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (e) { return json(400, { error: 'Invalid JSON' }); }

  const { clientId, invoiceIds } = payload;
  if (!clientId) return json(400, { error: 'clientId required' });

  try {
    const { initiatedBy, force } = await authorize(event, clientId);
    const bundle = await fetchClientBundle(clientId);
    if (!bundle) return json(404, { error: 'Client not found' });

    const due = unpaidInvoices(bundle.client.ledger);
    const targetIds = Array.isArray(invoiceIds) && invoiceIds.length
      ? invoiceIds
      : due.map((d) => d.id);
    if (!targetIds.length) return json(200, { ok: true, charged: false, reason: 'No unpaid invoices' });

    const priorAttempts = due
      .filter((d) => targetIds.includes(d.id))
      .map((d) => Number(d.charge_attempts) || 0);
    const attemptNumber = (priorAttempts.length ? Math.max(...priorAttempts) : 0) + 1;

    const result = await chargeClientDue({
      clientId,
      initiatedBy,
      invoiceIds: targetIds,
      attemptNumber,
      force,
    });

    if (result.skipped) return json(200, result);
    if (result.declined) return json(402, result);
    if (!result.ok) return json(result.statusCode || 400, { error: result.error, ...result });
    return json(200, result);
  } catch (e) {
    if (e.statusCode) {
      return { statusCode: e.statusCode, headers: { 'Content-Type': 'application/json' }, body: e.body || JSON.stringify({ error: e.message }) };
    }
    console.error('billing-charge error:', e);
    return json(500, { error: e.message || 'Charge failed' });
  }
};
