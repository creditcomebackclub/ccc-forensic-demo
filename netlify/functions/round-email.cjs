const { createClient } = require('@supabase/supabase-js');
const { requireStaff } = require('./_requireAuth.cjs');
const { queueRoundEvent, sendCustomClientEmail } = require('./_roundEmail.cjs');
const ws = require('ws');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const staff = await requireStaff(event);
    const body = JSON.parse(event.body || '{}');
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: ws } });

    if (body.action === 'queue_event') {
      const { data: round, error } = await db.from('dispute_rounds').select('id,user_id').eq('id', body.roundId).single();
      if (error || !round) return { statusCode: 404, body: JSON.stringify({ error: 'Round not found' }) };
      if (staff.role !== 'admin' && round.user_id !== staff.userId) return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for this round' }) };
      const result = await queueRoundEvent({ roundId: round.id, eventType: body.eventType });
      return { statusCode: 200, body: JSON.stringify(result) };
    }

    if (body.action === 'send_custom') {
      const { data: client, error } = await db.from('clients').select('id,user_id').eq('id', body.clientId).single();
      if (error || !client) return { statusCode: 404, body: JSON.stringify({ error: 'Client not found' }) };
      if (staff.role !== 'admin' && client.user_id !== staff.userId) return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for this client' }) };
      const result = await sendCustomClientEmail({ staffUserId: staff.userId, clientId: client.id, roundId: body.roundId || null, templateId: body.templateId || null, subject: body.subject, bodyText: body.bodyText });
      return { statusCode: 200, body: JSON.stringify(result) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (error) {
    if (error?.statusCode) return error;
    console.error('[round-email]', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || 'Email operation failed' }) };
  }
};
