const https = require('https');

async function sendViaSendGrid(sgKey, to, subject, htmlBody) {
  const body = JSON.stringify({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: 'chris@cccpartners.co', name: 'Credit Comeback Club' },
    subject,
    content: [{ type: 'text/html', value: htmlBody }],
  });
  const res = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.sendgrid.com', path: '/v3/mail/send', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + sgKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', reject); req.write(body); req.end();
  });
  if (res.status >= 400) throw new Error('SendGrid error ' + res.status + ': ' + res.body);
}

function supabaseRequest(path, method, body, url, key) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(url + path);
    const options = {
      hostname: u.hostname, port: 443, path: u.pathname + u.search, method,
      headers: { 'Content-Type': 'application/json', 'apikey': key, 'Authorization': 'Bearer ' + key, 'Prefer': 'return=minimal' },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(options, (res) => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} }); } catch (e) { resolve({ status: res.statusCode, body: raw }); } });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };

  const sgKey = process.env.SENDGRID_API_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { action } = payload;

  if (action === 'send') {
    const { clientName, clientEmail, lpoaUrl } = payload;
    if (!clientEmail || !lpoaUrl) return { statusCode: 400, body: JSON.stringify({ error: 'clientEmail and lpoaUrl required' }) };
    if (!sgKey) return { statusCode: 500, body: JSON.stringify({ error: 'SENDGRID_API_KEY not configured — add to Netlify env vars' }) };

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"><div style="background:#1B2A4A;padding:20px;border-radius:4px 4px 0 0;"><h1 style="color:#C9A84C;margin:0;font-size:20px;">Credit Comeback Club</h1><p style="color:#fff;margin:4px 0 0;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;">Authorization Required</p></div><div style="border:1px solid #ddd;border-top:none;padding:24px;border-radius:0 0 4px 4px;"><p>Hi ${clientName},</p><p>Before we begin your credit dispute campaign, we need your authorization. Please review and sign the Limited Power of Attorney by clicking below:</p><div style="text-align:center;margin:32px 0;"><a href="${lpoaUrl}" style="background:#1B2A4A;color:#C9A84C;padding:14px 32px;text-decoration:none;border-radius:4px;font-weight:bold;font-size:14px;display:inline-block;">Review &amp; Sign Authorization &#8594;</a></div><p style="font-size:12px;color:#666;">Your electronic signature is legally valid under the ESIGN Act (15 U.S.C. §7001).</p><p style="font-size:12px;color:#666;">Questions? Reply to this email or call 970-644-0063.</p><hr style="border:none;border-top:1px solid #eee;margin:24px 0;"><p style="font-size:11px;color:#999;">Credit Comeback Club | Grand Junction, CO | creditcomebackclub.com</p></div></body></html>`;

    try {
      await sendViaSendGrid(sgKey, clientEmail, 'Action Required: Sign Your Credit Dispute Authorization', html);
      return { statusCode: 200, body: JSON.stringify({ sent: true }) };
    } catch (e) {
      console.error('Email error:', e.message);
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  if (action === 'sign') {
    const { clientName, signedAt } = payload;
    if (!clientName) return { statusCode: 400, body: JSON.stringify({ error: 'clientName required' }) };
    const signatureData = {
      signedAt: signedAt || new Date().toISOString(),
      ip: event.headers['x-forwarded-for'] || 'unknown',
      userAgent: event.headers['user-agent'] || 'unknown',
      method: 'ESIGN — Click-to-sign via Credit Comeback Club portal',
    };
    await supabaseRequest(
      '/rest/v1/clients?name=eq.' + encodeURIComponent(clientName),
      'PATCH',
      { lpoa_signed: true, lpoa_signed_at: signatureData.signedAt, lpoa_signature_data: signatureData },
      supabaseUrl, supabaseKey
    );
    return { statusCode: 200, body: JSON.stringify({ signed: true, signatureData }) };
  }

  // Send audit summary email to client
  if (action === 'send_audit') {
    const { clientName, clientEmail, auditSummary, scores, accountsTargeted, totalViolations, batch1 } = payload;
    if (!clientEmail) return { statusCode: 400, body: JSON.stringify({ error: 'clientEmail required' }) };
    if (!sgKey) return { statusCode: 500, body: JSON.stringify({ error: 'SENDGRID_API_KEY not configured' }) };

    const scoreRow = Object.entries(scores || {}).map(([b, s]) => `<td style="text-align:center;padding:8px 16px;"><div style="font-size:22px;font-weight:bold;color:#1B2A4A;">${s || '—'}</div><div style="font-size:10px;color:#666;text-transform:uppercase;">${b}</div></td>`).join('');
    const batchRows = (batch1 || []).map(a => `<tr><td style="padding:6px 8px;font-size:12px;">${a.furnisher}</td><td style="padding:6px 8px;font-size:12px;text-align:center;">${a.accountClassification || '—'}</td><td style="padding:6px 8px;font-size:12px;">${a.primaryViolation || '—'}</td></tr>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#000;">
      <div style="background:#1B2A4A;padding:24px 32px;border-radius:4px 4px 0 0;">
        <h1 style="color:#C9A84C;margin:0;font-size:20px;">Credit Comeback Club</h1>
        <p style="color:#fff;margin:4px 0 0;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Your Forensic Audit is Ready</p>
      </div>
      <div style="border:1px solid #ddd;border-top:none;padding:24px 32px;border-radius:0 0 4px 4px;">
        <p>Hi ${clientName},</p>
        <p>Your forensic credit audit is complete. Here's what we found:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;"><tr>${scoreRow}</tr></table>
        <div style="background:#f5f5f0;border-radius:4px;padding:12px 16px;margin:16px 0;">
          <strong>${accountsTargeted}</strong> accounts targeted &nbsp;|&nbsp; <strong>${totalViolations}</strong> violations identified
        </div>
        ${batchRows ? `<p><strong>Priority Accounts (Batch 1):</strong></p>
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin:8px 0;">
          <thead><tr style="background:#1B2A4A;color:#fff;"><th style="padding:6px 8px;text-align:left;">Furnisher</th><th style="padding:6px 8px;">Type</th><th style="padding:6px 8px;text-align:left;">Primary Violation</th></tr></thead>
          <tbody>${batchRows}</tbody>
        </table>` : ''}
        <p>${auditSummary || 'Phase 1 dispute letters are being prepared and will be mailed via certified mail shortly.'}</p>
        <p>You can track your dispute progress anytime in your <a href="https://ccc-forensic-demo.netlify.app" style="color:#1B2A4A;">client portal</a>.</p>
        <p>Questions? Reply to this email or call 970-644-0063.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size:11px;color:#999;">Credit Comeback Club | Grand Junction, CO | creditcomebackclub.com</p>
      </div>
    </body></html>`;

    try {
      await sendViaSendGrid(sgKey, clientEmail, 'Your Credit Comeback Club Forensic Audit is Ready', html);
      return { statusCode: 200, body: JSON.stringify({ sent: true }) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  // Automated phase notification emails
  if (action === 'send_phase_notification') {
    const { clientName, clientEmail, phase, furnisher, trackingNumber, details } = payload;
    if (!clientEmail) return { statusCode: 400, body: JSON.stringify({ error: 'clientEmail required' }) };
    if (!sgKey) return { statusCode: 500, body: JSON.stringify({ error: 'SENDGRID_API_KEY not configured' }) };

    const subjects = {
      phase1_mailed: 'Your Dispute Letter Has Been Mailed — ' + furnisher,
      phase1_delivered: 'Dispute Letter Delivered — ' + furnisher + ' Has 30 Days to Respond',
      phase2_analyzed: 'Response Analysis Complete — ' + furnisher,
      phase3_mailed: 'Phase 3 Escalation Mailed to Credit Bureaus — ' + furnisher,
    };

    const bodies = {
      phase1_mailed: `<p>Your Phase 1 dispute letter to <strong>${furnisher}</strong> has been mailed via USPS Certified Mail.</p>
        ${trackingNumber ? `<p>Track your letter: <a href="https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}" style="color:#1B2A4A;">USPS Tracking ${trackingNumber.slice(-8)}</a></p>` : ''}
        <p>The furnisher has 30 days from delivery to respond. We will monitor the response and notify you of next steps.</p>`,
      phase1_delivered: `<p>Your dispute letter to <strong>${furnisher}</strong> has been delivered. Their 30-day response window has begun.</p>
        <p>We will monitor for their response and prepare Phase 3 escalation letters in advance.</p>`,
      phase2_analyzed: `<p>We have analyzed <strong>${furnisher}</strong>'s response to your dispute letter.</p>
        <p>${details || 'Phase 3 escalation letters have been prepared and will be mailed to the credit bureaus shortly.'}</p>`,
      phase3_mailed: `<p>Phase 3 escalation letters have been mailed to Equifax, Experian, and TransUnion regarding <strong>${furnisher}</strong>.</p>
        <p>The bureaus now have 30 days to investigate and respond. Deletions typically occur within this window when the furnisher failed to conduct a reasonable investigation.</p>`,
    };

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#000;">
      <div style="background:#1B2A4A;padding:24px 32px;border-radius:4px 4px 0 0;">
        <h1 style="color:#C9A84C;margin:0;font-size:20px;">Credit Comeback Club</h1>
        <p style="color:#fff;margin:4px 0 0;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Campaign Update</p>
      </div>
      <div style="border:1px solid #ddd;border-top:none;padding:24px 32px;border-radius:0 0 4px 4px;">
        <p>Hi ${clientName},</p>
        ${bodies[phase] || '<p>' + (details || 'Your dispute campaign has been updated.') + '</p>'}
        <p>Log in to your <a href="https://ccc-forensic-demo.netlify.app" style="color:#1B2A4A;">client portal</a> to see full details and tracking.</p>
        <p>Questions? Reply to this email or call 970-644-0063.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size:11px;color:#999;">Credit Comeback Club | Grand Junction, CO | creditcomebackclub.com</p>
      </div>
    </body></html>`;

    try {
      await sendViaSendGrid(sgKey, clientEmail, subjects[phase] || 'Credit Comeback Club Update', html);
      return { statusCode: 200, body: JSON.stringify({ sent: true }) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action: ' + action }) };
};
