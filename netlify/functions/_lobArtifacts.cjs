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

function download(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== 'https:') return reject(new Error('Lob artifact URL must use HTTPS'));
    const req = https.get({ hostname: u.hostname, port: 443, path: u.pathname + u.search, headers }, (res) => {
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

const ACTIVE_SUBMISSION_STATUSES = new Set(['pending', 'submitted', 'accepted_unreconciled']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function serviceAuth(serviceKey) {
  return { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey };
}

async function mailAttemptContext({ lobId, letterId, submissionId, idempotencyKey, supabaseUrl, serviceKey }) {
  if (!!submissionId !== !!idempotencyKey) throw new Error('Both submission ID and attempt key are required together');
  if (submissionId && !UUID_RE.test(String(submissionId))) throw new Error('Invalid mail submission identity');
  if (idempotencyKey && (String(idempotencyKey).trim().length < 1 || String(idempotencyKey).length > 200)) {
    throw new Error('Invalid mail attempt key');
  }
  const submissionQuery = submissionId
    ? '/rest/v1/mail_submissions?id=eq.' + encodeURIComponent(submissionId)
      + '&idempotency_key=eq.' + encodeURIComponent(idempotencyKey)
      + '&lob_id=eq.' + encodeURIComponent(lobId)
      + '&select=id,letter_id,user_id,client_id,idempotency_key,status,lob_id&limit=2'
    : '/rest/v1/mail_submissions?lob_id=eq.' + encodeURIComponent(lobId)
      + '&select=id,letter_id,user_id,client_id,idempotency_key,status,lob_id&limit=2';
  const submissionRes = await requestJson(supabaseUrl + submissionQuery, 'GET', null, serviceAuth(serviceKey));
  if (submissionRes.status < 200 || submissionRes.status >= 300) throw new Error('Could not resolve the Lob mail attempt');
  const submissions = Array.isArray(submissionRes.body) ? submissionRes.body : [];
  if (submissions.length !== 1) {
    throw new Error(submissions.length > 1 ? 'The Lob mail attempt is ambiguous' : 'The Lob mail attempt is not current');
  }
  const submission = submissions[0];
  if (String(submission.lob_id || '') !== String(lobId)) throw new Error('Lob ID does not match the durable mail attempt');
  if (!ACTIVE_SUBMISSION_STATUSES.has(submission.status)) throw new Error('The Lob mail attempt is no longer eligible for evidence archival');
  if (letterId && String(letterId) !== String(submission.letter_id)) throw new Error('Letter ID does not match the durable mail attempt');

  const letterRes = await requestJson(
    supabaseUrl + '/rest/v1/letters?id=eq.' + encodeURIComponent(submission.letter_id)
      + '&select=id,user_id,client_id,lob_id,mail_service,tracking_status&limit=2',
    'GET', null, serviceAuth(serviceKey)
  );
  if (letterRes.status < 200 || letterRes.status >= 300) throw new Error('Could not resolve the Lob artifact letter');
  const letters = Array.isArray(letterRes.body) ? letterRes.body : [];
  if (letters.length !== 1) throw new Error(letters.length > 1 ? 'The Lob artifact letter is ambiguous' : 'The Lob artifact letter was not found');
  const letter = letters[0];
  if (String(letter.user_id || '') !== String(submission.user_id || '')
      || String(letter.client_id || '') !== String(submission.client_id || '')) {
    throw new Error('The Lob letter and mail attempt ownership do not match');
  }
  if (letter.lob_id && String(letter.lob_id) !== String(lobId)) {
    throw new Error('The Lob artifact belongs to an older letter attempt');
  }
  return { letter, submission };
}

async function uploadImmutableArtifact({ supabaseUrl, serviceKey, storagePath, bytes, contentType, sha256 }) {
  const upload = await new Promise((resolve, reject) => {
    const u = new URL(supabaseUrl + '/storage/v1/object/documents/' + objectPath(storagePath));
    const req = https.request({
      hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'POST',
      headers: {
        ...serviceAuth(serviceKey),
        'Content-Type': contentType,
        'Content-Length': bytes.length,
        'x-upsert': 'false',
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', reject);
    req.write(bytes);
    req.end();
  });
  if (upload.status >= 200 && upload.status < 300) return;
  const alreadyExists = upload.status === 409 || (upload.status === 400 && /already exists|duplicate/i.test(upload.body));
  if (!alreadyExists) throw new Error('Could not store Lob artifact (HTTP ' + upload.status + ')');

  const existing = await download(
    supabaseUrl + '/storage/v1/object/documents/' + objectPath(storagePath),
    serviceAuth(serviceKey)
  );
  const existingHash = crypto.createHash('sha256').update(existing.body).digest('hex');
  if (existing.body.length !== bytes.length || existingHash !== sha256) {
    throw new Error('Stored Lob evidence does not match the exact current mail attempt');
  }
}

async function findAttemptArtifact({ context, lobId, artifactType, supabaseUrl, serviceKey }) {
  const res = await requestJson(
    supabaseUrl + '/rest/v1/mail_artifacts?mail_submission_id=eq.' + encodeURIComponent(context.submission.id)
      + '&idempotency_key=eq.' + encodeURIComponent(context.submission.idempotency_key)
      + '&lob_id=eq.' + encodeURIComponent(lobId)
      + '&artifact_type=eq.' + encodeURIComponent(artifactType)
      + '&select=id,status,storage_path,sha256,mail_submission_id,idempotency_key,lob_id&limit=2',
    'GET', null, serviceAuth(serviceKey)
  );
  if (res.status < 200 || res.status >= 300) throw new Error('Could not check existing Lob evidence');
  const rows = Array.isArray(res.body) ? res.body : [];
  if (rows.length > 1) throw new Error('The Lob artifact attempt has duplicate evidence rows');
  return rows[0] || null;
}

async function archiveLobArtifact({
  lobId,
  letterId,
  submissionId,
  idempotencyKey,
  artifactType,
  sourceUrl,
  apiKey,
  supabaseUrl,
  serviceKey,
}) {
  if (!lobId || !['mailpiece_pdf', 'return_receipt'].includes(artifactType) || !apiKey || !supabaseUrl || !serviceKey) {
    throw new Error('Incomplete Lob artifact archive configuration');
  }

  const context = await mailAttemptContext({
    lobId, letterId, submissionId, idempotencyKey, supabaseUrl, serviceKey,
  });
  const existing = await findAttemptArtifact({ context, lobId, artifactType, supabaseUrl, serviceKey });
  if (existing?.status === 'archived') {
    return { archived: true, reused: true, storagePath: existing.storage_path, submissionId: context.submission.id };
  }

  let artifactUrl = sourceUrl;
  if (!artifactUrl) {
    const lobRes = await lobRequest('/v1/letters/' + encodeURIComponent(lobId), apiKey);
    if (lobRes.status !== 200 || !lobRes.body) throw new Error('Could not retrieve Lob letter ' + lobId);
    const providerLetter = lobRes.body;
    artifactUrl = artifactType === 'return_receipt'
      ? (providerLetter.return_receipt?.url || providerLetter.return_receipt_url || null)
      : (providerLetter.url || null);
  }
  if (!artifactUrl) return { archived: false, reason: 'artifact_not_ready' };

  const file = await download(artifactUrl);
  const sha256 = crypto.createHash('sha256').update(file.body).digest('hex');
  const attemptPath = crypto.createHash('sha256').update(context.submission.idempotency_key).digest('hex').slice(0, 24);
  const lobPath = crypto.createHash('sha256').update(String(lobId)).digest('hex').slice(0, 16);
  const storagePath = context.letter.user_id + '/mail-artifacts/' + context.submission.id + '/'
    + attemptPath + '/' + lobPath + '/' + artifactType + '-' + sha256 + '.' + extension(file.contentType, artifactType);
  await uploadImmutableArtifact({
    supabaseUrl, serviceKey, storagePath, bytes: file.body, contentType: file.contentType, sha256,
  });

  const artifact = {
    user_id: context.letter.user_id,
    client_id: context.letter.client_id || null,
    letter_id: context.letter.id,
    mail_submission_id: context.submission.id,
    idempotency_key: context.submission.idempotency_key,
    legacy_unbound: false,
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
      ...serviceAuth(serviceKey),
      Prefer: 'resolution=ignore-duplicates,return=representation',
    }
  );
  if (saved.status < 200 || saved.status >= 300) throw new Error('Could not record Lob artifact (HTTP ' + saved.status + ')');
  const savedRows = Array.isArray(saved.body) ? saved.body : [];
  if (savedRows.length > 1) throw new Error('The Lob artifact insert returned ambiguous evidence');
  if (savedRows.length === 0) {
    const raced = await findAttemptArtifact({ context, lobId, artifactType, supabaseUrl, serviceKey });
    if (!raced || raced.status !== 'archived' || raced.storage_path !== storagePath || raced.sha256 !== sha256) {
      throw new Error('The Lob artifact changed during immutable evidence capture');
    }
  }

  return {
    archived: true,
    storagePath,
    sha256,
    byteSize: file.body.length,
    submissionId: context.submission.id,
    idempotencyKey: context.submission.idempotency_key,
  };
}

module.exports = { archiveLobArtifact, _test: { mailAttemptContext, uploadImmutableArtifact } };
