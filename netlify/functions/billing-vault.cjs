const { requireAuth, requireStaff, supabaseGet } = require('./_requireAuth.cjs');
const { boardVault, getSupabaseEnv, supabaseRequest } = require('./_shared/billing-charge-core.cjs');

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

async function resolveAuthorizedClientId(event, payload) {
  const { clientId } = payload || {};
  if (!clientId) throw { statusCode: 400, body: JSON.stringify({ error: 'clientId required' }) };

  const { url, key } = getSupabaseEnv();
  const clientRes = await supabaseRequest(
    `/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,email&limit=1`,
    'GET', null, url, key
  );
  const client = Array.isArray(clientRes.body) ? clientRes.body[0] : null;
  if (!client) throw { statusCode: 404, body: JSON.stringify({ error: 'Client not found' }) };

  // Prefer staff; otherwise requireAuth and match own client via email/profile.
  try {
    const staff = await requireStaff(event);
    return { clientId: client.id, initiatedBy: 'staff', caller: staff };
  } catch (staffErr) {
    if (staffErr.statusCode !== 403 && staffErr.statusCode !== 401) throw staffErr;
  }

  const caller = await requireAuth(event);
  if (caller.isSystem) {
    return { clientId: client.id, initiatedBy: 'onboarding', caller };
  }

  const profileRes = await supabaseGet(
    `/rest/v1/client_profiles?user_id=eq.${encodeURIComponent(caller.userId)}&select=client_id,email&limit=1`,
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  );
  const profile = Array.isArray(profileRes.body) ? profileRes.body[0] : null;
  const ownsByClientId = profile && profile.client_id === client.id;
  const ownsByEmail = client.email && caller.email
    && client.email.toLowerCase() === caller.email.toLowerCase();
  if (!ownsByClientId && !ownsByEmail) {
    throw { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for this client' }) };
  }
  return { clientId: client.id, initiatedBy: 'onboarding', caller };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (e) { return json(400, { error: 'Invalid JSON' }); }

  try {
    const { clientId, initiatedBy } = await resolveAuthorizedClientId(event, payload);
    const { paymentToken, cardLast4, cardType, cardExpiry, billing } = payload;
    if (!paymentToken) return json(400, { error: 'paymentToken required' });

    const result = await boardVault({
      clientId,
      paymentToken,
      cardLast4: cardLast4 || null,
      cardType: cardType || null,
      cardExpiry: cardExpiry || null,
      initiatedBy: payload.initiatedBy === 'client' ? 'client' : initiatedBy,
      billing: billing || null,
    });

    if (!result.ok) return json(result.statusCode || 400, { error: result.error });
    return json(200, {
      ok: true,
      cardLast4: result.cardLast4,
      cardType: result.cardType,
      cardExpiry: result.cardExpiry,
      alreadyProcessed: !!result.alreadyProcessed,
    });
  } catch (e) {
    if (e.statusCode) {
      return { statusCode: e.statusCode, headers: { 'Content-Type': 'application/json' }, body: e.body || JSON.stringify({ error: e.message }) };
    }
    console.error('billing-vault error:', e);
    return json(500, { error: e.message || 'Vault failed' });
  }
};
