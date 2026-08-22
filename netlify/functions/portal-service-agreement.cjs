const crypto = require('crypto');
const net = require('net');
const { PDFDocument, PngEmbedder, StandardFonts, rgb } = require('pdf-lib');
const { requireAuth } = require('./_requireAuth.cjs');
const { DOCUMENTS_BUCKET, serviceAgreementDocumentPath } = require('./_storagePaths.cjs');
const { resolvePortalIdentityWithRest } = require('./_portalIdentity.cjs');
const {
  AGREEMENT_TEMPLATE_VERSION,
  SERVICE_ONLY_PACKET_KIND,
  CANCELLATION_NOTICE_TITLE,
  CONSUMER_DISCLOSURE_TITLE,
  calculateCancellationWindow,
  escapeHtml,
  fillCancellationNoticeHtml,
  renderConsumerDisclosure,
  renderServiceAgreementOnlyPacket,
  sha256,
  templateLiveReadiness,
} = require('./_serviceAgreement.cjs');

const REQUIRED_ACKNOWLEDGEMENTS = Object.freeze([
  'service_agreement',
  'consumer_rights_disclosure',
  'cancellation_notices_received',
  'electronic_records',
]);
const IDENTITY_DOCUMENT_TYPES = Object.freeze({
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});
const MAX_IDENTITY_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_SIGNATURE_PIXELS = 2_000_000;
const MAX_SIGNATURE_DIMENSION = 4096;
const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
});
const json = (statusCode, body) => ({
  statusCode,
  headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function encodeStoragePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function pngCrc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = PNG_CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validatedPngEnvelope(bytes) {
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(magic)) return null;
  let offset = 8;
  let width = null;
  let height = null;
  let sawIdat = false;
  let sawIend = false;
  let chunkIndex = 0;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) return null;
    const length = bytes.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const crcOffset = dataStart + length;
    const chunkEnd = crcOffset + 4;
    if (chunkEnd > bytes.length) return null;
    const type = bytes.subarray(typeStart, dataStart).toString('ascii');
    if (!/^[A-Za-z]{4}$/.test(type)) return null;
    if (bytes.readUInt32BE(crcOffset) !== pngCrc32(bytes, typeStart, crcOffset)) return null;

    if (chunkIndex === 0) {
      if (type !== 'IHDR' || length !== 13) return null;
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      if (!width || !height
        || width > MAX_SIGNATURE_DIMENSION
        || height > MAX_SIGNATURE_DIMENSION
        || width * height > MAX_SIGNATURE_PIXELS) return null;
    } else if (type === 'IHDR') {
      return null;
    }
    if (type === 'IDAT') sawIdat = true;
    if (type === 'IEND') {
      if (length !== 0 || !sawIdat || chunkEnd !== bytes.length) return null;
      sawIend = true;
    }
    offset = chunkEnd;
    chunkIndex += 1;
  }
  return sawIend ? { width, height } : null;
}

async function signaturePngBytes(signatureData) {
  const value = String(signatureData || '');
  const match = value.match(/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || value.length > 1_100_000) return null;
  if (match[1].length % 4 !== 0) return null;
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length < 100 || bytes.length > 825_000) return null;
  if (bytes.toString('base64') !== match[1]) return null;
  const envelope = validatedPngEnvelope(bytes);
  if (!envelope) return null;
  try {
    const embedder = await PngEmbedder.for(bytes);
    if (embedder.width !== envelope.width || embedder.height !== envelope.height) return null;
    const rgbChannel = embedder.image?.rgbChannel;
    const alphaChannel = embedder.image?.alphaChannel;
    if (!rgbChannel || rgbChannel.length !== envelope.width * envelope.height * 3) return null;
    let visibleInkPixels = 0;
    for (let offset = 0; offset < rgbChannel.length && visibleInkPixels < 4; offset += 3) {
      const pixel = offset / 3;
      const alpha = alphaChannel ? alphaChannel[pixel] : 255;
      if (alpha > 16
        && (rgbChannel[offset] < 245 || rgbChannel[offset + 1] < 245 || rgbChannel[offset + 2] < 245)) {
        visibleInkPixels += 1;
      }
    }
    return visibleInkPixels >= 4 ? bytes : null;
  } catch {
    return null;
  }
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return null;
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (direct != null) return direct;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1] ?? null;
}

