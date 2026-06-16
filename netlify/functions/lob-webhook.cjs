const crypto = require('crypto');
const https = require('https');

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
        'Prefer': 'return=minimal',
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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const secret = process.env.LOB_WEBHOOK_SECRET;
  if (secret) {
    const signature = event.headers['lob-signature'] || event.headers['x-lob-signature'];
    if (signature) {
      const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(event.body)
        .digest('hex');
      if (signature !== expectedSig) {
        console.error('Lob webhook signature mismatch');
        return { statusCode: 401, body: JSON.stringify({ error: 'Invalid signature' }) };
      }
    }
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase env vars');
    return { statusCode: 500, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const eventType = payload.event_type && payload.event_type.id;
  const lobLetter = payload.body;
  const lobId = lobLetter && lobLetter.id;

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

  const patch = { tracking_status: trackingStatus };
  if (eventType === 'letter.delivered') {
    patch.delivered_at = new Date().toISOString();
  }

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
  return { statusCode: 200, body: JSON.stringify({ received: true, lobId, trackingStatus }) };
};
