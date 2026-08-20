const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const { requireStaff } = require('./_requireAuth.cjs');
const { queueRoundEvent } = require('./_roundEmail.cjs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let caller;
  try { caller = await requireStaff(event); }
  catch (error) { return error?.statusCode ? error : { statusCode: 500, body: 'authentication failed' }; }
  let letterId;
  try { letterId = JSON.parse(event.body || '{}').letterId; } catch (_) {}
  if (typeof letterId !== 'string' || !letterId) return { statusCode: 400, body: 'letterId required' };
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { statusCode: 500, body: 'server not configured' };
  const db = createClient(url, key, { auth: { persistSession: false }, realtime: { transport: ws } });
  const { data: letter, error } = await db.from('letters')
    .select('id,user_id,round_id,packet_version').eq('id', letterId).maybeSingle();
  if (error || !letter) return { statusCode: 404, body: 'letter not found' };
  if (caller.role !== 'admin' && letter.user_id !== caller.userId) return { statusCode: 403, body: 'not authorized' };
  if (Number(letter.packet_version || 1) !== 2 || !letter.round_id) return { statusCode: 409, body: 'not a packet round' };
  const results = [];
  for (const eventType of ['documents_needed', 'round_review_complete']) {
    try { results.push({ eventType, ...(await queueRoundEvent({ roundId: letter.round_id, eventType })) }); }
    catch (milestoneError) { console.error('Packet milestone email failed:', eventType, milestoneError.message); results.push({ eventType, error: milestoneError.message }); }
  }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results }) };
};
