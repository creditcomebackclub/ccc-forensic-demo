const { createClient } = require('@supabase/supabase-js');

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

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const payload = JSON.parse(event.body);
    const { name, email, phone, tier } = payload;

    if (!name || !email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Name and email are required' }) };
    }

    // 1. Create the lead in Supabase
    const { data: lead, error: insertErr } = await supabase.from('clients').insert([{
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone ? phone.trim() : null,
      status: 'lead',
      lead_source: 'Website Intake',
      notes: tier ? `Selected Tier: ${tier}` : null
    }]).select().single();

    if (insertErr) {
      console.error('Insert error:', insertErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create lead' }) };
    }

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
