// Canonical portal enrollment upload for the two identity documents required
// by the active service-agreement wizard. This endpoint deliberately does not
// accept signatures, agreements, or legacy LPOAs and never mutates onboarding
// or authorization state.

const https = require('https');
const crypto = require('crypto');
const { requireAuth } = require('./_requireAuth.cjs');
const { DOCUMENTS_BUCKET, identityDocPath } = require('./_storagePaths.cjs');
const { normalizePortalIdentity } = require('./_portalIdentity.cjs');

// Base64 expands by ~33%; keep the decoded file below the synchronous Netlify
// request limit so users receive our actionable 413 instead of an edge error.
const MAX_BYTES = 4 * 1024 * 1024;
const MIN_BYTES = 16;
const KINDS = new Set(['id', 'address']);
const DETECTED_TYPES = Object.freeze({
  pdf: { contentType: 'application/pdf', extension: 'pdf' },
  jpeg: { contentType: 'image/jpeg', extension: 'jpg' },
  png: { contentType: 'image/png', extension: 'png' },
  webp: { contentType: 'image/webp', extension: 'webp' },
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(statusCode, body) {
  return { statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function supabaseRequest(path, method, body, url, key, prefer = 'return=representation') {
  return new Promise((resolve, reject) => {
    const data = body === undefined || body === null ? null : JSON.stringify(body);
    const u = new URL(url + path);
    const options = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: 'Bearer ' + key,
        Prefer: prefer,
      },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed = raw;
        try { parsed = raw ? JSON.parse(raw) : {}; } catch { /* retain raw response */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function storageUpload(supabaseUrl, serviceKey, objectPath, buffer, contentType) {
  return new Promise((resolve, reject) => {
    const u = new URL('/storage/v1/object/' + DOCUMENTS_BUCKET + '/' + objectPath, supabaseUrl);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        apikey: serviceKey,
        Authorization: 'Bearer ' + serviceKey,
        'x-upsert': 'false',
        'Content-Length': buffer.length,
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
}

function storageDownload(supabaseUrl, serviceKey, objectPath) {
  return new Promise((resolve, reject) => {
    const u = new URL('/storage/v1/object/authenticated/' + DOCUMENTS_BUCKET + '/' + objectPath, supabaseUrl);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname,
      method: 'GET',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => { chunks.push(Buffer.from(chunk)); });
      res.on('end', () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

function normalizeClaimedType(value) {
  const type = String(value || '').split(';')[0].trim().toLowerCase();
  if (!type || type === 'application/octet-stream') return '';
  if (type === 'image/jpg') return 'image/jpeg';
  return type;
}

function decodeStrictBase64(value) {
  const input = String(value || '');
  const match = input.match(/^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/);
  const encoded = match ? match[2] : input;
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('The document payload is not valid base64.');
  }
  const buffer = Buffer.from(encoded, 'base64');
  const canonicalInput = encoded.replace(/=+$/, '');
  if (buffer.toString('base64').replace(/=+$/, '') !== canonicalInput) {
    throw new Error('The document payload is not valid base64.');
  }
  return { buffer, dataUrlType: match ? normalizeClaimedType(match[1]) : null };
}

function detectFile(buffer) {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return DETECTED_TYPES.pdf;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return DETECTED_TYPES.jpeg;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return DETECTED_TYPES.png;
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return DETECTED_TYPES.webp;
  return null;
}

function safeOriginalName(value, fallback, extension) {
  const base = String(value || '').replace(/\\/g, '/').split('/').pop().replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!base) return fallback;
  const stem = base.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9._ ()-]/g, '-').trim() || 'document';
  const safeExtension = extension || String(fallback || '').split('.').pop().replace(/[^a-z0-9]/gi, '') || 'bin';
  return `${stem.slice(0, 170)}.${safeExtension}`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json(500, { error: 'Server not configured' });

  let caller;
  try {
    caller = await requireAuth(event);
  } catch (error) {
    if (error.statusCode) return { ...error, headers: { ...corsHeaders, ...(error.headers || {}) } };
    throw error;
  }
  if (caller.isSystem) return json(403, { error: 'A verified client session is required.' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const kind = String(payload.kind || '');
  if (!KINDS.has(kind)) {
    return json(400, { error: 'Only government ID and proof-of-address uploads are accepted.' });
  }
  if (!payload.dataBase64) return json(400, { error: 'dataBase64 required' });

  try {
    const identityRes = await supabaseRequest(
      '/rest/v1/rpc/ccc_resolve_canonical_portal_identity',
      'POST',
      { p_portal_user_id: caller.userId, p_access_mode: 'pre_sign_v3' },
      supabaseUrl,
      serviceKey,
    );
    if (identityRes.status < 200 || identityRes.status >= 300) {
      return json(identityRes.status === 401 || identityRes.status === 403 ? 403 : 409, {
        error: 'A current sent Client Service Agreement is required before onboarding documents can be uploaded.',
      });
    }
    const canonical = normalizePortalIdentity(identityRes.body);

    // No email/name recovery is permitted here. The onboarding bootstrap RPC
    // must first create one exact Auth user -> profile -> CRM client link.
    const profilesRes = await supabaseRequest(
      '/rest/v1/client_profiles?user_id=eq.' + encodeURIComponent(caller.userId)
        + '&select=id,user_id,client_id,full_name&limit=2',
      'GET', null, supabaseUrl, serviceKey
    );
    const profiles = Array.isArray(profilesRes.body) ? profilesRes.body : [];
    if (profiles.length !== 1 || profiles[0].user_id !== caller.userId
      || profiles[0].id !== canonical.profileId
      || profiles[0].client_id !== canonical.clientId) {
      return json(409, { error: 'This portal is not linked to exactly one client record. Contact Credit Comeback Club.' });
    }
    const profile = profiles[0];

    const clientsRes = await supabaseRequest(
      '/rest/v1/clients?id=eq.' + encodeURIComponent(profile.client_id) + '&select=id,user_id,name&limit=2',
      'GET', null, supabaseUrl, serviceKey
    );
    const clients = Array.isArray(clientsRes.body) ? clientsRes.body : [];
    if (clients.length !== 1 || clients[0].id !== profile.client_id
      || clients[0].user_id !== canonical.firmUserId) {
      return json(409, { error: 'The linked client record is unavailable. Contact Credit Comeback Club.' });
    }
    const client = clients[0];

    const { buffer, dataUrlType } = decodeStrictBase64(payload.dataBase64);
    if (buffer.length < MIN_BYTES) return json(400, { error: 'The uploaded file is empty or incomplete.' });
    if (buffer.length > MAX_BYTES) return json(413, { error: 'File is too large. Upload a PDF or image no larger than 4 MB.' });

    const detected = detectFile(buffer);
    if (!detected) return json(415, { error: 'Upload a valid PDF, JPEG, PNG, or WebP document.' });
    const claimedType = normalizeClaimedType(payload.contentType);
    if ((claimedType && claimedType !== detected.contentType) || (dataUrlType && dataUrlType !== detected.contentType)) {
      return json(415, { error: 'The file contents do not match the claimed file type.' });
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const objectPath = identityDocPath(client.user_id, client.id, kind, detected.extension, sha256);
    const fileName = safeOriginalName(payload.fileName, `${kind}.${detected.extension}`, detected.extension);
    const uploadedAt = new Date().toISOString();

    const uploadRes = await storageUpload(supabaseUrl, serviceKey, objectPath, buffer, detected.contentType);
    if (uploadRes.status < 200 || uploadRes.status >= 300) {
      // Retrying the exact same upload is safe: the immutable object name is
      // derived from its SHA-256. Confirm exact bytes before accepting an
      // already-existing object; never upsert over evidence.
      const existing = await storageDownload(supabaseUrl, serviceKey, objectPath).catch(() => null);
      const existingHash = existing?.status === 200
        ? crypto.createHash('sha256').update(existing.buffer).digest('hex')
        : null;
      if (existingHash !== sha256) {
        console.error('portal-enroll-upload storage failed', uploadRes.status, uploadRes.body);
        return json(existing?.status === 200 ? 409 : 502, {
          error: existing?.status === 200
            ? 'A stored document failed its integrity check. Contact Credit Comeback Club.'
            : 'Secure document storage failed. Please retry.',
        });
      }
    }

    const registryRes = await supabaseRequest(
      '/rest/v1/documents?on_conflict=user_id,client_id,doc_type',
      'POST',
      {
        user_id: client.user_id,
        client_id: client.id,
        client_name: client.name || profile.full_name || 'Client',
        doc_type: kind,
        file_name: fileName,
        storage_path: objectPath,
        content_type: detected.contentType,
        byte_size: buffer.length,
        sha256,
        uploaded_at: uploadedAt,
      },
      supabaseUrl,
      serviceKey,
      'resolution=merge-duplicates,return=representation'
    );
    if (registryRes.status < 200 || registryRes.status >= 300) {
      console.error('portal-enroll-upload registry failed', registryRes.status, registryRes.body);
      return json(502, { error: 'File stored but its secure registry record could not be confirmed. Contact Credit Comeback Club.' });
    }

    return json(200, {
      ok: true,
      kind,
      path: objectPath,
      bucket: DOCUMENTS_BUCKET,
      clientId: client.id,
      firmUserId: client.user_id,
      contentType: detected.contentType,
      byteSize: buffer.length,
      sha256,
      uploadedAt,
    });
  } catch (error) {
    console.error('portal-enroll-upload error', error);
    if (error?.status === 403) return json(403, { error: 'The client portal identity could not be verified.' });
    const status = /base64|payload|file type/i.test(error.message || '') ? 400 : 500;
    return json(status, { error: status === 400 ? error.message : 'Upload failed. Please retry.' });
  }
};

exports._test = {
  MAX_BYTES,
  KINDS,
  normalizeClaimedType,
  decodeStrictBase64,
  detectFile,
  safeOriginalName,
  storageDownload,
};
