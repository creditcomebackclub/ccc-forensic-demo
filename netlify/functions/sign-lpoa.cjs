const https = require('https');
const crypto = require('crypto');
const {
  DOCUMENTS_BUCKET,
  lpoaSignaturePath,
  lpoaDocumentPath,
  buildLpoaSignatureRecord,
} = require('./_storagePaths.cjs');

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

// Section 4 (Fee Structure) receives the dynamically computed feeText
// to ensure the signed record reflects exactly what the client agreed to.
function buildLpoaHtml(clientName, signerName, signatureData, signedAt, feeText) {
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
    + '<p>This LPOA is between <strong>' + clientName + '</strong> ("Principal") and Credit Comeback Club, a DBA of Christopher Holland, Grand Junction, CO ("Attorney-in-Fact").</p>'
    + '<h2>2. Grant of Authority</h2>'
    + '<ul><li>Prepare and submit dispute letters to data furnishers under 15 U.S.C. §1681s-2(b)</li>'
    + '<li>Prepare and submit dispute letters to Equifax, Experian, and TransUnion</li>'
    + '<li>Send certified mail on behalf of Principal</li>'
    + '<li>Receive and respond to furnisher and bureau correspondence</li>'
    + '<li>Submit CFPB, FTC, and state AG complaints for FCRA/FDCPA violations</li>'
    + '<li>Sign correspondence as "By: Credit Comeback Club, Authorized Representative"</li></ul>'
    + '<h2>3. Limitations</h2>'
    + '<p>Does NOT authorize financial decisions, account access, disputing accurate information, new credit identity creation, or settling legal claims without explicit consent.</p>'
    + '<h2>4. Fee Structure</h2><p>' + feeText + '</p>'
    + '<h2>5. No Guarantee</h2><p>No specific outcome guaranteed. Results vary by credit profile and creditor response.</p>'
    + '<h2>6. Duration &amp; Revocation</h2><p>Effective until written revocation or dispute completion. To revoke: email creditcomebackclub@gmail.com with "LPOA REVOCATION — [Your Name]."</p>'
    + '<h2>7. ESIGN Disclosure</h2><p>Executed electronically under the ESIGN Act (15 U.S.C. §7001). Drawn signature, timestamp, and IP recorded as evidence of consent.</p>'
    + '<div class="sig-row">'
    + '<div class="sig-col"><div class="sig-line">' + (signatureData ? '<img src="' + signatureData + '" style="max-height:56px;max-width:200px;" />' : '') + '</div>'
    + '<div class="sig-label"><strong>' + signerName + '</strong> — Principal</div>'
    + '<div class="sig-label">Date: ' + dateStr + '</div></div>'
    + '<div class="sig-col"><div class="sig-line" style="align-items:center;"><span style="font-size:14px;font-weight:bold;">Christopher Holland</span></div>'
    + '<div class="sig-label"><strong>Christopher Holland</strong> — Attorney-in-Fact, Credit Comeback Club</div>'
    + '<div class="sig-label">Date: ' + dateStr + '</div></div>'
    + '</div>'
    + '<div class="footer">Credit Comeback Club | Grand Junction, CO | 970-644-0063 | creditcomebackclub.com | ESIGN Act 15 U.S.C. §7001</div>'
    + '</body></html>';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseKey) return { statusCode: 500, body: JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }) };

  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { clientName, signerName, signatureData, signedAt, token, lpoaType, feeText: frontendFeeText } = payload;
  if (!clientName || !signatureData) return { statusCode: 400, body: JSON.stringify({ error: 'clientName and signatureData required' }) };
  if (!token) return { statusCode: 400, body: JSON.stringify({ error: 'token required' }) };
  const resolvedLpoaType = lpoaType === 'inquiry' ? 'inquiry' : 'standard';

  const ip = event.headers['x-forwarded-for'] || 'unknown';
  const signedAtTime = signedAt || new Date().toISOString();

  try {
    // The link is the only thing standing between a signature request and
    // an actual signed authorization — clientName alone (a guessable string
    // in the URL) was never actually checked against anything until this
    // gate. Every client gets a random sign_token (clients migration
    // 20260725), so this now requires possession of the exact link Chris
    // generated for this specific client, not just knowledge of their name.
    const tokenCheck = await supabaseRequest(
      '/rest/v1/clients?name=eq.' + encodeURIComponent(clientName) + '&select=id,user_id,sign_token,billing_tier,service_agreement_mode,service_agreement_fee_text',
      'GET', null, supabaseUrl, supabaseKey
    );
    const matchedRow = Array.isArray(tokenCheck.body) && tokenCheck.body[0];
    if (!matchedRow || matchedRow.sign_token !== token) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Invalid or expired signing link.' }) };
    }
    const clientId = matchedRow.id;
    const firmUserId = matchedRow.user_id;
    if (!firmUserId) {
      return { statusCode: 409, body: JSON.stringify({ error: 'Client is not linked to a firm account; cannot store LPOA.' }) };
    }
    
    // Fetch settings to get any admin-overridden tier pricing
    const settingsReq = await supabaseRequest('/rest/v1/settings?id=eq.1&select=pricing', 'GET', null, supabaseUrl, supabaseKey);
    const settings = Array.isArray(settingsReq.body) && settingsReq.body[0] ? settingsReq.body[0] : {};
    
    // Custom service agreement (Billing tab) is the source of truth when set.
    // Inquiry hardcoded text applies only when still on tier mode + inquiry type.
    const customFee = String(matchedRow.service_agreement_fee_text || '').trim();
    const useCustom = matchedRow.service_agreement_mode === 'custom' && !!customFee;
    let backendFeeText = '';
    if (useCustom) {
      backendFeeText = customFee;
    } else if (resolvedLpoaType === 'inquiry') {
      backendFeeText = 'Personal Information / Inquiry Removal Fee: $50 per bureau, one-time. No monthly service fee. No deletion = no charge.';
    } else {
      const DEFAULT_TIER_PRICING = {
        Standard: { monthlyFee: 79, firstWorkFee: 75 },
        VIP: { monthlyFee: 149, firstWorkFee: 99 },
        'Paid In Full': { flatFee: 499, flatMonths: 6, firstWorkFee: 0 },
      };
      const overrides = (settings && settings.pricing && settings.pricing.tiers) || {};
      const tierPricing = {};
      for (const tier of Object.keys(DEFAULT_TIER_PRICING)) {
        tierPricing[tier] = { ...DEFAULT_TIER_PRICING[tier], ...(overrides[tier] || {}) };
      }
      const tier = matchedRow.billing_tier || 'Standard';
      const p = tierPricing[tier] || tierPricing['Standard'];
      
      if (tier === 'Paid In Full') {
        backendFeeText = `$${p.flatFee} flat for ${p.flatMonths} months of service (no monthly billing)${p.firstWorkFee ? `, plus a $${p.firstWorkFee} First Work Fee` : ' — First Work Fee waived'}.`;
      } else {
        backendFeeText = `$${p.monthlyFee}/month, plus a $${p.firstWorkFee} First Work Fee due after audit delivery.`;
      }
    }
    
    // Ensure mutual assent: the fee text the client saw MUST match what the database enforces.
    // We fall back to the backend text if frontend feeText is completely missing (e.g. old link)
    // to avoid permanently breaking existing in-flight links, but any mismatch is rejected.
    if (frontendFeeText && frontendFeeText !== backendFeeText) {
      // Allow legacy text mismatch if it's an old link falling back to hardcoded standard
      const legacyStandard = 'First Work Fee: $49 after audit delivery. Per-delete fees: Type A $125/bureau, Type B $75/bureau, Type C $150/bureau, Public Record $175/bureau. No deletion = no charge.';
      if (frontendFeeText !== legacyStandard) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Fee structure mismatch. Please ask your rep for a new signature link.' }) };
      }
    }

    // Upload signature PNG to private documents bucket under the firm/client tree.
    const base64Data = signatureData.replace(/^data:image\/png;base64,/, '');
    const sigBuffer = Buffer.from(base64Data, 'base64');
    const signaturePath = lpoaSignaturePath(firmUserId, clientId);

    const storageRes = await new Promise((resolve, reject) => {
      const path = '/storage/v1/object/' + DOCUMENTS_BUCKET + '/' + signaturePath;
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

    if (storageRes.status < 200 || storageRes.status >= 300) {
      throw new Error('Signature upload failed: ' + storageRes.status + ' ' + storageRes.body);
    }

    // Generate signed LPOA HTML with the verified backend fee text
    const lpoaHtml = buildLpoaHtml(clientName, signerName || clientName, signatureData, signedAtTime, backendFeeText);
    const lpoaBuffer = Buffer.from(lpoaHtml, 'utf8');
    // Hashed from the exact bytes about to be uploaded — this is what lets
    // anyone later confirm the stored lpoa-signed.html hasn't been altered
    // since the moment of signing.
    const documentHash = crypto.createHash('sha256').update(lpoaBuffer).digest('hex');
    const documentPath = lpoaDocumentPath(firmUserId, clientId);

    // Upload LPOA HTML to private documents bucket
    const lpoaUploadRes = await new Promise((resolve, reject) => {
      const path = '/storage/v1/object/' + DOCUMENTS_BUCKET + '/' + documentPath;
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
        let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      });
      req.on('error', reject);
      req.write(lpoaBuffer);
      req.end();
    });

    if (lpoaUploadRes.status < 200 || lpoaUploadRes.status >= 300) {
      throw new Error('LPOA upload failed: ' + lpoaUploadRes.status + ' ' + lpoaUploadRes.body);
    }

    // Create a short-lived signed URL for the response payload / audit log only.
    // Durable identity is storage paths on clients.lpoa_signature_data.
    const signedLpoa = await supabaseRequest(
      '/storage/v1/object/sign/' + DOCUMENTS_BUCKET + '/' + documentPath,
      'POST',
      { expiresIn: 60 * 60 * 24 * 7 },
      supabaseUrl,
      supabaseKey
    );
    const lpoaUrl = signedLpoa.body && signedLpoa.body.signedURL
      ? (supabaseUrl + '/storage/v1' + signedLpoa.body.signedURL)
      : null;

    const signatureRecord = buildLpoaSignatureRecord({
      firmUserId,
      clientId,
      signedAt: signedAtTime,
      ip,
      method: 'Canvas drawn signature — standalone LPOA signing page',
      lpoaType: resolvedLpoaType,
      documentHash,
      lpoaUrl,
    });

    const patchRes = await supabaseRequest(
      '/rest/v1/clients?name=eq.' + encodeURIComponent(clientName) + '&sign_token=eq.' + encodeURIComponent(token),
      'PATCH',
      {
        lpoa_signed: true,
        lpoa_signed_at: signedAtTime,
        lpoa_signature_data: signatureRecord,
        lpoa_document_hash: documentHash,
      },
      supabaseUrl,
      supabaseKey
    );

    if (patchRes.status < 200 || patchRes.status >= 300) {
      throw new Error('Clients table update failed: ' + patchRes.status + ' ' + JSON.stringify(patchRes.body));
    }

    // Append-only audit trail (lpoa_audit_log, migration 20260725) — never
    // overwritten by a later re-sign, unlike the JSON blob above. Best-effort:
    // the signature is already recorded on the clients row by this point, so
    // a logging failure here must not fail the whole request.
    try {
      const auditRes = await supabaseRequest('/rest/v1/lpoa_audit_log', 'POST', {
        client_id: clientId,
        client_name: clientName,
        document_hash: documentHash,
        document_url: lpoaUrl,
        signer_name: signerName || clientName,
        ip,
        user_agent: event.headers['user-agent'] || null,
        lpoa_type: resolvedLpoaType,
        signed_at: signedAtTime,
      }, supabaseUrl, supabaseKey);
      if (auditRes.status < 200 || auditRes.status >= 300) {
        console.warn('lpoa_audit_log insert failed (non-fatal):', auditRes.status, JSON.stringify(auditRes.body));
      }
    } catch (e) {
      console.warn('lpoa_audit_log insert failed (non-fatal):', e.message);
    }

    // Also record storage paths on client_profiles when linked
    try {
      await supabaseRequest(
        '/rest/v1/client_profiles?client_id=eq.' + encodeURIComponent(clientId),
        'PATCH',
        {
          lpoa_storage_bucket: DOCUMENTS_BUCKET,
          lpoa_storage_path: documentPath,
          lpoa_url: lpoaUrl,
        },
        supabaseUrl,
        supabaseKey
      );
    } catch (e) {
      console.warn('client_profiles LPOA path update failed (non-fatal):', e.message);
    }

    return { statusCode: 200, body: JSON.stringify({
      signed: true,
      signaturePath,
      lpoaPath: documentPath,
      lpoaUrl,
    }) };
  } catch (e) {
    console.error('sign-lpoa error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Signing failed' }) };
  }
};
