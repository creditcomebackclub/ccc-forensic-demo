// Client-side access to SSN last-4 / monitoring password. Both values are
// encrypted at rest and never included in bulk client-list queries — every
// read/write goes through netlify/functions/client-sensitive-data.mjs, which
// verifies the caller's session token itself rather than trusting anything
// sent in the request body.
import { supabase } from './supabase';

async function callFunction(body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in.');

  const res = await fetch('/.netlify/functions/client-sensitive-data', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + session.access_token,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || ('Request failed (HTTP ' + res.status + ')'));
  return json;
}

// Staff-only — returns { ssnLast4, monitoringPassword }.
export async function readClientSensitiveData(clientName) {
  return callFunction({ action: 'read', clientName });
}

// Staff, or the client updating their own record. Only keys present in
// `fields` are written — omit a key to leave it untouched.
export async function writeClientSensitiveData(clientName, fields) {
  return callFunction({ action: 'write', clientName, ...fields });
}
