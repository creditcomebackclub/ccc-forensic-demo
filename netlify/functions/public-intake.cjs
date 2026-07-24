exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  try {
    const payload = JSON.parse(event.body);
    const { name, email, phone, tier, ref } = payload;

    if (!name || !email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Name and email are required' }) };
    }

    // 1. Fetch the admin user_id from an existing client
    const userRes = await fetch(`${supabaseUrl}/rest/v1/clients?select=user_id&limit=1`, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    });
    const users = await userRes.json();
    const adminUserId = users.length > 0 ? users[0].user_id : null;

    if (!adminUserId) {
      console.error('No admin user found to assign lead to');
      return { statusCode: 500, body: JSON.stringify({ error: 'No admin user configured' }) };
    }

    // 1b. Affiliate attribution. The affiliate portal hands out
    // /join?ref=<first 8 chars of the affiliate UUID>, so resolve that
    // prefix to the full affiliate and stamp referred_by on the lead —
    // this is what makes the referral actually pay the affiliate. A bad or
    // unmatched ref is ignored (lead still created), never fatal.
    //
    // Matched in JS, not via a `like` filter on the `id` column: PostgREST/
    // Postgres has no `~~` (LIKE) operator for `uuid`, and this instance's
    // PostgREST does not honor the `column::text` cast-in-filter-name
    // syntax either (confirmed live — both return "operator does not exist:
    // uuid ~~ unknown"). The affiliates table is tiny, so fetching all rows
    // and prefix-matching client-side is simple and correct rather than
    // fighting a query-string cast that doesn't work here.
    let affiliate = null;
    if (ref && /^[0-9a-f]{6,36}$/i.test(String(ref).trim())) {
      try {
        const refPrefix = String(ref).trim().toLowerCase();
        const affRes = await fetch(`${supabaseUrl}/rest/v1/affiliates?select=id,name,company`, {
          headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
        });
        const allAffs = await affRes.json();
        const matches = Array.isArray(allAffs) ? allAffs.filter((a) => a.id.toLowerCase().startsWith(refPrefix)) : [];
        // Only attribute on an unambiguous single match — never guess.
        if (matches.length === 1) affiliate = matches[0];
        else if (matches.length > 1) console.warn('Ambiguous affiliate ref (multiple matches), not attributing:', ref);
      } catch (e) { console.warn('Affiliate ref lookup failed (non-fatal):', e.message); }
    }
    const affiliateLabel = affiliate ? (affiliate.company || affiliate.name) : null;

    // 2. Create the lead in Supabase via REST API
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/clients`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        user_id: adminUserId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        lead_phone: phone ? phone.trim() : null,
        status: 'lead',
        lead_source: affiliateLabel ? `Affiliate: ${affiliateLabel}` : 'Website Intake',
        lead_notes: tier ? `Selected Tier: ${tier}` : null,
        lead_created_at: new Date().toISOString(),
        ...(affiliate ? { referred_by: affiliate.id, referral_fee: null } : {})
      })
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      console.error('Insert error:', errText);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create lead: ' + errText }) };
    }

    const insertedData = await insertRes.json();
    const lead = insertedData[0]; // Prefer return=representation returns an array


    // 3. Trigger the magic link email (using service key to bypass admin check)
    const base = process.env.URL || process.env.DEPLOY_URL || 'https://ccc-forensic-demo.netlify.app';
    const portalUrl = `${base}/login`;
    
    const emailRes = await fetch(base + '/.netlify/functions/send-lpoa', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`
      },
      body: JSON.stringify({ 
        action: 'send', 
        clientName: lead.name, 
        clientEmail: lead.email, 
        lpoaUrl: portalUrl 
      }),
    });

    if (!emailRes.ok) {
      console.error('Email trigger failed:', await emailRes.text());
    }

    // 4. Trigger the Admin Notification email
    const adminRes = await fetch(base + '/.netlify/functions/send-lpoa', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`
      },
      body: JSON.stringify({ 
        action: 'admin_new_lead', 
        leadName: lead.name, 
        leadEmail: lead.email,
        leadPhone: lead.lead_phone,
        tier: tier
      }),
    });

    if (!adminRes.ok) {
      console.error('Admin notification trigger failed:', await adminRes.text());
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ success: true, leadId: lead.id })
    };

  } catch (err) {
    console.error('Intake error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
