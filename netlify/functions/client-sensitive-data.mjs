// Encrypted store for SSN last-4, monitoring-service password, and private
// staff-authored dispute-story notes. Values only reach an authorized
// browser when a focused workflow needs them. Reads/writes go through here instead
// of a direct Supabase call so we can (a) encrypt at rest with a key that
// only exists server-side, and (b) authorize server-side against a verified
// caller JWT rather than trusting a client-supplied client name/id.
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { decryptClientData, encryptClientData, versionClientData } from './_clientDataCrypto.mjs';
import { MAX_STORY_NOTES_CHARS, canStaffAccessClient } from '../../src/utils/disputeRewriteRules.js';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const READ_FIELDS = Object.freeze({
  ssnLast4: 'ssn_last4',
  monitoringPassword: 'monitoring_password',
  disputeStoryNotes: 'dispute_story_notes',
});

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

  // Same WebSocket workaround as audit-run-background.mjs -- createClient()
  // builds a RealtimeClient even for pure-REST usage and throws without it.
  // Needed on every createClient() call in this function, not just the
  // service-role one below.
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  });
  const { data: userData, error: userErr } = await authClient.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  }
  const caller = userData.user;

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { action, clientId } = payload;
  if (typeof clientId !== 'string' || !UUID_PATTERN.test(clientId)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'A valid clientId is required' }) };
  }
  if (action !== 'read' && action !== 'write') {
    return { statusCode: 400, body: JSON.stringify({ error: 'action must be "read" or "write"' }) };
  }

  // Sensitive records are UUID-addressed only. Names are not unique and must
  // never select an arbitrary client's encrypted row.
  const { data: clientRow, error: clientErr } = await db
    .from('clients')
    .select('id, email, user_id')
    .eq('id', clientId)
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
  const canAccessStoryNotes = canStaffAccessClient(staffRow?.role, caller.id, clientRow.user_id);

  // A client email is not an identity key: historical/lead rows can share an
  // address. Resolve the caller through the same exact, active portal mapping
  // used by every other client-data boundary and bind the payload UUID to it.
  let isOwnRecord = false;
  if (!isStaff) {
    const { data: portalIdentity, error: portalIdentityError } = await db.rpc(
      'ccc_resolve_canonical_portal_identity',
      {
        p_portal_user_id: caller.id,
        p_access_mode: 'active',
      },
    );
    const identity = Array.isArray(portalIdentity) && portalIdentity.length === 1
      ? portalIdentity[0]
      : portalIdentity;
    if (portalIdentityError
        || !identity
        || typeof identity !== 'object'
        || !UUID_PATTERN.test(String(identity.clientId || ''))
        || String(identity.clientId) !== clientRow.id) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized' }) };
    }
    isOwnRecord = true;
  }

  if (action === 'read') {
    // Reads are staff-only -- a client's portal never needs to see these
    // values back, only submit new ones.
    if (!isStaff) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized' }) };
    }
    if (!canAccessStoryNotes) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for this client' }) };
    }
    const requestedFields = payload.fields === undefined ? ['ssnLast4', 'monitoringPassword'] : payload.fields;
    if (!Array.isArray(requestedFields) || !requestedFields.length
        || requestedFields.some((field) => !Object.prototype.hasOwnProperty.call(READ_FIELDS, field))) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Valid sensitive-data fields are required' }) };
    }
    const uniqueFields = [...new Set(requestedFields)];
    const selectedColumns = uniqueFields.map((field) => READ_FIELDS[field]);
    if (uniqueFields.includes('disputeStoryNotes')) selectedColumns.push('dispute_story_notes_version');
    const { data: row, error: rowErr } = await db
      .from('client_sensitive_data')
      .select(selectedColumns.join(','))
      .eq('client_id', clientRow.id)
      .maybeSingle();
    if (rowErr) return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not load sensitive client data' }) };
    const values = {};
    try {
      for (const field of uniqueFields) values[field] = row ? decryptClientData(row[READ_FIELDS[field]]) : null;
    } catch {
      return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not decrypt sensitive client data' }) };
    }
    if (uniqueFields.includes('disputeStoryNotes')) {
      const computedVersion = versionClientData(values.disputeStoryNotes);
      if (row && row.dispute_story_notes_version !== computedVersion) {
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'The stored story-note version is invalid' }) };
      }
      values.disputeStoryNotesVersion = computedVersion;
    }
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(values),
    };
  }

  // action === 'write' -- staff, or the exact active portal client resolved
  // above. The caller-supplied UUID is never authorized by email equality.
  if (!isStaff && !isOwnRecord) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized' }) };
  }
  if (isStaff && !canAccessStoryNotes) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for this client' }) };
  }

  // Clients retain the existing ability to submit their own last-4 and
  // monitoring password, but the staff-authored dispute story is never a
  // client-readable or client-writable field.
  const includesStoryNotes = Object.prototype.hasOwnProperty.call(payload, 'disputeStoryNotes');
  if (includesStoryNotes && (!isStaff || !canAccessStoryNotes)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Staff access required for dispute story notes' }) };
  }
  if (includesStoryNotes && payload.disputeStoryNotes != null && typeof payload.disputeStoryNotes !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ error: 'disputeStoryNotes must be text' }) };
  }
  if (includesStoryNotes && String(payload.disputeStoryNotes || '').length > MAX_STORY_NOTES_CHARS) {
    return { statusCode: 400, body: JSON.stringify({ error: `disputeStoryNotes must be ${MAX_STORY_NOTES_CHARS} characters or fewer` }) };
  }
  const suppliedStoryNotesVersion = payload.disputeStoryNotesVersion;
  if (includesStoryNotes
      && suppliedStoryNotesVersion !== null
      && (typeof suppliedStoryNotesVersion !== 'string' || !/^[a-f0-9]{64}$/i.test(suppliedStoryNotesVersion))) {
    return { statusCode: 400, body: JSON.stringify({ error: 'A valid prior story-note version is required' }) };
  }
  if (!includesStoryNotes && Object.prototype.hasOwnProperty.call(payload, 'disputeStoryNotesVersion')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'A story-note version requires disputeStoryNotes' }) };
  }

  const patch = { client_id: clientRow.id, updated_at: new Date().toISOString() };
  if ('ssnLast4' in payload) patch.ssn_last4 = encryptClientData(payload.ssnLast4);
  if ('monitoringPassword' in payload) patch.monitoring_password = encryptClientData(payload.monitoringPassword);
  const nextStoryNotesVersion = includesStoryNotes ? versionClientData(payload.disputeStoryNotes) : null;
  if (includesStoryNotes) {
    patch.dispute_story_notes = encryptClientData(payload.disputeStoryNotes);
    patch.dispute_story_notes_version = nextStoryNotesVersion;
  }
  if (!('ssnLast4' in payload) && !('monitoringPassword' in payload) && !includesStoryNotes) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Nothing to write' }) };
  }

  if (includesStoryNotes) {
    const expectedVersion = suppliedStoryNotesVersion === null
      ? null
      : suppliedStoryNotesVersion.toLowerCase();
    let updateQuery = db
      .from('client_sensitive_data')
      .update(patch)
      .eq('client_id', clientRow.id);
    updateQuery = expectedVersion === null
      ? updateQuery.is('dispute_story_notes_version', null)
      : updateQuery.eq('dispute_story_notes_version', expectedVersion);
    const { data: updatedRows, error: updateErr } = await updateQuery.select('client_id');
    if (updateErr) {
      return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not save sensitive client data' }) };
    }
    if (!updatedRows?.length) {
      if (expectedVersion !== null) {
        return { statusCode: 409, headers: JSON_HEADERS, body: JSON.stringify({ error: 'The story notes changed in another staff session. Reload before saving your edits' }) };
      }
      const { error: insertErr } = await db.from('client_sensitive_data').insert(patch);
      if (insertErr) {
        if (insertErr.code === '23505') {
          return { statusCode: 409, headers: JSON_HEADERS, body: JSON.stringify({ error: 'The story notes changed in another staff session. Reload before saving your edits' }) };
        }
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not save sensitive client data' }) };
      }
    }
  } else {
    const { error: upsertErr } = await db
      .from('client_sensitive_data')
      .upsert(patch, { onConflict: 'client_id' });
    if (upsertErr) return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not save sensitive client data' }) };
  }

  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      saved: true,
      ...(includesStoryNotes
        ? { disputeStoryNotesVersion: nextStoryNotesVersion }
        : {}),
    }),
  };
};
