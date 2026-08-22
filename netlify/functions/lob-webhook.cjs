const https = require('https');
const crypto = require('crypto');
const { archiveLobArtifact } = require('./_lobArtifacts.cjs');

// Lob's ONE documented signing scheme (help.lob.com/print-and-mail/getting-
// data-and-results/using-webhooks): HMAC-SHA256, keyed with the webhook's
// secret exactly as shown in the Lob dashboard (plain string, no decoding),
// over the input string `${Lob-Signature-Timestamp}.${raw JSON body}`,
// hex-encoded, compared against the Lob-Signature header. No hex-decoded
// secret, no whsec_ prefix, no CR-stripped body — those were speculative
// variants from an earlier debugging attempt and are gone; matching more
// than one candidate format is itself a weaker check than matching exactly
// the one Lob documents.
//
// timingSafeEqual throws if the two buffers differ in length (rather than
// returning false), so a bad/short/malformed header must never reach it
// directly — hence the length check before comparing.
function verifyLobSignature(rawBody, timestamp, signature, secret) {
  if (!signature || !timestamp) return false;
  try {
    const expected = crypto.createHmac('sha256', secret).update(timestamp + '.' + (rawBody || '')).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const signatureBuffer = Buffer.from(signature, 'hex');
    if (expectedBuffer.length !== signatureBuffer.length) return false;
    return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  } catch (e) {
    return false;
  }
}

function eventFingerprint(rawBody) {
  return crypto.createHash('sha256').update(rawBody || '').digest('hex');
}

function supabaseRequest(path, method, body, url, key) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(url + path);
    const options = {
      hostname: u.hostname, port: 443, path: u.pathname + u.search, method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': 'Bearer ' + key,
        'Prefer': 'return=representation',
      },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function sendMailQuiet(to, subject, html) {
  const { sendEmail } = require('./_email.cjs');
  return sendEmail({ to, subject, html })
    .then(() => ({ status: 200 }))
    .catch((e) => {
      console.error('Resend Error:', e.message || e);
      return { status: 500 };
    });
}

async function updatePacketCoverage(letterIds, patch, supabaseUrl, serviceKey) {
  const ids = [...new Set((letterIds || []).filter(Boolean))];
  if (!ids.length) return;
  const result = await supabaseRequest(
    '/rest/v1/letter_account_coverage?letter_id=in.(' + ids.map(encodeURIComponent).join(',') + ')',
    'PATCH', { ...patch, updated_at: new Date().toISOString() }, supabaseUrl, serviceKey
  );
  if (result.status < 200 || result.status >= 300) console.error('Could not propagate Lob status to packet coverage:', ids, result.status);
}

// Certified letters fire `letter.certified.*` event ids; plain letters fire
// `letter.*`. Handle both so tracking never silently stalls.
const statusMap = {
  'letter.mailed': 'Mailed',
  'letter.certified.mailed': 'Mailed',
  'letter.in_transit': 'In Transit',
  'letter.certified.in_transit': 'In Transit',
  'letter.re-routed': 'In Transit',
  'letter.certified.re-routed': 'In Transit',
  'letter.in_local_area': 'Out for Delivery',
  'letter.certified.in_local_area': 'Out for Delivery',
  'letter.processed_for_delivery': 'Out for Delivery',
  'letter.certified.processed_for_delivery': 'Out for Delivery',
  'letter.certified.pickup_available': 'Available for Pickup',
  'letter.delivered': 'Delivered',
  'letter.certified.delivered': 'Delivered',
  'letter.returned_to_sender': 'Returned to Sender',
  'letter.certified.returned_to_sender': 'Returned to Sender',
};

// Kept as a defensive compatibility path for older/event-preview payloads.
// Lob's current live webhook catalog does not list a distinct electronic
// return-receipt event; get-return-receipt.cjs archives a receipt on demand.
const RETURN_RECEIPT_EVENTS = new Set([
  'letter.certified.return_receipt',
  'letter.return_receipt',
]);