function firstValidIp(value) {
  const input = Array.isArray(value) ? value.join(',') : String(value || '');
  if (!input || input.length > 2048) return null;
  for (const candidate of input.split(',')) {
    const ip = candidate.trim();
    if (net.isIP(ip)) return ip;
  }
  return null;
}

function requestClientIp(event) {
  const headers = event?.headers || {};
  return firstValidIp(headerValue(headers, 'x-nf-client-connection-ip'))
    || firstValidIp(event?.requestContext?.http?.sourceIp)
    || firstValidIp(event?.requestContext?.identity?.sourceIp)
    || firstValidIp(headerValue(headers, 'x-forwarded-for'))
    || null;
}

function allAcknowledged(acknowledgements) {
  return REQUIRED_ACKNOWLEDGEMENTS.every((key) => acknowledgements?.[key] === true);
}

function canonicalIdentityDocument(row, { firmUserId, clientId, kind }) {
  const path = String(row?.storage_path || '');
  const contentType = String(row?.content_type || '');
  const extension = IDENTITY_DOCUMENT_TYPES[contentType];
  const digest = String(row?.sha256 || '');
  const byteSize = Number(row?.byte_size);
  const expectedPath = extension && /^[0-9a-f]{64}$/.test(digest)
    ? `${firmUserId}/${clientId}/identity/${kind}-${digest.slice(0, 16)}.${extension}`
    : '';
  return row?.user_id === firmUserId
    && row?.client_id === clientId
    && row?.doc_type === kind
    && path === expectedPath
    && Number.isInteger(byteSize)
    && byteSize >= 16
    && byteSize <= MAX_IDENTITY_DOCUMENT_BYTES;
}

function siblingAgreementPath(firmUserId, clientId, agreementId, fileName) {
  return `${firmUserId}/${clientId}/agreements/${agreementId}/${fileName}`;
}

