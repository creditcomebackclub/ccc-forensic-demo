const https = require('https');

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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Only authenticated admins may send letters or verify addresses via Lob.
  const { requireAdmin } = require('./_requireAdmin.cjs');
  try { await requireAdmin(event); }
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
      const { toAddress, fromAddress, remoteUrl, description, idempotencyKey, metadata } = payload;

      // Parse-confidence hard block (2026-07-23 defect report, P0-1):
      // checked server-side against the DB row, not just the client UI, so
      // a letter phase2-analyze-background.mjs flagged as built on an
      // unreadable enclosure can never reach Lob regardless of how the
      // request got here.
      const letterId = metadata && metadata.letter_id;
      if (letterId) {
        const supabaseUrl = process.env.VITE_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (supabaseUrl && serviceKey) {
          const checkRes = await new Promise((resolve, reject) => {
            const u = new URL(supabaseUrl + '/rest/v1/letters?id=eq.' + encodeURIComponent(letterId) + '&select=enclosure_parse_blocked,enclosure_parse_issues');
            https.get(u, { headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey } }, (res) => {
              let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => resolve({ status: res.statusCode, body: raw }));
            }).on('error', reject);
          });
          if (checkRes.status === 200) {
            const rows = JSON.parse(checkRes.body);
            const row = rows && rows[0];
            if (row && row.enclosure_parse_blocked) {
              return {
                statusCode: 422,
                body: JSON.stringify({
                  error: 'ENCLOSURE UNPARSED — MANUAL RECONCILIATION REQUIRED',
                  issues: row.enclosure_parse_issues || [],
                  blocked: true,
                }),
              };
            }
          }
        }
      }

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
        file: remoteUrl,
        // Text letters print B&W double-sided — enclosures are grayscaled
        // upstream anyway, and this roughly halves the per-letter cost
        color: false,
        double_sided: true,
        address_placement: 'top_first_page',
        mail_type: 'usps_first_class',
        // Letters state "return receipt requested" — the mailing must match
        extra_service: 'certified_return_receipt',
        // Lets the webhook match the letter row even if lob_id never got saved
        ...(metadata ? { metadata } : {}),
      };
      // Idempotency: a retry of the same letter can never mail twice
      const headers = idempotencyKey ? { 'Idempotency-Key': String(idempotencyKey) } : undefined;
      const result = await lobRequest('/v1/letters', 'POST', letterPayload, apiKey, headers);
      return { statusCode: result.status, body: JSON.stringify(result.body) };
    }

    if (action === 'get_tracking') {
      const { letterId } = payload;
      const result = await lobRequest('/v1/letters/' + letterId, 'GET', {}, apiKey);
      return { statusCode: result.status, body: JSON.stringify(result.body) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Lob request failed' }) };
  }
};
