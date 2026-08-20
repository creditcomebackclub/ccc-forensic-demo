// Client-side access to SSN last-4, monitoring password, and staff-authored
// dispute-story notes. Values are encrypted at rest and never included in
// bulk client-list queries — every
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

// Staff-only. Ask for only the fields a focused workflow needs so unrelated
// credentials never enter that component's browser state.
// Sensitive records are UUID-addressed; names are never used as selectors.
export async function readClientSensitiveData(clientName, clientId, fields = ['ssnLast4', 'monitoringPassword']) {
  return callFunction({ action: 'read', clientId: clientId || null, fields });
}

// Staff, or the client updating their own SSN/password record. Story notes
// are additionally restricted to an admin or the auditor who owns the client.
// Only keys present in `fields` are written — omit a key to leave it untouched.
export async function writeClientSensitiveData(clientName, fields, clientId) {
  return callFunction({ action: 'write', clientId: clientId || null, ...fields });
}
