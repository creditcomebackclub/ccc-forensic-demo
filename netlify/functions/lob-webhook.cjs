const https = require('https');
const crypto = require('crypto');

// Lob signs webhooks with HMAC-SHA256 over `${timestamp}.${rawBody}` using the
// webhook's secret; the hex digest arrives in the Lob-Signature header.
function verifyLobSignature(rawBody, timestamp, signature, secret) {
  if (!signature || !timestamp) return false;
  try {
    const computed = crypto.createHmac('sha256', secret).update(timestamp + '.' + rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sendgridKey = process.env.SENDGRID_API_KEY;
  const webhookSecret = process.env.LOB_WEBHOOK_SECRET ? process.env.LOB_WEBHOOK_SECRET.trim() : null;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  // Reject spoofed events — anyone can guess this URL, so the signature is
  // the only thing standing between the internet and our tracking data
  if (!webhookSecret) {
    console.error('LOB_WEBHOOK_SECRET not configured — rejecting all webhook requests');
    return { statusCode: 500, body: JSON.stringify({ error: 'Webhook not configured' }) };
  }

  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  {
    const signature = event.headers['lob-signature'];
    const timestamp = event.headers['lob-signature-timestamp'];
    
    // Debug info computation (only used on failure to help diagnose)
    let debugInfo = {};
    try {
      debugInfo = {
        received_signature: signature,
        computed_hash: crypto.createHmac('sha256', webhookSecret || '').update((timestamp || '') + '.' + (rawBody || '')).digest('hex'),
        timestamp: timestamp,
        isBase64Encoded: event.isBase64Encoded,
        body_prefix: rawBody ? rawBody.substring(0, 50) : null
      };
    } catch(e) {}

    if (!verifyLobSignature(rawBody, timestamp, signature, webhookSecret)) {
      console.warn('Rejected Lob webhook: bad or missing signature');
      // Temporarily write the debug info to Supabase so we can read it, since Lob UI hides it
      if (supabaseUrl && supabaseKey) {
        try {
          await fetch(`${supabaseUrl}/rest/v1/letters`, {
            method: 'POST',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify({
              id: 'webhook-debug',
              client_name: 'Webhook Debug',
              furnisher: 'System',
              saved_at: new Date().toISOString(),
              html: JSON.stringify(debugInfo, null, 2)
            })
          });
        } catch(e) {}
      }
      return { statusCode: 200, body: JSON.stringify({ error: 'Invalid signature', debug: debugInfo }) };
    }
    
    // Note: Lob sends timestamp as milliseconds or seconds?
    // Let's compute age depending on its magnitude. If timestamp is in seconds, it will be ~1.7 billion.
    // If it's in milliseconds, it will be ~1.7 trillion.
    const tsNum = Number(timestamp);
    const tsMs = tsNum < 20000000000 ? tsNum * 1000 : tsNum;
    
    const age = Math.abs(Date.now() - tsMs);
    // 48 hours (172,800,000 ms) is a much safer tolerance for retries.
    if (!Number.isFinite(age) || age > 48 * 60 * 60 * 1000) {
      console.warn('Rejected Lob webhook: stale timestamp', timestamp);
      return { statusCode: 200, body: JSON.stringify({ error: 'Stale timestamp', tsMs, age, dateNow: Date.now() }) };
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
        const clientRes = await supabaseRequest(
          '/rest/v1/clients?name=eq.' + encodeURIComponent(letter.client_name) + '&select=email',
          'GET', null, supabaseUrl, supabaseKey
        );

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
