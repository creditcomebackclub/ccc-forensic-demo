// Provision a portal user server-side with the service role: ensure the auth
// user exists and link it to its client_profiles/affiliates row BEFORE any
// magic link is sent. This closes the race where a client's first login found
// no linked profile row and loadUser misclassified them.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  // Only authenticated admins may provision portal users.
  const { requireAdmin } = require('./_requireAdmin.cjs');
  try { await requireAdmin(event); }
  catch (e) { if (e.statusCode) return e; throw e; }

  try {
    const { email, fullName, kind } = JSON.parse(event.body || '{}');
    if (!email) return { statusCode: 400, body: JSON.stringify({ error: 'Email required' }) };
    const normEmail = String(email).trim().toLowerCase();

    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
    };

    // 1. Ensure the auth user exists and resolve its id
    let userId = null;
    const createRes = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: normEmail,
        email_confirm: true,
        user_metadata: fullName ? { full_name: fullName } : {},
      }),
    });
    const created = await createRes.json();
    if (createRes.ok) {
      userId = created.id;
    } else {
      userId = created.id || (created.user && created.user.id);
    }

    // If userId not found yet, it might be already created, so we resolve it from generate_link
    const redirectUrl = event.headers.origin || 'https://ccc-forensic-demo.netlify.app';
    const linkRes = await fetch(`${url}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'magiclink',
        email: normEmail,
        options: { redirectTo: redirectUrl }
      }),
    });
    const linkData = await linkRes.json();
    if (!linkRes.ok) {
      throw new Error(linkData.message || linkData.error || 'Could not resolve auth user magic link');
    }
    userId = userId || linkData.user.id;
    const actionLink = linkData.properties.action_link;

    // Send the Magic Link via SendGrid (bypassing Supabase SMTP rate limit)
    const sgKey = process.env.SENDGRID_API_KEY;
    if (sgKey && actionLink) {
      const https = require('https');
      const emailBody = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"><div style="background:#1B2A4A;padding:20px;border-radius:4px 4px 0 0;"><h1 style="color:#C9A84C;margin:0;font-size:20px;">Credit Comeback Club</h1><p style="color:#fff;margin:4px 0 0;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;">Portal Invitation</p></div><div style="border:1px solid #ddd;border-top:none;padding:24px;border-radius:0 0 4px 4px;"><p>Hi ${fullName || 'there'},</p><p>You have been invited to access your secure client portal. Please click the button below to log in, set up your password, and complete your enrollment:</p><div style="text-align:center;margin:32px 0;"><a href="${actionLink}" style="background:#1B2A4A;color:#C9A84C;padding:14px 32px;text-decoration:none;border-radius:4px;font-weight:bold;font-size:14px;display:inline-block;">Access Client Portal &#8594;</a></div><p style="font-size:12px;color:#666;">This secure link is temporary and will expire in 24 hours.</p><p style="font-size:12px;color:#666;">Questions? Reply to this email or call 970-644-0063.</p><hr style="border:none;border-top:1px solid #eee;margin:24px 0;"><p style="font-size:11px;color:#999;">Credit Comeback Club | Grand Junction, CO | creditcomebackclub.com</p></div></body></html>`;

      const payload = {
        personalizations: [{ to: [{ email: normEmail }] }],
        from: { email: 'chris@cccpartners.co', name: 'Credit Comeback Club' },
        subject: 'Action Required: Access Your Credit Comeback Club Portal',
        content: [{ type: 'text/html', value: emailBody }],
      };
      const body = JSON.stringify(payload);
      
      await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.sendgrid.com', path: '/v3/mail/send', method: 'POST',
          headers: { 'Authorization': 'Bearer ' + sgKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        }, (res) => {
          let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve({ status: res.statusCode, body: raw }));
        });
        req.on('error', reject); req.write(body); req.end();
      });
    }

    if (!userId) throw new Error('Could not resolve auth user id');

    // 2. Link the profile row, creating it for clients if missing
    if (kind === 'affiliate') {
      const patchRes = await fetch(`${url}/rest/v1/affiliates?email=eq.${encodeURIComponent(normEmail)}`, {
        method: 'PATCH',
        headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify({ user_id: userId }),
      });
      const patched = await patchRes.json();
      if (!patchRes.ok) throw new Error('Could not link affiliate row');
      if (!Array.isArray(patched) || patched.length === 0) throw new Error('No affiliate row found for ' + normEmail);
    } else {
      const getRes = await fetch(`${url}/rest/v1/client_profiles?email=eq.${encodeURIComponent(normEmail)}&select=id,user_id&limit=1`, { headers });
      const rows = await getRes.json();
      const existing = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
      if (existing) {
        // Never touch onboarding_complete here — resending a link must not reset an enrolled client
        const patchRes = await fetch(`${url}/rest/v1/client_profiles?email=eq.${encodeURIComponent(normEmail)}`, {
          method: 'PATCH',
          headers: { ...headers, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ user_id: userId, ...(fullName ? { full_name: fullName } : {}) }),
        });
        if (!patchRes.ok) throw new Error('Could not update client profile');
      } else {
        const insRes = await fetch(`${url}/rest/v1/client_profiles`, {
          method: 'POST',
          headers: { ...headers, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ email: normEmail, full_name: fullName || normEmail, user_id: userId, onboarding_complete: false }),
        });
        if (!insRes.ok) throw new Error('Could not create client profile');
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message || 'Provisioning failed' }),
    };
  }
};
