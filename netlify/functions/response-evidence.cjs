// Secure response intake for both the client portal and staff workflow.
//
// A client never supplies a client id, storage path, response kind, or letter
// patch. The server derives all four from the authenticated session and the
// existing letter. Files go straight to a private bucket through short-lived
// signed-upload URLs; `complete` verifies those exact objects before it marks
// a response received.

const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const crypto = require('crypto');
const { requireAuth } = require('./_requireAuth.cjs');
const { responseEvidencePrefix, responseEvidencePrefixes } = require('./_storagePaths.cjs');

// Canonical path: responses/{firmUid}/{clientId}/response-evidence/{evidenceId}/…

const MAX_FILES = 12;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function cleanName(value) {
  const cleaned = String(value || 'response')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return cleaned || 'response';
}

function isBureauLetter(letter) {
  return String(letter.phase || '').startsWith('Phase 3');
}

function clientMatchesLetter(clientProfile, letter) {
  if (!clientProfile) return false;
  if (clientProfile.client_id && letter.client_id) {
    return clientProfile.client_id === letter.client_id;
  }
  // Transitional fallback only for profiles/letters not yet backfilled to a
  // durable client_id. The normal path above is the collision-safe one.
  return !clientProfile.client_id && clientProfile.full_name === letter.client_name;
}

async function getAccess(db, userId, letter) {
  const [{ data: staffProfile }, { data: clientProfiles }] = await Promise.all([
    db.from('profiles').select('id,role').eq('id', userId).limit(1),
    db.from('client_profiles').select('client_id,full_name').eq('user_id', userId).limit(2),
  ]);
  const staff = staffProfile && staffProfile[0];
  const isAdmin = staff && staff.role === 'admin';
  const isOwnAuditor = staff && staff.role === 'auditor' && letter.user_id === userId;
  if (isAdmin || isOwnAuditor) return { role: 'staff', source: 'staff_upload' };

  const clientProfile = (clientProfiles || []).find((p) => clientMatchesLetter(p, letter));
  if (clientProfile) return { role: 'client', source: 'client_portal' };
  return null;
}

function parseFiles(files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('At least one response file is required.');
  if (files.length > MAX_FILES) throw new Error(`A response can contain at most ${MAX_FILES} files.`);

  return files.map((file, index) => {
    const name = cleanName(file && file.name);
    const contentType = String(file && file.contentType || '').toLowerCase();
    const size = Number(file && file.size || 0);
    if (!ALLOWED_TYPES.has(contentType)) {
      throw new Error('Only PDF, JPG, PNG, and WEBP response files are accepted.');
    }
    if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_SIZE) {
      throw new Error(`Each response file must be between 1 byte and ${Math.floor(MAX_FILE_SIZE / 1024 / 1024)} MB.`);
    }
    return { name, contentType, size, index };
  });
}

async function loadLetter(db, letterId) {
  if (!letterId || typeof letterId !== 'string' || letterId.length > 500) return null;
  const { data, error } = await db
    .from('letters')
    .select('id,user_id,client_id,client_account_id,client_name,phase,furnisher,mailed_date,response_outcome')
    .eq('id', letterId)
    .limit(1);
  if (error) throw error;
  return data && data[0] || null;
}

async function prepareUpload(db, userId, body) {
  const letter = await loadLetter(db, body.letterId);
  if (!letter) return { error: response(404, { error: 'Dispute letter not found.' }) };
  const access = await getAccess(db, userId, letter);
  if (!access) return { error: response(403, { error: 'You do not have access to this dispute letter.' }) };

  let files;
  try { files = parseFiles(body.files); }
  catch (e) { return { error: response(400, { error: e.message }) }; }

  // A deletion is a terminal reported outcome. Do not let a stale browser
  // upload overwrite it; staff can resolve the record deliberately instead.
  if (letter.response_outcome === 'deleted') {
    return { error: response(409, { error: 'This dispute is already marked deleted and cannot accept a new response.' }) };
  }
  if (access.role === 'client' && !letter.mailed_date) {
    return { error: response(409, { error: 'A response can be uploaded only after this dispute has been mailed.' }) };
  }

  if (!letter.client_id) {
    return { error: response(409, { error: 'This letter is missing a client_id; link it to a client before uploading a response.' }) };
  }

  const evidenceId = crypto.randomUUID();
  const prefix = responseEvidencePrefix(letter.user_id, letter.client_id, evidenceId);
  const paths = files.map((file) => `${prefix}/response_${String(file.index + 1).padStart(2, '0')}_${file.name}`);
  const responseKind = isBureauLetter(letter) ? 'bureau' : 'furnisher';

  const { error: insertError } = await db.from('response_evidence').insert({
    id: evidenceId,
    firm_user_id: letter.user_id,
    client_id: letter.client_id,
    client_account_id: letter.client_account_id || null,
    client_name: letter.client_name,
    letter_id: letter.id,
    response_kind: responseKind,
    source: access.source,
    storage_bucket: 'responses',
    storage_paths: paths,
    file_names: files.map((file) => file.name),
    upload_status: 'uploading',
    submitted_by: userId,
  });
  if (insertError) throw insertError;

  try {
    const uploads = [];
    for (let i = 0; i < files.length; i += 1) {
      const { data, error } = await db.storage.from('responses').createSignedUploadUrl(paths[i]);
      if (error || !data?.token) throw error || new Error('Could not create an upload URL.');
      uploads.push({
        path: paths[i],
        token: data.token,
        contentType: files[i].contentType,
      });
    }
    return {
      result: response(200, {
        evidenceId,
        responseKind,
        uploads,
      }),
    };
  } catch (e) {
    await db.from('response_evidence').delete().eq('id', evidenceId);
    throw e;
  }
}

