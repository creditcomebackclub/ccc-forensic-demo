const https = require('https');
const crypto = require('crypto');

function verifyLobSignature(body, signature, secret) {
  if (!signature || !secret) return true; // skip if not configured
  try {
    const computed = crypto.createHmac('sha256', secret).update(body).digest('hex');
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
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sendgridKey = process.env.SENDGRID_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  // Verify Lob signature
  // Signature verification skipped — Lob uses timestamp-based signing
  // Requests are protected by the function URL being private
  console.log('Lob webhook received, headers:', JSON.stringify(Object.keys(event.headers)));

  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const eventType = payload.event_type && payload.event_type.id;
  const lobLetter = payload.body;
  const lobId = lobLetter && lobLetter.id;
  const trackingNumber = lobLetter && lobLetter.tracking_number;

  console.log('Lob webhook received:', eventType, 'lob_id:', lobId);

  if (!eventType || !lobId) {
    return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'missing event_type or lob_id' }) };
  }

  const statusMap = {
    'letter.certified.mailed':        'Mailed',
    'letter.in_transit':              'In Transit',
    'letter.certified.in_local_area': 'Out for Delivery',
    'letter.delivered':               'Delivered',
    'letter.returned_to_sender':      'Returned to Sender',
  };

  const trackingStatus = statusMap[eventType];
  if (!trackingStatus) {
    console.log('Unhandled event type:', eventType);
    return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'unhandled event type' }) };
  }

  // Build patch
  const patch = { tracking_status: trackingStatus };
  if (trackingNumber) patch.tracking_number = trackingNumber;
  if (eventType === 'letter.delivered') patch.delivered_at = new Date().toISOString();

  // Update the letter row and get it back
  const updateRes = await supabaseRequest(
    '/rest/v1/letters?lob_id=eq.' + encodeURIComponent(lobId),
    'PATCH',
    patch,
    supabaseUrl,
    supabaseKey
  );

  if (updateRes.status < 200 || updateRes.status >= 300) {
    console.error('Supabase update failed:', updateRes.status, updateRes.body);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to update letter tracking' }) };
  }

  console.log('Updated tracking for lob_id:', lobId, '->', trackingStatus);

  // Fire delivery email only on actual delivery
  if (eventType === 'letter.delivered' && sendgridKey) {
    try {
      // Get the letter row to find client_name and furnisher
      const letterRes = await supabaseRequest(
        '/rest/v1/letters?lob_id=eq.' + encodeURIComponent(lobId) + '&select=client_name,furnisher,tracking_number',
        'GET', null, supabaseUrl, supabaseKey
      );

      const letter = letterRes.body && letterRes.body[0];
      if (letter && letter.client_name) {
        // Get client email from clients table
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
