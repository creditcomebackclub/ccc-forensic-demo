const https = require('https');
const crypto = require('crypto');
const { PDFDocument } = require('pdf-lib');
const { archiveLobArtifact } = require('./_lobArtifacts.cjs');
const { responseEvidencePrefixes } = require('./_storagePaths.cjs');
const { queueCampaignCleanupMailed, queueRoundEvent } = require('./_roundEmail.cjs');

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
      const found = new Set();
      let carry = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        // Keep a tail between chunks so a URL split across the boundary is
        // still seen whole; the Set absorbs the resulting overlap.
        const text = carry + chunk;
        MAIL_ASSET_URL_RE.lastIndex = 0;
        let match;
        while ((match = MAIL_ASSET_URL_RE.exec(text)) !== null) found.add(match[1]);
        carry = text.slice(-2048);
      });
      res.on('end', () => resolve(Array.from(found)));
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
      + '&select=id,user_id,client_id,client_account_id,client_name,phase,round_id,round_number,letter_kind,target_type,target_bureau,html,covered_furnishers,lob_id,mailed_date,tracking_number,tracking_status,enclosure_parse_blocked,enclosure_parse_issues,source_phase3_letter_id,source_bureau_response_evidence_id,campaign_id,campaign_route_id,packet_version,dispute_basis',
    'GET', null, supabaseUrl, serviceKey
  );
  if (!isSuccess(result)) throw new Error(requestError(result, 'Could not load letter before mailing'));
  return Array.isArray(result.body) ? result.body[0] : null;
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
  const result = await supabaseRequest('/rest/v1/documents?id=in.(' + ids.map(encodeURIComponent).join(',') + ')&select=id,user_id,client_id,file_name,storage_path', 'GET', null, supabaseUrl, serviceKey);
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
    validated.push({ document_id: doc.id, file_name: doc.file_name, storage_path: doc.storage_path, byte_size: bytes.byteLength, page_count: pageCount, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
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

async function findSubmission(letterId, supabaseUrl, serviceKey) {
  const result = await supabaseRequest(
    '/rest/v1/mail_submissions?letter_id=eq.' + encodeURIComponent(letterId)
      + '&select=id,letter_id,idempotency_key,status,lob_id,tracking_number,attempt_count,last_error',
    'GET', null, supabaseUrl, serviceKey
  );
  if (!isSuccess(result)) throw new Error(requestError(result, 'Could not load mail submission'));
  return Array.isArray(result.body) ? result.body[0] : null;
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

// A retry is permitted only after the signed Lob webhook has recorded a
// rendering failure. It deliberately rotates the durable idempotency key and
// clears only the operational fields; the original failed Lob ID remains in
// lob_webhook_events as the immutable audit record.
async function prepareFailedRetry(letter, submission, supabaseUrl, serviceKey) {
  if (submission.status !== 'failed' || letter.tracking_status !== 'Failed') {
    throw new Error('This mailpiece is not a confirmed failed Lob send and cannot be retried.');
  }
  if (letter.lob_id) {
    const cleared = await supabaseRequest(
      '/rest/v1/letters?id=eq.' + encodeURIComponent(letter.id)
        + '&lob_id=eq.' + encodeURIComponent(letter.lob_id)
        + '&tracking_status=eq.Failed',
      'PATCH',
      { lob_id: null, mailed_date: null, tracking_number: null, tracking_status: 'Failed', delivered_at: null },
      supabaseUrl, serviceKey
    );
    if (!isSuccess(cleared) || !Array.isArray(cleared.body) || cleared.body.length !== 1) {
      throw new Error('The failed mailpiece changed before it could be retried. Refresh the letter and try again.');
    }
  }
  const reset = await supabaseRequest(
    '/rest/v1/mail_submissions?letter_id=eq.' + encodeURIComponent(letter.id) + '&status=eq.failed',
    'PATCH',
    {
      idempotency_key: crypto.randomUUID(), status: 'pending', lob_id: null,
      tracking_number: null, submitted_at: null, last_error: null,
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
  if (submission.status !== 'cancelled' || letter.tracking_status !== 'Cancelled') {
    throw new Error('This mailpiece is not a confirmed canceled Lob send and cannot be re-mailed.');
  }
  if (letter.lob_id) {
    const cleared = await supabaseRequest(
      '/rest/v1/letters?id=eq.' + encodeURIComponent(letter.id)
        + '&lob_id=eq.' + encodeURIComponent(letter.lob_id)
        + '&tracking_status=eq.Cancelled',
      'PATCH',
      { lob_id: null, mailed_date: null, tracking_number: null, tracking_status: 'Cancelled', delivered_at: null },
      supabaseUrl, serviceKey
    );
    if (!isSuccess(cleared) || !Array.isArray(cleared.body) || cleared.body.length !== 1) {
      throw new Error('The canceled mailpiece changed before it could be re-mailed. Refresh the letter and try again.');
    }
  }
  const reset = await supabaseRequest(
    '/rest/v1/mail_submissions?letter_id=eq.' + encodeURIComponent(letter.id) + '&status=eq.cancelled',
    'PATCH',
    {
      idempotency_key: crypto.randomUUID(), status: 'pending', lob_id: null,
      tracking_number: null, submitted_at: null, last_error: null,
      updated_at: new Date().toISOString(),
    },
    supabaseUrl, serviceKey
  );
  if (!isSuccess(reset) || !Array.isArray(reset.body) || reset.body.length !== 1) {
    throw new Error('Could not prepare a fresh safe send for this canceled mailpiece.');
  }
  return reset.body[0];
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
      const storedHtml = String(letter.html || '').trim();
      const declaresDocument = /^<!doctype\s+html/i.test(storedHtml) || /^<html\b/i.test(storedHtml);
      const incompleteDocument = declaresDocument && !/<\/body>\s*<\/html>\s*$/i.test(storedHtml);
      const missingCampaignClosingSections = !!letter.campaign_route_id && !['signature-block', 'mail-notation', 'enclosures']
        .every((className) => new RegExp(`class=["'][^"']*${className}[^"']*["']`, 'i').test(storedHtml));
      if (!storedHtml || storedHtml === 'GENERATING...' || storedHtml.startsWith('ERROR:') || incompleteDocument || missingCampaignClosingSections) {
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
      const { letterSignatureState } = await import('../../src/utils/letterGeneration.js');
      const signatureState = letterSignatureState(storedHtml);
      if (signatureState !== 'embedded') {
        const signatureError = signatureState === 'missing'
          ? 'CLIENT SIGNATURE REQUIRED — wait for the signed LPOA/signature capture, then regenerate or repair the draft. Nothing was sent.'
          : signatureState === 'remote'
            ? 'CLIENT SIGNATURE LINK IS NOT DURABLE — embed the canonical signature before mailing. Nothing was sent.'
            : 'CLIENT SIGNATURE IS INVALID — rebuild it from the canonical stored signature before mailing. Nothing was sent.';
        return {
          statusCode: 422,
          body: JSON.stringify({ error: signatureError, blocked: true, signature_state: signatureState }),
        };
      }
      if (Number(letter.packet_version || 1) === 2) await validatePacketPreflight(letter, toAddress, supabaseUrl, serviceKey);
      else await validateStructuredRoundPreflight(letter, supabaseUrl, serviceKey);
      await validatePersonalInfoCleanupPreflight(letter, supabaseUrl, serviceKey);
      const validatedAttachments = await validateOptionalAttachments(letter, attachmentManifest, supabaseUrl, serviceKey);
      if (isBureauAccountDisputeLetter(letter)) {
        const {
          autoFixFieldCitations,
          collectBureauFollowUpProblems,
          collectPhase3CitationProblems,
          normalizeFollowUpPresentation,
        } = await import('../../src/constants/metro2Fields.js');
        let html = letter.html || '';
        html = autoFixFieldCitations(html).html;
        if (isBureauFollowUp(letter)) html = normalizeFollowUpPresentation(html);
        const currentProblems = isBureauFollowUp(letter)
          ? collectBureauFollowUpProblems(html)
          : collectPhase3CitationProblems(html);
        if (currentProblems.length > 0) {
          return {
            statusCode: 422,
            body: JSON.stringify({
              error: 'PHASE 3 CONTENT FAILED CURRENT PRODUCTION-SAFETY RULES — nothing was sent.',
              issues: currentProblems,
              blocked: true,
            }),
          };
        }
        // If mechanical autofix changed the stored letter, persist and ask the
        // staffer to reopen the mailer so Lob's remoteUrl is rebuilt from the
        // corrected HTML. Allowing this send would print the unfixed upload.
        if (html !== (letter.html || '')) {
          await supabaseRequest(
            '/rest/v1/letters?id=eq.' + encodeURIComponent(letterId),
            'PATCH',
            { html },
            supabaseUrl,
            serviceKey
          );
          return {
            statusCode: 409,
            body: JSON.stringify({
              error: 'Letter HTML was auto-corrected for Metro 2 citations. Re-open the mailer and send again so the printed packet uses the fixed text.',
              corrected: true,
              blocked: true,
            }),
          };
        }
      }
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
      // A bureau-facing Phase 3 packet must identify the exact furnishers it
      // covers. Never use a client-wide fallback here: it can attach unrelated
      // Phase 1 disputes and responses to the wrong bureau reinvestigation.
      if (isBureauAccountDisputeLetter(letter)
        && (!Array.isArray(letter.covered_furnishers) || letter.covered_furnishers.length === 0)) {
        return {
          statusCode: 422,
          body: JSON.stringify({ error: 'PHASE 3 COVERAGE MISSING — assign the specific furnisher(s) this bureau letter covers before mailing.', blocked: true }),
        };
      }
      const followUpIssues = await validateBureauFollowUpPreflight(
        letter,
        enclosureManifest,
        supabaseUrl,
        serviceKey
      );
      if (followUpIssues.length > 0) {
        return {
          statusCode: 422,
          body: JSON.stringify({
            error: 'BUREAU FOLLOW-UP ENCLOSURES INVALID — nothing was sent.',
            issues: followUpIssues,
            blocked: true,
          }),
        };
      }

      // Fail closed on any asset Lob would have to fetch from somewhere we do
      // not control. Retired public client-docs URLs inside legacy LPOA
      // enclosures failed whole mailpieces this way; only short-lived signed
      // URLs we minted for this send are acceptable.
      const durableAssetPrefix = String(supabaseUrl).replace(/\/+$/, '') + '/storage/v1/object/sign/documents/';
      const remoteAssets = await scanRemoteAssetUrls(mailpieceUrl);
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
          name: fromAddress.name,
          address_line1: fromAddress.line1,
          address_line2: fromAddress.line2 || '',
          address_city: fromAddress.city,
          address_state: fromAddress.state,
          address_zip: fromAddress.zip,
          address_country: 'US',
        },
        file: mailpieceUrl,
        // Text letters print B&W double-sided — enclosures are grayscaled
        // upstream anyway, and this roughly halves the per-letter cost
        color: false,
        double_sided: true,
        address_placement: 'top_first_page',
        mail_type: 'usps_first_class',
        // Letters state "return receipt requested" — the mailing must match
        extra_service: 'certified_return_receipt',
        // Lets the webhook match the letter row even if lob_id never got saved
        metadata: { letter_id: String(letterId) },
      };
      // This key was persisted before the Lob request. A reload or a second
      // tab therefore hits the same Lob idempotency record rather than
      // creating another physical mailpiece.
      const result = await lobRequest('/v1/letters', 'POST', letterPayload, apiKey, {
        'Idempotency-Key': String(submission.idempotency_key),
      });
      if (!isSuccess(result) || !result.body?.id) {
        await updateSubmission(letterId, {
          status: 'failed',
          last_error: requestError(result, 'Lob did not accept the letter'),
        }, supabaseUrl, serviceKey);
        await updatePacketCoverage(letter, { mail_status: 'failed', tracking_status: 'Failed' }, supabaseUrl, serviceKey);
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
        },
        supabaseUrl,
        serviceKey
      );
      let letterWasSaved = isSuccess(savedLetter) && Array.isArray(savedLetter.body) && savedLetter.body.length > 0;
      // When two browser tabs race with the same durable Lob key, Lob returns
      // the same accepted mailpiece to both. The losing PATCH sees `lob_id`
      // already populated, which is a successful reconciliation—not a reason
      // to downgrade the submission to `accepted_unreconciled`.
      if (!letterWasSaved) {
        try {
          const reconciledLetter = await findLetter(letterId, supabaseUrl, serviceKey);
          letterWasSaved = reconciledLetter?.lob_id === result.body.id;
        } catch (recheckError) {
          console.warn('Could not confirm concurrent letter reconciliation:', letterId, recheckError.message);
        }
      }
      await updateSubmission(letterId, {
        status: letterWasSaved ? 'submitted' : 'accepted_unreconciled',
        lob_id: result.body.id,
        tracking_number: result.body.tracking_number || null,
        submitted_at: new Date().toISOString(),
        last_error: letterWasSaved ? null : 'Lob accepted the mailpiece, but the letters row requires reconciliation.',
      }, supabaseUrl, serviceKey);
      await updatePacketCoverage(letter, {
        mail_status: letterWasSaved ? 'queued' : 'processing',
        tracking_status: 'Mailed',
      }, supabaseUrl, serviceKey);
      if (letterWasSaved && validatedAttachments.length) {
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
      if (letterWasSaved && letter.round_id) {
        try {
          await queueRoundEvent({ roundId: letter.round_id, eventType: 'round_mailed', requireAllMailed: true });
        } catch (emailError) {
          console.error('Round mailed milestone email failed (mail was still accepted):', emailError.message);
        }
      }
      if (letterWasSaved && letter.campaign_id && isPersonalInfoCleanupLetter(letter)) {
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
          mailed_date: mailedAt,
          artifact_archive: artifactArchive && artifactArchive.archived ? 'archived' : 'pending',
          mail_submission_status: letterWasSaved ? 'submitted' : 'accepted_unreconciled',
          reconciliation_required: !letterWasSaved,
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
