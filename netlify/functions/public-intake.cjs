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
    const { name, email, phone, tier } = payload;

    if (!name || !email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Name and email are required' }) };
    }

    // 1. Create the lead in Supabase via REST API
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/clients`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone ? phone.trim() : null,
        status: 'lead',
        lead_source: 'Website Intake',
        notes: tier ? `Selected Tier: ${tier}` : null
      })
    });

    if (!insertRes.ok) {
      console.error('Insert error:', await insertRes.text());
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create lead' }) };
    }

    const insertedData = await insertRes.json();
    const lead = insertedData[0]; // Prefer return=representation returns an array


    // 2. Trigger the magic link email (using service key to bypass admin check)
    const base = process.env.URL || process.env.DEPLOY_URL || 'https://ccc-forensic-demo.netlify.app';
    const emailRes = await fetch(base + '/.netlify/functions/send-lpoa', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`
      },
      body: JSON.stringify({ action: 'send', clientId: lead.id }),
    });

    if (!emailRes.ok) {
      console.error('Email trigger failed:', await emailRes.text());
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
