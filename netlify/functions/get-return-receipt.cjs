const https = require('https');
const { requireAuth, supabaseGet } = require('./_requireAuth.cjs');

function lobRequest(path, method, body, apiKey) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(apiKey + ':').toString('base64');
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.lob.com',
      port: 443,
      path,
      method,
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type': 'application/json',
      },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
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

  // 1. Authenticate the user (Admin, Affiliate, or Client)
  let userSession;
  try { userSession = await requireAuth(event); }
  catch (e) { if (e.statusCode) return e; throw e; }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { lobId } = payload;
  if (!lobId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'lobId required' }) };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  
  // 2. Verify the user has access to this letter using RLS
  // By querying with their specific token, Supabase RLS will ensure they only get it
  // if they are the admin, affiliate, or the client who owns the letter.
  const letterRes = await supabaseGet(`/rest/v1/letters?lob_id=eq.${encodeURIComponent(lobId)}&select=id`, supabaseUrl, anonKey, userSession.token);
  
  if (letterRes.status !== 200 || !Array.isArray(letterRes.body) || letterRes.body.length === 0) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized to view this letter or it does not exist' }) };
  }

  // 3. Fetch the letter from Lob
  const mode = process.env.LOB_MODE || 'test';
  const apiKey = mode === 'live' ? process.env.LOB_LIVE_KEY : process.env.LOB_TEST_KEY;
  
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Lob API key not configured' }) };
  }

  try {
    const result = await lobRequest('/v1/letters/' + lobId, 'GET', null, apiKey);
    
    if (result.status !== 200) {
      return { statusCode: result.status, body: JSON.stringify({ error: 'Failed to fetch letter from Lob' }) };
    }

    const letter = result.body;
    
    // 4. Return the return receipt URL if it exists
    if (letter.return_receipt && letter.return_receipt.url) {
      return { statusCode: 200, body: JSON.stringify({ return_receipt_url: letter.return_receipt.url }) };
    } else {
      return { statusCode: 404, body: JSON.stringify({ error: 'Return receipt not available yet' }) };
    }

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Lob request failed' }) };
  }
};
