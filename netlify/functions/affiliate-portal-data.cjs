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

    // 2. Fetch clients
    const clients = await fetchWithKey(`${supabaseUrl}/rest/v1/clients?referred_by=eq.${affiliateId}`);

    // 3. Fetch letters and profiles for these clients
    let letters = [];
    let profiles = [];

    if (clients && clients.length > 0) {
      const names = clients.map(c => c.name).filter(Boolean);
      const emails = clients.map(c => c.email).filter(Boolean);
      
      if (names.length > 0) {
        const namesQuery = names.map(n => `"${n}"`).join(',');
        letters = await fetchWithKey(`${supabaseUrl}/rest/v1/letters?select=client_name,furnisher,phase,mailed_date,tracking_status,delivered_at,response_outcome,saved_at&client_name=in.(${encodeURIComponent(namesQuery)})`);
      }
      
      if (emails.length > 0) {
        const emailsQuery = emails.map(e => `"${e}"`).join(',');
        profiles = await fetchWithKey(`${supabaseUrl}/rest/v1/client_profiles?select=email,full_name,starting_scores,current&email=in.(${encodeURIComponent(emailsQuery)})`);
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clients: clients || [], letters: letters || [], profiles: profiles || [] })
    };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