function pdfSafeText(value) {
  return String(value || '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/•/g, '-');
}

function wrapPdfText(text, font, size, maxWidth) {
  const lines = [];
  for (const paragraph of pdfSafeText(text).split(/\n+/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    lines.push('');
  }
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

async function buildCancellationPdf({ clientName, signedAt, cancellationDateLabel, noticeHtml }) {
  const document = await PDFDocument.create();
  document.setTitle(`${CANCELLATION_NOTICE_TITLE} - ${clientName}`);
  document.setAuthor('Credit Comeback Club');
  document.setProducer('Credit Comeback Club portal');
  document.setCreator('Credit Comeback Club portal');
  document.setCreationDate(new Date(signedAt));
  document.setModificationDate(new Date(signedAt));
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const completedHtml = fillCancellationNoticeHtml(noticeHtml, cancellationDateLabel);
  const copyText = htmlToText(completedHtml);
  const contractDate = new Date(signedAt).toLocaleDateString('en-US', {
    timeZone: 'America/Phoenix', month: 'long', day: 'numeric', year: 'numeric',
  });

  for (let copyNumber = 1; copyNumber <= 2; copyNumber += 1) {
    const page = document.addPage([612, 792]);
    page.drawText(CANCELLATION_NOTICE_TITLE.toUpperCase(), {
      x: 48, y: 730, size: 17, font: bold, color: rgb(0.06, 0.09, 0.16),
    });
    page.drawText(`Client: ${pdfSafeText(clientName)}`, { x: 48, y: 700, size: 10, font: regular });
    page.drawText(`Contract date: ${contractDate}`, { x: 48, y: 683, size: 10, font: regular });
    let y = 650;
    for (const line of wrapPdfText(copyText, bold, 11, 516)) {
      if (!line) {
        y -= 10;
        continue;
      }
      page.drawText(line, { x: 48, y, size: 11, font: bold, maxWidth: 516 });
      y -= 17;
    }
    page.drawText(`Consumer copy ${copyNumber} of 2`, { x: 48, y: 52, size: 9, font: regular, color: rgb(0.35, 0.38, 0.43) });
    page.drawText('Credit Comeback Club | 970-644-0063 | creditcomebackclub.com', { x: 230, y: 52, size: 8, font: regular, color: rgb(0.35, 0.38, 0.43) });
  }
  return Buffer.from(await document.save({ useObjectStreams: false }));
}

async function defaultRest(path, method, body, url, key, prefer = 'return=representation') {
  const response = await fetch(url + path, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: prefer },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    const error = new Error(typeof data === 'object' && data?.message ? data.message : `Database request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function defaultUpload(path, bytes, contentType, url, key) {
  const response = await fetch(`${url}/storage/v1/object/${DOCUMENTS_BUCKET}/${encodeStoragePath(path)}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': contentType,
      'Content-Length': String(bytes.length),
      'x-upsert': 'false',
    },
    body: bytes,
  });
  if (response.ok) return { reused: false };

  // Signed packet objects are immutable (`x-upsert:false`). A storage write
  // can succeed while the later finalization transaction times out. On retry,
  // reuse the object only when its exact bytes match this server-rendered
  // signing claim; never overwrite or accept a same-path/different-document
  // collision.
  if ([400, 409].includes(response.status)) {
    const existing = await fetch(
      `${url}/storage/v1/object/authenticated/${DOCUMENTS_BUCKET}/${encodeStoragePath(path)}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (existing.ok) {
      const existingBytes = Buffer.from(await existing.arrayBuffer());
      const expectedBytes = Buffer.from(bytes);
      if (existingBytes.length === expectedBytes.length
        && crypto.timingSafeEqual(
          crypto.createHash('sha256').update(existingBytes).digest(),
          crypto.createHash('sha256').update(expectedBytes).digest(),
        )) return { reused: true };
    }
  }
  throw new Error(`Secure agreement upload failed (${response.status}).`);
}

async function defaultObjectExists(path, url, key) {
  const response = await fetch(`${url}/storage/v1/object/${DOCUMENTS_BUCKET}/${encodeStoragePath(path)}`, {
    method: 'HEAD', headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  return response.ok;
}

async function defaultObjectIntegrity(path, url, key) {
  const response = await fetch(`${url}/storage/v1/object/authenticated/${DOCUMENTS_BUCKET}/${encodeStoragePath(path)}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) return null;
  const claimedLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(claimedLength) && claimedLength > MAX_IDENTITY_DOCUMENT_BYTES) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 16 || bytes.length > MAX_IDENTITY_DOCUMENT_BYTES) return null;
  return {
    byteSize: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    contentType: String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(),
  };
}

