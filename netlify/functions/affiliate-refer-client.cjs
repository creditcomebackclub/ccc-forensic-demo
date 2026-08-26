// Secure referral intake for authenticated affiliate partners. The browser
// never gets permission to create CRM rows directly; this function verifies
// the partner identity and stamps the referral with the firm administrator.
const { requireAuth } = require('./_requireAuth.cjs');
const { requireAffiliatePortalAccess } = require('./_affiliateAccess.cjs');

async function notifyAffiliateInternal(serviceKey, payload) {
  const base = process.env.URL || process.env.DEPLOY_URL || 'https://credit-comeback-club.netlify.app';
  try {
    const res = await fetch(`${base}/.netlify/functions/notify-affiliate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error('Affiliate partner notify failed:', await res.text());
  } catch (e) {
    console.error('Affiliate partner notify error:', e.message);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  let caller;
  try { caller = await requireAuth(event); }
  catch (error) { if (error.statusCode) return error; throw error; }
  if (caller.isSystem) return { statusCode: 403, body: JSON.stringify({ error: 'A partner session is required' }) };

  try {
    const { name, email, phone, notes } = JSON.parse(event.body || '{}');
    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPhone = String(phone || '').trim();
    const cleanNotes = String(notes || '').trim();
    if (!cleanName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'A name and valid email are required' }) };
    }
    if (cleanName.length > 160 || cleanPhone.length > 60 || cleanNotes.length > 3000) {
      return { statusCode: 400, body: JSON.stringify({ error: 'One or more fields are too long' }) };
    }

    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
    const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

    let affiliate;
    try {
      affiliate = await requireAffiliatePortalAccess({ url, key, userId: caller.userId });
    } catch (accessError) {
      return {
        statusCode: accessError.statusCode || 403,
        body: JSON.stringify({ error: accessError.message, code: accessError.code, programStatus: accessError.programStatus }),
      };
    }

    if (!affiliate.owner_user_id) {
      return { statusCode: 409, body: JSON.stringify({ error: 'This partner record needs owner assignment before referrals can be accepted.' }) };
    }
    const adminRes = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(affiliate.owner_user_id)}&role=eq.admin&select=id&limit=2`, { headers });
    const adminRows = await adminRes.json().catch(() => null);
    if (!adminRes.ok || !Array.isArray(adminRows)) throw new Error('Could not validate the partner program owner');
    if (adminRows.length !== 1) return { statusCode: 409, body: JSON.stringify({ error: 'This partner record needs a valid program owner before referrals can be accepted.' }) };
    const admin = adminRows[0];

    // Make normal double-clicks/idempotent resubmissions harmless. The same
    // affiliate + email can have one open lead; staff can still intentionally
    // create a new record later after the first lead is progressed.
    const existingRes = await fetch(`${url}/rest/v1/clients?user_id=eq.${encodeURIComponent(admin.id)}&referred_by=eq.${encodeURIComponent(affiliate.id)}&email=eq.${encodeURIComponent(cleanEmail)}&status=eq.lead&select=id,lead_drips_sent&limit=1`, { headers });
    const existingRows = await existingRes.json().catch(() => null);
    if (!existingRes.ok || !Array.isArray(existingRows)) throw new Error('Could not validate an existing referral');
    let lead = Array.isArray(existingRows) ? existingRows[0] : null;
    const duplicate = Boolean(lead);

    if (!lead) {
      const source = affiliate.company || affiliate.name;
      const insertRes = await fetch(`${url}/rest/v1/clients?select=id,lead_drips_sent`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({
          user_id: admin.id,
          name: cleanName,
          email: cleanEmail,
          phone: cleanPhone || null,
          lead_phone: cleanPhone || null,
          notes: cleanNotes || null,
          status: 'lead',
          lead_source: `Affiliate: ${source}`,
          lead_created_at: new Date().toISOString(),
          referred_by: affiliate.id,
          referral_fee: null,
        }),
      });
      const insertedRows = await insertRes.json().catch(() => null);
      if (!insertRes.ok || !Array.isArray(insertedRows) || !insertedRows[0]) throw new Error('Could not create referral lead');
      lead = insertedRows[0];
    }

    let notificationSent = false;
    const notificationMarker = 'affiliate_referral_admin_notification';
    const markers = Array.isArray(lead.lead_drips_sent) ? lead.lead_drips_sent : [];
    if (!markers.includes(notificationMarker)) {
      const base = process.env.URL || process.env.DEPLOY_URL || 'https://credit-comeback-club.netlify.app';
      // Forward the affiliate JWT — send-lpoa rejects service-role for this action.
      const affiliateAuth = event.headers.authorization || event.headers.Authorization;
      const notificationRes = await fetch(`${base}/.netlify/functions/send-lpoa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: affiliateAuth },
        body: JSON.stringify({ action: 'affiliate_new_referral', clientEmail: cleanEmail }),
      });
      notificationSent = notificationRes.ok;
      if (notificationSent) {
        const markerRes = await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(lead.id)}`, {
          method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({ lead_drips_sent: [...markers, notificationMarker] }),
        });
        if (!markerRes.ok) console.error('Affiliate referral notification marker failed:', markerRes.status);
      } else {
        console.error('Affiliate referral notification failed:', await notificationRes.text());
      }
    }

    // Partner confirmation (idempotent via notify-affiliate markers).
    if (!duplicate) {
      await notifyAffiliateInternal(key, {
        event: 'referral_received',
        clientId: lead.id,
        affiliateId: affiliate.id,
      });
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, duplicate, clientId: lead.id, notificationSent }) };
  } catch (error) {
    console.error('Affiliate referral failed:', error.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not submit referral.' }) };
  }
};
