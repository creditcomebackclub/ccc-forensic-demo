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

function sendgridEmail(to, subject, html, apiKey) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: 'chris@cccpartners.co', name: 'Credit Comeback Club' },
      subject,
      content: [{ type: 'text/html', value: html }],
    });
    const options = {
      hostname: 'api.sendgrid.com', port: 443,
      path: '/v3/mail/send', method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          console.error(`SendGrid Error (${res.statusCode}): ${raw}`);
        }
        resolve({ status: res.statusCode });
      });
    });
    req.on('error', (e) => {
      console.error('SendGrid Request Error:', e);
      reject(e);
    });
    req.write(data);
    req.end();
  });
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


exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sendgridKey = process.env.SENDGRID_API_KEY;
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
        '/rest/v1/letters?id=eq.' + encodeURIComponent(metaLetterId),
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
  let updateRes = await supabaseRequest(
    '/rest/v1/letters?lob_id=eq.' + encodeURIComponent(lobId),
    'PATCH', patch, supabaseUrl, supabaseKey
  );
  let updatedRows = Array.isArray(updateRes.body) ? updateRes.body : [];

  if (updatedRows.length === 0 && metaLetterId) {
    updateRes = await supabaseRequest(
      '/rest/v1/letters?id=eq.' + encodeURIComponent(metaLetterId),
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

  console.log('Updated tracking for lob_id:', lobId, '->', trackingStatus);

  // Fire delivery email only on actual delivery
  if (isDelivered && sendgridKey) {
    try {
      const letter = updatedRows[0];
      if (letter && letter.client_name) {
        // client_id preferred (present on the updated row since the PATCH
        // above returns the full row) — client_name alone can resolve to
        // the wrong same-named client's email.
        const clientRes = letter.client_id
          ? await supabaseRequest('/rest/v1/clients?id=eq.' + letter.client_id + '&select=email', 'GET', null, supabaseUrl, supabaseKey)
          : await supabaseRequest('/rest/v1/clients?name=eq.' + encodeURIComponent(letter.client_name) + '&select=email', 'GET', null, supabaseUrl, supabaseKey);

        const clientEmail = clientRes.body && clientRes.body[0] && clientRes.body[0].email;
        if (clientEmail) {
          const furnisher = letter.furnisher || 'your creditor';
          const clientName = letter.client_name.split(' ')[0];
          const tn = letter.tracking_number || trackingNumber;

          const subject = 'Dispute Letter Delivered — ' + furnisher + ' Has 30 Days to Respond';
          const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#000;">
            <div style="background:#1B2A4A;padding:24px 32px;border-radius:4px 4px 0 0;">
              <h1 style="color:#C9A84C;margin:0;font-size:20px;">Credit Comeback Club</h1>
              <p style="color:#fff;margin:4px 0 0;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Campaign Update</p>
            </div>
            <div style="border:1px solid #ddd;border-top:none;padding:24px 32px;border-radius:0 0 4px 4px;">
              <p>Hi ${clientName},</p>
              <p>Your dispute letter to <strong>${furnisher}</strong> has been delivered. Their 30-day response window has begun.</p>
              ${tn ? `<p>Track your letter: <a href="https://tools.usps.com/go/TrackConfirmAction?tLabels=${tn}" style="color:#1B2A4A;">USPS Tracking ${tn.slice(-8)}</a></p>` : ''}
              <p>We will monitor for their response and prepare Phase 3 escalation letters in advance.</p>
              <p>Log in to your <a href="https://ccc-forensic-demo.netlify.app" style="color:#1B2A4A;">client portal</a> to see full details and tracking.</p>
              <p>Questions? Reply to this email or call 970-644-0063.</p>
              <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
              <p style="font-size:11px;color:#999;">Credit Comeback Club | Grand Junction, CO | creditcomebackclub.com</p>
            </div>
          </body></html>`;

          const emailRes = await sendgridEmail(clientEmail, subject, html, sendgridKey);
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
