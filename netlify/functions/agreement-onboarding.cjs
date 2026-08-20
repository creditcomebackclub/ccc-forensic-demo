const { requireAdmin } = require('./_requireAdmin.cjs');
const { sendEmail, isConfigured, wrapClientEmail, escapeHtml } = require('./_email.cjs');
const { AGREEMENT_TEMPLATE_VERSION, sha256, randomToken, planSnapshot } = require('./_serviceAgreement.cjs');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function rest(path, method, body, url, key, prefer = 'return=representation') {
  const res = await fetch(url + path, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: prefer },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!res.ok) throw new Error(typeof data === 'object' && data?.message ? data.message : `Database request failed (${res.status})`);
  return data;
}

async function recordEvent({ agreementId, eventType, actorType, actorId, eventData }, url, key) {
  await rest('/rest/v1/client_service_agreement_events', 'POST', {
    agreement_id: agreementId, event_type: eventType, actor_type: actorType,
    actor_id: actorId || null, event_data: eventData || {},
  }, url, key, 'return=minimal');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  let caller;
  try { caller = await requireAdmin(event); }
  catch (error) { return error.statusCode ? error : json(500, { error: error.message || 'Authorization failed' }); }

  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json(500, { error: 'Server not configured' });
  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  const clientId = String(payload.clientId || '');
  const action = payload.action || 'prepare';
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return json(400, { error: 'A valid client is required.' });
  if (!['prepare', 'start'].includes(action)) return json(400, { error: 'Unknown onboarding action.' });

  try {
    const clients = await rest('/rest/v1/clients?id=eq.' + encodeURIComponent(clientId)
      + '&select=id,user_id,name,email,address,billing_tier,service_agreement_mode,service_agreement_label,service_agreement_amount,service_agreement_fee_text,engagement_status', 'GET', undefined, url, key);
    const client = clients?.[0];
    if (!client?.user_id) return json(409, { error: 'This client is not linked to a firm account.' });
    if (!client.email) return json(409, { error: 'Add the client email before starting onboarding.' });
    const templates = await rest('/rest/v1/service_agreement_templates?version=eq.' + encodeURIComponent(AGREEMENT_TEMPLATE_VERSION)
      + '&select=id,version,title,legal_status,body_html&limit=1', 'GET', undefined, url, key);
    const template = templates?.[0];
    if (!template) return json(409, { error: 'Agreement template is not installed.' });
    const settings = await rest('/rest/v1/settings?id=eq.1&select=pricing&limit=1', 'GET', undefined, url, key).catch(() => []);
    const plan = planSnapshot(client, settings?.[0]?.pricing || {});
    if (plan.mode === 'custom' && !plan.feeText) return json(409, { error: 'Custom plan needs service terms before onboarding can be prepared.' });

    // A new packet is a new snapshot. Existing unsigned packets can never be
    // silently edited after staff change a plan.
    const openPackets = await rest('/rest/v1/client_service_agreements?client_id=eq.' + encodeURIComponent(clientId)
      + '&status=in.(draft,sent)&select=id,status', 'GET', undefined, url, key);
    for (const packet of openPackets || []) {
      await rest('/rest/v1/client_service_agreements?id=eq.' + encodeURIComponent(packet.id), 'PATCH', { status: 'superseded', superseded_at: new Date().toISOString() }, url, key, 'return=minimal');
      await recordEvent({ agreementId: packet.id, eventType: 'superseded', actorType: 'staff', actorId: caller.userId, eventData: { reason: 'A new service-plan snapshot was prepared.' } }, url, key);
    }

    const clientSnapshot = { name: client.name, email: client.email, address: client.address || null };
    const inserted = await rest('/rest/v1/client_service_agreements', 'POST', {
      user_id: client.user_id, client_id: client.id, template_id: template.id, template_version: template.version,
      plan_snapshot: plan, client_snapshot: clientSnapshot, created_by: caller.userId,
    }, url, key);
    const agreement = inserted?.[0];
    if (!agreement) throw new Error('Agreement packet was not created.');
    await recordEvent({ agreementId: agreement.id, eventType: 'prepared', actorType: 'staff', actorId: caller.userId, eventData: { plan } }, url, key);

    if (template.legal_status !== 'approved' || !String(template.body_html || '').trim()) {
      return json(200, {
        agreementId: agreement.id, status: 'draft', sendBlocked: true,
        message: 'Packet prepared. Sending is disabled until counsel approves the agreement text, fee milestones, disclosures, and cancellation materials.',
      });
    }

    if (action === 'prepare') return json(200, { agreementId: agreement.id, status: 'draft', sendBlocked: false, message: 'Packet prepared and ready to send.' });

    if (!isConfigured()) return json(409, { agreementId: agreement.id, error: 'Email delivery is not configured. Packet was prepared but not sent.' });
    const token = randomToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const sentRows = await rest('/rest/v1/client_service_agreements?id=eq.' + encodeURIComponent(agreement.id) + '&status=eq.draft', 'PATCH', {
      status: 'sent', signing_token_hash: sha256(token), signing_expires_at: expiresAt, sent_at: new Date().toISOString(),
    }, url, key);
    if (!sentRows?.[0]) throw new Error('Packet was changed before it could be sent. Prepare it again.');
    const base = (process.env.APP_URL || event.headers.origin || 'https://ccc-forensic-demo.netlify.app').replace(/\/$/, '');
    const link = `${base}/sign-agreement.html?token=${encodeURIComponent(token)}`;
    await sendEmail({
      to: client.email,
      subject: 'Your Credit Comeback Club agreement is ready to review',
      html: wrapClientEmail({
        eyebrow: 'Secure Agreement Signing',
        bodyHtml: `<p>Hi ${escapeHtml(client.name)},</p><p>Your personalized service agreement and Limited Power of Attorney are ready to review and sign securely.</p><p>This link expires in seven days and can only be used once.</p><p style="font-size:12px;color:#6B7280;">No payment is created by this signing packet.</p>`,
        cta: { href: link, label: 'Review and sign securely →' },
      }),
      tags: { kind: 'service_agreement_sent', agreement_id: agreement.id },
    });
    await recordEvent({ agreementId: agreement.id, eventType: 'sent', actorType: 'staff', actorId: caller.userId, eventData: { expiresAt } }, url, key);
    return json(200, { agreementId: agreement.id, status: 'sent', sendBlocked: false, expiresAt });
  } catch (error) {
    console.error('agreement-onboarding:', error.message);
    return json(500, { error: error.message || 'Could not prepare onboarding.' });
  }
};
