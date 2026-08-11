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
    const { name, email, phone, tier, ref, website } = payload;

    if (!name || !email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Name and email are required' }) };
    }

    // Honeypot: every intake form (home.html, freeguide.html, join.html,
    // join-embed.js) carries a hidden `website` field a real visitor never
    // sees or fills. A bot that fills every field it finds trips this.
    // Pretend success rather than reject — a bot that gets an error tries a
    // different payload shape; one that gets 200 has no reason to adapt.
    if (website) {
      console.warn('Intake honeypot triggered — dropping silently. IP:', (event.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim());
      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ success: true }) };
    }

    // Per-IP rate limiting. Netlify functions share no memory between
    // invocations, so this has to be backed by something persistent —
    // public_intake_attempts (migration 20260725) is that store. Record
    // this attempt FIRST, then count the window inclusive of it: recording
    // only attempts that make it past the limit would let a sustained flood
    // fall out of the window and start passing again once older rows age
    // out, since nothing would be left to count.
    const clientIp = (event.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
    const RATE_LIMIT_WINDOW_MIN = 15;
    const RATE_LIMIT_MAX = 5;
    try {
      await fetch(`${supabaseUrl}/rest/v1/public_intake_attempts`, {
        method: 'POST',
        headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: clientIp }),
      });

      const sinceIso = new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60 * 1000).toISOString();
      const countRes = await fetch(
        `${supabaseUrl}/rest/v1/public_intake_attempts?ip=eq.${encodeURIComponent(clientIp)}&created_at=gte.${encodeURIComponent(sinceIso)}&select=id`,
        { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
      );
      const recentAttempts = await countRes.json();
      if (Array.isArray(recentAttempts) && recentAttempts.length > RATE_LIMIT_MAX) {
        console.warn('Rate limit exceeded for IP:', clientIp, '-', recentAttempts.length, 'attempts in', RATE_LIMIT_WINDOW_MIN, 'min');
        return { statusCode: 429, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Too many submissions — please try again later.' }) };
      }
    } catch (e) {
      // Rate-limit bookkeeping failing must never block a genuine lead —
      // fail open here, the same as every other best-effort step below.
      console.warn('Rate-limit check failed (non-fatal):', e.message);
    }

    // 1. Assign every public lead to the actual administrator, never an
    // arbitrary existing client row (which could be owned by an auditor).
    const userRes = await fetch(`${supabaseUrl}/rest/v1/profiles?role=eq.admin&select=id&limit=1`, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    });
    const users = await userRes.json();
    const adminUserId = users.length > 0 ? users[0].id : null;

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
        consultation_status: 'requested',
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


    // The lead form is followed by an embedded Calendly scheduler. Do not
    // claim they booked—or send a scheduling email—until the embed reports
    // calendly.event_scheduled. intake-booked.cjs owns that confirmation.
    const base = process.env.URL || process.env.DEPLOY_URL || 'https://ccc-forensic-demo.netlify.app';

    // 3. Trigger the Admin Notification email
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

    // Partner confirmation when the public /join?ref= link attributed this lead.
    if (affiliate?.id && lead?.id) {
      try {
        const partnerRes = await fetch(base + '/.netlify/functions/notify-affiliate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            event: 'referral_received',
            clientId: lead.id,
            affiliateId: affiliate.id,
          }),
        });
        if (!partnerRes.ok) console.error('Affiliate referral confirm failed:', await partnerRes.text());
      } catch (e) {
        console.error('Affiliate referral confirm error:', e.message);
      }
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
