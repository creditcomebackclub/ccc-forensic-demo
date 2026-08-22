const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const { requireAdmin } = require('./_requireAdmin.cjs');
const { sendEmail, isConfigured, wrapClientEmail, escapeHtml } = require('./_email.cjs');
const { serviceHeaders, readJson } = require('./_affiliateAccess.cjs');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

async function rpc(url, key, name, body) {
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: serviceHeaders(key, { Prefer: 'return=representation' }), body: JSON.stringify(body),
  });
  const data = await readJson(res, null);
  if (!res.ok) {
    const error = new Error(data?.message || `Database request failed (${res.status})`);
    error.statusCode = res.status === 403 ? 403 : 409;
    throw error;
  }
  return data;
}

async function prepareMagicLink({ email, name, origin, url, key }) {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });
  const { error: createError } = await client.auth.admin.createUser({
    email, email_confirm: true, user_metadata: { full_name: name },
  });
  if (createError && !/already\s+(been\s+)?(registered|exists)|email[_ ]exists/i.test(createError.message || '')) {
    throw new Error(createError.message || 'Could not create the partner login');
  }
  const { data, error } = await client.auth.admin.generateLink({
    type: 'magiclink', email, options: { redirectTo: `${origin.replace(/\/$/, '')}/login` },
  });
  if (error || !data?.user?.id || !data?.properties?.action_link) {
    throw new Error(error?.message || 'Could not generate the secure partner onboarding link');
  }
  return { userId: data.user.id, actionLink: data.properties.action_link };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  let caller;
  try { caller = await requireAdmin(event); }
  catch (error) { return error.statusCode ? error : json(500, { error: 'Authorization failed' }); }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  const action = payload.action === 'resend' ? 'resend' : 'send';
  const agreementId = String(payload.agreementId || '');
  if (!/^[0-9a-f-]{36}$/i.test(agreementId)) return json(400, { error: 'A valid agreement is required' });
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json(500, { error: 'Server not configured' });

  try {
    const agreementRes = await fetch(`${url}/rest/v1/affiliate_agreements?id=eq.${encodeURIComponent(agreementId)}&owner_user_id=eq.${encodeURIComponent(caller.userId)}&select=*&limit=1`, { headers: serviceHeaders(key) });
    const agreements = await readJson(agreementRes, []);
    if (!agreementRes.ok) throw new Error('Could not verify the affiliate agreement');
    const agreement = Array.isArray(agreements) ? agreements[0] : null;
    if (!agreement) return json(404, { error: 'Affiliate agreement not found for this owner' });
    if ((action === 'send' && agreement.status !== 'draft') || (action === 'resend' && agreement.status !== 'sent')) {
      return json(409, { error: action === 'send' ? 'Only a prepared draft can be sent.' : 'Only a sent agreement can be resent.' });
    }
    const [templateRes, affiliateRes] = await Promise.all([
      fetch(`${url}/rest/v1/affiliate_agreement_templates?id=eq.${agreement.template_id}&select=id,legal_status,body_html,content_sha256&limit=1`, { headers: serviceHeaders(key) }),
      fetch(`${url}/rest/v1/affiliates?id=eq.${agreement.affiliate_id}&owner_user_id=eq.${encodeURIComponent(caller.userId)}&select=id,user_id,name,email,company&limit=1`, { headers: serviceHeaders(key) }),
    ]);
    const template = (await readJson(templateRes, []))?.[0];
    const affiliate = (await readJson(affiliateRes, []))?.[0];
    if (!templateRes.ok || !affiliateRes.ok) throw new Error('Could not verify agreement ownership and template state');
    if (!template || !affiliate) return json(409, { error: 'Agreement ownership or template could not be verified.' });
    if (template.legal_status !== 'approved' || !String(template.body_html || '').trim()) {
      return json(409, {
        error: 'Affiliate agreement sending is blocked until the exact agreement and compensation language receive owner/counsel approval.',
        code: 'COUNSEL_APPROVAL_REQUIRED', sendBlocked: true,
      });
    }
    if (!isConfigured()) return json(409, { error: 'Email delivery is not configured. No onboarding state was changed.' });
    const email = String(affiliate.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(409, { error: 'Add a valid affiliate email before sending.' });
    // Never trust a browser Origin when minting authentication links. APP_URL
    // should be the operations origin; Netlify's own URL is the safe fallback.
    const origin = process.env.APP_URL || process.env.URL || 'https://ccc-forensic-demo.netlify.app';
    const magic = await prepareMagicLink({ email, name: affiliate.name, origin, url, key });
    // A resend refreshes both the magic link and the agreement window. The
    // lifecycle RPC verifies the frozen packet and exact portal identity.
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await rpc(url, key, 'ccc_mark_affiliate_agreement_sent', {
      p_agreement_id: agreement.id, p_portal_user_id: magic.userId, p_expires_at: expiresAt,
    });
    await sendEmail({
      to: email,
      subject: action === 'resend' ? 'Your Credit Comeback Club partner agreement link' : 'Review and sign your Credit Comeback Club partner agreement',
      html: wrapClientEmail({
        eyebrow: 'Secure Partner Onboarding',
        bodyHtml: `<p>Hi ${escapeHtml(affiliate.name || 'there')},</p><p>Your versioned Credit Comeback Club partner agreement is ready in the secure onboarding portal. Review the complete agreement and the exact compensation terms, provide the required electronic acknowledgements, and sign.</p><p>Portal access remains locked until the signed packet receives final owner activation.</p><p style="font-size:12px;color:#6B7280;">The prepared agreement expires ${escapeHtml(new Date(expiresAt).toLocaleDateString('en-US'))}.</p>`,
        cta: { href: magic.actionLink, label: 'Review partner agreement →' },
      }),
      tags: { kind: 'affiliate_agreement_invite', agreement_id: agreement.id },
    });
    return json(200, { agreementId: agreement.id, status: 'sent', expiresAt, invitationSent: true });
  } catch (error) {
    console.error('affiliate-agreement-onboarding:', error.message);
    return json(error.statusCode || 500, { error: error.message || 'Could not send affiliate onboarding.' });
  }
};

exports._test = { prepareMagicLink };
