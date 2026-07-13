// One-off migration: backfill client_sensitive_data from clients.ssn_last4 /
// clients.monitoring_password, verifying every value decrypts back to the
// original before anything is considered safe to drop.
//
// Usage (do not run until CLIENT_DATA_ENCRYPTION_KEY is confirmed live in
// Netlify — this script encrypts with the same key so it must match exactly
// what the deployed client-sensitive-data function will use):
//   node --env-file=.env.local scripts/migrate-sensitive-data.mjs
//
// Required in .env.local: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// CLIENT_DATA_ENCRYPTION_KEY.
//
// This script NEVER drops the plaintext columns itself. If every row
// verifies, it prints the exact DROP COLUMN SQL to run manually as a
// separate, deliberate step. If any row fails to verify, it stops and
// prints which client failed — no columns are touched either way.
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const b64 = process.env.CLIENT_DATA_ENCRYPTION_KEY;
  if (!b64) throw new Error('CLIENT_DATA_ENCRYPTION_KEY not set');
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

async function main() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  getKey(); // fail fast if the encryption key is missing/malformed

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  });

  const { data: clients, error } = await db
    .from('clients')
    .select('id, name, ssn_last4, monitoring_password')
    .or('ssn_last4.not.is.null,monitoring_password.not.is.null');
  if (error) { console.error('Could not read clients:', error.message); process.exit(1); }

  console.log('Found ' + clients.length + ' client(s) with plaintext sensitive data to migrate.');

  const failures = [];
  const succeeded = [];

  for (const c of clients) {
    const patch = { client_id: c.id, updated_at: new Date().toISOString() };
    if (c.ssn_last4) patch.ssn_last4 = encryptValue(c.ssn_last4);
    if (c.monitoring_password) patch.monitoring_password = encryptValue(c.monitoring_password);

    const { error: upsertErr } = await db
      .from('client_sensitive_data')
      .upsert(patch, { onConflict: 'client_id' });
    if (upsertErr) {
      failures.push({ name: c.name, reason: 'upsert failed: ' + upsertErr.message });
      continue;
    }

    // Verify: read back what was just written and confirm it decrypts to
    // the exact original plaintext.
    const { data: row, error: readErr } = await db
      .from('client_sensitive_data')
      .select('ssn_last4, monitoring_password')
      .eq('client_id', c.id)
      .single();
    if (readErr || !row) {
      failures.push({ name: c.name, reason: 'could not read back written row' });
      continue;
    }

    const ssnOk = !c.ssn_last4 || decryptValue(row.ssn_last4) === c.ssn_last4;
    const pwOk = !c.monitoring_password || decryptValue(row.monitoring_password) === c.monitoring_password;
    if (!ssnOk || !pwOk) {
      failures.push({
        name: c.name,
        reason: 'decrypt mismatch — ' + (!ssnOk ? 'ssn_last4 ' : '') + (!pwOk ? 'monitoring_password' : ''),
      });
      continue;
    }

    succeeded.push(c.name);
  }

  console.log(succeeded.length + ' verified OK, ' + failures.length + ' failed.');

  if (failures.length > 0) {
    console.error('\nSTOPPING — the following clients failed verification. No plaintext columns will be dropped:');
    for (const f of failures) console.error('  - ' + f.name + ': ' + f.reason);
    process.exit(1);
  }

  console.log('\nAll rows verified. Plaintext values are now duplicated (encrypted) in client_sensitive_data.');
  console.log('Nothing has been deleted yet. Once you\'ve spot-checked a few clients live in the app,');
  console.log('run this SQL manually in the Supabase SQL editor to drop the plaintext columns:\n');
  console.log('  alter table public.clients drop column ssn_last4;');
  console.log('  alter table public.clients drop column monitoring_password;');
}

main().catch((e) => { console.error(e); process.exit(1); });
