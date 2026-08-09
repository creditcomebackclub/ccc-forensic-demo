// Portal enrollment uploads (signature / LPOA / ID / address).
// ClientSetupFlow used to write directly to the private documents bucket;
// that INSERT is gated by storage RLS that joins client_profiles → clients.
// When those policies are missing, stale, or the profile's client_id is not
// wired yet, enrollment dies with "new row violates row-level security
// policy". This endpoint authenticates the portal session, resolves the
// caller's firm/client path server-side, and uploads with the service role.

const https = require('https');
const crypto = require('crypto');
const { requireAuth } = require('./_requireAuth.cjs');
const {
  DOCUMENTS_BUCKET,
  identityDocPath,
  lpoaSignaturePath,
  lpoaDocumentPath,
  buildLpoaSignatureRecord,
} = require('./_storagePaths.cjs');
const {
  loadAttorneySignatureDataUrl,
  injectAttorneySignatureHtml,
  htmlNeedsAttorneySignature,
} = require('./_attorneySig.cjs');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function supabaseRequest(path, method, body, url, key) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
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
        Prefer: 'return=representation',
      },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} });
        } catch (e) {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function storageUpload(supabaseUrl, serviceKey, objectPath, buffer, contentType) {
  return new Promise((resolve, reject) => {
    const path = '/storage/v1/object/' + DOCUMENTS_BUCKET + '/' + objectPath;
    const u = new URL(supabaseUrl + path);
    const options = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
        apikey: serviceKey,
        Authorization: 'Bearer ' + serviceKey,
        'x-upsert': 'true',
        'Content-Length': buffer.length,
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let body = raw;
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch (e) {
          /* keep raw */
        }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
}

function decodePayloadBytes(dataBase64) {
  const cleaned = String(dataBase64 || '').replace(/^data:[^;]+;base64,/, '');
  return Buffer.from(cleaned, 'base64');
}

function extFromNameOrType(fileName, contentType, fallback) {
  if (fileName && fileName.includes('.')) {
    return fileName.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || fallback;
  }
  if (contentType === 'image/jpeg' || contentType === 'image/jpg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType === 'text/html') return 'html';
  return fallback;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  let userId;
  let email;
  try {
    ({ userId, email } = await requireAuth(event));
  } catch (e) {
    if (e.statusCode) return { ...e, headers: { ...corsHeaders, ...(e.headers || {}) } };
    throw e;
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const kind = payload.kind;
  const allowed = new Set(['signature', 'lpoa', 'id', 'address']);
  if (!allowed.has(kind)) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'kind must be signature|lpoa|id|address' }) };
  }
  if (!payload.dataBase64) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'dataBase64 required' }) };
  }

  try {
    let profileRes = await supabaseRequest(
      '/rest/v1/client_profiles?user_id=eq.' + encodeURIComponent(userId) + '&select=id,full_name,client_id,email',
      'GET',
      null,
      supabaseUrl,
      serviceKey
    );
    let profile = Array.isArray(profileRes.body) && profileRes.body[0];

    // First-login race: profile may still be email-linked only.
    if (!profile && email) {
      const byEmail = await supabaseRequest(
        '/rest/v1/client_profiles?email=eq.' + encodeURIComponent(String(email).toLowerCase()) + '&select=id,full_name,client_id,email,user_id',
        'GET',
        null,
        supabaseUrl,
        serviceKey
      );
      profile = Array.isArray(byEmail.body) && byEmail.body[0];
      if (profile && !profile.user_id) {
        await supabaseRequest(
          '/rest/v1/client_profiles?id=eq.' + encodeURIComponent(profile.id),
          'PATCH',
          { user_id: userId },
          supabaseUrl,
          serviceKey
        );
      }
    }

    if (!profile) {
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Client profile not found for this session' }) };
    }

    let clientId = profile.client_id || null;
    let firmUserId = null;
    let clientName = profile.full_name || email || 'Client';

    if (clientId) {
      const clientRes = await supabaseRequest(
        '/rest/v1/clients?id=eq.' + encodeURIComponent(clientId) + '&select=id,user_id,name',
        'GET',
        null,
        supabaseUrl,
        serviceKey
      );
      const clientRow = Array.isArray(clientRes.body) && clientRes.body[0];
      if (clientRow) {
        firmUserId = clientRow.user_id;
        clientName = clientRow.name || clientName;
      }
    }

    if (!clientId || !firmUserId) {
      const name = profile.full_name;
      const emailNorm = (profile.email || email || '').toLowerCase();
      let clientRow = null;
      if (emailNorm) {
        const byEmail = await supabaseRequest(
          '/rest/v1/clients?email=eq.' + encodeURIComponent(emailNorm) + '&select=id,user_id,name&limit=1',
          'GET',
          null,
          supabaseUrl,
          serviceKey
        );
        clientRow = Array.isArray(byEmail.body) && byEmail.body[0];
      }
      if (!clientRow && name) {
        const byName = await supabaseRequest(
          '/rest/v1/clients?name=eq.' + encodeURIComponent(name) + '&select=id,user_id,name&limit=1',
          'GET',
          null,
          supabaseUrl,
          serviceKey
        );
        clientRow = Array.isArray(byName.body) && byName.body[0];
      }
      if (clientRow) {
        clientId = clientRow.id;
        firmUserId = clientRow.user_id;
        clientName = clientRow.name || clientName;
        await supabaseRequest(
          '/rest/v1/client_profiles?id=eq.' + encodeURIComponent(profile.id),
          'PATCH',
          { client_id: clientId, user_id: userId },
          supabaseUrl,
          serviceKey
        );
      }
    }

    if (!clientId || !firmUserId) {
      return {
        statusCode: 409,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Client record is not linked to a firm folder yet. Contact Credit Comeback Club.' }),
      };
    }

    const contentType = payload.contentType || 'application/octet-stream';
    let buffer = decodePayloadBytes(payload.dataBase64);
    if (!buffer.length) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Empty file payload' }) };
    }
    // Netlify request body limit is ~6MB; keep a clear error under that.
    if (buffer.length > 5.5 * 1024 * 1024) {
      return {
        statusCode: 413,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'File is too large to upload during enrollment. Use a smaller photo (under ~5MB) and retry.' }),
      };
    }

    let documentHash = null;
    // Portal clients cannot read client-docs/firm/* — inject attorney sig here
    // so stored LPOA HTML always has the real signature for Lob enclosures.
    if (kind === 'lpoa') {
      let html = buffer.toString('utf8');
      if (htmlNeedsAttorneySignature(html)) {
        try {
          const dataUrl = await loadAttorneySignatureDataUrl(supabaseUrl, serviceKey);
          html = injectAttorneySignatureHtml(html, dataUrl);
          buffer = Buffer.from(html, 'utf8');
        } catch (e) {
          console.warn('portal-enroll-upload: attorney signature inject failed', e.message);
        }
      }
      documentHash = crypto.createHash('sha256').update(buffer).digest('hex');
    }

    let objectPath;
    if (kind === 'signature') {
      objectPath = lpoaSignaturePath(firmUserId, clientId);
    } else if (kind === 'lpoa') {
      objectPath = lpoaDocumentPath(firmUserId, clientId);
    } else {
      const ext = extFromNameOrType(payload.fileName, contentType, kind === 'id' ? 'jpg' : 'jpg');
      objectPath = identityDocPath(firmUserId, clientId, kind, ext);
    }

    const uploadRes = await storageUpload(supabaseUrl, serviceKey, objectPath, buffer, contentType);
    if (uploadRes.status < 200 || uploadRes.status >= 300) {
      console.error('portal-enroll-upload storage failed', uploadRes.status, uploadRes.body);
      return {
        statusCode: 502,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Storage upload failed', detail: uploadRes.body }),
      };
    }

    // Legacy portal enrollment remains supported, but this security-sensitive
    // state change happens server-side after the authenticated client actually
    // stored an LPOA. Clients no longer receive broad UPDATE permission on
    // their CRM row.
    if (kind === 'lpoa') {
      const signedAt = new Date().toISOString();
      const signatureRecord = buildLpoaSignatureRecord({
        firmUserId,
        clientId,
        signedAt,
        method: 'Canvas signature — legacy portal enrollment',
        documentHash,
        ip: event.headers['x-forwarded-for'] || null,
      });
      const patch = await supabaseRequest(
        '/rest/v1/clients?id=eq.' + encodeURIComponent(clientId),
        'PATCH',
        { lpoa_signed: true, lpoa_signed_at: signedAt, lpoa_signature_data: signatureRecord },
        supabaseUrl,
        serviceKey
      );
      if (patch.status < 200 || patch.status >= 300) throw new Error('Could not record the signed authorization.');
    }

    if (kind === 'id' || kind === 'address') {
      const data = JSON.stringify({
        user_id: firmUserId,
        client_id: clientId,
        client_name: clientName,
        doc_type: kind,
        file_name: payload.fileName || objectPath.split('/').pop(),
        storage_path: objectPath,
        uploaded_at: new Date().toISOString(),
      });
      const upsertRes = await new Promise((resolve, reject) => {
        const u = new URL(
          supabaseUrl + '/rest/v1/documents?on_conflict=user_id,client_id,doc_type'
        );
        const options = {
          hostname: u.hostname,
          port: 443,
          path: u.pathname + u.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: serviceKey,
            Authorization: 'Bearer ' + serviceKey,
            Prefer: 'resolution=merge-duplicates,return=minimal',
            'Content-Length': Buffer.byteLength(data),
          },
        };
        const req = https.request(options, (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => resolve({ status: res.statusCode, body: raw }));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
      });
      if (upsertRes.status < 200 || upsertRes.status >= 300) {
        console.error('documents upsert failed', upsertRes.status, upsertRes.body);
        return {
          statusCode: 502,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'File stored but documents registry write failed' }),
        };
      }
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        path: objectPath,
        bucket: DOCUMENTS_BUCKET,
        clientId,
        firmUserId,
        clientName,
        ...(documentHash ? { documentHash } : {}),
      }),
    };
  } catch (e) {
    console.error('portal-enroll-upload error', e);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: e.message || 'Upload failed' }),
    };
  }
};
