// Secure referral intake for authenticated affiliate partners. The browser
// never gets permission to create CRM rows directly; this function verifies
// the partner identity and stamps the referral with the firm administrator.
const { requireAuth } = require('./_requireAuth.cjs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  let caller;
  try { caller = await requireAuth(event); }
  catch (error) { if (error.statusCode) return error; throw error; }

  try {
    const { name, email, phone, notes, notifyAdmin = true } = JSON.parse(event.body || '{}');
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

    const affiliateRes = await fetch(`${url}/rest/v1/affiliates?user_id=eq.${encodeURIComponent(caller.userId)}&select=id,name,company&limit=1`, { headers });
    const affiliateRows = await affiliateRes.json();
    const affiliate = Array.isArray(affiliateRows) ? affiliateRows[0] : null;
    if (!affiliate) return { statusCode: 403, body: JSON.stringify({ error: 'Your affiliate portal is not linked yet. Contact Credit Comeback Club.' }) };

    const adminRes = await fetch(`${url}/rest/v1/profiles?role=eq.admin&select=id&limit=1`, { headers });
    const adminRows = await adminRes.json();
    const admin = Array.isArray(adminRows) ? adminRows[0] : null;
    if (!admin?.id) return { statusCode: 500, body: JSON.stringify({ error: 'No administrator is configured' }) };

    // Make normal double-clicks/idempotent resubmissions harmless. The same
    // affiliate + email can have one open lead; staff can still intentionally
    // create a new record later after the first lead is progressed.
    const existingRes = await fetch(`${url}/rest/v1/clients?user_id=eq.${encodeURIComponent(admin.id)}&referred_by=eq.${encodeURIComponent(affiliate.id)}&email=eq.${encodeURIComponent(cleanEmail)}&status=eq.lead&select=id,lead_drips_sent&limit=1`, { headers });
    const existingRows = await existingRes.json();
    let lead = Array.isArray(existingRows) ? existingRows[0] : null;
    const duplicate = Boolean(lead);

    if (!lead) {
      const source = affiliate.company || affiliate.name;
      const insertRes = await fetch(`${url}/rest/v1/clients`, {
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
      const insertedRows = await insertRes.json();
      if (!insertRes.ok || !Array.isArray(insertedRows) || !insertedRows[0]) throw new Error('Could not create referral lead');
      lead = insertedRows[0];
    }

    let notificationSent = false;
    const notificationMarker = 'affiliate_referral_admin_notification';
    const markers = Array.isArray(lead.lead_drips_sent) ? lead.lead_drips_sent : [];
    if (notifyAdmin !== false && !markers.includes(notificationMarker)) {
      const base = process.env.URL || process.env.DEPLOY_URL || 'https://ccc-forensic-demo.netlify.app';
      const notificationRes = await fetch(`${base}/.netlify/functions/send-lpoa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ action: 'affiliate_new_referral', userId: caller.userId, clientEmail: cleanEmail }),
      });
      notificationSent = notificationRes.ok;
      if (notificationSent) {
        await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(lead.id)}`, {
          method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({ lead_drips_sent: [...markers, notificationMarker] }),
        });
      } else {
        console.error('Affiliate referral notification failed:', await notificationRes.text());
      }
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, duplicate, clientId: lead.id, notificationSent }) };
  } catch (error) {
    console.error('Affiliate referral failed:', error.message);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Could not submit referral' }) };
  }
};
