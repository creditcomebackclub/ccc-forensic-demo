// Creates or resolves a portal identity, links it to its business record,
// then sends exactly one branded, short-lived sign-in invitation.
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

// Netlify's Node 20 runtime has no global WebSocket, and supabase-js always
// constructs a RealtimeClient in createClient() even though this function
// only uses Auth — without a real transport it throws synchronously.
// Mutating global.WebSocket (the previous approach here) does NOT reliably
// prevent this — confirmed live 2026-07-29 (a client portal invite failed
// with "Node.js 20 detected without native WebSocket support"). Same
// workaround already proven across audit-run-background.mjs,
// client-sensitive-data.mjs, and phase2-analyze-background.mjs: pass a real
// WebSocket implementation via the realtime.transport option directly.

async function sendInvitation({ email, name, actionLink, kind }) {
  if (!actionLink) throw new Error('No invitation link was generated');
  const { sendEmail, wrapClientEmail, escapeHtml } = require('./_email.cjs');
  const isAffiliate = kind === 'affiliate';
  const buttonText = isAffiliate ? 'Access Partner Portal →' : 'Access Client Portal →';
  const intro = isAffiliate
    ? 'You have been invited to your secure partner portal. Use it to access your referral link, view referral progress, and track commissions.'
    : 'You have been invited to your secure client portal. Use it to complete enrollment, securely upload documents, and follow your campaign.';
  const html = wrapClientEmail({
    eyebrow: isAffiliate ? 'Partner Portal Invitation' : 'Client Portal Invitation',
    bodyHtml: `<p style="margin:0 0 14px;">Hi ${escapeHtml(name || 'there')},</p>`
      + `<p style="margin:0 0 14px;">${intro}</p>`
      + `<p style="margin:0;font-size:12px;color:#6B7280;">This secure link expires in 24 hours. If it expires, ask us to resend it.</p>`
      + `<p style="margin:14px 0 0;font-size:12px;color:#6B7280;">Questions? Reply to this email or call 970-644-0063.</p>`,
    cta: { href: actionLink, label: buttonText },
  });
  await sendEmail({
    to: email,
    subject: isAffiliate ? 'Your Credit Comeback Club Partner Portal Invite' : 'Access Your Credit Comeback Club Portal',
    html,
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const { requireAdmin } = require('./_requireAdmin.cjs');
  let caller;
  try { caller = await requireAdmin(event); }
  catch (error) { if (error.statusCode) return error; throw error; }

  try {
    const { email, fullName, kind, clientId } = JSON.parse(event.body || '{}');
    const portalKind = kind === 'affiliate' ? 'affiliate' : kind === 'client' ? 'client' : null;
    const normEmail = String(email || '').trim().toLowerCase();
    if (!portalKind) return { statusCode: 400, body: JSON.stringify({ error: 'A valid portal kind is required' }) };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail)) return { statusCode: 400, body: JSON.stringify({ error: 'A valid email is required' }) };

    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
    const headers = { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` };

    // Validate the client before creating any auth identity. This prevents a
    // mistyped client ID from leaving behind an unlinked login account.
    let client = null;
    let existingPortalUserId = null;
    if (portalKind === 'client') {
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(String(clientId || ''))) {
        return { statusCode: 400, body: JSON.stringify({ error: 'A valid client ID is required for a client invitation' }) };
      }
      const clientRes = await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,user_id,email,name&limit=1`, { headers });
      const clientRows = await clientRes.json();
      client = Array.isArray(clientRows) ? clientRows[0] : null;
      if (!client) return { statusCode: 404, body: JSON.stringify({ error: 'Client not found' }) };
      if (caller.userId !== 'system' && client.user_id !== caller.userId) return { statusCode: 403, body: JSON.stringify({ error: 'Client does not belong to this administrator' }) };
      if (client.email && String(client.email).trim().toLowerCase() !== normEmail) return { statusCode: 409, body: JSON.stringify({ error: 'Invitation email does not match the client record' }) };
      const existingProfileRes = await fetch(`${url}/rest/v1/client_profiles?email=eq.${encodeURIComponent(normEmail)}&select=id,user_id,client_id&limit=1`, { headers });
      const existingProfileRows = await existingProfileRes.json();
      const existingProfile = Array.isArray(existingProfileRows) ? existingProfileRows[0] : null;
      if (existingProfile?.client_id && existingProfile.client_id !== client.id) return { statusCode: 409, body: JSON.stringify({ error: 'This email is already linked to another client portal' }) };
      existingPortalUserId = existingProfile?.user_id || null;
    } else {
      const affiliateRes = await fetch(`${url}/rest/v1/affiliates?email=eq.${encodeURIComponent(normEmail)}&select=id,user_id&limit=2`, { headers });
      const affiliateRows = await affiliateRes.json();
      if (!Array.isArray(affiliateRows) || affiliateRows.length !== 1) return { statusCode: 409, body: JSON.stringify({ error: 'A single matching affiliate record is required' }) };
      existingPortalUserId = affiliateRows[0].user_id || null;
    }

    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: ws },
    });
    // An explicit resend from the admin screen doubles as a deliberate
    // reactivation of a previously revoked portal identity.
    if (existingPortalUserId) {
      const { error: unbanError } = await supabase.auth.admin.updateUserById(existingPortalUserId, { ban_duration: 'none' });
      if (unbanError) throw new Error(unbanError.message || 'Could not reactivate portal user');
    }
    const { error: createError } = await supabase.auth.admin.createUser({
      email: normEmail, email_confirm: true, user_metadata: fullName ? { full_name: fullName } : {},
    });
    // Supabase's real message is "A user with this email address has
    // already been registered" — the old regex required "already" to be
    // immediately followed by "registered"/"exists", so "already been
    // registered" never matched. That made this guard throw on the exact
    // case it exists to swallow, permanently blocking any client whose
    // auth identity was created (e.g. by an earlier attempt that died
    // partway through, such as the WebSocket crash fixed above) but never
    // finished onboarding. Confirmed live 2026-07-29 — David Roberts.
    if (createError && !/already\s+(been\s+)?(registered|exists)|email[_ ]exists/i.test(createError.message || '')) {
      throw new Error(createError.message || 'Could not create portal user');
    }

    const configuredOrigin = process.env.APP_URL || event.headers.origin || 'https://ccc-forensic-demo.netlify.app';
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink', email: normEmail, options: { redirectTo: `${configuredOrigin.replace(/\/$/, '')}/login` },
    });
    if (linkError || !linkData?.user?.id || !linkData?.properties?.action_link) throw new Error(linkError?.message || 'Could not generate portal invitation');
    const userId = linkData.user.id;

    if (portalKind === 'affiliate') {
      const patchRes = await fetch(`${url}/rest/v1/affiliates?email=eq.${encodeURIComponent(normEmail)}`, {
        method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify({ user_id: userId }),
      });
      const patched = await patchRes.json();
      if (!patchRes.ok || !Array.isArray(patched) || patched.length !== 1) throw new Error('Could not link affiliate record');
    } else {
      const profileRes = await fetch(`${url}/rest/v1/client_profiles?email=eq.${encodeURIComponent(normEmail)}&select=id,client_id&limit=1`, { headers });
      const profileRows = await profileRes.json();
      const profile = Array.isArray(profileRows) ? profileRows[0] : null;
      if (profile?.client_id && profile.client_id !== client.id) throw new Error('This email is already linked to another client portal');
      const profilePatch = { user_id: userId, client_id: client.id, full_name: fullName || client.name || normEmail };
      const profileRequest = profile
        ? fetch(`${url}/rest/v1/client_profiles?id=eq.${encodeURIComponent(profile.id)}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(profilePatch) })
        : fetch(`${url}/rest/v1/client_profiles`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify({ ...profilePatch, email: normEmail, onboarding_complete: false }) });
      const profileWrite = await profileRequest;
      if (!profileWrite.ok) throw new Error('Could not link client portal profile');
    }

    const { isConfigured } = require('./_email.cjs');
    await sendInvitation({ email: normEmail, name: fullName || client?.name, actionLink: linkData.properties.action_link, kind: portalKind });
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, invitationSent: isConfigured() }) };
  } catch (error) {
    console.error('Portal provisioning failed:', error.message);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Provisioning failed' }) };
  }
};
