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

function buildLpoaHtml(clientName, signerName, signatureData, signedAt) {
  const dateStr = new Date(signedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>'
    + 'body{font-family:Arial,sans-serif;font-size:12px;line-height:1.6;margin:0;padding:40px;color:#000;}'
    + '.header{background:#1B2A4A;color:#C9A84C;padding:20px 32px;margin:-40px -40px 32px;}'
    + '.header h1{margin:0;font-size:18px;} .header p{margin:4px 0 0;font-size:11px;color:#fff;opacity:0.8;}'
    + 'h2{font-size:11px;background:#1B2A4A;color:#fff;padding:5px 12px;margin:20px -12px 10px;text-transform:uppercase;letter-spacing:0.05em;}'
    + 'ul{padding-left:18px;margin:6px 0;} li{margin:3px 0;}'
    + '.sig-row{display:flex;gap:40px;margin-top:24px;padding-top:16px;border-top:1px solid #ddd;}'
    + '.sig-col{flex:1;} .sig-line{border-bottom:1px solid #000;min-height:64px;display:flex;align-items:flex-end;padding-bottom:4px;}'
    + '.sig-label{font-size:10px;color:#666;margin-top:4px;}'
    + '.footer{margin-top:32px;padding-top:10px;border-top:1px solid #eee;font-size:10px;color:#999;text-align:center;}'
    + '</style></head><body>'
    + '<div class="header"><h1>Credit Dispute Authorization — Limited Power of Attorney</h1><p>Executed ' + dateStr + '</p></div>'
    + '<h2>1. Parties</h2>'
    + '<p>This LPOA is between <strong>' + clientName + '</strong> ("Principal") and Credit Comeback Club, a DBA of Christopher Holland, 3088 Colorado Ave, Grand Junction, CO 81504 ("Attorney-in-Fact").</p>'
    + '<h2>2. Grant of Authority</h2>'
    + '<ul><li>Prepare and submit dispute letters to data furnishers under 15 U.S.C. §1681s-2(b)</li>'
    + '<li>Prepare and submit dispute letters to Equifax, Experian, and TransUnion</li>'
    + '<li>Send certified mail on behalf of Principal</li>'
    + '<li>Receive and respond to furnisher and bureau correspondence</li>'
    + '<li>Submit CFPB, FTC, and state AG complaints for FCRA/FDCPA violations</li>'
    + '<li>Sign correspondence as "By: Credit Comeback Club, Authorized Representative"</li></ul>'
    + '<h2>3. Limitations</h2>'
    + '<p>Does NOT authorize financial decisions, account access, disputing accurate information, new credit identity creation, or settling legal claims without explicit consent.</p>'
    + '<h2>4. No Guarantee</h2><p>No specific outcome guaranteed. Results vary by credit profile and creditor response.</p>'
    + '<h2>5. ESIGN Disclosure</h2><p>Executed electronically under the ESIGN Act (15 U.S.C. §7001). Drawn signature, timestamp, and IP recorded as evidence of consent.</p>'
    + '<div class="sig-row">'
    + '<div class="sig-col"><div class="sig-line">' + (signatureData ? '<img src="' + signatureData + '" style="max-height:56px;max-width:200px;" />' : '') + '</div>'
    + '<div class="sig-label"><strong>' + signerName + '</strong> — Principal</div>'
    + '<div class="sig-label">Date: ' + dateStr + '</div></div>'
    + '<div class="sig-col"><div class="sig-line" style="align-items:center;"><span style="font-size:14px;font-weight:bold;">Christopher Holland</span></div>'
    + '<div class="sig-label"><strong>Christopher Holland</strong> — Attorney-in-Fact, Credit Comeback Club</div>'
    + '<div class="sig-label">Date: ' + dateStr + '</div></div>'
    + '</div>'
    + '<div class="footer">Credit Comeback Club | 3088 Colorado Ave, Grand Junction, CO 81504 | 970-644-0063 | creditcomebackclub.com | ESIGN Act 15 U.S.C. §7001</div>'
    + '</body></html>';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { clientName, signerName, signatureData, signedAt } = payload;
  if (!clientName || !signatureData) return { statusCode: 400, body: JSON.stringify({ error: 'clientName and signatureData required' }) };

  const ip = event.headers['x-forwarded-for'] || 'unknown';
  const signedAtTime = signedAt || new Date().toISOString();

  try {
    // Upload signature PNG to Supabase Storage via base64
    const base64Data = signatureData.replace(/^data:image\/png;base64,/, '');
    const sigBuffer = Buffer.from(base64Data, 'base64');

    // Upload via Supabase Storage API
    const storageRes = await new Promise((resolve, reject) => {
      const path = '/storage/v1/object/client-docs/standalone/' + encodeURIComponent(clientName) + '/signature.png';
      const u = new URL(supabaseUrl + path);
      const options = {
        hostname: u.hostname, port: 443, path: u.pathname, method: 'POST',
        headers: {
          'Content-Type': 'image/png',
          'apikey': supabaseKey,
          'Authorization': 'Bearer ' + supabaseKey,
          'x-upsert': 'true',
          'Content-Length': sigBuffer.length,
        },
      };
      const req = https.request(options, (res) => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      });
      req.on('error', reject);
      req.write(sigBuffer);
      req.end();
    });

    // Get public URL
    const sigUrl = supabaseUrl + '/storage/v1/object/public/client-docs/standalone/' + encodeURIComponent(clientName) + '/signature.png';

    // Generate signed LPOA HTML
    const lpoaHtml = buildLpoaHtml(clientName, signerName || clientName, signatureData, signedAtTime);
    const lpoaBuffer = Buffer.from(lpoaHtml, 'utf8');

    // Upload LPOA HTML
    await new Promise((resolve, reject) => {
      const path = '/storage/v1/object/client-docs/standalone/' + encodeURIComponent(clientName) + '/lpoa-signed.html';
      const u = new URL(supabaseUrl + path);
      const options = {
        hostname: u.hostname, port: 443, path: u.pathname, method: 'POST',
        headers: {
          'Content-Type': 'text/html',
          'apikey': supabaseKey,
          'Authorization': 'Bearer ' + supabaseKey,
          'x-upsert': 'true',
          'Content-Length': lpoaBuffer.length,
        },
      };
      const req = https.request(options, (res) => {
        let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve({ status: res.statusCode }));
      });
      req.on('error', reject);
      req.write(lpoaBuffer);
      req.end();
    });

    const lpoaUrl = supabaseUrl + '/storage/v1/object/public/client-docs/standalone/' + encodeURIComponent(clientName) + '/lpoa-signed.html';

    // Update clients table
    const signatureRecord = {
      signatureUrl: sigUrl,
      lpoaUrl,
      signedAt: signedAtTime,
      ip,
      method: 'Canvas drawn signature — standalone LPOA signing page',
    };

    await supabaseRequest(
      '/rest/v1/clients?name=eq.' + encodeURIComponent(clientName),
      'PATCH',
      {
        lpoa_signed: true,
        lpoa_signed_at: signedAtTime,
        lpoa_signature_data: signatureRecord,
      },
      supabaseUrl,
      supabaseKey
    );

    return { statusCode: 200, body: JSON.stringify({ signed: true, sigUrl, lpoaUrl }) };
  } catch (e) {
    console.error('sign-lpoa error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Signing failed' }) };
  }
};
