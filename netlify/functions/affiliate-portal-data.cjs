const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { affiliateId } = JSON.parse(event.body || '{}');
    if (!affiliateId) return { statusCode: 400, body: JSON.stringify({ error: 'Missing affiliateId' }) };

    // Get the auth token from header
    const authHeader = event.headers.authorization;
    if (!authHeader) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Validate the user's token using the normal anon key
    // We can just verify the token with the admin auth api
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        'apikey': process.env.VITE_SUPABASE_ANON_KEY || supabaseKey,
        'Authorization': authHeader
      }
    });

    const user = await res.json();
    if (!user || !user.id) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid token' }) };
    }

    // Now use REST API to bypass RLS and fetch data using service key
    const fetchWithKey = async (url) => {
      const r = await fetch(url, {
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
      });
      return r.json();
    };

    // 1. Verify affiliate belongs to user
    const affiliates = await fetchWithKey(`${supabaseUrl}/rest/v1/affiliates?id=eq.${affiliateId}&user_id=eq.${user.id}`);
    if (!affiliates || affiliates.length === 0) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
    }
    const affiliate = affiliates[0];

    // 2. Fetch clients — explicit select allowlist. This used to fetch the
    // ENTIRE clients row (address, phone, date_of_birth, monitoring_email,
    // internal notes/lead_notes, full ledger, everything) straight to the
    // affiliate's browser. Only the fields actually needed — either for
    // display, or as raw input to the server-side commission calc below —
    // are fetched, and the raw ledger/referral_fee never leave this
    // function; only the derived numbers do.
    const clientsData = await fetchWithKey(
      `${supabaseUrl}/rest/v1/clients?referred_by=eq.${affiliateId}&select=id,name,email,phone,created_at,referral_fee,ledger`
    );
    const rawClients = Array.isArray(clientsData) ? clientsData : [];

    // 3. Fetch this affiliate's payout ledger and compute commission
    // server-side via the shared module (same one BillingDashboardPage.jsx,
    // AffiliateProfilePanel.jsx etc. use) — single source of truth, and it
    // means the affiliate's own portal can never drift from what staff see.
    const { computeClientCommission } = await import('../../src/utils/affiliateCommission.js');
    const payoutsData = await fetchWithKey(
      `${supabaseUrl}/rest/v1/commission_payouts?affiliate_id=eq.${affiliateId}&select=client_id,covered_tx_ids,amount`
    );
    const payouts = Array.isArray(payoutsData) ? payoutsData : [];
    const payoutsByClient = new Map();
    for (const p of payouts) {
      if (!payoutsByClient.has(p.client_id)) payoutsByClient.set(p.client_id, []);
      payoutsByClient.get(p.client_id).push(p);
    }

    const clients = rawClients.map((c) => {
      const { earned, paid, owed } = computeClientCommission(
        { referral_fee: c.referral_fee, ledger: c.ledger },
        affiliate,
        payoutsByClient.get(c.id) || []
      );
      const ratePct = c.referral_fee !== null && c.referral_fee !== undefined ? c.referral_fee : Math.round((affiliate.commission_rate || 0.20) * 100);
      const totalPaid = (Array.isArray(c.ledger) ? c.ledger : []).reduce((sum, tx) => {
        if (tx.type === 'Payment' || (tx.type === 'Invoice' && tx.status === 'Paid')) return sum + (parseFloat(tx.amount) || 0);
        return sum;
      }, 0);
      return {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        created_at: c.created_at,
        totalPaid,
        commissionEarned: earned,
        commissionPaid: paid,
        commissionOwed: owed,
        ratePct,
      };
    });

    // 4. Fetch letters and profiles for these clients
    let letters = [];
    let profiles = [];

    if (clients.length > 0) {
      const formatIn = (str) => str.includes(',') ? `"${str}"` : str;

      const names = clients.map(c => c.name).filter(Boolean);
      if (names.length > 0) {
        const namesQuery = names.map(formatIn).join(',');
        const lettersData = await fetchWithKey(`${supabaseUrl}/rest/v1/letters?select=client_name,furnisher,phase,mailed_date,tracking_status,delivered_at,response_outcome,saved_at&client_name=in.(${encodeURIComponent(namesQuery)})`);
        if (Array.isArray(lettersData)) letters = lettersData;
      }

      const emails = clients.map(c => c.email).filter(Boolean);
      if (emails.length > 0) {
        const emailsQuery = emails.map(formatIn).join(',');
        const profilesData = await fetchWithKey(`${supabaseUrl}/rest/v1/client_profiles?select=email,full_name,starting_scores,current&email=in.(${encodeURIComponent(emailsQuery)})`);
        if (Array.isArray(profilesData)) profiles = profilesData;
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clients, letters, profiles })
    };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
