const https = require('https');
const crypto = require('crypto');
const { PDFDocument } = require('pdf-lib');
const { archiveLobArtifact } = require('./_lobArtifacts.cjs');
const { responseEvidencePrefixes } = require('./_storagePaths.cjs');
const { queueCampaignCleanupMailed, queueRoundEvent } = require('./_roundEmail.cjs');
const {
  MAX_MAILPIECE_HTML_BYTES,
  mailedConsumerStatementEvidence,
} = require('../../src/utils/mailedConsumerStatement.cjs');

function lobRequest(path, method, body, apiKey, extraHeaders) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(apiKey + ':').toString('base64');
    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.lob.com',
      port: 443,
      path,
      method,
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...(extraHeaders || {}),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Server-owned writes for an irreversible mail submission.  The browser must
// never be the durable source of truth for a Lob idempotency key: a timeout,
// reload, or second tab otherwise generates a new key and can mail twice.
function supabaseRequest(path, method, body, supabaseUrl, serviceKey, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const u = new URL(supabaseUrl + path);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method,
      headers: {
        apikey: serviceKey,
        Authorization: 'Bearer ' + serviceKey,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        Prefer: 'return=representation',
        ...extraHeaders,
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

// Lob renders the mailpiece HTML on its own schedule and fetches every remote
// asset at that moment. The browser assembles that HTML, so the browser cannot
// be the only thing that checks it — re-read what was actually uploaded.
// Unquoted `src=https://…` renders the same as the quoted form, so the
// allowlist has to see it too.
const MAIL_ASSET_URL_RE = /(?:\bsrc\s*=\s*["']?|url\(\s*["']?)(https?:\/\/[^"')\s>]+)/gi;
const CCC_SCREENSHOT_MARKER_RE = /\bdata-ccc-screenshot-id\s*=\s*["']([^"']+)["']/gi;

const CCC_RETURN_ADDRESS = Object.freeze({
  name: 'Credit Comeback Club',
  line1: '3088 Colorado Ave',
  line2: '',
  city: 'Grand Junction',
  state: 'CO',
  zip: '81504',
});
const CURRENT_CCC_MAIL_SERVICE = 'usps_first_class';
const MAX_CCC_EXHIBIT_BYTES = 8 * 1024 * 1024;

const MAILPIECE_PREFLIGHT_TIMEOUT_MS = 15000;

/**
 * The mailpiece URL arrives in the request body, and this function both fetches
 * it and hands it to Lob to print. Neither may point anywhere but the signed
 * document we just uploaded: otherwise it is a server-side request primitive,
 * and a way to have Lob print arbitrary content on firm letterhead.
 */
function durableMailpieceUrl(remoteUrl, supabaseUrl) {
  const expectedPrefix = String(supabaseUrl).replace(/\/+$/, '') + '/storage/v1/object/sign/documents/';
  let parsed;
  let expected;
  try {
    parsed = new URL(String(remoteUrl));
    expected = new URL(expectedPrefix);
  } catch (e) {
    throw new Error('The rendered letter URL is not a valid URL.');
  }
  if (parsed.protocol !== 'https:' || parsed.origin !== expected.origin || !String(remoteUrl).startsWith(expectedPrefix)) {
    throw new Error('The rendered letter URL must be a signed document URL from this project storage.');
  }
  return String(remoteUrl);
}

function normalizedAddressKey(address) {
  return [address?.name, address?.line1, address?.line2 || '', address?.city, address?.state, address?.zip]
    .map((value) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ''))
    .join('|');
}

function signedStorageObjectIdentity(value, supabaseUrl) {
  let parsed;
  let project;
  try {
    parsed = new URL(String(value));
    project = new URL(String(supabaseUrl));
  } catch {
    throw new Error('A CCC packet asset does not use a valid signed storage URL.');
  }
  const prefix = '/storage/v1/object/sign/';
  if (parsed.protocol !== 'https:' || parsed.origin !== project.origin || !parsed.pathname.startsWith(prefix)) {
    throw new Error('A CCC packet asset is outside this project’s signed private storage.');
  }
  let segments;
  try {
    segments = parsed.pathname.slice(prefix.length).split('/').map((segment) => decodeURIComponent(segment));
  } catch {
    throw new Error('A CCC packet asset has an invalid encoded storage path.');
  }
  const bucket = segments.shift() || '';
  const path = segments.join('/');
  if (!bucket || !path || /(?:^|\/)\.\.(?:\/|$)|\\|[\u0000-\u001f]/.test(path)) {
    throw new Error('A CCC packet asset has an invalid private storage path.');
  }
  return { bucket, path };
}

async function readBoundAsset(url, maxBytes, errorLabel, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${errorLabel} cannot be read (${response.status}).`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`${errorLabel} exceeds the verified size limit.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > maxBytes) throw new Error(`${errorLabel} exceeds the verified size limit.`);
  return { bytes, contentType: String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() };
}

async function readPrivateStorageAsset(bucket, path, supabaseUrl, serviceKey, maxBytes, errorLabel) {
  const objectPath = String(path).split('/').map(encodeURIComponent).join('/');
  return readBoundAsset(
    `${supabaseUrl}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${objectPath}`,
    maxBytes,
    errorLabel,
    { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  );
}

function detectedImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function scanRemoteAssetUrls(fileUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(fileUrl);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'GET',
      timeout: MAILPIECE_PREFLIGHT_TIMEOUT_MS,
    }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error('Could not re-read the uploaded mailpiece for preflight (' + res.statusCode + ')'));
        return;
      }
      const declaredBytes = Number(res.headers['content-length'] || 0);
      if (Number.isFinite(declaredBytes) && declaredBytes > MAX_MAILPIECE_HTML_BYTES) {
        res.resume();
        reject(new Error('The uploaded mailpiece is too large for safe server preflight.'));
        return;
      }
      const chunks = [];
      let receivedBytes = 0;
      let rejected = false;
      res.on('data', (chunk) => {
        if (rejected) return;
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_MAILPIECE_HTML_BYTES) {
          rejected = true;
          reject(new Error('The uploaded mailpiece is too large for safe server preflight.'));
          req.destroy();
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (rejected) return;
        const html = Buffer.concat(chunks, receivedBytes).toString('utf8');
        const found = new Set();
        const screenshotIds = [];
        MAIL_ASSET_URL_RE.lastIndex = 0;
        let match;
        while ((match = MAIL_ASSET_URL_RE.exec(html)) !== null) found.add(match[1]);
        CCC_SCREENSHOT_MARKER_RE.lastIndex = 0;
        while ((match = CCC_SCREENSHOT_MARKER_RE.exec(html)) !== null) screenshotIds.push(match[1]);
        resolve({ html, urls: Array.from(found), screenshotIds });
      });
      res.on('error', reject);
    });
    // Without this a stalled endpoint holds an irreversible mail send open
    // until Netlify kills the whole invocation.
    req.on('timeout', () => {
      req.destroy(new Error('Timed out re-reading the uploaded mailpiece for preflight'));
    });
    req.on('error', reject);
    req.end();
  });
}

function isSuccess(res) {
  return res && res.status >= 200 && res.status < 300;
}

function requestError(res, fallback) {
  if (!res) return fallback;
  if (typeof res.body === 'object' && res.body?.message) return res.body.message;
  if (typeof res.body === 'string' && res.body) return res.body;
  return fallback;
}

async function findLetter(letterId, supabaseUrl, serviceKey) {
  const result = await supabaseRequest(
    '/rest/v1/letters?id=eq.' + encodeURIComponent(letterId)
      + '&select=id,user_id,client_id,client_account_id,client_name,furnisher,phase,round_id,round_number,letter_kind,target_type,target_bureau,html,covered_furnishers,lob_id,mailed_date,tracking_number,tracking_status,mail_service,expected_delivery_date,enclosure_parse_blocked,enclosure_parse_issues,source_phase3_letter_id,source_bureau_response_evidence_id,campaign_id,campaign_route_id,packet_version,dispute_basis,dispute_template_id,dispute_flow_code,dispute_round_number,dispute_bureau_code,dispute_template_snapshot,dispute_account_snapshot,ccc_account_track_snapshots,ccc_letter_identity_snapshot,dispute_automatic_values_snapshot,dispute_screenshot_policy_snapshot,dispute_screenshot_manifest',
    'GET', null, supabaseUrl, serviceKey
  );
  if (!isSuccess(result)) throw new Error(requestError(result, 'Could not load letter before mailing'));
  return Array.isArray(result.body) ? result.body[0] : null;
}

async function validateCccTrackSnapshotPreflight(letter, toAddress, supabaseUrl, serviceKey) {
  if (!String(letter?.phase || '').startsWith('CCC Dispute —')) return [];
  const {
    cccFurnisherKey,
    normalizeCccAccountTrackSnapshots,
    validateCccLetterTrackBinding,
  } = await import('../../src/utils/cccLetterTrackSnapshots.js');

  let snapshots;
  try {
    snapshots = normalizeCccAccountTrackSnapshots(letter.ccc_account_track_snapshots);
  } catch (error) {
    return [error.message];
  }

  const trackIds = snapshots.map((snapshot) => snapshot.trackId);
  const tracksResult = await supabaseRequest(
    '/rest/v1/ccc_account_tracks?id=in.(' + trackIds.map(encodeURIComponent).join(',') + ')'
      + '&select=id,user_id,client_id,client_account_id,track_scope,bureau_code,method_version,account_kind,native_flow,current_flow,current_round,path_role,status,cycle,revision',
    'GET', null, supabaseUrl, serviceKey
  );
  if (!isSuccess(tracksResult)) throw new Error(requestError(tracksResult, 'Could not reload the bound CCC account tracks'));

  if (!letter.dispute_template_id) return ['A CCC letter requires its exact library template before mailing.'];
  const templateResult = await supabaseRequest(
    '/rest/v1/dispute_templates?id=eq.' + encodeURIComponent(letter.dispute_template_id)
      + '&select=id,flow_code,round_number,bureau_code',
    'GET', null, supabaseUrl, serviceKey
  );
  if (!isSuccess(templateResult)) throw new Error(requestError(templateResult, 'Could not reload the bound CCC template'));
  const template = Array.isArray(templateResult.body) ? templateResult.body[0] : null;

  let verifiedDirectRecipient = null;
  if (snapshots[0]?.trackScope === 'direct') {
    const furnisherKey = cccFurnisherKey(letter.furnisher);
    if (furnisherKey) {
      const recipientResult = await supabaseRequest(
        '/rest/v1/furnisher_addresses?user_id=eq.' + encodeURIComponent(letter.user_id)
          + '&furnisher_key=eq.' + encodeURIComponent(furnisherKey)
          + '&select=user_id,furnisher_key,display_name,address_line1,address_line2,city,state,zip',
        'GET', null, supabaseUrl, serviceKey
      );
      if (!isSuccess(recipientResult)) throw new Error(requestError(recipientResult, 'Could not reload the verified Direct recipient'));
      verifiedDirectRecipient = Array.isArray(recipientResult.body) ? recipientResult.body[0] : null;
    }
  }

  return validateCccLetterTrackBinding({
    letter,
    tracks: Array.isArray(tracksResult.body) ? tracksResult.body : [],
    template,
    toAddress,
    verifiedDirectRecipient,
  });
}