async function completeUpload(db, userId, body) {
  const evidenceId = body.evidenceId;
  if (!evidenceId || typeof evidenceId !== 'string') return response(400, { error: 'evidenceId required.' });

  const { data: records, error } = await db
    .from('response_evidence')
    .select('*')
    .eq('id', evidenceId)
    .limit(1);
  if (error) throw error;
  const evidence = records && records[0];
  if (!evidence) return response(404, { error: 'Response upload was not found.' });

  const letter = await loadLetter(db, evidence.letter_id);
  if (!letter) return response(404, { error: 'The linked dispute letter no longer exists.' });
  const access = await getAccess(db, userId, letter);
  if (!access || (access.role === 'client' && evidence.submitted_by !== userId)) {
    return response(403, { error: 'You do not have access to this response upload.' });
  }

  if (evidence.upload_status === 'received') {
    return response(200, {
      evidenceId: evidence.id,
      responseKind: evidence.response_kind,
      receivedAt: evidence.received_at,
      storagePaths: evidence.storage_paths || [],
    });
  }

  const paths = Array.isArray(evidence.storage_paths) ? evidence.storage_paths : [];
  const prefixes = responseEvidencePrefixes(evidence.firm_user_id, evidence.client_id, evidence.id);
  const matchedPrefix = prefixes.find((prefix) =>
    paths.length && paths.every((path) => typeof path === 'string' && path.startsWith(prefix))
  );
  if (!matchedPrefix) {
    return response(400, { error: 'Response upload paths are invalid.' });
  }

  // List the exact evidence folder with the service role. A signed upload URL
  // alone is not enough evidence of a completed upload; do not advance the
  // letter until each expected object exists.
  const { data: storedFiles, error: listError } = await db.storage
    .from(evidence.storage_bucket || 'responses')
    .list(matchedPrefix.slice(0, -1), { limit: MAX_FILES + 2 });
  if (listError) throw listError;
  const expectedNames = new Set(paths.map((path) => path.split('/').pop()));
  const presentNames = new Set((storedFiles || []).map((file) => file.name));
  if ([...expectedNames].some((name) => !presentNames.has(name))) {
    return response(409, { error: 'One or more response files have not finished uploading. Please try again.' });
  }

  const now = new Date().toISOString();
  const { error: evidenceError } = await db.from('response_evidence').update({
    upload_status: 'received',
    received_at: now,
    updated_at: now,
  }).eq('id', evidence.id);
  if (evidenceError) throw evidenceError;

  // This is the only client-initiated letter mutation: the field set is
  // fixed server-side and tied to the caller's verified evidence record.
  const letterPatch = {
    response_outcome: 'received',
    response_date: now.slice(0, 10),
    response_file_url: null,
  };
  if (evidence.response_kind === 'bureau') {
    letterPatch.bureau_response_status = 'received';
    letterPatch.bureau_response_received_at = now;
  }
  const { error: letterError } = await db.from('letters').update(letterPatch).eq('id', letter.id);
  if (letterError) throw letterError;

  return response(200, {
    evidenceId: evidence.id,
    responseKind: evidence.response_kind,
    receivedAt: now,
    storagePaths: paths,
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed.' });

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return response(500, { error: 'Server not configured.' });

  let session;
  try { session = await requireAuth(event); }
  catch (e) { if (e.statusCode) return e; throw e; }
  if (session.isSystem) return response(403, { error: 'A user session is required.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return response(400, { error: 'Invalid JSON.' }); }

  // Netlify's Node 20 runtime has no global WebSocket, and supabase-js
  // always constructs a RealtimeClient in createClient() even for pure
  // REST usage — without a real transport it throws synchronously. Same
  // fix as audit-run-background.mjs / provision-user.cjs.
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });
  try {
    if (body.action === 'prepare') {
      const prepared = await prepareUpload(db, session.userId, body);
      return prepared.error || prepared.result;
    }
    if (body.action === 'complete') return await completeUpload(db, session.userId, body);
    return response(400, { error: 'Unknown response-evidence action.' });
  } catch (e) {
    console.error('response-evidence error:', e.message || e);
    return response(500, { error: 'Could not process this response upload.' });
  }
};
