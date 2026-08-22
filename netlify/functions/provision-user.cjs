// Creates or resolves a portal identity, links it to its business record,
// then sends exactly one branded, short-lived sign-in invitation.
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

function profileConflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

// Netlify's Node 20 runtime has no global WebSocket, and supabase-js always
// constructs a RealtimeClient in createClient() even though this function
// only uses Auth — without a real transport it throws synchronously.
// Mutating global.WebSocket (the previous approach here) does NOT reliably
// prevent this — confirmed live 2026-07-29 (a client portal invite failed
// with "Node.js 20 detected without native WebSocket support"). Same
// workaround already proven across audit-run-background.mjs,
// client-sensitive-data.mjs, and phase2-analyze-background.mjs: pass a real
// WebSocket implementation via the realtime.transport option directly.

async function sendInvitation({ email, name, actionLink, kind, companyName, commissionRate }) {
  if (!actionLink) throw new Error('No invitation link was generated');
  const { sendEmail, wrapClientEmail, escapeHtml } = require('./_email.cjs');
  const isAffiliate = kind === 'affiliate';
  const buttonText = isAffiliate ? 'Access Partner Portal →' : 'Access Client Portal →';
  const commPct = Math.round((commissionRate || 0.20) * 100);
  let bodyHtml;
  if (isAffiliate) {
    bodyHtml = `<p style="margin:0 0 14px;">Hi ${escapeHtml(name || 'there')},</p>`
      + `<p style="margin:0 0 14px;">Welcome to the Credit Comeback Club partner program${companyName ? ' on behalf of ' + escapeHtml(companyName) : ''}. Your secure portal invite is ready.</p>`
      + `<h3 style="color:#1B2A4A;font-size:14px;margin:20px 0 8px;">How it works</h3>`
      + `<ol style="padding-left:18px;line-height:1.8;font-size:13px;color:#444;margin:0 0 14px;">`
      + `<li>Log in to submit client referrals</li>`
      + `<li>We handle the full process &mdash; report review, personalized dispute correspondence, follow-up, and progress tracking</li>`
      + `<li>You earn <strong>${commPct}%</strong> of actual eligible client revenue recorded as collected under your saved partner terms</li>`
      + `<li>Track referrals and commissions in real time from your portal</li>`
      + `</ol>`
      + `<p style="margin:0 0 14px;font-size:13px;color:#444;">We&rsquo;ll email you when a referral is received, when they enroll, when commission accrues or is paid, and a monthly summary.</p>`
      + `<p style="margin:0;font-size:12px;color:#6B7280;">This secure link expires in 24 hours. If it expires, ask us to resend it.</p>`
      + `<p style="margin:14px 0 0;font-size:12px;color:#6B7280;">Questions? Reply to this email or call 970-644-0063.</p>`;
  } else {
    bodyHtml = `<p style="margin:0 0 14px;">Hi ${escapeHtml(name || 'there')},</p>`
      + `<p style="margin:0 0 14px;">You have been invited to your secure client portal. Use it to complete enrollment, securely upload documents, and follow your campaign.</p>`
      + `<p style="margin:0;font-size:12px;color:#6B7280;">This secure link expires in 24 hours. If it expires, ask us to resend it.</p>`
      + `<p style="margin:14px 0 0;font-size:12px;color:#6B7280;">Questions? Reply to this email or call 970-644-0063.</p>`;
  }
  const html = wrapClientEmail({
    eyebrow: isAffiliate ? 'Partner Program Welcome' : 'Client Portal Invitation',
    bodyHtml,
    cta: { href: actionLink, label: buttonText },
  });
  await sendEmail({
    to: email,
    subject: isAffiliate ? 'Welcome to the Credit Comeback Club Partner Program' : 'Access Your Credit Comeback Club Portal',
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
    let affiliateMeta = null;
    if (portalKind === 'client') {
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(String(clientId || ''))) {
        return { statusCode: 400, body: JSON.stringify({ error: 'A valid client ID is required for a client invitation' }) };
      }
      const clientRes = await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,user_id,email,name&limit=1`, { headers });
      const clientRows = await clientRes.json();
      client = Array.isArray(clientRows) ? clientRows[0] : null;
      if (!client) return { statusCode: 404, body: JSON.stringify({ error: 'Client not found' }) };
      if (caller.userId !== 'system' && client.user_id !== caller.userId) return { statusCode: 403, body: JSON.stringify({ error: 'Client does not belong to this administrator' }) };
      if (!client.email || String(client.email).trim().toLowerCase() !== normEmail) return { statusCode: 409, body: JSON.stringify({ error: 'Invitation email does not match the client record' }) };
      // Resolve both durable identity dimensions before touching Auth. A
      // client may have at most one profile, and an email candidate may only
      // be that same row. The transactional RPC below repeats these checks
      // under advisory locks after the Auth user ID is known.
      const [clientProfilesRes, emailProfilesRes] = await Promise.all([
        fetch(`${url}/rest/v1/client_profiles?client_id=eq.${encodeURIComponent(client.id)}&select=id,user_id,client_id,email&limit=2`, { headers }),
        fetch(`${url}/rest/v1/client_profiles?email=eq.${encodeURIComponent(normEmail)}&select=id,user_id,client_id,email&limit=2`, { headers }),
      ]);
      if (!clientProfilesRes.ok || !emailProfilesRes.ok) throw new Error('Could not validate the existing client portal link');
      const clientProfiles = await clientProfilesRes.json();
      const emailProfiles = await emailProfilesRes.json();
      if (!Array.isArray(clientProfiles) || !Array.isArray(emailProfiles)) throw new Error('Could not validate the existing client portal link');
      if (clientProfiles.length > 1 || emailProfiles.length > 1) {
        throw profileConflict('Conflicting client portal profiles require staff resolution');
      }
      const profileForClient = clientProfiles[0] || null;
      const profileForEmail = emailProfiles[0] || null;
      if (profileForClient && String(profileForClient.email || '').trim().toLowerCase() !== normEmail) {
        throw profileConflict('This client already has a different portal email');
      }
      if (profileForEmail?.client_id && profileForEmail.client_id !== client.id) {
        throw profileConflict('This email is already linked to another client portal');
      }
      if (profileForClient && profileForEmail && profileForClient.id !== profileForEmail.id) {
        throw profileConflict('Conflicting client portal profiles require staff resolution');
      }
      const existingProfile = profileForClient || profileForEmail;
      existingPortalUserId = existingProfile?.user_id && existingProfile.user_id !== ZERO_UUID
        ? existingProfile.user_id
        : null;
    } else {
      const affiliateRes = await fetch(`${url}/rest/v1/affiliates?email=eq.${encodeURIComponent(normEmail)}&select=id,user_id,owner_user_id,company,commission_rate,program_status&limit=2`, { headers });
      const affiliateRows = await affiliateRes.json();
      if (!affiliateRes.ok) throw new Error('Could not validate the affiliate portal record');
      if (!Array.isArray(affiliateRows) || affiliateRows.length !== 1) return { statusCode: 409, body: JSON.stringify({ error: 'A single matching affiliate record is required' }) };
      if (!['legacy_active', 'active'].includes(affiliateRows[0].program_status)) {
        return { statusCode: 409, body: JSON.stringify({
          error: 'Portal access is locked until the affiliate agreement is signed and owner-activated. Use the agreement onboarding action instead.',
          code: 'AFFILIATE_ACTIVATION_REQUIRED',
        }) };
      }
      if (caller.userId !== 'system' && (!affiliateRows[0].owner_user_id || affiliateRows[0].owner_user_id !== caller.userId)) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Only this affiliate program owner may send portal access.' }) };
      }
      existingPortalUserId = affiliateRows[0].user_id || null;
      affiliateMeta = affiliateRows[0];
    }

    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: ws },
    });
    // An explicit resend from the admin screen doubles as a deliberate
    // reactivation of a previously revoked portal identity, but only after
    // its Auth email is proven to match this exact invitation.
    if (existingPortalUserId) {
      const { data: existingAuth, error: existingAuthError } = await supabase.auth.admin.getUserById(existingPortalUserId);
      if (existingAuthError) throw new Error(existingAuthError.message || 'Could not validate the existing portal user');
      if (String(existingAuth?.user?.email || '').trim().toLowerCase() !== normEmail) {
        throw profileConflict('The existing portal link belongs to another Auth identity');
      }
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

    // Authentication links must use a server-configured operations origin;
    // a request Origin is attacker-controlled and can never choose redirectTo.
    const configuredOrigin = process.env.APP_URL || process.env.URL || 'https://ccc-forensic-demo.netlify.app';
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink', email: normEmail, options: { redirectTo: `${configuredOrigin.replace(/\/$/, '')}/login` },
    });
    if (linkError || !linkData?.user?.id || !linkData?.properties?.action_link) throw new Error(linkError?.message || 'Could not generate portal invitation');
    const userId = linkData.user.id;
    if (existingPortalUserId && existingPortalUserId !== userId) {
      throw profileConflict('The existing portal link belongs to another Auth identity');
    }

    if (portalKind === 'affiliate') {
      const patchRes = await fetch(`${url}/rest/v1/rpc/ccc_link_affiliate_portal_identity`, {
        method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify({
          p_affiliate_id: affiliateMeta.id,
          p_portal_user_id: userId,
        }),
      });
      if (!patchRes.ok) throw new Error('Could not securely link affiliate record');
    } else {
      const profileLinkRes = await fetch(`${url}/rest/v1/rpc/ccc_link_portal_profile_for_onboarding`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({
          p_portal_user_id: userId,
          p_client_id: client.id,
          p_email: normEmail,
          p_full_name: fullName || client.name || normEmail,
        }),
      });
      const profileLinkRaw = await profileLinkRes.text();
      let linkedProfileId = null;
      try { linkedProfileId = profileLinkRaw ? JSON.parse(profileLinkRaw) : null; }
      catch { linkedProfileId = null; }
      if (!profileLinkRes.ok) {
        const safeDefault = 'Could not securely link the client portal profile';
        let detail = safeDefault;
        try {
          const parsed = profileLinkRaw ? JSON.parse(profileLinkRaw) : null;
          const candidate = String(parsed?.message || '');
          if (/portal identity|auth identity|staff or affiliate identity|conflicting client portal|already linked|different portal email/i.test(candidate)) {
            detail = candidate;
          }
        } catch { /* keep the non-sensitive default */ }
        if (detail !== safeDefault) throw profileConflict(detail);
        throw new Error(safeDefault);
      }
      if (!linkedProfileId) throw new Error('Could not securely link the client portal profile');
    }

    const { isConfigured } = require('./_email.cjs');
    await sendInvitation({
      email: normEmail,
      name: fullName || client?.name,
      actionLink: linkData.properties.action_link,
      kind: portalKind,
      companyName: affiliateMeta?.company || null,
      commissionRate: affiliateMeta?.commission_rate,
    });
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, invitationSent: isConfigured() }) };
  } catch (error) {
    console.error('Portal provisioning failed:', error.message);
    const statusCode = error?.statusCode === 409 ? 409 : 500;
    return { statusCode, body: JSON.stringify({ error: error.message || 'Provisioning failed' }) };
  }
};