// The creation response usually lets lob.cjs archive the PDF immediately.
// This event is the safe fallback when Lob finishes rendering later or an
// earlier archive attempt was interrupted. Webhook bodies can redact URLs,
// so _lobArtifacts retrieves the authoritative letter record with Lob's API.
const RENDERED_PDF_EVENTS = new Set(['letter.rendered_pdf']);
const FAILED_EVENTS = new Set(['letter.failed', 'letter.certified.failed']);
const DELETED_EVENTS = new Set(['letter.deleted']);
const USPS_FIRST_CLASS = 'usps_first_class';
const USPS_CERTIFIED_RETURN_RECEIPT = 'usps_first_class_certified_return_receipt';
const TERMINAL_TRACKING_STATUSES = new Set(['Delivered', 'Returned to Sender', 'Failed', 'Cancelled']);
const ACTIVE_SUBMISSION_STATUSES = new Set(['pending', 'submitted', 'accepted_unreconciled']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function exactFilter(column, value) {
  return value == null
    ? `&${column}=is.null`
    : `&${column}=eq.${encodeURIComponent(String(value))}`;
}

function expectedServiceForEvent(eventType) {
  if (RETURN_RECEIPT_EVENTS.has(eventType) || String(eventType).startsWith('letter.certified.')) {
    return USPS_CERTIFIED_RETURN_RECEIPT;
  }
  if (eventType === 'letter.deleted') return null;
  return USPS_FIRST_CLASS;
}

function trackingRank(status) {
  if (status == null || status === '') return 0;
  if (status === 'Mailed') return 1;
  if (status === 'In Transit' || status === 'Mailpiece Scan Received') return 2;
  if (status === 'Out for Delivery' || status === 'Available for Pickup') return 3;
  if (status === 'Delivered' || status === 'Returned to Sender') return 4;
  return null;
}

function isMonotonicTrackingTransition(currentStatus, nextStatus) {
  if (TERMINAL_TRACKING_STATUSES.has(currentStatus)) return false;
  if (TERMINAL_TRACKING_STATUSES.has(nextStatus)) return true;
  const currentRank = trackingRank(currentStatus);
  const nextRank = trackingRank(nextStatus);
  return currentRank != null && nextRank != null && nextRank > currentRank;
}

function resolutionError(message, code = 'MAIL_ATTEMPT_UNRESOLVED') {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function resolveCurrentMailAttempt({
  lobId,
  metaLetterId,
  metaSubmissionId,
  metaAttemptKey,
  metaMailService,
  eventType,
  supabaseUrl,
  serviceKey,
}) {
  const submissionResult = await supabaseRequest(
    '/rest/v1/mail_submissions?lob_id=eq.' + encodeURIComponent(lobId)
      + '&select=id,letter_id,user_id,client_id,idempotency_key,status,lob_id&limit=2',
    'GET', null, supabaseUrl, serviceKey
  );
  if (submissionResult.status < 200 || submissionResult.status >= 300) {
    throw resolutionError('Could not resolve the Lob submission attempt.');
  }
  let submissions = Array.isArray(submissionResult.body) ? submissionResult.body : [];
  if (submissions.length > 1) throw resolutionError('The Lob ID maps to multiple mail submissions.', 'AMBIGUOUS_MAIL_ATTEMPT');

  let matchedViaMetadata = false;
  if (submissions.length === 0) {
    if (!metaLetterId || !UUID_RE.test(String(metaSubmissionId || '')) || !metaAttemptKey) {
      throw resolutionError('No exact current mail submission matches this Lob event.');
    }
    const fallbackResult = await supabaseRequest(
      '/rest/v1/mail_submissions?id=eq.' + encodeURIComponent(metaSubmissionId)
        + '&letter_id=eq.' + encodeURIComponent(metaLetterId)
        + '&idempotency_key=eq.' + encodeURIComponent(metaAttemptKey)
        + '&lob_id=is.null&status=in.(pending,submitted,accepted_unreconciled)'
        + '&select=id,letter_id,user_id,client_id,idempotency_key,status,lob_id&limit=2',
      'GET', null, supabaseUrl, serviceKey
    );
    if (fallbackResult.status < 200 || fallbackResult.status >= 300) {
      throw resolutionError('Could not resolve the metadata-bound Lob submission attempt.');
    }
    submissions = Array.isArray(fallbackResult.body) ? fallbackResult.body : [];
    if (submissions.length !== 1) {
      throw resolutionError(
        submissions.length > 1
          ? 'The Lob metadata maps to multiple mail submissions.'
          : 'No exact current mail submission matches the Lob metadata.',
        submissions.length > 1 ? 'AMBIGUOUS_MAIL_ATTEMPT' : 'MAIL_ATTEMPT_UNRESOLVED'
      );
    }
    matchedViaMetadata = true;
  }

  const submission = submissions[0];
  if (metaLetterId && String(metaLetterId) !== String(submission.letter_id)) {
    throw resolutionError('The Lob letter metadata does not match the current submission attempt.', 'MAIL_ATTEMPT_MISMATCH');
  }
  if (metaSubmissionId && String(metaSubmissionId) !== String(submission.id)) {
    throw resolutionError('The Lob submission metadata does not match the current attempt.', 'MAIL_ATTEMPT_MISMATCH');
  }
  if (metaAttemptKey && String(metaAttemptKey) !== String(submission.idempotency_key)) {
    throw resolutionError('The Lob attempt metadata is stale.', 'MAIL_ATTEMPT_MISMATCH');
  }
  if (submission.lob_id && String(submission.lob_id) !== String(lobId)) {
    throw resolutionError('The mail submission belongs to a different Lob attempt.', 'MAIL_ATTEMPT_MISMATCH');
  }

  const letterResult = await supabaseRequest(
    '/rest/v1/letters?id=eq.' + encodeURIComponent(submission.letter_id) + '&limit=2',
    'GET', null, supabaseUrl, serviceKey
  );
  if (letterResult.status < 200 || letterResult.status >= 300) {
    throw resolutionError('Could not resolve the letter for this Lob attempt.');
  }
  const letters = Array.isArray(letterResult.body) ? letterResult.body : [];
  if (letters.length !== 1) {
    throw resolutionError(
      letters.length > 1 ? 'The submission maps to multiple letters.' : 'The submission letter no longer exists.',
      letters.length > 1 ? 'AMBIGUOUS_MAIL_ATTEMPT' : 'MAIL_ATTEMPT_UNRESOLVED'
    );
  }
  const letter = letters[0];
  if (String(letter.user_id || '') !== String(submission.user_id || '')
      || String(letter.client_id || '') !== String(submission.client_id || '')) {
    throw resolutionError('The letter and submission ownership do not match.', 'MAIL_ATTEMPT_MISMATCH');
  }
  if (letter.lob_id && String(letter.lob_id) !== String(lobId)) {
    throw resolutionError('The letter is bound to a different Lob attempt.', 'MAIL_ATTEMPT_MISMATCH');
  }
  const requiredService = expectedServiceForEvent(eventType);
  const storedService = String(letter.mail_service || '');
  if (![USPS_FIRST_CLASS, USPS_CERTIFIED_RETURN_RECEIPT].includes(storedService)) {
    throw resolutionError('The letter does not have an exact supported mail-service identity.', 'MAIL_SERVICE_MISMATCH');
  }
  if (requiredService && storedService !== requiredService) {
    throw resolutionError('The Lob event type does not match the letter mail service.', 'MAIL_SERVICE_MISMATCH');
  }
  if (metaMailService && String(metaMailService) !== storedService) {
    throw resolutionError('The Lob mail-service metadata does not match the letter.', 'MAIL_SERVICE_MISMATCH');
  }

  return { letter, submission, matchedViaMetadata, mailService: storedService };
}

function letterAttemptCasPath(resolved) {
  return '/rest/v1/letters?id=eq.' + encodeURIComponent(resolved.letter.id)
    + exactFilter('lob_id', resolved.letter.lob_id)
    + '&mail_service=eq.' + encodeURIComponent(resolved.mailService)
    + exactFilter('tracking_status', resolved.letter.tracking_status);
}

function submissionAttemptCasPath(resolved) {
  return '/rest/v1/mail_submissions?id=eq.' + encodeURIComponent(resolved.submission.id)
    + '&letter_id=eq.' + encodeURIComponent(resolved.letter.id)
    + '&idempotency_key=eq.' + encodeURIComponent(resolved.submission.idempotency_key)
    + exactFilter('lob_id', resolved.submission.lob_id)
    + '&status=eq.' + encodeURIComponent(resolved.submission.status);
}

async function bindResolvedSubmissionLobId(resolved, lobId, supabaseUrl, serviceKey) {
  if (resolved.submission.lob_id === lobId) return true;
  const result = await supabaseRequest(
    submissionAttemptCasPath(resolved),
    'PATCH', { lob_id: lobId, updated_at: new Date().toISOString() }, supabaseUrl, serviceKey
  );
  if (result.status < 200 || result.status >= 300) return false;
  const rows = Array.isArray(result.body) ? result.body : [];
  if (rows.length !== 1) return false;
  resolved.submission = rows[0];
  return true;
}


exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { isConfigured } = require('./_email.cjs');
  const mailReady = isConfigured();
  // Lob issues a distinct signing secret PER WEBHOOK, and Test/Live are
  // fully separate webhooks in their dashboard — so a Test-mode event is
  // signed with a different secret than a Live one. LOB_WEBHOOK_SECRET can
  // hold either one secret, or both comma-separated ("live_secret,
  // test_secret") — no separate env var, by design, so real in-flight
  // client mail (LOB_MODE=live) never silently loses tracking just because
  // LOB_WEBHOOK_SECRET was pointed at the Test secret for a sandbox check.
  // Confirmed live 2026-07-26: a freshly-created Test webhook 401'd against
  // the single Live secret this used to check exclusively.
  const webhookSecrets = (process.env.LOB_WEBHOOK_SECRET || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  // Reject spoofed events — anyone can guess this URL, so the signature is
  // the only thing standing between the internet and our tracking data
  if (webhookSecrets.length === 0) {
    console.error('No LOB_WEBHOOK_SECRET configured — rejecting all webhook requests');
    return { statusCode: 500, body: JSON.stringify({ error: 'Webhook not configured' }) };
  }

  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  {
    const signature = event.headers['lob-signature'];
    const timestamp = event.headers['lob-signature-timestamp'];

    if (!webhookSecrets.some((secret) => verifyLobSignature(rawBody, timestamp, signature, secret))) {
      // Diagnostic detail goes to the function log (Netlify dashboard →
      // Functions → lob-webhook), never in the HTTP response — the response
      // body is public to anyone who can reach this URL, so it must never
      // echo back the secret, the computed digest, or anything derived from
      // the secret. Logging the expected digest's first few hex chars (not
      // the full digest) is enough to tell "wrong secret" apart from "right
      // secret, body/timestamp mismatch" without exposing a crackable amount
      // of the HMAC output. Previewing against the first configured secret
      // only — good enough as a diagnostic, doesn't need every candidate.
      let expectedPreview = 'n/a';
      try { expectedPreview = crypto.createHmac('sha256', webhookSecrets[0]).update((timestamp || '') + '.' + (rawBody || '')).digest('hex').slice(0, 8) + '…'; } catch (e) { /* leave as n/a */ }
      console.error('Rejected Lob webhook: signature mismatch', {
        has_signature_header: !!signature,
        has_timestamp_header: !!timestamp,
        signature_len: signature ? signature.length : 0,
        expected_prefix: expectedPreview,
        received_prefix: signature ? signature.slice(0, 8) + '…' : null,
        raw_body_len: rawBody ? rawBody.length : 0,
        isBase64Encoded: event.isBase64Encoded,
      });
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid signature' }) };
    }

    // Lob sends the timestamp in seconds; ~1.7 billion vs. ~1.7 trillion
    // tells seconds and milliseconds apart if that ever changes.
    const tsNum = Number(timestamp);
    const tsMs = tsNum < 20000000000 ? tsNum * 1000 : tsNum;

    const age = Math.abs(Date.now() - tsMs);
    // Lob's own docs recommend a 5-minute tolerance for replay protection;
    // 10 minutes leaves headroom for normal delivery/clock-drift delay
    // without reopening a multi-hour replay window (the previous 48-hour
    // tolerance effectively provided none).
    if (!Number.isFinite(age) || age > 10 * 60 * 1000) {
      console.warn('Rejected Lob webhook: stale timestamp', { timestamp, age_ms: age });
      return { statusCode: 401, body: JSON.stringify({ error: 'Stale timestamp' }) };
    }
  }

  let payload;
  try { payload = JSON.parse(rawBody); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const eventType = payload.event_type && payload.event_type.id;
  const lobLetter = payload.body;
  const lobId = lobLetter && lobLetter.id;
  const trackingNumber = lobLetter && lobLetter.tracking_number;
  const metaLetterId = lobLetter && lobLetter.metadata && lobLetter.metadata.letter_id;
  const metaSubmissionId = lobLetter && lobLetter.metadata && lobLetter.metadata.mail_submission_id;
  const metaAttemptKey = lobLetter && lobLetter.metadata && lobLetter.metadata.mail_attempt_key;
  const metaMailService = lobLetter && lobLetter.metadata && lobLetter.metadata.mail_service;

  console.log('Lob webhook received:', eventType, 'lob_id:', lobId, 'letter_id:', metaLetterId || '—');

  if (!eventType || !lobId) {
    return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'missing event_type or lob_id' }) };
  }

  // Keep a compact audit ledger for Lob retries and out-of-order events. The
  // signed raw body itself is deliberately never persisted because it can
  // contain client data. This table is additive: if its migration has not
  // reached an environment yet, tracking still continues and the function
  // reports the missing ledger only in server logs.
  try {
    const eventResult = await supabaseRequest(
      '/rest/v1/lob_webhook_events?on_conflict=event_key',
      'POST',
      {
        event_key: eventFingerprint(rawBody),
        event_type: eventType,
        lob_id: lobId,
        letter_id: metaLetterId || null,
        event_occurred_at: payload.date_created || null,
      },
      supabaseUrl,
      supabaseKey
    );
    if (eventResult.status < 200 || eventResult.status >= 300) {
      console.warn('Could not record Lob webhook event:', eventResult.status);
    }
  } catch (eventLogError) {
    console.warn('Could not record Lob webhook event:', eventLogError.message);
  }

  const mode = process.env.LOB_MODE || 'test';
  const lobApiKey = mode === 'live' ? process.env.LOB_LIVE_KEY : process.env.LOB_TEST_KEY;

  if (RENDERED_PDF_EVENTS.has(eventType)) {
    if (!lobApiKey) {
      console.error('Cannot archive rendered Lob PDF: active Lob API key is not configured');
      return { statusCode: 500, body: JSON.stringify({ error: 'Lob API key not configured' }) };
    }
    try {
      const resolved = await resolveCurrentMailAttempt({
        lobId, metaLetterId, metaSubmissionId, metaAttemptKey, metaMailService,
        eventType, supabaseUrl, serviceKey: supabaseKey,
      });
      if (!ACTIVE_SUBMISSION_STATUSES.has(resolved.submission.status)) {
        return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'rendered artifact attempt is terminal' }) };
      }
      if (!(await bindResolvedSubmissionLobId(resolved, lobId, supabaseUrl, supabaseKey))) {
        throw new Error('Rendered artifact submission changed during exact-attempt binding');
      }
      const archived = await archiveLobArtifact({
        lobId,
        letterId: resolved.letter.id,
        submissionId: resolved.submission.id,
        idempotencyKey: resolved.submission.idempotency_key,
        artifactType: 'mailpiece_pdf',
        apiKey: lobApiKey,
        supabaseUrl,
        serviceKey: supabaseKey,
      });
      return { statusCode: 200, body: JSON.stringify({ received: true, lobId, event: eventType, artifact: archived.archived ? 'archived' : archived.reason }) };
    } catch (e) {
      // Return a retryable status. An eventually-rendered PDF should not be
      // silently lost just because the first storage attempt was transient.
      console.error('Could not archive rendered Lob PDF for', lobId, e.message);
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not archive rendered PDF' }) };
    }
  }

  // ── Return-receipt: USPS signed green-card scan is now available ─────────
  if (RETURN_RECEIPT_EVENTS.has(eventType)) {
    const receiptUrl = lobLetter && (lobLetter.return_receipt_url || (lobLetter.thumbnails && lobLetter.thumbnails[0] && lobLetter.thumbnails[0].large));
    if (!receiptUrl) {
      console.warn('return_receipt event received but no URL found in payload for lob_id', lobId);
      return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'no receipt url in payload' }) };
    }
    let parsedReceiptUrl;
    try { parsedReceiptUrl = new URL(receiptUrl); }
    catch { parsedReceiptUrl = null; }
    if (!parsedReceiptUrl || parsedReceiptUrl.protocol !== 'https:') {
      console.error('Rejected invalid Lob return-receipt URL for', lobId);
      return { statusCode: 500, body: JSON.stringify({ error: 'Invalid return-receipt evidence URL' }) };
    }

    let resolved;
    try {
      resolved = await resolveCurrentMailAttempt({
        lobId, metaLetterId, metaSubmissionId, metaAttemptKey, metaMailService,
        eventType, supabaseUrl, serviceKey: supabaseKey,
      });
    } catch (error) {
      console.error('Could not resolve exact return-receipt attempt:', lobId, error.code, error.message);
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not resolve exact return-receipt attempt' }) };
    }
    if (!ACTIVE_SUBMISSION_STATUSES.has(resolved.submission.status)
        || resolved.letter.tracking_status !== 'Delivered') {
      console.warn('Ignored return receipt for a non-delivered or terminal attempt:', lobId);
      return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'return receipt state mismatch' }) };
    }
    if (!(await bindResolvedSubmissionLobId(resolved, lobId, supabaseUrl, supabaseKey))) {
      console.error('Return-receipt submission changed during CAS:', lobId);
      return { statusCode: 500, body: JSON.stringify({ error: 'Return-receipt attempt changed during processing' }) };
    }
    if (resolved.letter.return_receipt_url) {
      const sameReceipt = resolved.letter.return_receipt_url === receiptUrl;
      return {
        statusCode: sameReceipt ? 200 : 500,
        body: JSON.stringify(sameReceipt
          ? { received: true, lobId, event: 'return_receipt', saved: true, duplicate: true }
          : { error: 'Return-receipt evidence changed for an immutable mail attempt' }),
      };
    }
    const rcptRes = await supabaseRequest(
      letterAttemptCasPath(resolved) + '&return_receipt_url=is.null',
      'PATCH', {
        return_receipt_url: receiptUrl,
        ...(resolved.letter.lob_id ? {} : { lob_id: lobId }),
      }, supabaseUrl, supabaseKey
    );
    const receiptRows = Array.isArray(rcptRes.body) ? rcptRes.body : [];
    if (rcptRes.status < 200 || rcptRes.status >= 300 || receiptRows.length !== 1) {
      console.error('Return-receipt letter changed during CAS:', lobId, rcptRes.status, receiptRows.length);
      return { statusCode: 500, body: JSON.stringify({ error: 'Return-receipt letter changed during processing' }) };
    }

    console.log('Saved immutable return receipt for Lob attempt:', lobId);
    if (lobApiKey) {
      try {
        const archived = await archiveLobArtifact({
          lobId,
          letterId: resolved.letter.id,
          submissionId: resolved.submission.id,
          idempotencyKey: resolved.submission.idempotency_key,
          artifactType: 'return_receipt',
          sourceUrl: receiptUrl,
          apiKey: lobApiKey,
          supabaseUrl,
          serviceKey: supabaseKey,
        });
        if (!archived.archived) console.warn('Return receipt not archived yet:', lobId, archived.reason);
      } catch (e) {
        // Do not reject a valid USPS event just because a separate evidence
        // copy is temporarily unavailable. Lob will not replay a 2xx event.
        console.error('Could not archive return receipt for', lobId, e.message);
      }
    }
    return { statusCode: 200, body: JSON.stringify({ received: true, lobId, event: 'return_receipt', saved: true }) };
  }
  // ─────────────────────────────────────────────────────────────────────────

  // A creation response only means Lob accepted the job; rendering can still
  // fail before anything reaches USPS. Mark that submission retryable and
  // clear the operational mail fields. The failed Lob ID remains preserved in
  // the webhook ledger, so a future retry cannot erase the audit trail.
  if (FAILED_EVENTS.has(eventType)) {
    const failureMessage = lobLetter?.failure_reason || lobLetter?.error || 'Lob failed to render this mailpiece before mailing.';
    let resolved;
    try {
      resolved = await resolveCurrentMailAttempt({
        lobId, metaLetterId, metaSubmissionId, metaAttemptKey, metaMailService,
        eventType, supabaseUrl, serviceKey: supabaseKey,
      });
    } catch (error) {
      console.error('Could not resolve exact failed Lob attempt:', lobId, error.code, error.message);
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not resolve exact failed Lob attempt' }) };
    }
    if (resolved.letter.tracking_status === 'Failed') {
      if (resolved.submission.status === 'failed') {
        return { statusCode: 200, body: JSON.stringify({ received: true, lobId, trackingStatus: 'Failed', duplicate: true }) };
      }
      if (!ACTIVE_SUBMISSION_STATUSES.has(resolved.submission.status)) {
        return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'failure submission is already terminal' }) };
      }
      const reconciledSubmission = await supabaseRequest(
        submissionAttemptCasPath(resolved),
        'PATCH', {
          status: 'failed', lob_id: lobId,
          last_error: String(failureMessage).slice(0, 1000),
          updated_at: new Date().toISOString(),
        }, supabaseUrl, supabaseKey
      );
      const reconciledRows = Array.isArray(reconciledSubmission.body) ? reconciledSubmission.body : [];
      if (reconciledSubmission.status < 200 || reconciledSubmission.status >= 300 || reconciledRows.length !== 1) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Could not reconcile failed Lob submission' }) };
      }
      await updatePacketCoverage([resolved.letter.id], { mail_status: 'failed', tracking_status: 'Failed', delivered_at: null }, supabaseUrl, supabaseKey);
      return { statusCode: 200, body: JSON.stringify({ received: true, lobId, trackingStatus: 'Failed', reconciled: true }) };
    }
    if (!ACTIVE_SUBMISSION_STATUSES.has(resolved.submission.status)
        || TERMINAL_TRACKING_STATUSES.has(resolved.letter.tracking_status)
        || ![null, undefined, '', 'Mailed'].includes(resolved.letter.tracking_status)) {
      console.warn('Ignored late failure for progressed or terminal Lob attempt:', lobId);
      return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'failure state is no longer eligible' }) };
    }
    const failedLetter = await supabaseRequest(
      letterAttemptCasPath(resolved),
      'PATCH', {
        tracking_status: 'Failed',
        mailed_date: null,
        tracking_number: null,
        delivered_at: null,
        expected_delivery_date: null,
        ...(resolved.letter.lob_id ? {} : { lob_id: lobId }),
      }, supabaseUrl, supabaseKey
    );
    const failedLetterRows = Array.isArray(failedLetter.body) ? failedLetter.body : [];
    if (failedLetter.status < 200 || failedLetter.status >= 300 || failedLetterRows.length !== 1) {
      console.error('Failed Lob letter changed during CAS:', lobId, failedLetter.status, failedLetterRows.length);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed Lob letter changed during processing' }) };
    }
    const failedSubmission = await supabaseRequest(
      submissionAttemptCasPath(resolved),
      'PATCH', {
        status: 'failed',
        lob_id: lobId,
        last_error: String(failureMessage).slice(0, 1000),
        updated_at: new Date().toISOString(),
      }, supabaseUrl, supabaseKey
    );
    const failedSubmissionRows = Array.isArray(failedSubmission.body) ? failedSubmission.body : [];
    if (failedSubmission.status < 200 || failedSubmission.status >= 300 || failedSubmissionRows.length !== 1) {
      console.error('Failed Lob submission changed during CAS:', lobId, failedSubmission.status, failedSubmissionRows.length);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed Lob submission changed during processing' }) };
    }
    await updatePacketCoverage(
      failedLetterRows.map((letter) => letter.id),
      { mail_status: 'failed', tracking_status: 'Failed', delivered_at: null },
      supabaseUrl, supabaseKey
    );
    console.warn('Lob mailpiece failed before mailing:', lobId, failureMessage);
    return { statusCode: 200, body: JSON.stringify({ received: true, lobId, trackingStatus: 'Failed', retryable: true }) };
  }

  // Lob emits `letter.deleted` when a mailpiece is successfully canceled
  // before production. A cancellation is not a completed mailing: clear the
  // operational dates/tracking data while retaining lob_id and the signed
  // webhook ledger as the immutable record of the abandoned attempt.
  if (DELETED_EVENTS.has(eventType)) {
    let resolved;
    try {
      resolved = await resolveCurrentMailAttempt({
        lobId, metaLetterId, metaSubmissionId, metaAttemptKey, metaMailService,
        eventType, supabaseUrl, serviceKey: supabaseKey,
      });
    } catch (error) {
      console.error('Could not resolve exact cancelled Lob attempt:', lobId, error.code, error.message);
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not resolve exact cancelled Lob attempt' }) };
    }
    if (resolved.letter.tracking_status === 'Cancelled') {
      if (resolved.submission.status === 'cancelled') {
        return { statusCode: 200, body: JSON.stringify({ received: true, lobId, trackingStatus: 'Cancelled', duplicate: true }) };
      }
      if (!ACTIVE_SUBMISSION_STATUSES.has(resolved.submission.status)) {
        return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'cancellation submission is already terminal' }) };
      }
      const reconciledSubmission = await supabaseRequest(
        submissionAttemptCasPath(resolved),
        'PATCH', {
          status: 'cancelled', lob_id: lobId,
          last_error: 'Cancelled in Lob before production.',
          updated_at: new Date().toISOString(),
        }, supabaseUrl, supabaseKey
      );
      const reconciledRows = Array.isArray(reconciledSubmission.body) ? reconciledSubmission.body : [];
      if (reconciledSubmission.status < 200 || reconciledSubmission.status >= 300 || reconciledRows.length !== 1) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Could not reconcile cancelled Lob submission' }) };
      }
      await updatePacketCoverage([resolved.letter.id], { mail_status: 'cancelled', tracking_status: 'Cancelled', delivered_at: null }, supabaseUrl, supabaseKey);
      return { statusCode: 200, body: JSON.stringify({ received: true, lobId, trackingStatus: 'Cancelled', reconciled: true }) };
    }
    if (!ACTIVE_SUBMISSION_STATUSES.has(resolved.submission.status)
        || TERMINAL_TRACKING_STATUSES.has(resolved.letter.tracking_status)
        || ![null, undefined, '', 'Mailed'].includes(resolved.letter.tracking_status)) {
      console.warn('Ignored late cancellation for progressed or terminal Lob attempt:', lobId);
      return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'cancellation state is no longer eligible' }) };
    }
    const cancelledPatch = {
      tracking_status: 'Cancelled',
      mailed_date: null,
      tracking_number: null,
      delivered_at: null,
      expected_delivery_date: null,
      ...(resolved.letter.lob_id ? {} : { lob_id: lobId }),
    };
    const cancelledLetter = await supabaseRequest(
      letterAttemptCasPath(resolved),
      'PATCH', cancelledPatch, supabaseUrl, supabaseKey
    );
    const cancelledLetterRows = Array.isArray(cancelledLetter.body) ? cancelledLetter.body : [];
    if (cancelledLetter.status < 200 || cancelledLetter.status >= 300 || cancelledLetterRows.length !== 1) {
      console.error('Cancelled Lob letter changed during CAS:', lobId, cancelledLetter.status, cancelledLetterRows.length);
      return { statusCode: 500, body: JSON.stringify({ error: 'Cancelled Lob letter changed during processing' }) };
    }
    const cancelledSubmission = await supabaseRequest(
      submissionAttemptCasPath(resolved),
      'PATCH', {
        status: 'cancelled',
        lob_id: lobId,
        last_error: 'Cancelled in Lob before production.',
        updated_at: new Date().toISOString(),
      },
      supabaseUrl, supabaseKey
    );
    const cancelledSubmissionRows = Array.isArray(cancelledSubmission.body) ? cancelledSubmission.body : [];
    if (cancelledSubmission.status < 200 || cancelledSubmission.status >= 300 || cancelledSubmissionRows.length !== 1) {
      console.error('Cancelled Lob submission changed during CAS:', lobId, cancelledSubmission.status, cancelledSubmissionRows.length);
      return { statusCode: 500, body: JSON.stringify({ error: 'Cancelled Lob submission changed during processing' }) };
    }
    await updatePacketCoverage(
      cancelledLetterRows.map((letter) => letter.id),
      { mail_status: 'cancelled', tracking_status: 'Cancelled', delivered_at: null },
      supabaseUrl, supabaseKey
    );
    console.log('Lob mailpiece canceled before production:', lobId);
    return { statusCode: 200, body: JSON.stringify({ received: true, lobId, trackingStatus: 'Cancelled', retryable: true }) };
  }

  const trackingStatus = statusMap[eventType];
  if (!trackingStatus) {
    console.log('Unhandled event type:', eventType);
    return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'unhandled event type' }) };
  }

  const isDeliveryEvent = trackingStatus === 'Delivered';

  // First-Class Lob scans are operational hints, not evidence of delivery.
  // Every event must resolve through one exact durable submission attempt and
  // its exact letter before any state is changed. Metadata fallback is valid
  // only while it carries the current submission id + rotated idempotency key.
  let resolved;
  try {
    resolved = await resolveCurrentMailAttempt({
      lobId, metaLetterId, metaSubmissionId, metaAttemptKey, metaMailService,
      eventType, supabaseUrl, serviceKey: supabaseKey,
    });
  } catch (error) {
    console.error('Could not resolve exact Lob tracking attempt:', lobId, error.code, error.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not resolve exact Lob tracking attempt' }) };
  }
  if (!ACTIVE_SUBMISSION_STATUSES.has(resolved.submission.status)) {
    console.warn('Ignored tracking event for terminal submission attempt:', lobId, resolved.submission.status);
    return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'terminal submission state' }) };
  }

  const candidate = resolved.letter;
  // Only the historical certified service is delivery evidence. Plain
  // First-Class and rows with an absent/unknown service stay on the
  // expected-delivery review clock even when Lob reports a scan as delivered.
  const isTrackedCertified = candidate.mail_service === 'usps_first_class_certified_return_receipt';
  const isUntrackedMail = !isTrackedCertified;
  const hasDeliveryProof = isDeliveryEvent && isTrackedCertified;
  if (TERMINAL_TRACKING_STATUSES.has(candidate.tracking_status)) {
    console.log('Mailpiece status is terminal; ignored late Lob event:', lobId, candidate.tracking_status);
    return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'terminal mailpiece state' }) };
  }
  const effectiveTrackingStatus = isUntrackedMail
    ? trackingStatus === 'Mailed'
      ? 'Mailed'
      : trackingStatus === 'Returned to Sender'
        ? 'Returned to Sender'
        : 'Mailpiece Scan Received'
    : trackingStatus;
  if (!isMonotonicTrackingTransition(candidate.tracking_status, effectiveTrackingStatus)) {
    console.log('Ignored duplicate or regressive Lob tracking event:', lobId, candidate.tracking_status, '->', effectiveTrackingStatus);
    return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'duplicate or regressive tracking event' }) };
  }
  if (!(await bindResolvedSubmissionLobId(resolved, lobId, supabaseUrl, supabaseKey))) {
    console.error('Tracking submission changed during CAS:', lobId);
    return { statusCode: 500, body: JSON.stringify({ error: 'Tracking submission changed during processing' }) };
  }
  const patch = {
    tracking_status: effectiveTrackingStatus,
    ...(trackingNumber ? { tracking_number: trackingNumber } : {}),
    ...(hasDeliveryProof ? { delivered_at: payload.date_created || new Date().toISOString() } : {}),
    ...(candidate.lob_id ? {} : { lob_id: lobId }),
  };

  // Match by lob_id first; fall back to our own letter id from metadata
  // (covers letters where saving lob_id failed after sending) and heal lob_id
  // Delivery is a one-way transition. Conditional writes make duplicate
  // `delivered` webhooks harmless and keep a late in-transit event from
  // overwriting a confirmed delivery. The client notification is sent only
  // by the request that wins this transition.
  // A confirmed cancellation is terminal for that Lob ID. The id filter
  // below is also constrained to rows without a Lob ID so a late event from
  // an abandoned attempt can never overwrite a newer explicit re-mail.
  const updateRes = await supabaseRequest(
    letterAttemptCasPath(resolved),
    'PATCH', patch, supabaseUrl, supabaseKey
  );
  let updatedRows = Array.isArray(updateRes.body) ? updateRes.body : [];
  if (!candidate.lob_id && updatedRows.length > 0) console.log('Healed metadata-bound letter Lob id:', lobId);

  if (updateRes.status < 200 || updateRes.status >= 300) {
    console.error('Supabase update failed:', updateRes.status, updateRes.body);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to update letter tracking' }) };
  }
  if (updatedRows.length === 0) {
    console.log('Mailpiece state changed during tracking CAS:', lobId, effectiveTrackingStatus);
    return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'tracking state changed concurrently' }) };
  }
  if (updatedRows.length !== 1) {
    console.error('Mailpiece update did not affect exactly one letter:', lobId, updatedRows.length);
    return { statusCode: 500, body: JSON.stringify({ error: 'Ambiguous mailpiece update' }) };
  }

  const coverageMailStatus = isUntrackedMail
    ? effectiveTrackingStatus === 'Returned to Sender' ? 'returned' : 'mailed'
    : hasDeliveryProof ? 'delivered'
    : effectiveTrackingStatus === 'Returned to Sender' ? 'returned'
      : effectiveTrackingStatus === 'Mailed' ? 'queued' : 'in_transit';
  await updatePacketCoverage(updatedRows.map((letter) => letter.id), {
    mail_status: coverageMailStatus,
    tracking_status: effectiveTrackingStatus,
    ...(hasDeliveryProof ? { delivered_at: updatedRows[0].delivered_at } : {}),
  }, supabaseUrl, supabaseKey);

  // Delivery starts the canonical 30-day clock for new adaptive rounds. The
  // stored due date is authoritative and may later receive one documented +15.
  if (hasDeliveryProof && updatedRows[0]?.target_type && !updatedRows[0]?.response_due_at) {
    const dueAt = new Date(new Date(updatedRows[0].delivered_at).getTime() + 30 * 86400000).toISOString();
    const dueResult = await supabaseRequest(
      '/rest/v1/letters?id=eq.' + encodeURIComponent(updatedRows[0].id) + '&response_due_at=is.null',
      'PATCH', { response_due_at: dueAt }, supabaseUrl, supabaseKey
    );
    if (dueResult.status >= 200 && dueResult.status < 300) updatedRows[0].response_due_at = dueAt;
  }

  console.log('Updated tracking for lob_id:', lobId, '->', effectiveTrackingStatus);

  // Fire delivery email only on actual delivery
  if (hasDeliveryProof && mailReady) {
    try {
      const letter = updatedRows[0];
      if (letter && letter.client_name) {
        // client_id preferred (present on the updated row since the PATCH
        // above returns the full row) — client_name alone can resolve to
        // the wrong same-named client's email.
        const clientRes = letter.client_id
          ? await supabaseRequest('/rest/v1/clients?id=eq.' + letter.client_id + '&select=email', 'GET', null, supabaseUrl, supabaseKey)
          : await supabaseRequest('/rest/v1/clients?name=eq.' + encodeURIComponent(letter.client_name) + '&user_id=eq.' + encodeURIComponent(letter.user_id || '') + '&select=email', 'GET', null, supabaseUrl, supabaseKey);

        const clientEmail = clientRes.body && clientRes.body[0] && clientRes.body[0].email;
        if (clientEmail) {
          const furnisher = letter.furnisher || 'your creditor';
          const clientName = letter.client_name.split(' ')[0];
          const tn = letter.tracking_number || trackingNumber;
          const isBureauDispute = letter.target_type === 'bureau' || String(letter.phase || '').startsWith('Phase 3');
          const isCccDispute = String(letter.phase || '').startsWith('CCC Dispute —');
          const reviewDays = isCccDispute ? 30 : letter.target_type ? 30 : (isBureauDispute ? 45 : 30);

          const subject = isCccDispute
            ? 'CCC Letter Delivery Scan — ' + furnisher
            : 'Dispute Letter Delivered — ' + furnisher + ' Has ' + reviewDays + ' Days to Respond';
          const { wrapClientEmail, escapeHtml, BRAND } = require('./_email.cjs');
          const html = wrapClientEmail({
            eyebrow: 'Campaign Update',
            bodyHtml: `<p style="margin:0 0 14px;">Hi ${escapeHtml(clientName)},</p>`
              + `<p style="margin:0 0 14px;">${isCccDispute
                ? `Lob received a USPS delivery scan for your First Class CCC dispute letter to <strong>${escapeHtml(furnisher)}</strong>. CCC's ${reviewDays}-day operational round review is now underway.`
                : `Your dispute letter to <strong>${escapeHtml(furnisher)}</strong> has been delivered. Its ${reviewDays}-day review window has begun.`}</p>`
              + (tn && !isCccDispute
                ? `<p style="margin:0 0 14px;">Track your letter: <a href="https://tools.usps.com/go/TrackConfirmAction?tLabels=${escapeHtml(tn)}" style="color:#1B2A4A;">USPS Tracking ${escapeHtml(String(tn).slice(-8))}</a></p>`
                : '')
              + `<p style="margin:0 0 14px;">${isCccDispute
                ? 'We will record the documented result and determine the next saved CCC round for any account that remains.'
                : 'We will monitor the response window and review any result before deciding the next step.'}</p>`
              + `<p style="margin:0;">Questions? Reply to this email or call ${BRAND.phone}.</p>`,
            cta: { href: BRAND.portalUrl, label: 'View in your portal →' },
          });

          const emailRes = await sendMailQuiet(clientEmail, subject, html);
          console.log('Delivery email sent to', clientEmail, '- status:', emailRes.status);
        } else {
          console.log('No client email found for', letter.client_name);
        }
      }
    } catch (e) {
      console.error('Email send failed (non-fatal):', e.message);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true, lobId, trackingStatus: effectiveTrackingStatus }) };
};

// Pure transition helpers are exported only for focused regression tests.
exports.expectedServiceForEvent = expectedServiceForEvent;
exports.isMonotonicTrackingTransition = isMonotonicTrackingTransition;
exports.trackingRank = trackingRank;
