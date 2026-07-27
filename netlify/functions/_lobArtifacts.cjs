const https = require('https');
const crypto = require('crypto');

function requestJson(url, method, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method,
      headers: {
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
        ...headers,
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function download(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== 'https:') return reject(new Error('Lob artifact URL must use HTTPS'));
    const req = https.get({ hostname: u.hostname, port: 443, path: u.pathname + u.search }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error('Artifact download returned HTTP ' + res.statusCode));
      }
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > 30 * 1024 * 1024) {
          req.destroy(new Error('Artifact exceeds 30 MB archive limit'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ body: Buffer.concat(chunks), contentType: res.headers['content-type'] || 'application/octet-stream' }));
    });
    req.on('error', reject);
  });
}

function lobRequest(path, apiKey) {
  const auth = Buffer.from(apiKey + ':').toString('base64');
  return requestJson('https://api.lob.com' + path, 'GET', null, { Authorization: 'Basic ' + auth });
}

function objectPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function extension(contentType, artifactType) {
  if (/pdf/i.test(contentType)) return 'pdf';
  if (/png/i.test(contentType)) return 'png';
  if (/jpe?g/i.test(contentType)) return 'jpg';
  return artifactType === 'mailpiece_pdf' ? 'pdf' : 'bin';
}

async function letterContext({ lobId, letterId, supabaseUrl, serviceKey }) {
  const query = letterId
    ? '/rest/v1/letters?id=eq.' + encodeURIComponent(letterId) + '&select=id,user_id,client_id,lob_id'
    : '/rest/v1/letters?lob_id=eq.' + encodeURIComponent(lobId) + '&select=id,user_id,client_id,lob_id';
  const res = await requestJson(supabaseUrl + query, 'GET', null, {
    apikey: serviceKey,
    Authorization: 'Bearer ' + serviceKey,
  });
  return Array.isArray(res.body) ? res.body[0] : null;
}

async function archiveLobArtifact({ lobId, letterId, artifactType, sourceUrl, apiKey, supabaseUrl, serviceKey }) {
  if (!lobId || !artifactType || !apiKey || !supabaseUrl || !serviceKey) {
    throw new Error('Incomplete Lob artifact archive configuration');
  }

  const context = await letterContext({ lobId, letterId, supabaseUrl, serviceKey });
  if (!context) return { archived: false, reason: 'letter_not_found' };
  if (context.lob_id && context.lob_id !== lobId) {
    throw new Error('Lob ID does not belong to the requested CCC letter');
  }

  const existing = await requestJson(
    supabaseUrl + '/rest/v1/mail_artifacts?lob_id=eq.' + encodeURIComponent(lobId)
      + '&artifact_type=eq.' + encodeURIComponent(artifactType) + '&select=id,status,storage_path',
    'GET', null, { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey }
  );
  if (Array.isArray(existing.body) && existing.body[0]?.status === 'archived') {
    return { archived: true, reused: true, storagePath: existing.body[0].storage_path };
  }

  let artifactUrl = sourceUrl;
  if (!artifactUrl) {
    const lobRes = await lobRequest('/v1/letters/' + encodeURIComponent(lobId), apiKey);
    if (lobRes.status !== 200 || !lobRes.body) throw new Error('Could not retrieve Lob letter ' + lobId);
    const letter = lobRes.body;
    artifactUrl = artifactType === 'return_receipt'
      ? (letter.return_receipt?.url || letter.return_receipt_url || null)
      : (letter.url || null);
  }
  if (!artifactUrl) return { archived: false, reason: 'artifact_not_ready' };

  const file = await download(artifactUrl);
  const sha256 = crypto.createHash('sha256').update(file.body).digest('hex');
  const storagePath = context.user_id + '/mail-artifacts/' + lobId + '/'
    + artifactType + '-' + sha256.slice(0, 16) + '.' + extension(file.contentType, artifactType);
  const upload = await new Promise((resolve, reject) => {
    const u = new URL(supabaseUrl + '/storage/v1/object/documents/' + objectPath(storagePath));
    const req = https.request({
      hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: 'Bearer ' + serviceKey,
        'Content-Type': file.contentType,
        'Content-Length': file.body.length,
        'x-upsert': 'true',
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', reject);
    req.write(file.body);
    req.end();
  });
  if (upload.status < 200 || upload.status >= 300) throw new Error('Could not store Lob artifact (HTTP ' + upload.status + ')');

  const artifact = {
    user_id: context.user_id,
    client_id: context.client_id || null,
    letter_id: context.id,
    lob_id: lobId,
    artifact_type: artifactType,
    storage_bucket: 'documents',
    storage_path: storagePath,
    content_type: file.contentType,
    byte_size: file.body.length,
    sha256,
    status: 'archived',
    captured_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const saved = await requestJson(
    supabaseUrl + '/rest/v1/mail_artifacts?on_conflict=lob_id,artifact_type',
    'POST', artifact,
    {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      Prefer: 'resolution=merge-duplicates,return=representation',
    }
  );
  if (saved.status < 200 || saved.status >= 300) throw new Error('Could not record Lob artifact (HTTP ' + saved.status + ')');

  return { archived: true, storagePath, sha256, byteSize: file.body.length };
}

module.exports = { archiveLobArtifact };
