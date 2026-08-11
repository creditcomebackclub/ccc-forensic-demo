// Browser-side backup for the Calendly inline embed. The server webhook is
// authoritative and fills the event URI/time, but this callback can send the
// preparation message immediately. Both paths share the same atomic email
// claim, so a race cannot send two copies.
const { consultationTags } = require('./_calendly.cjs');
const { sendConsultationBookedOnce } = require('./_consultationBooking.cjs');

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
    `${supabaseUrl}/rest/v1/clients?id=eq.${encodeURIComponent(leadId)}&status=eq.lead&select=id,name,email,tags&limit=1`,
    { headers }
  );
  const rows = await leadRes.json();
  const lead = Array.isArray(rows) ? rows[0] : null;
  if (!lead?.email) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Lead not found' }) };

  const patchRes = await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${encodeURIComponent(lead.id)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      consultation_status: 'scheduled',
      tags: consultationTags(lead.tags, 'scheduled', true),
    }),
  });
  if (!patchRes.ok) {
    console.error('Could not record browser Calendly booking:', await patchRes.text());
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'Could not record booking' }) };
  }

  try {
    const result = await sendConsultationBookedOnce({
      clientId: lead.id,
      name: lead.name,
      email: lead.email,
      supabaseUrl,
      serviceKey,
    });
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, duplicate: Boolean(result.duplicate) }) };
  } catch (error) {
    console.error('Booked consultation email failed:', error.message || error);
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'Could not send booking preparation email' }) };
  }
};