async function loadPreparedContext(caller, deps, url, key) {
  const canonical = await resolvePortalIdentityWithRest(
    deps.rest, caller.userId, 'canonical', url, key,
  );
  const profiles = await deps.rest(
    '/rest/v1/client_profiles?user_id=eq.' + encodeURIComponent(caller.userId)
      + '&select=id,user_id,client_id,full_name,email,onboarding_complete,agreement_signed_at&limit=2',
    'GET', undefined, url, key
  );
  if (!Array.isArray(profiles) || profiles.length !== 1 || !profiles[0]?.client_id
    || profiles[0].id !== canonical.profileId || profiles[0].client_id !== canonical.clientId) {
    const error = new Error('Your portal profile is not linked to exactly one client record. Contact Credit Comeback Club.');
    error.status = 409;
    throw error;
  }
  const profile = profiles[0];
  if (profile.user_id !== caller.userId) {
    const error = new Error('The signed-in portal identity does not match this client profile.');
    error.status = 403;
    throw error;
  }

  const clients = await deps.rest(
    '/rest/v1/clients?id=eq.' + encodeURIComponent(profile.client_id) + '&select=id,user_id&limit=2',
    'GET', undefined, url, key
  );
  if (!Array.isArray(clients) || clients.length !== 1 || clients[0]?.id !== profile.client_id
    || clients[0].user_id !== canonical.firmUserId) {
    const error = new Error('The linked client record is unavailable. Contact Credit Comeback Club.');
    error.status = 409;
    throw error;
  }
  const client = clients[0];

  const signedRows = await deps.rest(
    '/rest/v1/client_service_agreements?client_id=eq.' + encodeURIComponent(client.id)
      + '&template_version=eq.' + encodeURIComponent(AGREEMENT_TEMPLATE_VERSION)
      + '&status=eq.signed&select=id,signed_at&order=signed_at.desc&limit=1',
    'GET', undefined, url, key
  );
  if (profile.onboarding_complete === true && Array.isArray(signedRows) && signedRows.length === 1) {
    await resolvePortalIdentityWithRest(deps.rest, caller.userId, 'active', url, key);
    return { completed: true, profile, client, signedAgreement: signedRows[0] };
  }

  // The unsigned wizard is available only for one exact, delivered,
  // unexpired, counsel-approved v3 packet. The server-owned RPC verifies the
  // Auth/profile/client/email/role/affiliate boundary again before any source
  // document or upload state is returned.
  await resolvePortalIdentityWithRest(deps.rest, caller.userId, 'pre_sign_v3', url, key);

  const agreements = await deps.rest(
    '/rest/v1/client_service_agreements?client_id=eq.' + encodeURIComponent(client.id)
      + '&template_version=eq.' + encodeURIComponent(AGREEMENT_TEMPLATE_VERSION)
      + '&status=eq.sent&select=id,user_id,client_id,template_id,template_version,status,plan_snapshot,client_snapshot,document_snapshot,signing_expires_at,sent_at&limit=2',
    'GET', undefined, url, key
  );
  if (!Array.isArray(agreements) || agreements.length !== 1) {
    const error = new Error('No single prepared Client Service Agreement is available for this portal. Ask Credit Comeback Club to start onboarding again.');
    error.status = 409;
    throw error;
  }
  const agreement = agreements[0];
  if (agreement.client_id !== client.id || agreement.user_id !== client.user_id) {
    const error = new Error('The prepared agreement does not belong to this client portal.');
    error.status = 403;
    throw error;
  }
  if (agreement.signing_expires_at && new Date(agreement.signing_expires_at).getTime() <= Date.now()) {
    const error = new Error('The prepared Client Service Agreement has expired. Ask Credit Comeback Club to start onboarding again.');
    error.status = 410;
    throw error;
  }

  const templates = await deps.rest(
    '/rest/v1/service_agreement_templates?id=eq.' + encodeURIComponent(agreement.template_id)
      + '&version=eq.' + encodeURIComponent(AGREEMENT_TEMPLATE_VERSION)
      + '&select=id,version,title,legal_status,packet_kind,body_html,consumer_disclosure_html,cancellation_notice_html,cancellation_calendar_kind&limit=2',
    'GET', undefined, url, key
  );
  if (!Array.isArray(templates) || templates.length !== 1) {
    const error = new Error('The prepared agreement template is unavailable.');
    error.status = 409;
    throw error;
  }
  const template = templates[0];
  const readiness = templateLiveReadiness(template);
  if (!readiness.ready || template.version !== AGREEMENT_TEMPLATE_VERSION || template.packet_kind !== SERVICE_ONLY_PACKET_KIND) {
    const error = new Error('The prepared Client Service Agreement is awaiting final approval and cannot be signed.');
    error.status = 409;
    error.blockers = readiness.blockers;
    throw error;
  }
  const snapshot = agreement.document_snapshot || {};
  const exactSnapshot = snapshot.templateVersion === template.version
    && snapshot.packetKind === template.packet_kind
    && snapshot.agreementBodyHtml === template.body_html
    && snapshot.consumerDisclosureHtml === template.consumer_disclosure_html
    && snapshot.cancellationNoticeHtml === template.cancellation_notice_html
    && snapshot.cancellationCalendarKind === template.cancellation_calendar_kind;
  const hashes = {
    agreementBodyHash: sha256(String(snapshot.agreementBodyHtml || '')),
    consumerDisclosureHash: sha256(String(snapshot.consumerDisclosureHtml || '')),
    cancellationNoticeHash: sha256(String(snapshot.cancellationNoticeHtml || '')),
  };
  if (!exactSnapshot
      || snapshot.agreementBodyHash !== hashes.agreementBodyHash
      || snapshot.consumerDisclosureHash !== hashes.consumerDisclosureHash
      || snapshot.cancellationNoticeHash !== hashes.cancellationNoticeHash) {
    const error = new Error('The prepared agreement snapshot no longer matches the approved version. Ask Credit Comeback Club to prepare it again.');
    error.status = 409;
    throw error;
  }
  return { completed: false, profile, client, agreement, template, snapshot, hashes };
}