function normalizedRecipient(value) {
  if (!value) return '';
  if (typeof value === 'object') return Object.values(value).map(normalizedRecipient).join('');
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function validatePacketPreflight(letter, toAddress, supabaseUrl, serviceKey) {
  const coverageResult = await supabaseRequest(
    '/rest/v1/letter_account_coverage?letter_id=eq.' + encodeURIComponent(letter.id)
      + '&select=id,user_id,client_id,campaign_id,campaign_route_id,campaign_item_id,client_account_id,dispute_round_id,coverage_order,frozen_findings,expected_recipient',
    'GET', null, supabaseUrl, serviceKey
  );
  const coverage = Array.isArray(coverageResult.body) ? coverageResult.body : [];
  if (!isSuccess(coverageResult) || coverage.length < 1 || coverage.length > 5) {
    throw new Error('The consolidated packet must have one to five verified account coverage records.');
  }
  const routeResult = await supabaseRequest(
    '/rest/v1/campaign_letter_routes?id=eq.' + encodeURIComponent(letter.campaign_route_id)
      + '&select=id,user_id,client_id,campaign_id,item_id,item_ids,target_type,target_bureau,dispute_basis,recipient_key',
    'GET', null, supabaseUrl, serviceKey
  );
  const route = Array.isArray(routeResult.body) ? routeResult.body[0] : null;
  const coveredItems = coverage.map((entry) => entry.campaign_item_id);
  const routeItems = route?.item_ids?.length ? route.item_ids : [route?.item_id];
  if (!isSuccess(routeResult) || !route || route.user_id !== letter.user_id || route.client_id !== letter.client_id
      || route.campaign_id !== letter.campaign_id || route.target_type !== letter.target_type
      || route.target_bureau !== letter.target_bureau || route.dispute_basis !== letter.dispute_basis
      || routeItems.length !== coveredItems.length || coveredItems.some((id) => !routeItems.includes(id))) {
    throw new Error('The packet no longer matches its reviewed Blueprint route.');
  }
  if (coverage.some((entry, index) => entry.user_id !== letter.user_id || entry.client_id !== letter.client_id
      || entry.campaign_id !== letter.campaign_id || entry.campaign_route_id !== letter.campaign_route_id
      || entry.coverage_order !== index + 1 || !Array.isArray(entry.frozen_findings)
      || !entry.frozen_findings.some((finding) => finding?.outcome === 'FLAG'))) {
    throw new Error('Every packet account must retain its ordered frozen findings and campaign identity.');
  }
  const expectedKeys = new Set(coverage.map((entry) => normalizedRecipient(entry.expected_recipient)));
  if (expectedKeys.size !== 1) throw new Error('The packet coverage contains mixed recipients or legal paths.');
  const expected = coverage[0].expected_recipient || {};
  if (letter.target_type === 'bureau') {
    if (expected.type !== 'bureau' || expected.bureau !== letter.target_bureau) {
      throw new Error('The packet bureau recipient does not match its frozen coverage.');
    }
  } else {
    const actualAddress = normalizedRecipient([toAddress.name, toAddress.line1, toAddress.line2, toAddress.city, toAddress.state, toAddress.zip]);
    const expectedAddress = normalizedRecipient([expected.name, expected.address]);
    if (expected.type !== 'furnisher' || expected.basis !== letter.dispute_basis
        || !actualAddress || !expectedAddress || !actualAddress.includes(expectedAddress.slice(-Math.min(24, expectedAddress.length)))) {
      throw new Error('The verified mailing address does not match the reviewed direct-packet recipient.');
    }
  }

  const roundIds = coverage.map((entry) => entry.dispute_round_id);
  const roundsResult = await supabaseRequest(
    '/rest/v1/dispute_rounds?id=in.(' + roundIds.map(encodeURIComponent).join(',') + ')&select=id,user_id,client_id,client_account_id,round_number,target_type,status,campaign_id',
    'GET', null, supabaseUrl, serviceKey
  );
  const rounds = Array.isArray(roundsResult.body) ? roundsResult.body : [];
  const roundById = new Map(rounds.map((round) => [round.id, round]));
  if (!isSuccess(roundsResult) || rounds.length !== coverage.length || coverage.some((entry) => {
    const round = roundById.get(entry.dispute_round_id);
    return !round || round.status !== 'open' || round.user_id !== letter.user_id
      || round.client_id !== letter.client_id || round.client_account_id !== entry.client_account_id
      || round.target_type !== letter.target_type || round.campaign_id !== letter.campaign_id;
  })) throw new Error('Every covered account must have its matching open dispute round before mailing.');

  const clientResult = await supabaseRequest('/rest/v1/clients?id=eq.' + encodeURIComponent(letter.client_id) + '&select=id,user_id,lpoa_signature_data', 'GET', null, supabaseUrl, serviceKey);
  const client = Array.isArray(clientResult.body) ? clientResult.body[0] : null;
  if (!isSuccess(clientResult) || !client || client.user_id !== letter.user_id || !client.lpoa_signature_data) {
    throw new Error('A signed Limited Power of Attorney is required before mailing this packet.');
  }
  if (rounds.some((round) => round.round_number === 1)) {
    const docsResult = await supabaseRequest('/rest/v1/documents?client_id=eq.' + encodeURIComponent(letter.client_id) + '&doc_type=in.(id,address)&select=id,doc_type', 'GET', null, supabaseUrl, serviceKey);
    const docTypes = new Set((Array.isArray(docsResult.body) ? docsResult.body : []).map((doc) => doc.doc_type));
    if (!isSuccess(docsResult) || !docTypes.has('id') || !docTypes.has('address')) throw new Error('A Round 1 packet requires a government ID and proof of current address.');
  }

  const laterItemIds = coverage.filter((entry) => roundById.get(entry.dispute_round_id)?.round_number > 1).map((entry) => entry.campaign_item_id);
  if (laterItemIds.length) {
    const linksResult = await supabaseRequest('/rest/v1/letter_source_links?user_id=eq.' + encodeURIComponent(letter.user_id) + '&letter_id=eq.' + encodeURIComponent(letter.id) + '&select=source_letter_id,response_evidence_id,campaign_item_ids', 'GET', null, supabaseUrl, serviceKey);
    const links = Array.isArray(linksResult.body) ? linksResult.body : [];
    if (!isSuccess(linksResult) || laterItemIds.some((itemId) => !links.some((link) => link.response_evidence_id && (link.campaign_item_ids || []).includes(itemId)))) {
      throw new Error('Every later-round packet account requires its own reviewed prior evidence link.');
    }
    const evidenceIds = [...new Set(links.map((link) => link.response_evidence_id).filter(Boolean))];
    const evidenceResult = await supabaseRequest('/rest/v1/response_evidence?id=in.(' + evidenceIds.map(encodeURIComponent).join(',') + ')&select=id,firm_user_id,analysis_status,review_status', 'GET', null, supabaseUrl, serviceKey);
    const evidence = Array.isArray(evidenceResult.body) ? evidenceResult.body : [];
    if (!isSuccess(evidenceResult) || evidence.length !== evidenceIds.length || evidence.some((row) => row.firm_user_id !== letter.user_id || row.analysis_status !== 'analyzed' || row.review_status === 'not_reviewed')) {
      throw new Error('A packet prior source is no longer analyzed and reviewed.');
    }
    const sourceLetterIds = [...new Set(links.map((link) => link.source_letter_id).filter(Boolean))];
    const sourceLettersResult = await supabaseRequest('/rest/v1/letters?id=in.(' + sourceLetterIds.map(encodeURIComponent).join(',') + ')&select=id,user_id,client_id,client_account_id,packet_version,mailed_date', 'GET', null, supabaseUrl, serviceKey);
    const sourceLetters = Array.isArray(sourceLettersResult.body) ? sourceLettersResult.body : [];
    if (!isSuccess(sourceLettersResult) || sourceLetters.length !== sourceLetterIds.length) {
      throw new Error('A packet prior source letter is no longer available.');
    }
    const sourceLetterById = new Map(sourceLetters.map((source) => [source.id, source]));
    const packetSourceIds = sourceLetters.filter((source) => Number(source.packet_version || 1) === 2).map((source) => source.id);
    let sourceCoverage = [];
    if (packetSourceIds.length) {
      const sourceCoverageResult = await supabaseRequest('/rest/v1/letter_account_coverage?letter_id=in.(' + packetSourceIds.map(encodeURIComponent).join(',') + ')&select=id,letter_id,client_account_id', 'GET', null, supabaseUrl, serviceKey);
      if (!isSuccess(sourceCoverageResult)) throw new Error('Packet prior-account coverage could not be revalidated.');
      sourceCoverage = Array.isArray(sourceCoverageResult.body) ? sourceCoverageResult.body : [];
    }
    let sourceAssessments = [];
    if (packetSourceIds.length) {
      const assessmentResult = await supabaseRequest('/rest/v1/response_evidence_account_assessment?response_evidence_id=in.(' + evidenceIds.map(encodeURIComponent).join(',') + ')&select=response_evidence_id,coverage_id,client_account_id,review_status,next_action', 'GET', null, supabaseUrl, serviceKey);
      if (!isSuccess(assessmentResult)) throw new Error('Packet prior-account assessments could not be revalidated.');
      sourceAssessments = Array.isArray(assessmentResult.body) ? assessmentResult.body : [];
    }
    for (const currentCoverage of coverage.filter((entry) => laterItemIds.includes(entry.campaign_item_id))) {
      const scopedLinks = links.filter((link) => (link.campaign_item_ids || []).includes(currentCoverage.campaign_item_id));
      const hasEligibleSource = scopedLinks.some((link) => {
        const sourceLetter = sourceLetterById.get(link.source_letter_id);
        if (!sourceLetter || sourceLetter.user_id !== letter.user_id || sourceLetter.client_id !== letter.client_id || !sourceLetter.mailed_date) return false;
        if (Number(sourceLetter.packet_version || 1) !== 2) {
          return sourceLetter.client_account_id === currentCoverage.client_account_id;
        }
        const matchingCoverage = sourceCoverage.find((entry) =>
          entry.letter_id === sourceLetter.id && entry.client_account_id === currentCoverage.client_account_id);
        return Boolean(matchingCoverage && sourceAssessments.some((assessment) =>
          assessment.response_evidence_id === link.response_evidence_id
          && assessment.coverage_id === matchingCoverage.id
          && assessment.client_account_id === currentCoverage.client_account_id
          && assessment.review_status === 'reviewed'
          && ['next_round', 'escalate'].includes(assessment.next_action)));
      });
      if (!hasEligibleSource) {
        throw new Error('Every later-round account requires its own reviewed, follow-up-eligible prior assessment.');
      }
    }
  }
}

async function updatePacketCoverage(letter, patch, supabaseUrl, serviceKey) {
  if (Number(letter.packet_version || 1) !== 2) return;
  const result = await supabaseRequest(
    '/rest/v1/letter_account_coverage?letter_id=eq.' + encodeURIComponent(letter.id),
    'PATCH', { ...patch, updated_at: new Date().toISOString() }, supabaseUrl, serviceKey
  );
  if (!isSuccess(result)) console.error('Could not update packet coverage:', letter.id, requestError(result, 'unknown error'));
}

async function markPacketCoverageQueuedIfUntracked(letter, supabaseUrl, serviceKey) {
  if (Number(letter.packet_version || 1) !== 2) return;
  const result = await supabaseRequest(
    '/rest/v1/letter_account_coverage?letter_id=eq.' + encodeURIComponent(letter.id)
      + '&tracking_status=is.null',
    'PATCH', {
      mail_status: 'queued',
      tracking_status: 'Mailed',
      updated_at: new Date().toISOString(),
    }, supabaseUrl, serviceKey
  );
  if (!isSuccess(result)) console.error('Could not mark packet coverage queued:', letter.id, requestError(result, 'unknown error'));
}

async function validateStructuredRoundPreflight(letter, supabaseUrl, serviceKey) {
  if (!letter.round_id) return;
  const roundResult = await supabaseRequest('/rest/v1/dispute_rounds?id=eq.' + encodeURIComponent(letter.round_id) + '&select=id,user_id,client_id,client_account_id,round_number,target_type,status', 'GET', null, supabaseUrl, serviceKey);
  const round = Array.isArray(roundResult.body) ? roundResult.body[0] : null;
  if (!isSuccess(roundResult) || !round || round.status !== 'open') throw new Error('Only a letter in an open dispute round may be mailed.');
  if (round.user_id !== letter.user_id || round.client_id !== letter.client_id || round.client_account_id !== letter.client_account_id || round.round_number !== letter.round_number || round.target_type !== letter.target_type) {
    throw new Error('The letter does not match its structured dispute round.');
  }
  const clientResult = await supabaseRequest('/rest/v1/clients?id=eq.' + encodeURIComponent(letter.client_id) + '&select=id,user_id,lpoa_signature_data', 'GET', null, supabaseUrl, serviceKey);
  const client = Array.isArray(clientResult.body) ? clientResult.body[0] : null;
  if (!isSuccess(clientResult) || !client || client.user_id !== letter.user_id || !client.lpoa_signature_data) {
    throw new Error('A signed Limited Power of Attorney is required before mailing a structured dispute round.');
  }
  if (round.round_number === 1) {
    const docsResult = await supabaseRequest('/rest/v1/documents?client_id=eq.' + encodeURIComponent(letter.client_id) + '&doc_type=in.(id,address)&select=id,doc_type', 'GET', null, supabaseUrl, serviceKey);
    const docTypes = new Set((Array.isArray(docsResult.body) ? docsResult.body : []).map((doc) => doc.doc_type));
    if (!isSuccess(docsResult) || !docTypes.has('id') || !docTypes.has('address')) {
      throw new Error('Round 1 requires a government ID and proof of current address before mailing.');
    }
  }
  if (round.round_number <= 1) return;
  const linksResult = await supabaseRequest('/rest/v1/letter_source_links?user_id=eq.' + encodeURIComponent(letter.user_id) + '&letter_id=eq.' + encodeURIComponent(letter.id) + '&select=source_letter_id,response_evidence_id', 'GET', null, supabaseUrl, serviceKey);
  const links = Array.isArray(linksResult.body) ? linksResult.body : [];
  if (!isSuccess(linksResult) || !links.length || links.some((link) => !link.response_evidence_id)) throw new Error('A later-round letter requires reviewed prior source evidence before mailing.');
  const evidenceIds = [...new Set(links.map((link) => link.response_evidence_id))];
  const evidenceResult = await supabaseRequest('/rest/v1/response_evidence?id=in.(' + evidenceIds.map(encodeURIComponent).join(',') + ')&select=id,firm_user_id,analysis_status,review_status', 'GET', null, supabaseUrl, serviceKey);
  const evidence = Array.isArray(evidenceResult.body) ? evidenceResult.body : [];
  if (!isSuccess(evidenceResult) || evidence.length !== evidenceIds.length || evidence.some((row) => row.firm_user_id !== letter.user_id || row.analysis_status !== 'analyzed' || row.review_status === 'not_reviewed')) {
    throw new Error('A selected prior source is no longer analyzed and reviewed.');
  }
}

async function validateOptionalAttachments(letter, manifest, supabaseUrl, serviceKey) {
  const items = Array.isArray(manifest) ? manifest : [];
  if (items.length > 5) throw new Error('At most five optional supporting documents may be mailed.');
  if (!items.length) return [];
  const ids = [...new Set(items.map((item) => String(item.document_id || '')).filter(Boolean))];
  if (ids.length !== items.length) throw new Error('Optional attachment identifiers are missing or duplicated.');
  const result = await supabaseRequest('/rest/v1/documents?id=in.(' + ids.map(encodeURIComponent).join(',') + ')&select=id,user_id,client_id,label,file_name,storage_path,content_type,byte_size,sha256', 'GET', null, supabaseUrl, serviceKey);
  if (!isSuccess(result) || !Array.isArray(result.body) || result.body.length !== ids.length) throw new Error('One or more optional documents no longer exist.');
  const byId = new Map(result.body.map((doc) => [doc.id, doc]));
  const validated = [];
  let totalPages = 0;
  for (const item of items) {
    const doc = byId.get(item.document_id);
    if (!doc || doc.user_id !== letter.user_id || doc.client_id !== letter.client_id || doc.storage_path !== item.storage_path) throw new Error('An optional document does not belong to this client.');
    const objectPath = String(doc.storage_path).split('/').map(encodeURIComponent).join('/');
    const objectResponse = await fetch(`${supabaseUrl}/storage/v1/object/authenticated/documents/${objectPath}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!objectResponse.ok) throw new Error('An optional supporting document could not be read from private storage.');
    const bytes = new Uint8Array(await objectResponse.arrayBuffer());
    if (bytes.byteLength > 5 * 1024 * 1024) throw new Error(`${doc.file_name} exceeds the 5 MB optional-document limit.`);
    const isPdf = /\.pdf$/i.test(doc.file_name || '') || /application\/pdf/i.test(objectResponse.headers.get('content-type') || '');
    const isImage = /\.(jpe?g|png|webp)$/i.test(doc.file_name || '') || /^image\/(jpeg|png|webp)/i.test(objectResponse.headers.get('content-type') || '');
    if (!isPdf && !isImage) throw new Error(`${doc.file_name} must be a PDF, JPG, PNG, or WEBP file.`);
    let pageCount = 1;
    if (isPdf) {
      try {
        const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
        pageCount = pdf.getPageCount();
      } catch (pdfError) {
        throw new Error(`${doc.file_name} is not a readable PDF.`);
      }
    }
    totalPages += pageCount;
    if (totalPages > 4) throw new Error('Optional supporting documents may contain at most four total pages.');
    validated.push({
      document_id: doc.id,
      label: doc.label || null,
      file_name: doc.file_name,
      storage_path: doc.storage_path,
      content_type: doc.content_type || null,
      byte_size: bytes.byteLength,
      page_count: pageCount,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    });
  }
  return validated;
}

function isBureauFollowUp(letter) {
  return /^Phase 3\b.*\(Follow-up\)/i.test(String(letter?.phase || ''))
    || !!(letter?.source_phase3_letter_id || letter?.source_bureau_response_evidence_id);
}

function isFileUpdateLetter(letter) {
  const cleanupPhases = new Set([
    'Personal Info Cleanup',
    'Inquiry Removal',
    'Personal Info & Inquiries',
    'Interim Letter',
  ]);
  return String(letter?.letter_kind || '') === 'file_update'
    || cleanupPhases.has(String(letter?.phase || ''));
}

function isPersonalInfoCleanupLetter(letter) {
  return ['Personal Info Cleanup', 'Inquiry Removal', 'Personal Info & Inquiries']
    .includes(String(letter?.phase || ''));
}

async function validatePersonalInfoCleanupPreflight(letter, supabaseUrl, serviceKey) {
  if (!isPersonalInfoCleanupLetter(letter)) return;
  if (!letter.client_id || !letter.user_id) {
    throw new Error('PI/inquiry letters require a linked client before mailing.');
  }
  const docsResult = await supabaseRequest(
    '/rest/v1/documents?client_id=eq.' + encodeURIComponent(letter.client_id)
      + '&doc_type=in.(id,address)&select=id,user_id,client_id,doc_type',
    'GET', null, supabaseUrl, serviceKey
  );
  const docs = Array.isArray(docsResult.body) ? docsResult.body : [];
  const validTypes = new Set(docs
    .filter((doc) => doc.user_id === letter.user_id && doc.client_id === letter.client_id)
    .map((doc) => doc.doc_type));
  if (!isSuccess(docsResult) || !validTypes.has('id') || !validTypes.has('address')) {
    throw new Error('PI/inquiry letters require a government-issued photo ID and proof of current address before mailing.');
  }
}

function isBureauAccountDisputeLetter(letter) {
  if (!letter || isFileUpdateLetter(letter)) return false;
  return letter.target_type === 'bureau' || String(letter.phase || '').startsWith('Phase 3');
}

function bureauFromPhase(phase) {
  const value = String(phase || '').toLowerCase();
  if (value.includes('equifax')) return 'equifax';
  if (value.includes('experian')) return 'experian';
  if (value.includes('transunion') || value.includes('trans union')) return 'transunion';
  return null;
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || !right.length) return false;
  return JSON.stringify([...new Set(left.map(String))].sort())
    === JSON.stringify([...new Set(right.map(String))].sort());
}

async function validateBureauFollowUpPreflight(letter, manifest, supabaseUrl, serviceKey) {
  if (!isBureauFollowUp(letter)) return [];
  const issues = [];
  const sourceLetterId = letter.source_phase3_letter_id;
  const sourceEvidenceId = letter.source_bureau_response_evidence_id;
  if (!sourceLetterId || !sourceEvidenceId) {
    return ['The saved follow-up does not identify both its exact prior Phase 3 letter and exact bureau response. Regenerate it before mailing.'];
  }
  if (!letter.client_id || !letter.user_id || sourceLetterId === letter.id) {
    return ['The saved follow-up source relationship is incomplete or invalid. Reconcile it before mailing.'];
  }

  const [priorResult, evidenceResult, clientResult] = await Promise.all([
    supabaseRequest(
      '/rest/v1/letters?id=eq.' + encodeURIComponent(sourceLetterId)
        + '&user_id=eq.' + encodeURIComponent(letter.user_id)
        + '&select=id,user_id,client_id,phase,covered_furnishers,html',
      'GET', null, supabaseUrl, serviceKey
    ),
    supabaseRequest(
      '/rest/v1/response_evidence?id=eq.' + encodeURIComponent(sourceEvidenceId)
        + '&firm_user_id=eq.' + encodeURIComponent(letter.user_id)
        + '&select=id,firm_user_id,client_id,letter_id,response_kind,storage_bucket,storage_paths,file_names,upload_status',
      'GET', null, supabaseUrl, serviceKey
    ),
    supabaseRequest(
      '/rest/v1/clients?id=eq.' + encodeURIComponent(letter.client_id)
        + '&select=id,user_id,lpoa_signature_data',
      'GET', null, supabaseUrl, serviceKey
    ),
  ]);
  if (!isSuccess(priorResult)) throw new Error(requestError(priorResult, 'Could not validate the prior Phase 3 enclosure'));
  if (!isSuccess(evidenceResult)) throw new Error(requestError(evidenceResult, 'Could not validate the bureau-response enclosure'));
  if (!isSuccess(clientResult)) throw new Error(requestError(clientResult, 'Could not validate the Limited Power of Attorney'));

  const prior = Array.isArray(priorResult.body) ? priorResult.body[0] : null;
  const evidence = Array.isArray(evidenceResult.body) ? evidenceResult.body[0] : null;
  const client = Array.isArray(clientResult.body) ? clientResult.body[0] : null;
  if (!prior
    || prior.id !== sourceLetterId
    || prior.user_id !== letter.user_id
    || prior.client_id !== letter.client_id
    || !String(prior.phase || '').startsWith('Phase 3')
    || !bureauFromPhase(letter.phase)
    || bureauFromPhase(prior.phase) !== bureauFromPhase(letter.phase)
    || !sameStringSet(prior.covered_furnishers, letter.covered_furnishers)
    || !String(prior.html || '').trim()) {
    issues.push('Exhibit A is not a printable Phase 3 letter for the same client, firm, bureau, and furnisher coverage.');
  }

  const paths = Array.isArray(evidence?.storage_paths) ? evidence.storage_paths : [];
  const names = Array.isArray(evidence?.file_names) ? evidence.file_names : [];
  const prefixes = responseEvidencePrefixes(letter.user_id, letter.client_id, sourceEvidenceId);
  const pathsMatch = paths.length > 0 && prefixes.some((expectedPrefix) =>
    paths.every((path) => typeof path === 'string' && path.startsWith(expectedPrefix))
  );
  if (!evidence
    || evidence.id !== sourceEvidenceId
    || evidence.firm_user_id !== letter.user_id
    || evidence.client_id !== letter.client_id
    || evidence.letter_id !== sourceLetterId
    || evidence.response_kind !== 'bureau'
    || evidence.storage_bucket !== 'responses'
    || evidence.upload_status !== 'received'
    || paths.length === 0
    || !pathsMatch
    || names.length !== paths.length) {
    issues.push('Exhibit B is not a complete bureau response to Exhibit A for this same client and firm.');
  }
  const hasLpoa = !!(client?.lpoa_signature_data?.lpoaPath || client?.lpoa_signature_data?.lpoaUrl);
  if (!client
    || client.id !== letter.client_id
    || client.user_id !== letter.user_id
    || !hasLpoa) {
    issues.push('Exhibit C is missing the client’s signed Limited Power of Attorney.');
  }

  if (!manifest
    || manifest.kind !== 'bureau_follow_up_v1'
    || manifest.source_phase3_letter_id !== sourceLetterId
    || manifest.source_bureau_response_evidence_id !== sourceEvidenceId
    || JSON.stringify(manifest.response_storage_paths || []) !== JSON.stringify(paths)) {
    issues.push('The rendered packet manifest does not exactly match the saved follow-up sources.');
  }
  return issues;
}

function requiredCccAutomaticIdentityIssues(letter, automaticValues, expectedByToken) {
  const issues = [];
  if (!automaticValues || typeof automaticValues !== 'object' || Array.isArray(automaticValues)) {
    return ['The frozen automatic curly values are missing.'];
  }
  for (const token of ['client_first_name', 'client_last_name', 'client_address']) {
    const expected = expectedByToken[token];
    if (!Object.prototype.hasOwnProperty.call(automaticValues, token)) {
      issues.push(`The required frozen {${token}} value is missing.`);
    } else if (String(automaticValues[token]) !== expected) {
      issues.push(`The frozen {${token}} value does not match the verified CCC letter identity.`);
    }
  }
  const clientNameWasUsed = /\{\{?\s*client_name\s*\}?\}/i.test(String(letter?.dispute_template_snapshot || ''));
  if (clientNameWasUsed && !Object.prototype.hasOwnProperty.call(automaticValues, 'client_name')) {
    issues.push('The required frozen {client_name} value is missing.');
  } else if (Object.prototype.hasOwnProperty.call(automaticValues, 'client_name')
    && String(automaticValues.client_name) !== expectedByToken.client_name) {
    issues.push('The frozen {client_name} value does not match the verified CCC letter identity.');
  }
  return issues;
}

async function validateCccLetterIdentityPreflight(letter, supabaseUrl, serviceKey) {
  if (!String(letter?.phase || '').startsWith('CCC Dispute —')) return [];
  const {
    cccLetterIdentityAutomaticValues,
    cccLetterIdentityIssues,
  } = await import('../../src/utils/cccLetterIdentity.js');
  const snapshot = letter.ccc_letter_identity_snapshot;
  const issues = cccLetterIdentityIssues(snapshot);
  if (issues.length) return issues;

  const matchResult = await supabaseRequest(
    '/rest/v1/rpc/ccc_letter_identity_snapshot_matches_current',
    'POST',
    { p_user_id: letter.user_id, p_client_id: letter.client_id, p_snapshot: snapshot },
    supabaseUrl,
    serviceKey
  );
  if (!isSuccess(matchResult) || matchResult.body !== true) {
    return ['The saved CCC legal name/address or its bound identity documents changed. Rebuild the letter from Campaign Studio.'];
  }

  const documentIds = [snapshot.identityDocumentId, snapshot.addressDocumentId];
  const documentsResult = await supabaseRequest(
    '/rest/v1/documents?id=in.(' + documentIds.map(encodeURIComponent).join(',') + ')'
      + '&select=id,user_id,client_id,doc_type,storage_path,content_type,byte_size,sha256',
    'GET', null, supabaseUrl, serviceKey
  );
  const documents = Array.isArray(documentsResult.body) ? documentsResult.body : [];
  if (!isSuccess(documentsResult) || documents.length !== 2) {
    return ['The exact verified government ID and proof-of-address records are unavailable.'];
  }
  for (const document of documents) {
    const expected = document.doc_type === 'id'
      ? { id: snapshot.identityDocumentId, path: snapshot.identityDocumentStoragePath, sha256: snapshot.identityDocumentSha256 }
      : { id: snapshot.addressDocumentId, path: snapshot.addressDocumentStoragePath, sha256: snapshot.addressDocumentSha256 };
    if (!expected
      || document.id !== expected.id
      || document.user_id !== letter.user_id
      || document.client_id !== letter.client_id
      || document.storage_path !== expected.path
      || document.sha256 !== expected.sha256) {
      issues.push('An identity-document registry record no longer matches the reviewed letter identity.');
      continue;
    }
    const objectPath = String(document.storage_path).split('/').map(encodeURIComponent).join('/');
    const objectResponse = await fetch(`${supabaseUrl}/storage/v1/object/authenticated/documents/${objectPath}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!objectResponse.ok) {
      issues.push(`The verified ${document.doc_type === 'id' ? 'government ID' : 'proof of address'} cannot be read from private storage.`);
      continue;
    }
    const bytes = Buffer.from(await objectResponse.arrayBuffer());
    const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (actualSha256 !== expected.sha256 || bytes.byteLength !== Number(document.byte_size)) {
      issues.push(`The verified ${document.doc_type === 'id' ? 'government ID' : 'proof of address'} failed its byte-integrity check.`);
    }
  }

  const automaticValues = letter.dispute_automatic_values_snapshot;
  const expectedValues = cccLetterIdentityAutomaticValues(snapshot);
  const expectedByToken = {
    client_first_name: expectedValues.firstName,
    client_last_name: expectedValues.lastName,
    client_name: expectedValues.name,
    client_address: expectedValues.address,
  };
  issues.push(...requiredCccAutomaticIdentityIssues(letter, automaticValues, expectedByToken));
  return [...new Set(issues)];
}

async function cccCraSensitiveAutomaticValueIssues(letter, currentIdentity = {}) {
  const isCccCraLetter = String(letter?.phase || '').startsWith('CCC Dispute —')
    && letter?.target_type === 'bureau';
  if (!isCccCraLetter) return [];

  const issues = [];
  const dateOfBirth = typeof currentIdentity.dateOfBirth === 'string'
    ? currentIdentity.dateOfBirth.trim()
    : '';
  const ssnLast4 = typeof currentIdentity.ssnLast4 === 'string'
    ? currentIdentity.ssnLast4.trim()
    : '';
  const { buildAutomaticTemplateValues } = await import('../../src/utils/disputeTemplateEngine.js');
  const currentValues = buildAutomaticTemplateValues({
    identity: { dateOfBirth, ssnLast4 },
    strictIdentity: true,
  });

  if (!dateOfBirth || !currentValues.bdate) {
    issues.push('The current client date of birth is missing or malformed.');
  }
  // This field is specifically SSN last-four, not a full or formatted SSN.
  // Reject anything except four digits before handing it to the shared mask.
  if (!/^\d{4}$/.test(ssnLast4) || !currentValues.ss_number) {
    issues.push('The current client SSN last four is missing or malformed.');
  }
  if (issues.length > 0) return issues;

  const automaticValues = letter.dispute_automatic_values_snapshot;
  if (!automaticValues || typeof automaticValues !== 'object' || Array.isArray(automaticValues)) {
    return ['The frozen CCC CRA date-of-birth and SSN curlys are missing.'];
  }
  for (const token of ['bdate', 'ss_number']) {
    if (!Object.prototype.hasOwnProperty.call(automaticValues, token)) {
      issues.push(`The frozen {${token}} value is missing.`);
    } else if (automaticValues[token] !== currentValues[token]) {
      issues.push(`The frozen {${token}} value no longer matches the current client record.`);
    }
  }
  return issues;
}

async function validateCccCraSensitiveAutomaticValuesPreflight(letter, supabaseUrl, serviceKey) {
  const isCccCraLetter = String(letter?.phase || '').startsWith('CCC Dispute —')
    && letter?.target_type === 'bureau';
  if (!isCccCraLetter) return [];

  const unavailableIssue = 'The current client date of birth and SSN last four could not be verified.';
  if (!letter.client_id || !letter.user_id) return [unavailableIssue];

  try {
    const clientResult = await supabaseRequest(
      '/rest/v1/clients?id=eq.' + encodeURIComponent(letter.client_id)
        + '&select=id,user_id,date_of_birth',
      'GET', null, supabaseUrl, serviceKey
    );
    const clients = Array.isArray(clientResult.body) ? clientResult.body : [];
    const client = clients.length === 1 ? clients[0] : null;
    if (!isSuccess(clientResult)
      || !client
      || client.id !== letter.client_id
      || client.user_id !== letter.user_id) {
      return [unavailableIssue];
    }

    const sensitiveResult = await supabaseRequest(
      '/rest/v1/client_sensitive_data?client_id=eq.' + encodeURIComponent(letter.client_id)
        + '&select=client_id,ssn_last4',
      'GET', null, supabaseUrl, serviceKey
    );
    const sensitiveRows = Array.isArray(sensitiveResult.body) ? sensitiveResult.body : [];
    const sensitiveRow = sensitiveRows.length === 1 ? sensitiveRows[0] : null;
    if (!isSuccess(sensitiveResult)
      || !sensitiveRow
      || sensitiveRow.client_id !== letter.client_id) {
      return [unavailableIssue];
    }

    const { decryptClientData } = await import('./_clientDataCrypto.mjs');
    const ssnLast4 = decryptClientData(sensitiveRow.ssn_last4);
    return await cccCraSensitiveAutomaticValueIssues(letter, {
      dateOfBirth: client.date_of_birth,
      ssnLast4,
    });
  } catch {
    // Encryption/config/query failures must block before Lob without exposing
    // the current or frozen identity values in logs or the response.
    return [unavailableIssue];
  }
}

async function validateCccPacketPreflight(letter, manifest, supabaseUrl, serviceKey) {
  const { isCccDisputePhase, requiresCccR1IdentityDocuments } = await import('../../src/utils/cccMailRules.js');
  const {
    resolveDisputeScreenshotPolicy,
    validateDisputeScreenshotManifest,
  } = await import('../../src/utils/disputeScreenshots.js');
  if (!isCccDisputePhase(letter.phase)) return [];
  if (!letter.client_id || !letter.user_id) {
    return ['CCC requires a canonical staff owner and client record before packet exhibits can be validated.'];
  }

  const screenshotManifest = Array.isArray(letter.dispute_screenshot_manifest) ? letter.dispute_screenshot_manifest : [];
  const screenshotPolicy = resolveDisputeScreenshotPolicy({
    snapshot: letter.dispute_screenshot_policy_snapshot,
    templateText: letter.dispute_template_snapshot,
  });
  const screenshotIssues = validateDisputeScreenshotManifest({
    accounts: Array.isArray(letter.dispute_account_snapshot) ? letter.dispute_account_snapshot : [],
    manifest: screenshotManifest,
    policy: screenshotPolicy,
    userId: letter.user_id,
    clientId: letter.client_id,
  });
  const issues = [...screenshotIssues];
  const expectedScreenshotPaths = screenshotManifest.map((item) => item.storagePath);
  const requiresIdentity = requiresCccR1IdentityDocuments(letter);
  let expectedIds = [];
  let expectedIdentityPaths = [];
  let expectedIdentitySha256 = [];

  if (requiresIdentity) {
    const identitySnapshot = letter.ccc_letter_identity_snapshot || {};
    expectedIds = [identitySnapshot.identityDocumentId, identitySnapshot.addressDocumentId];
    expectedIdentityPaths = [identitySnapshot.identityDocumentStoragePath, identitySnapshot.addressDocumentStoragePath];
    expectedIdentitySha256 = [identitySnapshot.identityDocumentSha256, identitySnapshot.addressDocumentSha256];
    const result = await supabaseRequest(
      '/rest/v1/documents?user_id=eq.' + encodeURIComponent(letter.user_id)
        + '&client_id=eq.' + encodeURIComponent(letter.client_id)
        + '&id=in.(' + expectedIds.map(encodeURIComponent).join(',') + ')'
        + '&select=id,doc_type,storage_path,sha256',
      'GET', null, supabaseUrl, serviceKey
    );
    if (!isSuccess(result)) throw new Error(requestError(result, 'Could not validate CCC R1 identity documents'));

    const documents = Array.isArray(result.body) ? result.body : [];
    const idDocument = documents.find((document) => document.doc_type === 'id');
    const addressDocument = documents.find((document) => document.doc_type === 'address');
    if (!idDocument || idDocument.id !== expectedIds[0] || idDocument.storage_path !== expectedIdentityPaths[0] || idDocument.sha256 !== expectedIdentitySha256[0]) issues.push('The exact verified government-issued photo ID is missing or changed.');
    if (!addressDocument || addressDocument.id !== expectedIds[1] || addressDocument.storage_path !== expectedIdentityPaths[1] || addressDocument.sha256 !== expectedIdentitySha256[1]) issues.push('The exact verified proof of current address is missing or changed.');
  }

  if (!manifest
    || manifest.kind !== 'ccc_packet_v1'
    || JSON.stringify(manifest.screenshot_storage_paths || []) !== JSON.stringify(expectedScreenshotPaths)
    || JSON.stringify(manifest.identity_document_ids || []) !== JSON.stringify(expectedIds)
    || JSON.stringify(manifest.identity_storage_paths || []) !== JSON.stringify(expectedIdentityPaths)
    || JSON.stringify(manifest.identity_document_sha256 || []) !== JSON.stringify(expectedIdentitySha256)) {
    issues.push('The rendered CCC packet manifest does not exactly match the saved account screenshots and current R1 identity records.');
  }
  return issues;
}

async function validateCccRenderedMailpiece({
  letter,
  mailpieceUrl,
  scannedMailpiece,
  validatedAttachments,
  supabaseUrl,
  serviceKey,
}) {
  const {
    canonicalizeCccLetterHtml,
    cccExhibitImageUrl,
    cccLetterBindingInput,
    inspectBoundCccMailpiece,
    parseCccExhibitSections,
    renderCccImageExhibit,
  } = await import('../../src/utils/cccMailpieceIntegrity.js');
  const { requiresCccR1IdentityDocuments } = await import('../../src/utils/cccMailRules.js');
  const issues = [];
  const canonicalLetterHtml = canonicalizeCccLetterHtml(letter.html);
  const expectedLetterSha256 = sha256Hex(Buffer.from(cccLetterBindingInput(letter.id, canonicalLetterHtml), 'utf8'));
  const binding = inspectBoundCccMailpiece({
    letterId: letter.id,
    storedLetterHtml: letter.html,
    expectedSha256: expectedLetterSha256,
    uploadedHtml: scannedMailpiece.html,
  });
  issues.push(...binding.issues);

  let mailpieceObject;
  try {
    mailpieceObject = signedStorageObjectIdentity(mailpieceUrl, supabaseUrl);
    if (mailpieceObject.bucket !== 'documents'
      || !mailpieceObject.path.startsWith(`${letter.user_id}/temp/letters/`)) {
      issues.push('The CCC mailpiece itself is outside the canonical staff-owned temporary letter path.');
    }
  } catch (error) {
    issues.push(error.message);
  }
  if (binding.issues.length) return [...new Set(issues)];

  const expected = [];
  for (const item of Array.isArray(letter.dispute_screenshot_manifest) ? letter.dispute_screenshot_manifest : []) {
    expected.push({
      kind: 'screenshot',
      id: String(item.id || ''),
      bucket: 'documents',
      path: item.storagePath,
      sha256: String(item.sha256 || '').toLowerCase(),
      byteSize: Number(item.size || 0),
      heading: `Credit Report Exhibit — ${item.furnisher || 'Account'} — ${item.accountNumberMasked || 'account number not shown'}`,
      screenshot: true,
    });
  }

  if (requiresCccR1IdentityDocuments(letter)) {
    const snapshot = letter.ccc_letter_identity_snapshot || {};
    const identityIds = [snapshot.identityDocumentId, snapshot.addressDocumentId];
    const result = await supabaseRequest(
      '/rest/v1/documents?id=in.(' + identityIds.map(encodeURIComponent).join(',') + ')'
        + '&select=id,user_id,client_id,doc_type,file_name,storage_path,content_type,byte_size,sha256',
      'GET', null, supabaseUrl, serviceKey
    );
    if (!isSuccess(result)) throw new Error(requestError(result, 'Could not bind the CCC identity exhibits'));
    const documents = Array.isArray(result.body) ? result.body : [];
    const byType = new Map(documents.map((document) => [document.doc_type, document]));
    for (const spec of [
      { type: 'id', kind: 'identity-id', id: snapshot.identityDocumentId, path: snapshot.identityDocumentStoragePath, sha256: snapshot.identityDocumentSha256, heading: 'Enclosure — Government-Issued Photo ID' },
      { type: 'address', kind: 'identity-address', id: snapshot.addressDocumentId, path: snapshot.addressDocumentStoragePath, sha256: snapshot.addressDocumentSha256, heading: 'Enclosure — Proof of Current Address' },
    ]) {
      const document = byType.get(spec.type);
      if (!document
        || document.id !== spec.id
        || document.user_id !== letter.user_id
        || document.client_id !== letter.client_id
        || document.storage_path !== spec.path
        || document.sha256 !== spec.sha256) {
        issues.push(`The bound CCC ${spec.type === 'id' ? 'government ID' : 'proof-of-address'} exhibit no longer matches its frozen record.`);
        continue;
      }
      expected.push({
        kind: spec.kind,
        id: spec.id,
        bucket: 'documents',
        path: spec.path,
        sha256: spec.sha256,
        byteSize: Number(document.byte_size || 0),
        heading: spec.heading,
        screenshot: false,
      });
    }
  }

  for (const item of validatedAttachments || []) {
    expected.push({
      kind: 'optional',
      id: item.document_id,
      bucket: 'documents',
      path: item.storage_path,
      sha256: item.sha256,
      byteSize: Number(item.byte_size || 0),
      heading: `Enclosure — ${item.label || item.file_name}`,
      screenshot: false,
    });
  }

  const parsed = parseCccExhibitSections(binding.enclosureHtml);
  issues.push(...parsed.issues);
  if (parsed.sections.length !== expected.length) {
    issues.push('The physical CCC packet does not contain exactly the required and selected exhibits.');
  }

  const boundUrls = [];
  for (let index = 0; index < expected.length; index += 1) {
    const spec = expected[index];
    const section = parsed.sections[index];
    if (!section || section.kind !== spec.kind || section.id !== spec.id) {
      issues.push(`CCC exhibit ${index + 1} is missing, duplicated, or out of its deterministic packet order.`);
      continue;
    }
    let signedUrl;
    try {
      signedUrl = cccExhibitImageUrl(section.html);
      const exactSection = renderCccImageExhibit({
        kind: spec.kind,
        id: spec.id,
        heading: spec.heading,
        imageUrl: signedUrl,
        screenshot: spec.screenshot,
      });
      const markerStart = exactSection.indexOf('-->') + 3;
      const markerEnd = exactSection.lastIndexOf('<!--CCC-MAILPIECE-EXHIBIT:V1:');
      if (section.html !== exactSection.slice(markerStart, markerEnd)) {
        issues.push(`CCC exhibit ${index + 1} does not match the deterministic print layout.`);
      }
      const signedObject = signedStorageObjectIdentity(signedUrl, supabaseUrl);
      if (signedObject.bucket !== spec.bucket || signedObject.path !== spec.path) {
        issues.push(`CCC exhibit ${index + 1} does not point to its exact frozen source object.`);
        continue;
      }
      boundUrls.push(signedUrl);

      const [sourceAsset, signedAsset] = await Promise.all([
        readPrivateStorageAsset(spec.bucket, spec.path, supabaseUrl, serviceKey, MAX_CCC_EXHIBIT_BYTES, `CCC exhibit ${index + 1} source`),
        readBoundAsset(signedUrl, MAX_CCC_EXHIBIT_BYTES, `CCC exhibit ${index + 1} signed asset`),
      ]);
      const sourceSha256 = sha256Hex(sourceAsset.bytes);
      const signedSha256 = sha256Hex(signedAsset.bytes);
      if (!detectedImageType(sourceAsset.bytes)) {
        issues.push(`CCC exhibit ${index + 1} is not a source-verifiable JPG, PNG, or WebP image. Re-upload PDFs as images before mailing.`);
      }
      if (sourceSha256 !== spec.sha256 || sourceAsset.bytes.byteLength !== spec.byteSize) {
        issues.push(`CCC exhibit ${index + 1} source bytes no longer match the frozen review record.`);
      }
      if (signedSha256 !== sourceSha256 || signedAsset.bytes.byteLength !== sourceAsset.bytes.byteLength) {
        issues.push(`CCC exhibit ${index + 1} signed print bytes do not match the verified source object.`);
      }
    } catch (error) {
      issues.push(error.message);
    }
  }

  if (JSON.stringify(scannedMailpiece.urls) !== JSON.stringify([...new Set(boundUrls)])) {
    issues.push('The CCC mailpiece contains a remote asset outside its exact bound exhibit list.');
  }
  return [...new Set(issues)];
}

async function findSubmission(letterId, supabaseUrl, serviceKey) {
  const result = await supabaseRequest(
    '/rest/v1/mail_submissions?letter_id=eq.' + encodeURIComponent(letterId)
      + '&select=id,letter_id,idempotency_key,status,lob_id,tracking_number,attempt_count,last_error,consumer_statement_text,consumer_statement_sha256,consumer_statement_captured_at',
    'GET', null, supabaseUrl, serviceKey
  );
  if (!isSuccess(result)) throw new Error(requestError(result, 'Could not load mail submission'));
  return Array.isArray(result.body) ? result.body[0] : null;
}

function cccConsumerStatementAudience(letter) {
  const flow = String(letter?.dispute_flow_code || '').trim().toLowerCase();
  const targetType = String(letter?.target_type || '').trim().toLowerCase();
  const craFlows = new Set(['accuracy', 'accuracy_solo', 'collection', 'combo', 'consent', 'late_pay']);
  if (flow === 'direct') {
    if (targetType === 'bureau') throw new Error('The CCC letter has conflicting direct-flow and bureau-recipient metadata.');
    return 'direct';
  }
  if (!craFlows.has(flow)) throw new Error('The CCC letter is missing a recognized dispute flow.');
  if (targetType === 'furnisher') throw new Error('The CCC letter has conflicting CRA-flow and direct-recipient metadata.');
  return 'cra';
}

async function captureMailedConsumerStatement(letterId, evidence, audience, supabaseUrl, serviceKey) {
  if (!audience) return null;
  const capturedAt = new Date().toISOString();
  const result = await supabaseRequest(
    '/rest/v1/mail_submissions?letter_id=eq.' + encodeURIComponent(letterId)
      + '&consumer_statement_captured_at=is.null',
    'PATCH',
    {
      consumer_statement_text: evidence?.text || null,
      consumer_statement_sha256: evidence?.sha256 || null,
      consumer_statement_captured_at: capturedAt,
      updated_at: capturedAt,
    },
    supabaseUrl,
    serviceKey
  );
  if (!isSuccess(result)) throw new Error(requestError(result, 'Could not capture the mailed Consumer Statement evidence'));
  if (Array.isArray(result.body) && result.body.length === 1) return result.body[0];

  // A second tab may have claimed this one-per-letter submission first. It is
  // safe to reuse only when both requests read the exact same mailed body.
  const existing = await findSubmission(letterId, supabaseUrl, serviceKey);
  if (existing?.consumer_statement_sha256 === (evidence?.sha256 || null)
      && existing?.consumer_statement_text === (evidence?.text || null)
      && existing?.consumer_statement_captured_at) return existing;
  const conflict = new Error('The durable Consumer Statement changed after this mail submission was claimed. Create a reviewed letter revision before mailing.');
  conflict.code = 'CONSUMER_STATEMENT_CAPTURE_CONFLICT';
  throw conflict;
}

async function getOrCreateSubmission(letter, requestedBy, supabaseUrl, serviceKey) {
  let submission = await findSubmission(letter.id, supabaseUrl, serviceKey);
  if (submission) return submission;

  const created = await supabaseRequest(
    '/rest/v1/mail_submissions?on_conflict=letter_id',
    'POST',
    {
      letter_id: letter.id,
      user_id: letter.user_id,
      client_id: letter.client_id || null,
      requested_by: requestedBy || null,
      idempotency_key: crypto.randomUUID(),
      status: 'pending',
    },
    supabaseUrl,
    serviceKey,
    { Prefer: 'resolution=ignore-duplicates,return=representation' }
  );
  if (!isSuccess(created)) throw new Error(requestError(created, 'Could not create durable mail submission'));

  submission = Array.isArray(created.body) ? created.body[0] : null;
  // A concurrent click may have won the unique(letter_id) insert. Fetch its
  // key and deliberately reuse it so Lob still sees both requests as one.
  return submission || findSubmission(letter.id, supabaseUrl, serviceKey);
}

async function updateSubmission(letterId, patch, supabaseUrl, serviceKey) {
  const result = await supabaseRequest(
    '/rest/v1/mail_submissions?letter_id=eq.' + encodeURIComponent(letterId),
    'PATCH',
    { ...patch, updated_at: new Date().toISOString() },
    supabaseUrl,
    serviceKey
  );
  if (!isSuccess(result)) throw new Error(requestError(result, 'Could not update durable mail submission'));
  return Array.isArray(result.body) ? result.body[0] : null;
}

async function finalizeAcceptedSubmission({
  letter,
  submission,
  lobId,
  trackingNumber,
  desiredStatus,
  desiredError,
  supabaseUrl,
  serviceKey,
}) {
  const exactAttempt = (candidate) => candidate
    && candidate.id === submission.id
    && candidate.letter_id === letter.id
    && candidate.idempotency_key === submission.idempotency_key
    && (!candidate.lob_id || candidate.lob_id === lobId);
  let current = await findSubmission(letter.id, supabaseUrl, serviceKey);
  if (!exactAttempt(current)) {
    throw new Error('The durable mail attempt changed after Lob accepted this letter. Reconciliation is required.');
  }
  if (['failed', 'cancelled'].includes(current.status)) return current;
  if (['submitted', 'accepted_unreconciled'].includes(current.status) && current.lob_id === lobId) return current;
  if (current.status !== 'pending') {
    throw new Error('The durable mail attempt entered an unexpected state after Lob acceptance.');
  }

  const finalized = await supabaseRequest(
    '/rest/v1/mail_submissions?id=eq.' + encodeURIComponent(current.id)
      + '&letter_id=eq.' + encodeURIComponent(letter.id)
      + '&idempotency_key=eq.' + encodeURIComponent(current.idempotency_key)
      + '&status=eq.pending'
      + (current.lob_id
        ? '&lob_id=eq.' + encodeURIComponent(current.lob_id)
        : '&lob_id=is.null'),
    'PATCH', {
      status: desiredStatus,
      lob_id: lobId,
      tracking_number: trackingNumber || null,
      submitted_at: new Date().toISOString(),
      last_error: desiredError,
      updated_at: new Date().toISOString(),
    }, supabaseUrl, serviceKey
  );
  if (isSuccess(finalized) && Array.isArray(finalized.body) && finalized.body.length === 1) {
    return finalized.body[0];
  }

  // A signed webhook may have won the race after the read above. Re-read and
  // accept only the same exact attempt in a known terminal/accepted state;
  // never overwrite it with a late generic "submitted" write.
  current = await findSubmission(letter.id, supabaseUrl, serviceKey);
  if (exactAttempt(current)
      && current.lob_id === lobId
      && ['submitted', 'accepted_unreconciled', 'failed', 'cancelled'].includes(current.status)) {
    return current;
  }
  throw new Error('Could not reconcile the exact durable mail attempt after Lob acceptance.');
}

// A retry is permitted only after the signed Lob webhook has recorded a
// rendering failure. It deliberately rotates the durable idempotency key and
// clears only the operational fields; the original failed Lob ID remains in
// lob_webhook_events as the immutable audit record.
async function prepareFailedRetry(letter, submission, supabaseUrl, serviceKey) {
  const alreadyCleared = !letter.lob_id
    && !letter.tracking_status
    && !letter.mailed_date
    && !letter.tracking_number
    && !letter.expected_delivery_date;
  if (submission.status !== 'failed' || (letter.tracking_status !== 'Failed' && !alreadyCleared)) {
    throw new Error('This mailpiece is not a confirmed failed Lob send and cannot be retried.');
  }
  if (!alreadyCleared) {
    const cleared = await supabaseRequest(
      '/rest/v1/letters?id=eq.' + encodeURIComponent(letter.id)
        + (letter.lob_id
          ? '&lob_id=eq.' + encodeURIComponent(letter.lob_id)
          : '&lob_id=is.null')
        + '&tracking_status=eq.Failed',
      'PATCH',
      { lob_id: null, mailed_date: null, tracking_number: null, tracking_status: null, delivered_at: null, expected_delivery_date: null },
      supabaseUrl, serviceKey
    );
    if (!isSuccess(cleared) || !Array.isArray(cleared.body) || cleared.body.length !== 1) {
      throw new Error('The failed mailpiece changed before it could be retried. Refresh the letter and try again.');
    }
  }
  const reset = await supabaseRequest(
    '/rest/v1/mail_submissions?id=eq.' + encodeURIComponent(submission.id)
      + '&letter_id=eq.' + encodeURIComponent(letter.id)
      + '&idempotency_key=eq.' + encodeURIComponent(submission.idempotency_key)
      + '&status=eq.failed'
      + (submission.lob_id
        ? '&lob_id=eq.' + encodeURIComponent(submission.lob_id)
        : '&lob_id=is.null'),
    'PATCH',
    {
      idempotency_key: crypto.randomUUID(), status: 'pending', lob_id: null,
      tracking_number: null, submitted_at: null, last_error: null,
      consumer_statement_text: null, consumer_statement_sha256: null,
      consumer_statement_captured_at: null,
      updated_at: new Date().toISOString(),
    },
    supabaseUrl, serviceKey
  );
  if (!isSuccess(reset) || !Array.isArray(reset.body) || reset.body.length !== 1) {
    throw new Error('Could not prepare a fresh safe retry for this failed mailpiece.');
  }
  return reset.body[0];
}

// A canceled Lob job may be mailed again only through an explicit staff
// action after the bad enclosure has been corrected. Rotate idempotency so
// Lob creates a genuinely new mailpiece while retaining the canceled job in
// lob_webhook_events and the current lob_id until this guarded transition.
async function prepareCancelledRetry(letter, submission, supabaseUrl, serviceKey) {
  const alreadyCleared = !letter.lob_id
    && !letter.tracking_status
    && !letter.mailed_date
    && !letter.tracking_number
    && !letter.expected_delivery_date;
  if (submission.status !== 'cancelled' || (letter.tracking_status !== 'Cancelled' && !alreadyCleared)) {
    throw new Error('This mailpiece is not a confirmed canceled Lob send and cannot be re-mailed.');
  }
  if (!alreadyCleared) {
    const cleared = await supabaseRequest(
      '/rest/v1/letters?id=eq.' + encodeURIComponent(letter.id)
        + (letter.lob_id
          ? '&lob_id=eq.' + encodeURIComponent(letter.lob_id)
          : '&lob_id=is.null')
        + '&tracking_status=eq.Cancelled',
      'PATCH',
      { lob_id: null, mailed_date: null, tracking_number: null, tracking_status: null, delivered_at: null, expected_delivery_date: null },
      supabaseUrl, serviceKey
    );
    if (!isSuccess(cleared) || !Array.isArray(cleared.body) || cleared.body.length !== 1) {
      throw new Error('The canceled mailpiece changed before it could be re-mailed. Refresh the letter and try again.');
    }
  }
  const reset = await supabaseRequest(
    '/rest/v1/mail_submissions?id=eq.' + encodeURIComponent(submission.id)
      + '&letter_id=eq.' + encodeURIComponent(letter.id)
      + '&idempotency_key=eq.' + encodeURIComponent(submission.idempotency_key)
      + '&status=eq.cancelled'
      + (submission.lob_id
        ? '&lob_id=eq.' + encodeURIComponent(submission.lob_id)
        : '&lob_id=is.null'),
    'PATCH',
    {
      idempotency_key: crypto.randomUUID(), status: 'pending', lob_id: null,
      tracking_number: null, submitted_at: null, last_error: null,
      consumer_statement_text: null, consumer_statement_sha256: null,
      consumer_statement_captured_at: null,
      updated_at: new Date().toISOString(),
    },
    supabaseUrl, serviceKey
  );
  if (!isSuccess(reset) || !Array.isArray(reset.body) || reset.body.length !== 1) {
    throw new Error('Could not prepare a fresh safe send for this canceled mailpiece.');
  }
  return reset.body[0];
}

async function hasCccServiceAuthorization(clientId, supabaseUrl, serviceKey) {
  if (!clientId) return false;
  const result = await supabaseRequest(
    '/rest/v1/rpc/ccc_has_service_authorization',
    'POST',
    { p_client_id: clientId },
    supabaseUrl,
    serviceKey
  );
  if (!isSuccess(result)) return false;
  return result.body === true
    || (Array.isArray(result.body) && result.body.length === 1 && result.body[0] === true);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Only authenticated admins may send letters or verify addresses via Lob.
  const { requireAdmin } = require('./_requireAdmin.cjs');
  let admin;
  try { admin = await requireAdmin(event); }
  catch (e) { if (e.statusCode) return e; throw e; }

  // Prefer non-VITE names — VITE_-prefixed vars risk being inlined into the
  // client bundle if ever referenced from browser code. Old names kept as
  // fallback until the Netlify env is renamed.
  const mode = process.env.LOB_MODE || 'test';
  const apiKey = mode === 'live'
    ? process.env.LOB_LIVE_KEY
    : process.env.LOB_TEST_KEY;

  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Lob API key not configured' }) };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Supabase server configuration is required for Lob operations' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { action } = payload;

  try {
    if (action === 'verify_address') {
      const { address } = payload;
      const result = await lobRequest('/v1/us_verifications', 'POST', {
        primary_line: address.line1,
        secondary_line: address.line2 || '',
        city: address.city,
        state: address.state,
        zip_code: address.zip,
      }, apiKey);
      return { statusCode: 200, body: JSON.stringify(result.body) };
    }

    if (action === 'send_letter') {
      const { toAddress, fromAddress, remoteUrl, description, metadata, enclosureManifest, attachmentManifest } = payload;
      const letterId = metadata && metadata.letter_id;
      if (!letterId || !remoteUrl || !toAddress || !fromAddress) {
        return { statusCode: 400, body: JSON.stringify({ error: 'letter_id, rendered letter URL, and complete addresses are required' }) };
      }
      let mailpieceUrl;
      try {
        mailpieceUrl = durableMailpieceUrl(remoteUrl, supabaseUrl);
      } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ error: e.message, blocked: true }) };
      }

      // The database—not browser state—is the authoritative preflight check.
      // It prevents both a citation/enclosure block bypass and a second send
      // after a reload, timeout, or a staff member opens the same letter in
      // another tab.
      const letter = await findLetter(letterId, supabaseUrl, serviceKey);
      if (!letter) return { statusCode: 404, body: JSON.stringify({ error: 'Letter not found' }) };
      const isCccDispute = String(letter.phase || '').startsWith('CCC Dispute —');
      if (!isCccDispute) {
        return {
          statusCode: 410,
          body: JSON.stringify({
            error: 'LEGACY MAILING RETIRED — only reviewed CCC dispute letters can be submitted for new First-Class mail. Historical mail records remain available for evidence and archive retrieval.',
            blocked: true,
          }),
        };
      }
      if (letter.mail_service && letter.mail_service !== CURRENT_CCC_MAIL_SERVICE) {
        return {
          statusCode: 422,
          body: JSON.stringify({
            error: 'CURRENT CCC MAIL SERVICE MISMATCH — certified, return-receipt, and unknown services cannot be used for a new CCC send.',
            blocked: true,
          }),
        };
      }
      const storedHtml = String(letter.html || '').trim();
      const declaresDocument = /^<!doctype\s+html/i.test(storedHtml) || /^<html\b/i.test(storedHtml);
      const incompleteDocument = declaresDocument && !/<\/body>\s*<\/html>\s*$/i.test(storedHtml);
      if (!storedHtml || storedHtml === 'GENERATING...' || storedHtml.startsWith('ERROR:') || incompleteDocument) {
        return {
          statusCode: 422,
          body: JSON.stringify({
            error: storedHtml === 'GENERATING...'
              ? 'LETTER GENERATION IS STILL RUNNING — nothing was sent.'
              : 'LETTER GENERATION FAILED — regenerate and review the letter before mailing. Nothing was sent.',
            blocked: true,
          }),
        };
      }
      if (isCccDispute && normalizedAddressKey(fromAddress) !== normalizedAddressKey(CCC_RETURN_ADDRESS)) {
        return {
          statusCode: 422,
          body: JSON.stringify({
            error: 'CCC RETURN ADDRESS IS STALE — reopen the mailer before sending. Nothing was sent.',
            blocked: true,
          }),
        };
      }
      // This state/coverage/recipient gate re-fetches every bound record. It
      // deliberately runs before packet downloads, mail-submission claims,
      // and the first Lob /v1/letters request, so stale browser state can
      // never reach an irreversible external send.
      const cccTrackIssues = await validateCccTrackSnapshotPreflight(
        letter,
        toAddress,
        supabaseUrl,
        serviceKey
      );
      if (cccTrackIssues.length > 0) {
        return {
          statusCode: 422,
          body: JSON.stringify({
            error: 'CCC ACCOUNT STATE CHANGED OR IS INVALID — rebuild the letter from Campaign Studio. Nothing was sent.',
            issues: cccTrackIssues,
            blocked: true,
          }),
        };
      }
      const cccIdentityIssues = await validateCccLetterIdentityPreflight(letter, supabaseUrl, serviceKey);
      if (cccIdentityIssues.length > 0) {
        return {
          statusCode: 422,
          body: JSON.stringify({
            error: 'CCC LETTER IDENTITY OR PROOF DOCUMENTS CHANGED — rebuild the letter from Campaign Studio. Nothing was sent.',
            issues: cccIdentityIssues,
            blocked: true,
          }),
        };
      }
      const cccSensitiveCurlyIssues = await validateCccCraSensitiveAutomaticValuesPreflight(
        letter,
        supabaseUrl,
        serviceKey
      );
      if (cccSensitiveCurlyIssues.length > 0) {
        return {
          statusCode: 422,
          body: JSON.stringify({
            error: 'CCC DATE-OF-BIRTH OR SSN CURLYS CHANGED — rebuild the letter from Campaign Studio. Nothing was sent.',
            issues: cccSensitiveCurlyIssues,
            blocked: true,
          }),
        };
      }
      if (isCccDispute && !(await hasCccServiceAuthorization(letter.client_id, supabaseUrl, serviceKey))) {
        return {
          statusCode: 422,
          body: JSON.stringify({
            error: 'CLIENT SERVICE IS NOT AUTHORIZED YET — wait until the signed agreement becomes service-eligible, or verify the immutable legacy-grandfather record. Nothing was sent.',
            blocked: true,
          }),
        };
      }
      const validatedAttachments = await validateOptionalAttachments(letter, attachmentManifest, supabaseUrl, serviceKey);
      if (letter.enclosure_parse_blocked) {
        return {
          statusCode: 422,
          body: JSON.stringify({
            error: 'ENCLOSURE UNPARSED — MANUAL RECONCILIATION REQUIRED',
            issues: letter.enclosure_parse_issues || [],
            blocked: true,
          }),
        };
      }
      const cccPacketIssues = await validateCccPacketPreflight(
        letter,
        enclosureManifest,
        supabaseUrl,
        serviceKey
      );
      if (cccPacketIssues.length > 0) {
        return {
          statusCode: 422,
          body: JSON.stringify({
            error: 'CCC PACKET EXHIBITS INVALID — nothing was sent.',
            issues: cccPacketIssues,
            blocked: true,
          }),
        };
      }

      // Fail closed on any asset Lob would have to fetch from somewhere we do
      // not control. Only short-lived signed URLs minted for this exact CCC
      // send are acceptable.
      const durableAssetPrefix = String(supabaseUrl).replace(/\/+$/, '') + '/storage/v1/object/sign/documents/';
      const scannedMailpiece = await scanRemoteAssetUrls(mailpieceUrl);
      const remoteAssets = scannedMailpiece.urls;
      let consumerStatementEvidence = null;
      let consumerStatementAudience = null;
      if (String(letter.phase || '').startsWith('CCC Dispute —')) {
        const renderedPacketIssues = await validateCccRenderedMailpiece({
          letter,
          mailpieceUrl,
          scannedMailpiece,
          validatedAttachments,
          supabaseUrl,
          serviceKey,
        });
        if (renderedPacketIssues.length > 0) {
          return {
            statusCode: 422,
            body: JSON.stringify({
              error: 'CCC MAILPIECE DOES NOT MATCH THE REVIEWED LETTER AND EXHIBITS — nothing was sent.',
              issues: renderedPacketIssues,
              blocked: true,
            }),
          };
        }
        const { unresolvedCccMissingTokens } = await import('../../src/utils/cccLetterTrackSnapshots.js');
        const unresolvedTokens = unresolvedCccMissingTokens(scannedMailpiece.html);
        if (unresolvedTokens.length > 0) {
          return {
            statusCode: 422,
            body: JSON.stringify({
              error: 'CCC LETTER STILL CONTAINS UNRESOLVED TEMPLATE FIELDS — nothing was sent.',
              issues: unresolvedTokens.map((token) => `{${token}} is still unresolved in the exact signed mailpiece.`),
              blocked: true,
            }),
          };
        }
        const expectedScreenshotIds = (letter.dispute_screenshot_manifest || []).map((item) => String(item.id || ''));
        if (JSON.stringify(scannedMailpiece.screenshotIds) !== JSON.stringify(expectedScreenshotIds)) {
          return {
            statusCode: 422,
            body: JSON.stringify({
              error: 'CCC SCREENSHOT EXHIBIT PAGES DO NOT MATCH THE SAVED LETTER MANIFEST — nothing was sent.',
              blocked: true,
            }),
          };
        }
        try {
          consumerStatementAudience = cccConsumerStatementAudience(letter);
          consumerStatementEvidence = mailedConsumerStatementEvidence(
            scannedMailpiece.html,
            consumerStatementAudience
          );
        } catch (statementError) {
          return {
            statusCode: 422,
            body: JSON.stringify({
              error: 'CCC CONSUMER STATEMENT INVALID — nothing was sent.',
              issues: [statementError.message],
              blocked: true,
            }),
          };
        }
      }
      const nonDurableAssets = remoteAssets.filter((url) => !url.startsWith(durableAssetPrefix));
      if (nonDurableAssets.length > 0) {
        return {
          statusCode: 422,
          body: JSON.stringify({
            error: 'MAILPIECE CONTAINS NON-DURABLE IMAGE LINKS — Lob would fail to render it. Nothing was sent.',
            issues: nonDurableAssets.slice(0, 10),
            blocked: true,
          }),
        };
      }

      let submission = await findSubmission(letterId, supabaseUrl, serviceKey);
      if (submission && (submission.status === 'submitted' || submission.status === 'accepted_unreconciled') && submission.lob_id) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            id: submission.lob_id,
            tracking_number: submission.tracking_number || letter.tracking_number || null,
            mailed_date: letter.mailed_date || null,
            mail_service: letter.mail_service || null,
            expected_delivery_date: letter.expected_delivery_date || null,
            duplicate: true,
            mail_submission_status: submission.status,
          }),
        };
      }
      if (!submission && (letter.lob_id || letter.mailed_date)) {
        // Historical/manual mail has no durable submission record, but it is
        // still a real send. Never let a UI retry convert it to duplicate
        // postage; staff must create a reviewed revision instead.
        return {
          statusCode: 409,
          body: JSON.stringify({ error: 'This letter is already marked mailed. Create a new reviewed revision before sending again.' }),
        };
      }

      submission = submission || await getOrCreateSubmission(letter, admin.userId, supabaseUrl, serviceKey);
      if (!submission) throw new Error('Could not claim a durable mail submission');
      if ((submission.status === 'submitted' || submission.status === 'accepted_unreconciled') && submission.lob_id) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            id: submission.lob_id,
            tracking_number: submission.tracking_number || letter.tracking_number || null,
            mailed_date: letter.mailed_date || null,
            mail_service: letter.mail_service || null,
            expected_delivery_date: letter.expected_delivery_date || null,
            duplicate: true,
            mail_submission_status: submission.status,
          }),
        };
      }

      if (submission.status === 'failed') {
        submission = await prepareFailedRetry(letter, submission, supabaseUrl, serviceKey);
      }
      if (submission.status === 'cancelled') {
        submission = await prepareCancelledRetry(letter, submission, supabaseUrl, serviceKey);
      }

      // Persist the one supported current service before Lob can emit an
      // asynchronous event. The exact prior-value predicate prevents a stale
      // tab from changing a letter that another send already claimed.
      const servicePrepared = await supabaseRequest(
        '/rest/v1/letters?id=eq.' + encodeURIComponent(letterId)
          + '&lob_id=is.null'
          + (letter.mail_service
            ? '&mail_service=eq.' + encodeURIComponent(letter.mail_service)
            : '&mail_service=is.null'),
        'PATCH', { mail_service: CURRENT_CCC_MAIL_SERVICE }, supabaseUrl, serviceKey
      );
      const servicePreparedRows = Array.isArray(servicePrepared.body) ? servicePrepared.body : [];
      if (!isSuccess(servicePrepared) || servicePreparedRows.length !== 1) {
        return {
          statusCode: 409,
          body: JSON.stringify({
            error: 'The letter mail-service state changed before this send was claimed. Refresh and review it before trying again.',
            blocked: true,
          }),
        };
      }
      letter.mail_service = CURRENT_CCC_MAIL_SERVICE;

      try {
        await captureMailedConsumerStatement(
          letterId,
          consumerStatementEvidence,
          consumerStatementAudience,
          supabaseUrl,
          serviceKey
        );
      } catch (captureError) {
        if (captureError.code !== 'CONSUMER_STATEMENT_CAPTURE_CONFLICT') throw captureError;
        return {
          statusCode: 409,
          body: JSON.stringify({ error: captureError.message, blocked: true }),
        };
      }

      await updateSubmission(letterId, {
        status: 'pending',
        attempt_count: (submission.attempt_count || 0) + 1,
        last_attempt_at: new Date().toISOString(),
        last_error: null,
        attachment_manifest: validatedAttachments,
      }, supabaseUrl, serviceKey);
      await updatePacketCoverage(letter, {
        mail_status: 'processing',
        tracking_status: null,
      }, supabaseUrl, serviceKey);

      const mailService = CURRENT_CCC_MAIL_SERVICE;
      const letterPayload = {
        description: description || 'CCC Dispute Letter',
        to: {
          name: toAddress.name,
          address_line1: toAddress.line1,
          address_line2: toAddress.line2 || '',
          address_city: toAddress.city,
          address_state: toAddress.state,
          address_zip: toAddress.zip,
          address_country: 'US',
        },
        from: {
          name: CCC_RETURN_ADDRESS.name,
          address_line1: CCC_RETURN_ADDRESS.line1,
          address_line2: CCC_RETURN_ADDRESS.line2 || '',
          address_city: CCC_RETURN_ADDRESS.city,
          address_state: CCC_RETURN_ADDRESS.state,
          address_zip: CCC_RETURN_ADDRESS.zip,
          address_country: 'US',
        },
        // For CCC, send the exact bytes this server just re-read and validated
        // instead of asking Lob to fetch a browser-owned URL a second time.
        // This closes the validate-A/print-B race for the irreversible send.
        file: scannedMailpiece.html,
        // Text letters print B&W double-sided — enclosures are grayscaled
        // upstream anyway, and this roughly halves the per-letter cost
        color: false,
        double_sided: true,
        address_placement: 'top_first_page',
        mail_type: 'usps_first_class',
        // Lets the webhook match the letter row even if lob_id never got saved
        metadata: {
          letter_id: String(letterId),
          mail_submission_id: String(submission.id),
          mail_attempt_key: String(submission.idempotency_key),
          mail_service: CURRENT_CCC_MAIL_SERVICE,
        },
      };
      // This key was persisted before the Lob request. A reload or a second
      // tab therefore hits the same Lob idempotency record rather than
      // creating another physical mailpiece.
      const result = await lobRequest('/v1/letters', 'POST', letterPayload, apiKey, {
        'Idempotency-Key': String(submission.idempotency_key),
      });
      if (!isSuccess(result) || !result.body?.id) {
        // Lob explicitly rejected this request and did not return an accepted
        // mailpiece identity. Keep the attempt pending with the same durable
        // idempotency key so staff can safely retry; `failed` is reserved for
        // a signed letter.failed webhook tied to one accepted Lob attempt.
        await updateSubmission(letterId, {
          status: 'pending',
          last_error: requestError(result, 'Lob did not accept the letter'),
        }, supabaseUrl, serviceKey);
        await updatePacketCoverage(letter, { mail_status: 'failed', tracking_status: null }, supabaseUrl, serviceKey);
        return { statusCode: result.status || 502, body: JSON.stringify(result.body || { error: 'Lob did not accept the letter' }) };
      }

      // Persist Lob's acceptance server-side. If the letters row cannot be
      // reconciled after an accepted send, retain the Lob ID in the durable
      // submission and explicitly surface it as a reconciliation task—never
      // present it as a failed send that someone might retry.
      const mailedAt = new Date().toISOString().slice(0, 10);
      const savedLetter = await supabaseRequest(
        '/rest/v1/letters?id=eq.' + encodeURIComponent(letterId) + '&lob_id=is.null',
        'PATCH',
        {
          lob_id: result.body.id,
          mailed_date: mailedAt,
          tracking_number: result.body.tracking_number || null,
          tracking_status: 'Mailed',
          mail_service: mailService,
          expected_delivery_date: result.body.expected_delivery_date || null,
        },
        supabaseUrl,
        serviceKey
      );
      let reconciledLetter = isSuccess(savedLetter) && Array.isArray(savedLetter.body) ? savedLetter.body[0] : null;
      let letterWasSaved = Boolean(reconciledLetter);
      // When two browser tabs race with the same durable Lob key, Lob returns
      // the same accepted mailpiece to both. The losing PATCH sees `lob_id`
      // already populated, which is a successful reconciliation—not a reason
      // to downgrade the submission to `accepted_unreconciled`.
      if (!letterWasSaved) {
        try {
          reconciledLetter = await findLetter(letterId, supabaseUrl, serviceKey);
          letterWasSaved = reconciledLetter?.lob_id === result.body.id;
        } catch (recheckError) {
          console.warn('Could not confirm concurrent letter reconciliation:', letterId, recheckError.message);
        }
      }
      const finalizedSubmission = await finalizeAcceptedSubmission({
        letter,
        submission,
        lobId: result.body.id,
        trackingNumber: result.body.tracking_number || null,
        desiredStatus: letterWasSaved ? 'submitted' : 'accepted_unreconciled',
        desiredError: letterWasSaved ? null : 'Lob accepted the mailpiece, but the letters row requires reconciliation.',
        supabaseUrl,
        serviceKey,
      });
      const terminalAttempt = ['failed', 'cancelled'].includes(finalizedSubmission.status);
      const operationallyMailed = letterWasSaved && !terminalAttempt;
      if (!terminalAttempt) {
        // Do not let this synchronous acceptance response overwrite a newer
        // signed webhook scan. The pre-send transition set coverage tracking
        // to null, so this CAS only fills the initial queued/Mailed state.
        if (letterWasSaved) {
          await markPacketCoverageQueuedIfUntracked(letter, supabaseUrl, serviceKey);
        }
      }
      if (operationallyMailed && validatedAttachments.length) {
        const snapshotRows = validatedAttachments.map((item) => ({
          user_id: letter.user_id,
          letter_id: letter.id,
          document_id: item.document_id,
          mail_submission_id: submission.id,
          storage_path: item.storage_path,
          file_name: item.file_name,
          byte_size: item.byte_size,
          page_count: item.page_count,
          sha256: item.sha256,
          included_by: admin.userId,
        }));
        const snapshotResult = await supabaseRequest('/rest/v1/letter_attachments?on_conflict=user_id,letter_id,document_id,mail_submission_id', 'POST', snapshotRows, supabaseUrl, serviceKey, { Prefer: 'resolution=ignore-duplicates,return=minimal' });
        if (!isSuccess(snapshotResult)) console.error('Could not snapshot optional mail attachments:', requestError(snapshotResult, 'unknown error'));
      }
      // Archive the immutable, Lob-rendered mailpiece while this request still
      // knows the CCC letter id. This is evidence capture, never a condition
      // of mailing: Lob already accepted the mailpiece, so an archive failure
      // must not be reported as a send failure or invite an expensive resend.
      let artifactArchive = null;
      if (result.status >= 200 && result.status < 300 && result.body?.id && letterId) {
        try {
          artifactArchive = await archiveLobArtifact({
            lobId: result.body.id,
            letterId,
            submissionId: finalizedSubmission.id,
            idempotencyKey: finalizedSubmission.idempotency_key,
            artifactType: 'mailpiece_pdf',
            sourceUrl: result.body.url || null,
            apiKey,
            supabaseUrl,
            serviceKey,
          });
          if (!artifactArchive.archived) console.warn('Lob mailpiece not archived yet:', artifactArchive.reason, result.body.id);
        } catch (archiveErr) {
          console.error('Lob mailpiece archive failed (mail was still accepted):', result.body.id, archiveErr.message);
        }
      }
      if (operationallyMailed && letter.round_id) {
        try {
          await queueRoundEvent({ roundId: letter.round_id, eventType: 'round_mailed', requireAllMailed: true });
        } catch (emailError) {
          console.error('Round mailed milestone email failed (mail was still accepted):', emailError.message);
        }
      }
      if (operationallyMailed && letter.campaign_id && isPersonalInfoCleanupLetter(letter)) {
        try {
          await queueCampaignCleanupMailed({ campaignId: letter.campaign_id });
        } catch (emailError) {
          console.error('Cleanup mailed milestone email failed (mail was still accepted):', emailError.message);
        }
      }
      return {
        statusCode: result.status,
        body: JSON.stringify({
          ...(result.body || {}),
          mailed_date: operationallyMailed ? (reconciledLetter?.mailed_date || mailedAt) : null,
          mail_service: mailService,
          artifact_archive: artifactArchive && artifactArchive.archived ? 'archived' : 'pending',
          mail_submission_status: finalizedSubmission.status,
          reconciliation_required: !letterWasSaved && !terminalAttempt,
        }),
      };
    }

    if (action === 'get_tracking') {
      const { letterId } = payload;
      const result = await lobRequest('/v1/letters/' + letterId, 'GET', {}, apiKey);
      return { statusCode: result.status, body: JSON.stringify(result.body) };
    }

    // Historical backfill: a staff member can ask Lob for the exact rendered
    // PDF for an already-mailed letter. The archive helper verifies that the
    // supplied Lob ID belongs to this CCC letter before it downloads anything.
    if (action === 'archive_letter_artifact') {
      const { letterId, lobId } = payload;
      if (!letterId || !lobId) return { statusCode: 400, body: JSON.stringify({ error: 'letterId and lobId required' }) };
      const archived = await archiveLobArtifact({
        lobId,
        letterId,
        artifactType: 'mailpiece_pdf',
        apiKey,
        supabaseUrl: process.env.VITE_SUPABASE_URL,
        serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      });
      return { statusCode: archived.archived ? 200 : 202, body: JSON.stringify(archived) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Lob request failed' }) };
  }
};

// Exported for preflight regression tests; the handler is the only entry point
// used in production.
exports.durableMailpieceUrl = durableMailpieceUrl;
exports.MAIL_ASSET_URL_RE = MAIL_ASSET_URL_RE;
exports.cccCraSensitiveAutomaticValueIssues = cccCraSensitiveAutomaticValueIssues;
exports.requiredCccAutomaticIdentityIssues = requiredCccAutomaticIdentityIssues;
exports.signedStorageObjectIdentity = signedStorageObjectIdentity;
exports.CCC_RETURN_ADDRESS = CCC_RETURN_ADDRESS;
