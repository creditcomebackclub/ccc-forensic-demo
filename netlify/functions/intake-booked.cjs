// Receives the Calendly inline embed's event_scheduled notification. The
// opaque lead UUID returned by public-intake binds the browser event to one
// CRM lead; the server loads all email/name/tier data itself.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Server not configured' }) };

  let leadId;
  try { leadId = JSON.parse(event.body || '{}').leadId; }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(String(leadId || ''))) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid lead' }) };
  }

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const leadRes = await fetch(
    `${supabaseUrl}/rest/v1/clients?id=eq.${encodeURIComponent(leadId)}&status=eq.lead&select=id,name,email,lead_notes,lead_drips_sent&limit=1`,
    { headers }
  );
  const rows = await leadRes.json();
  const lead = Array.isArray(rows) ? rows[0] : null;
  if (!lead?.email) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Lead not found' }) };

  const marker = 'consultation_booked_confirmation';
  const sent = Array.isArray(lead.lead_drips_sent) ? lead.lead_drips_sent : [];
  if (sent.includes(marker)) return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, duplicate: true }) };

  const tierMatch = String(lead.lead_notes || '').match(/^Selected Tier:\s*(.+)$/i);
  const tier = tierMatch ? tierMatch[1].trim() : 'Consultation';
  const enrollment = tier !== 'Consultation';
  const base = process.env.URL || process.env.DEPLOY_URL || 'https://ccc-forensic-demo.netlify.app';

  let portalInvited = false;
  if (enrollment) {
    try {
      const provisionRes = await fetch(base + '/.netlify/functions/provision-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ email: lead.email, fullName: lead.name, kind: 'client', clientId: lead.id }),
      });
      portalInvited = provisionRes.ok;
      if (!provisionRes.ok) console.error('Pre-call portal provisioning failed:', await provisionRes.text());
    } catch (e) {
      console.error('Pre-call portal provisioning failed:', e.message);
    }
  }

  const emailRes = await fetch(base + '/.netlify/functions/send-lpoa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      action: 'send_consultation_booked',
      clientName: lead.name,
      clientEmail: lead.email,
      tier,
      portalInvited,
    }),
  });
  if (!emailRes.ok) {
    console.error('Booked consultation email failed:', await emailRes.text());
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'Could not send booking confirmation' }) };
  }

  await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${encodeURIComponent(lead.id)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ lead_drips_sent: [...sent, marker] }),
  });

  return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, portalInvited }) };
};