async function requiredDocuments(context, deps, url, key) {
  const rows = await deps.rest(
    '/rest/v1/documents?user_id=eq.' + encodeURIComponent(context.client.user_id)
      + '&client_id=eq.' + encodeURIComponent(context.client.id)
      + '&doc_type=in.(id,address)&select=id,user_id,client_id,doc_type,storage_path,content_type,byte_size,sha256,uploaded_at',
    'GET', undefined, url, key
  );
  const selected = {};
  for (const kind of ['id', 'address']) {
    const matches = (rows || []).filter((row) => canonicalIdentityDocument(row, {
      firmUserId: context.client.user_id, clientId: context.client.id, kind,
    }));
    const integrity = matches.length === 1
      ? await deps.objectIntegrity(matches[0].storage_path, url, key)
      : null;
    if (matches.length !== 1
      || !integrity
      || integrity.sha256 !== matches[0].sha256
      || integrity.byteSize !== Number(matches[0].byte_size)
      || integrity.contentType !== matches[0].content_type) {
      const error = new Error(kind === 'id'
        ? 'A government ID must be uploaded before the agreement can be signed.'
        : 'Proof of address must be uploaded before the agreement can be signed.');
      error.status = 409;
      throw error;
    }
    selected[kind] = matches[0];
  }
  return selected;
}

