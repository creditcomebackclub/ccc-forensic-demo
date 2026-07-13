// Encrypted store for SSN last-4 and monitoring-service password. These
// values never touch the browser in plaintext except as a value the user
// themselves typed into a form field. Reads/writes go through here instead
// of a direct Supabase call so we can (a) encrypt at rest with a key that
// only exists server-side, and (b) authorize server-side against a verified
// caller JWT rather than trusting a client-supplied client name/id.
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const b64 = process.env.CLIENT_DATA_ENCRYPTION_KEY;
  if (!b64) throw new Error('CLIENT_DATA_ENCRYPTION_KEY not configured');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('CLIENT_DATA_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

function encryptValue(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

function decryptValue(blob) {
  if (!blob) return null;
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error('client-sensitive-data: missing supabase env');
    return { statusCode: 500, body: JSON.stringify({ error: 'server not configured' }) };
  }
  if (!process.env.CLIENT_DATA_ENCRYPTION_KEY) {
    console.error('client-sensitive-data: missing CLIENT_DATA_ENCRYPTION_KEY');
    return { statusCode: 500, body: JSON.stringify({ error: 'server not configured' }) };
  }

  // Verify the caller's session token server-side. Never trust a
  // client-supplied identity for who's asking.
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Missing Authorization token' }) };

  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data: userData, error: userErr } = await authClient.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  }
  const caller = userData.user;

  // Same WebSocket workaround as audit-run-background.mjs -- createClient()
  // builds a RealtimeClient even for pure-REST usage and throws without it.
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { action, clientName } = payload;
  if (!clientName) return { statusCode: 400, body: JSON.stringify({ error: 'clientName required' }) };
  if (action !== 'read' && action !== 'write') {
    return { statusCode: 400, body: JSON.stringify({ error: 'action must be "read" or "write"' }) };
  }

  const { data: clientRow, error: clientErr } = await db
    .from('clients')
    .select('id, email')
    .eq('name', clientName)
    .limit(1)
    .maybeSingle();
  if (clientErr || !clientRow) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Client not found' }) };
  }

  const { data: staffRow } = await db
    .from('profiles')
    .select('role')
    .eq('id', caller.id)
    .maybeSingle();
  const isStaff = !!staffRow && (staffRow.role === 'admin' || staffRow.role === 'auditor');
  const isOwnRecord = !!clientRow.email && !!caller.email
    && clientRow.email.toLowerCase() === caller.email.toLowerCase();

  if (action === 'read') {
    // Reads are staff-only -- a client's portal never needs to see these
    // values back, only submit new ones.
    if (!isStaff) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized' }) };
    }
    const { data: row, error: rowErr } = await db
      .from('client_sensitive_data')
      .select('ssn_last4, monitoring_password')
      .eq('client_id', clientRow.id)
      .maybeSingle();
    if (rowErr) return { statusCode: 500, body: JSON.stringify({ error: rowErr.message }) };
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ssnLast4: row ? decryptValue(row.ssn_last4) : null,
        monitoringPassword: row ? decryptValue(row.monitoring_password) : null,
      }),
    };
  }

  // action === 'write' -- staff, or the client themself (email-verified,
  // never trusting a client-supplied id).
  if (!isStaff && !isOwnRecord) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized' }) };
  }
  const patch = { client_id: clientRow.id, updated_at: new Date().toISOString() };
  if ('ssnLast4' in payload) patch.ssn_last4 = encryptValue(payload.ssnLast4);
  if ('monitoringPassword' in payload) patch.monitoring_password = encryptValue(payload.monitoringPassword);
  if (!('ssnLast4' in payload) && !('monitoringPassword' in payload)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Nothing to write' }) };
  }

  const { error: upsertErr } = await db
    .from('client_sensitive_data')
    .upsert(patch, { onConflict: 'client_id' });
  if (upsertErr) return { statusCode: 500, body: JSON.stringify({ error: upsertErr.message }) };

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ saved: true }) };
};
