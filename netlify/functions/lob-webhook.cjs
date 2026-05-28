const crypto = require('crypto');
const https = require('https');

function verifySignature(payload, signature, secret) {
  const computed = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(signature, 'hex'));
  } catch (e) { return false; }
}

function supabaseRequest(path, method, body, supabaseUrl, supabaseKey) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const url = new URL(supabaseUrl + path);
    const options = {
      hostname: url.hostname, port: 443,
      path: url.pathname + url.search, method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': 'Bearer ' + supabaseKey,
        'Prefer': 'return=minimal',
      },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
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

const TRACKING_STATUS_MAP = {
  'letter.certified_mailed': 'Mailed — In Transit',
  'letter.in_transit': 'In Transit',
  'letter.in_local_area': 'Out for Delivery',
  'letter.delivered': 'Delivered',
  'letter.returned_to_sender': 'Returned to Sender',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const webhookSecret = process.env.LOB_WEBHOOK_SECRET;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!webhookSecret || !supabaseUrl || !supabaseKey) {
    console.error('Missing environment variables');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  const signature = event.headers['lob-signature'] || event.headers['x-lob-signature'] || '';
  if (signature) {
    const isValid = verifySignature(event.body, signature, webhookSecret);
    if (!isValid) {
      console.error('Invalid webhook signature');
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid signature' }) };
    }
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const eventType = payload.event_type?.id || payload.event_type || '';
  const lobObject = payload.body || {};
  const lobId = lobObject.id || '';
  const trackingNumber = lobObject.tracking_number || '';

  console.log('Lob webhook:', eventType, 'letter:', lobId);

  if (!lobId) {
    return { statusCode: 200, body: JSON.stringify({ received: true, action: 'no_letter_id' }) };
  }

  const trackingStatus = TRACKING_STATUS_MAP[eventType] || eventType;
  const patch = { tracking_status: trackingStatus };

  if (eventType === 'letter.certified_mailed') {
    patch.mailed_date = new Date().toISOString().slice(0, 10);
  }
  if (eventType === 'letter.delivered') {
    patch.delivered_at = new Date().toISOString();
  }
  if (trackingNumber) {
    patch.tracking_number = trackingNumber;
  }

  const result = await supabaseRequest(
    `/rest/v1/letters?lob_id=eq.${encodeURIComponent(lobId)}`,
    'PATCH', patch, supabaseUrl, supabaseKey
  );

  console.log('Supabase update:', result.status);

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true, event: eventType, lobId, status: trackingStatus }),
  };
};