function createPortalServiceAgreementHandler(overrides = {}) {
  const deps = {
    requireAuth,
    rest: defaultRest,
    upload: defaultUpload,
    objectExists: defaultObjectExists,
    objectIntegrity: defaultObjectIntegrity,
    now: () => new Date().toISOString(),
    buildCancellationPdf,
    ...overrides,
  };

  return async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
    let caller;
    try { caller = await deps.requireAuth(event); }
    catch (error) { return error?.statusCode ? { ...error, headers: { ...CORS_HEADERS, ...(error.headers || {}) } } : json(500, { error: error.message || 'Authorization failed.' }); }
    if (caller.isSystem) return json(403, { error: 'A verified client session is required.' });

    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return json(500, { error: 'Server not configured' });
    let payload;
    try { payload = JSON.parse(event.body || '{}'); }
    catch { return json(400, { error: 'Invalid JSON' }); }
    const action = String(payload.action || 'load');
    if (!['load', 'sign'].includes(action)) return json(400, { error: 'Unknown agreement action.' });

    try {
      const context = await loadPreparedContext(caller, deps, url, key);
      if (context.completed) return json(200, { completed: true, signedAt: context.signedAgreement.signed_at });

      if (action === 'load') {
        return json(200, {
          completed: false,
          agreement: {
            id: context.agreement.id,
            clientName: context.agreement.client_snapshot?.name,
            title: context.template.title,
            templateVersion: context.agreement.template_version,
            plan: context.agreement.plan_snapshot,
            serviceAgreementHtml: context.snapshot.agreementBodyHtml,
            consumerDisclosureTitle: CONSUMER_DISCLOSURE_TITLE,
            consumerDisclosureHtml: context.snapshot.consumerDisclosureHtml,
            cancellationNoticeHtml: context.snapshot.cancellationNoticeHtml,
            hashes: context.hashes,
            acknowledgementRequired: REQUIRED_ACKNOWLEDGEMENTS,
            signingAllowed: true,
          },
        });
      }

      if (payload.agreementId !== context.agreement.id || payload.templateVersion !== context.agreement.template_version) {
        return json(403, { error: 'The requested agreement does not match this client portal.' });
      }
      if (payload.hashes?.agreementBodyHash !== context.hashes.agreementBodyHash
        || payload.hashes?.consumerDisclosureHash !== context.hashes.consumerDisclosureHash
        || payload.hashes?.cancellationNoticeHash !== context.hashes.cancellationNoticeHash) {
        return json(409, { error: 'The prepared agreement changed after it was reviewed. Reload it before signing.' });
      }
      if (!allAcknowledged(payload.acknowledgements)) {
        return json(400, { error: 'The agreement, separate disclosure, cancellation notices, and electronic-records acknowledgements are all required.' });
      }
      const signatureBytes = await signaturePngBytes(payload.signatureData);
      if (!signatureBytes) return json(400, { error: 'A valid drawn PNG signature is required.' });
      const docs = await requiredDocuments(context, deps, url, key);

      const signatureSha256 = crypto.createHash('sha256').update(signatureBytes).digest('hex');
      const claimedSigningTime = await deps.rest('/rest/v1/rpc/ccc_claim_portal_service_agreement_signing', 'POST', {
        p_portal_user_id: caller.userId,
        p_profile_id: context.profile.id,
        p_client_id: context.client.id,
        p_agreement_id: context.agreement.id,
        p_signature_sha256: signatureSha256,
      }, url, key);
      const signedAt = Array.isArray(claimedSigningTime) ? claimedSigningTime[0] : claimedSigningTime;
      if (!signedAt || !Number.isFinite(new Date(signedAt).getTime())) {
        throw new Error('The secure signing time could not be claimed. Reload and try again.');
      }
      const cancellation = calculateCancellationWindow(signedAt, context.snapshot.cancellationCalendarKind);
      const signatureHtml = `<img src="${escapeHtml(payload.signatureData)}" style="max-height:56px;max-width:220px" alt="Client signature">`;
      const renderClient = {
        ...context.agreement.client_snapshot,
        signerName: context.agreement.client_snapshot?.name,
      };
      const packetHtml = renderServiceAgreementOnlyPacket({
        client: renderClient,
        plan: context.agreement.plan_snapshot,
        signedAt,
        clientSignatureHtml: signatureHtml,
        approved: true,
        approvedTermsHtml: context.snapshot.agreementBodyHtml,
      });
      const disclosureHtml = renderConsumerDisclosure({
        client: renderClient,
        signedAt,
        clientSignatureHtml: signatureHtml,
        disclosureHtml: context.snapshot.consumerDisclosureHtml,
      });
      const cancellationPdf = await deps.buildCancellationPdf({
        clientName: context.agreement.client_snapshot?.name,
        signedAt,
        cancellationDateLabel: cancellation.cancellationDateLabel,
        noticeHtml: context.snapshot.cancellationNoticeHtml,
      });
      const packetBytes = Buffer.from(packetHtml, 'utf8');
      const disclosureBytes = Buffer.from(disclosureHtml, 'utf8');
      const signedDocumentPath = serviceAgreementDocumentPath(context.client.user_id, context.client.id, context.agreement.id, 'html');
      const signedDisclosurePath = siblingAgreementPath(context.client.user_id, context.client.id, context.agreement.id, 'consumer-rights-disclosure.html');
      const signedCancellationPath = siblingAgreementPath(context.client.user_id, context.client.id, context.agreement.id, 'notice-of-cancellation-two-copies.pdf');
      const signedDocumentHash = crypto.createHash('sha256').update(packetBytes).digest('hex');
      const signedDisclosureHash = crypto.createHash('sha256').update(disclosureBytes).digest('hex');
      const signedCancellationHash = crypto.createHash('sha256').update(cancellationPdf).digest('hex');

      await deps.upload(signedDocumentPath, packetBytes, 'text/html', url, key);
      await deps.upload(signedDisclosurePath, disclosureBytes, 'text/html', url, key);
      await deps.upload(signedCancellationPath, cancellationPdf, 'application/pdf', url, key);
      for (const path of [signedDocumentPath, signedDisclosurePath, signedCancellationPath]) {
        if (!(await deps.objectExists(path, url, key))) throw new Error('A signed enrollment document could not be verified in secure storage.');
      }

      const acknowledgements = REQUIRED_ACKNOWLEDGEMENTS.reduce((out, keyName) => ({ ...out, [keyName]: true }), {});
      const eventData = {
        packetKind: SERVICE_ONLY_PACKET_KIND,
        acknowledgements,
        identityDocuments: {
          governmentId: {
            id: docs.id.id,
            path: docs.id.storage_path,
            contentType: docs.id.content_type,
            byteSize: Number(docs.id.byte_size),
            sha256: docs.id.sha256,
          },
          proofOfAddress: {
            id: docs.address.id,
            path: docs.address.storage_path,
            contentType: docs.address.content_type,
            byteSize: Number(docs.address.byte_size),
            sha256: docs.address.sha256,
          },
        },
        sourceHashes: context.hashes,
        cancellation,
        signedDocumentHash,
        signedDisclosureHash,
        signedCancellationHash,
        signatureSha256,
        cancellationCopiesDelivered: 2,
        paymentCollected: false,
      };
      const ip = requestClientIp(event);
      const userAgent = event.headers?.['user-agent'] || null;
      const finalized = await deps.rest('/rest/v1/rpc/ccc_finalize_portal_service_agreement', 'POST', {
        p_portal_user_id: caller.userId,
        p_profile_id: context.profile.id,
        p_client_id: context.client.id,
        p_agreement_id: context.agreement.id,
        p_template_id: context.agreement.template_id,
        p_template_version: context.agreement.template_version,
        p_plan_snapshot: context.agreement.plan_snapshot,
        p_client_snapshot: context.agreement.client_snapshot,
        p_document_snapshot: context.agreement.document_snapshot,
        p_signed_at: signedAt,
        p_cancellation_deadline: cancellation.cancellationDeadline,
        p_signed_document_path: signedDocumentPath,
        p_signed_document_hash: signedDocumentHash,
        p_signed_disclosure_path: signedDisclosurePath,
        p_signed_disclosure_hash: signedDisclosureHash,
        p_signed_cancellation_path: signedCancellationPath,
        p_signed_cancellation_hash: signedCancellationHash,
        p_event_data: eventData,
        p_ip_address: ip,
        p_user_agent: userAgent,
      }, url, key);
      if (finalized !== context.agreement.id && finalized?.[0] !== context.agreement.id) {
        throw new Error('The signed documents were stored but enrollment finalization was not confirmed. Contact Credit Comeback Club.');
      }
      return json(200, {
        signed: true,
        completed: true,
        agreementId: context.agreement.id,
        templateVersion: context.agreement.template_version,
        signedAt,
        cancellationDeadline: cancellation.cancellationDeadline,
        serviceEligibleAt: cancellation.serviceEligibleAt,
        paymentCollected: false,
        documents: {
          agreement: {
            fileName: 'CCC-Client-Service-Agreement.html',
            contentType: 'text/html',
            dataBase64: packetBytes.toString('base64'),
          },
          disclosure: {
            fileName: 'Consumer-Credit-File-Rights.html',
            contentType: 'text/html',
            dataBase64: disclosureBytes.toString('base64'),
          },
          cancellation: {
            fileName: 'Notice-of-Cancellation-Two-Copies.pdf',
            contentType: 'application/pdf',
            dataBase64: cancellationPdf.toString('base64'),
          },
        },
      });
    } catch (error) {
      console.error('portal-service-agreement:', error.message);
      return json(error.status || 500, { error: error.message || 'Could not complete the Client Service Agreement.', ...(error.blockers ? { blockers: error.blockers } : {}) });
    }
  };
}

exports.handler = createPortalServiceAgreementHandler();
exports._test = {
  REQUIRED_ACKNOWLEDGEMENTS,
  allAcknowledged,
  buildCancellationPdf,
  canonicalIdentityDocument,
  createPortalServiceAgreementHandler,
  defaultObjectIntegrity,
  htmlToText,
  requestClientIp,
  signaturePngBytes,
  siblingAgreementPath,
};
