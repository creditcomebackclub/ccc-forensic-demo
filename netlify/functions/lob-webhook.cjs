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
      const archived = await archiveLobArtifact({
        lobId,
        letterId: metaLetterId || null,
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
    // The scan URL lives at body.return_receipt_url in Lob's payload
    const receiptUrl = lobLetter && (lobLetter.return_receipt_url || (lobLetter.thumbnails && lobLetter.thumbnails[0] && lobLetter.thumbnails[0].large));
    if (!receiptUrl) {
      console.warn('return_receipt event received but no URL found in payload for lob_id', lobId);
      return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'no receipt url in payload' }) };
    }

    // Save to the letters row — match by lob_id, fall back to metadata letter_id
    let rcptRes = await supabaseRequest(
      '/rest/v1/letters?lob_id=eq.' + encodeURIComponent(lobId),
      'PATCH', { return_receipt_url: receiptUrl }, supabaseUrl, supabaseKey
    );
    if (Array.isArray(rcptRes.body) && rcptRes.body.length === 0 && metaLetterId) {
      rcptRes = await supabaseRequest(
        '/rest/v1/letters?id=eq.' + encodeURIComponent(metaLetterId) + '&lob_id=is.null',
        'PATCH', { return_receipt_url: receiptUrl, lob_id: lobId }, supabaseUrl, supabaseKey
      );
    }

    console.log('Saved return_receipt_url for lob_id:', lobId, '→', receiptUrl.slice(0, 60) + '…');
    if (lobApiKey) {
      try {
        const archived = await archiveLobArtifact({
          lobId,
          letterId: metaLetterId || null,
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
    let failedLetter = await supabaseRequest(
      '/rest/v1/letters?lob_id=eq.' + encodeURIComponent(lobId),
      'PATCH',
      { tracking_status: 'Failed', mailed_date: null, tracking_number: null, delivered_at: null },
      supabaseUrl, supabaseKey
    );
    if (Array.isArray(failedLetter.body) && failedLetter.body.length === 0 && metaLetterId) {
      failedLetter = await supabaseRequest(
        '/rest/v1/letters?id=eq.' + encodeURIComponent(metaLetterId) + '&lob_id=is.null',
        'PATCH',
        { tracking_status: 'Failed', mailed_date: null, tracking_number: null, delivered_at: null },
        supabaseUrl, supabaseKey
      );
    }
    await updatePacketCoverage(
      (Array.isArray(failedLetter.body) ? failedLetter.body : []).map((letter) => letter.id).concat(metaLetterId || []),
      { mail_status: 'failed', tracking_status: 'Failed', delivered_at: null },
      supabaseUrl, supabaseKey
    );
    const failedSubmission = await supabaseRequest(
      '/rest/v1/mail_submissions?lob_id=eq.' + encodeURIComponent(lobId),
      'PATCH',
      { status: 'failed', last_error: String(failureMessage).slice(0, 1000) },
      supabaseUrl, supabaseKey
    );
    if (failedLetter.status < 200 || failedLetter.status >= 300 || failedSubmission.status < 200 || failedSubmission.status >= 300) {
      console.error('Could not record Lob mail failure:', lobId, failedLetter.status, failedSubmission.status);
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not record failed Lob mailpiece' }) };
    }
    console.warn('Lob mailpiece failed before mailing:', lobId, failureMessage);
    return { statusCode: 200, body: JSON.stringify({ received: true, lobId, trackingStatus: 'Failed', retryable: true }) };
  }

  // Lob emits `letter.deleted` when a mailpiece is successfully canceled
  // before production. A cancellation is not a completed mailing: clear the
  // operational dates/tracking data while retaining lob_id and the signed
  // webhook ledger as the immutable record of the abandoned attempt.
  if (DELETED_EVENTS.has(eventType)) {
    const cancelledPatch = {
      tracking_status: 'Cancelled',
      mailed_date: null,
      tracking_number: null,
      delivered_at: null,
    };
    let cancelledLetter = await supabaseRequest(
      '/rest/v1/letters?lob_id=eq.' + encodeURIComponent(lobId),
      'PATCH', cancelledPatch, supabaseUrl, supabaseKey
    );
    if (Array.isArray(cancelledLetter.body) && cancelledLetter.body.length === 0 && metaLetterId) {
      cancelledLetter = await supabaseRequest(
        '/rest/v1/letters?id=eq.' + encodeURIComponent(metaLetterId) + '&lob_id=is.null',
        'PATCH', { ...cancelledPatch, lob_id: lobId }, supabaseUrl, supabaseKey
      );
    }
    await updatePacketCoverage(
      (Array.isArray(cancelledLetter.body) ? cancelledLetter.body : []).map((letter) => letter.id).concat(metaLetterId || []),
      { mail_status: 'cancelled', tracking_status: 'Cancelled', delivered_at: null },
      supabaseUrl, supabaseKey
    );
    const cancelledSubmission = await supabaseRequest(
      '/rest/v1/mail_submissions?lob_id=eq.' + encodeURIComponent(lobId),
      'PATCH', { status: 'cancelled', last_error: 'Cancelled in Lob before production.' },
      supabaseUrl, supabaseKey
    );
    if (cancelledLetter.status < 200 || cancelledLetter.status >= 300
      || cancelledSubmission.status < 200 || cancelledSubmission.status >= 300) {
      console.error('Could not record Lob mail cancellation:', lobId, cancelledLetter.status, cancelledSubmission.status);
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not record canceled Lob mailpiece' }) };
    }
    console.log('Lob mailpiece canceled before production:', lobId);
    return { statusCode: 200, body: JSON.stringify({ received: true, lobId, trackingStatus: 'Cancelled', retryable: true }) };
  }

  const trackingStatus = statusMap[eventType];
  if (!trackingStatus) {
    console.log('Unhandled event type:', eventType);
    return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'unhandled event type' }) };
  }

  const isDelivered = trackingStatus === 'Delivered';

  // Build patch — delivered_at uses Lob's event time, not webhook arrival time
  const patch = { tracking_status: trackingStatus };
  if (trackingNumber) patch.tracking_number = trackingNumber;
  if (isDelivered) patch.delivered_at = payload.date_created || new Date().toISOString();

  // Match by lob_id first; fall back to our own letter id from metadata
  // (covers letters where saving lob_id failed after sending) and heal lob_id
  // Delivery is a one-way transition. Conditional writes make duplicate
  // `delivered` webhooks harmless and keep a late in-transit event from
  // overwriting a confirmed delivery. The client notification is sent only
  // by the request that wins this transition.
  // A confirmed cancellation is terminal for that Lob ID. The id filter
  // below is also constrained to rows without a Lob ID so a late event from
  // an abandoned attempt can never overwrite a newer explicit re-mail.
  const unresolvedFilter = '&delivered_at=is.null&or=(tracking_status.is.null,tracking_status.neq.Cancelled)';
  let updateRes = await supabaseRequest(
    '/rest/v1/letters?lob_id=eq.' + encodeURIComponent(lobId) + unresolvedFilter,
    'PATCH', patch, supabaseUrl, supabaseKey
  );
  let updatedRows = Array.isArray(updateRes.body) ? updateRes.body : [];

  if (updatedRows.length === 0 && metaLetterId) {
    updateRes = await supabaseRequest(
      '/rest/v1/letters?id=eq.' + encodeURIComponent(metaLetterId) + '&lob_id=is.null' + unresolvedFilter,
      'PATCH', { ...patch, lob_id: lobId }, supabaseUrl, supabaseKey
    );
    updatedRows = Array.isArray(updateRes.body) ? updateRes.body : [];
    if (updatedRows.length > 0) console.log('Matched letter via metadata letter_id, healed lob_id:', lobId);
  }

  if (updateRes.status < 200 || updateRes.status >= 300) {
    console.error('Supabase update failed:', updateRes.status, updateRes.body);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to update letter tracking' }) };
  }
  if (updatedRows.length === 0) {
    console.warn('No letter row matched lob_id', lobId, 'or letter_id', metaLetterId);
    return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'no matching letter row' }) };
  }

  const coverageMailStatus = isDelivered ? 'delivered'
    : trackingStatus === 'Returned to Sender' ? 'returned'
      : trackingStatus === 'Mailed' ? 'queued' : 'in_transit';
  await updatePacketCoverage(updatedRows.map((letter) => letter.id), {
    mail_status: coverageMailStatus,
    tracking_status: trackingStatus,
    ...(isDelivered ? { delivered_at: patch.delivered_at } : {}),
  }, supabaseUrl, supabaseKey);

  // Delivery starts the canonical 30-day clock for new adaptive rounds. The
  // stored due date is authoritative and may later receive one documented +15.
  if (isDelivered && updatedRows[0]?.target_type && !updatedRows[0]?.response_due_at) {
    const dueAt = new Date(new Date(patch.delivered_at).getTime() + 30 * 86400000).toISOString();
    const dueResult = await supabaseRequest(
      '/rest/v1/letters?id=eq.' + encodeURIComponent(updatedRows[0].id) + '&response_due_at=is.null',
      'PATCH', { response_due_at: dueAt }, supabaseUrl, supabaseKey
    );
    if (dueResult.status >= 200 && dueResult.status < 300) updatedRows[0].response_due_at = dueAt;
  }

  console.log('Updated tracking for lob_id:', lobId, '->', trackingStatus);

  // Fire delivery email only on actual delivery
  if (isDelivered && mailReady) {
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
          const reviewDays = letter.target_type ? 30 : (isBureauDispute ? 45 : 30);

          const subject = 'Dispute Letter Delivered — ' + furnisher + ' Has ' + reviewDays + ' Days to Respond';
          const { wrapClientEmail, escapeHtml, BRAND } = require('./_email.cjs');
          const html = wrapClientEmail({
            eyebrow: 'Campaign Update',
            bodyHtml: `<p style="margin:0 0 14px;">Hi ${escapeHtml(clientName)},</p>`
              + `<p style="margin:0 0 14px;">Your dispute letter to <strong>${escapeHtml(furnisher)}</strong> has been delivered. Its ${reviewDays}-day review window has begun.</p>`
              + (tn
                ? `<p style="margin:0 0 14px;">Track your letter: <a href="https://tools.usps.com/go/TrackConfirmAction?tLabels=${escapeHtml(tn)}" style="color:#1B2A4A;">USPS Tracking ${escapeHtml(String(tn).slice(-8))}</a></p>`
                : '')
              + `<p style="margin:0 0 14px;">We will monitor the response window and review any result before deciding the next step.</p>`
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

  return { statusCode: 200, body: JSON.stringify({ received: true, lobId, trackingStatus }) };
};
