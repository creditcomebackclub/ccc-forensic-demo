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

  // Automated campaign update emails
  if (action === 'send_campaign_update') {
    const { clientName, clientEmail, updateType, furnisher, details, daysElapsed } = payload;
    if (!clientEmail) return { statusCode: 400, body: JSON.stringify({ error: 'clientEmail required' }) };
    if (!sgKey) return { statusCode: 500, body: JSON.stringify({ error: 'SENDGRID_API_KEY not configured' }) };

    const firstName = clientName.split(' ')[0] || clientName;
    const configs = {
      day7_checkin: {
        subject: 'Your Dispute Campaign — Week 1 Update',
        headline: 'Your letters are in transit.',
        body: 'Your certified dispute letters are currently in transit to ' + (furnisher || 'your creditors') + '. The furnisher has 30 days from delivery to respond with a substantive investigation. No action is needed on your part right now.',
        action: 'Do nothing. If a creditor contacts you directly, do not respond — forward any correspondence to creditcomebackclub@gmail.com.',
        tone: '#EFF6FF',
        borderColor: '#BFDBFE',
      },
      day30_approaching: {
        subject: 'Response Deadline Approaching — ' + (furnisher || 'Your Dispute'),
        headline: 'The 30-day response window is closing.',
        body: furnisher + ' has approximately ' + (30 - (daysElapsed || 28)) + ' days remaining to respond to your dispute. If they fail to respond or provide an inadequate investigation, we will escalate to the credit bureaus with Phase 3 letters.',
        action: 'Continue doing nothing. We are monitoring for their response and have Phase 3 letters prepared.',
        tone: '#FFFBEB',
        borderColor: '#FDE68A',
      },
      day35_escalation: {
        subject: 'No Response Confirmed — Phase 3 Escalation Triggered',
        headline: furnisher + ' failed to respond.',
        body: furnisher + ' did not conduct a reasonable investigation within the 30-day statutory window required by 15 U.S.C. §1681s-2(b). This is an automatic federal law violation. We are now escalating to Equifax, Experian, and TransUnion with Phase 3 letters documenting their failure.',
        action: 'Phase 3 letters are being prepared and will be mailed to all three credit bureaus. Deletions typically occur within 30 days of bureau-level escalation.',
        tone: '#F0FDF4',
        borderColor: '#BBF7D0',
      },
    };

    const cfg = configs[updateType];
    if (!cfg) return { statusCode: 400, body: JSON.stringify({ error: 'Unknown updateType: ' + updateType }) };

    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
      + '<body style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;background:#F8F9FA;">'
      + '<div style="background:#1B2A4A;padding:20px 28px;border-radius:8px 8px 0 0;display:flex;align-items:center;gap:10px;">'
      + '<div style="background:#C9A84C;border-radius:5px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;"><span style="color:#1B2A4A;font-weight:800;font-size:12px;">CC</span></div>'
      + '<div style="color:#C9A84C;font-weight:700;font-size:14px;">Credit Comeback Club</div></div>'
      + '<div style="background:#fff;border:1px solid #E5E7EB;border-top:none;padding:28px;border-radius:0 0 8px 8px;">'
      + '<p style="color:#6B7280;font-size:12px;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Campaign Update</p>'
      + '<h1 style="font-size:20px;color:#1B2A4A;margin:0 0 16px;">' + cfg.headline + '</h1>'
      + '<p style="font-size:13px;color:#374151;margin:0 0 16px;">' + cfg.body + '</p>'
      + '<div style="background:' + cfg.tone + ';border:1px solid ' + cfg.borderColor + ';border-radius:6px;padding:14px 16px;margin:0 0 20px;">'
      + '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#374151;font-weight:600;margin-bottom:4px;">Your Action</div>'
      + '<p style="font-size:12px;color:#374151;margin:0;">' + cfg.action + '</p></div>'
      + '<p style="font-size:12px;color:#6B7280;">Track your full campaign in your <a href="https://ccc-forensic-demo.netlify.app" style="color:#1B2A4A;font-weight:600;">client portal</a>.</p>'
      + '<p style="font-size:12px;color:#6B7280;">Questions? Reply to this email or call 970-644-0063.</p>'
      + '<hr style="border:none;border-top:1px solid #E5E7EB;margin:20px 0;">'
      + '<p style="font-size:11px;color:#9CA3AF;margin:0;">Credit Comeback Club | creditcomebackclub.com | 970-644-0063</p>'
      + '</div></body></html>';

    try {
      await sendViaSendGrid(sgKey, clientEmail, cfg.subject, html);
      return { statusCode: 200, body: JSON.stringify({ sent: true }) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  // Educational email series
  if (action === 'send_educational') {
    const { clientName, clientEmail, emailNumber } = payload;
    if (!clientEmail) return { statusCode: 400, body: JSON.stringify({ error: 'clientEmail required' }) };
    if (!sgKey) return { statusCode: 500, body: JSON.stringify({ error: 'SENDGRID_API_KEY not configured' }) };

    const firstName = clientName.split(' ')[0] || clientName;

    const emails = {
      1: {
        subject: 'What Is Metro 2 and Why Does It Matter For Your Credit?',
        headline: 'The reporting standard creditors are supposed to follow — but often don\'t.',
        content: '<p>Every piece of information on your credit report is supposed to follow a technical standard called Metro 2. It was created by the Consumer Data Industry Association and defines exactly how creditors must report account data to Equifax, Experian, and TransUnion.</p>'
          + '<p>Metro 2 has over 400 data fields. Each one has specific rules — what values are valid, how dates must be formatted, which fields are mandatory, and how fields must relate to each other logically.</p>'
          + '<p><strong>Here\'s the problem:</strong> Creditors frequently violate these rules. They report balances on closed accounts. They suppress payment history. They report charge-offs with incorrect dates. They use status codes that contradict each other across bureaus.</p>'
          + '<p>These aren\'t minor clerical errors — they\'re violations of the Fair Credit Reporting Act. And they\'re what we look for in your forensic audit.</p>'
          + '<p><strong>What this means for you:</strong> Every violation we identify in your credit file is a legally actionable inaccuracy. The creditor has a legal obligation to correct it when formally disputed.</p>',
      },
      2: {
        subject: 'Why Generic Credit Repair Doesn\'t Work',
        headline: 'The e-OSCAR problem — and why we bypass it entirely.',
        content: '<p>Most credit repair companies send dispute letters to the credit bureaus. The bureaus receive millions of disputes and process them through an automated system called e-OSCAR.</p>'
          + '<p>Here\'s what actually happens: e-OSCAR converts your dispute into a two-digit code and forwards it to the creditor. The creditor\'s computer looks at their database, confirms the data matches what they submitted, and responds "verified." The bureau marks it verified. Your dispute dies.</p>'
          + '<p>No human ever looks at your case. No one examines whether the data is actually accurate. The entire process is a loop of automated confirmation.</p>'
          + '<p><strong>What we do instead:</strong> We dispute directly with the furnisher — the creditor or collector — bypassing the bureaus entirely. Under 15 U.S.C. §1681s-2(b), a direct written dispute triggers independent legal obligations that cannot be processed through e-OSCAR.</p>'
          + '<p>The furnisher must conduct a reasonable investigation — not just an automated database check. The legal standard comes from <em>Johnson v. MBNA America Bank</em>, a Fourth Circuit federal case that held automated verification is legally insufficient.</p>'
          + '<p>That\'s the foundation of every letter we send on your behalf.</p>',
      },
      3: {
        subject: 'Understanding Your 30-Day Window',
        headline: 'What happens after your letters are delivered.',
        content: '<p>Once your certified dispute letters are delivered, the furnisher has 30 days to respond with a substantive investigation. This is a federal legal requirement under 15 U.S.C. §1681s-2(b).</p>'
          + '<p><strong>A substantive investigation means:</strong></p>'
          + '<ul><li>Reviewing original source documentation — not just their internal database</li><li>Addressing each specific violation you identified</li><li>Providing written explanation of how they verified the disputed information</li><li>Correcting or deleting inaccurate information and notifying all bureaus</li></ul>'
          + '<p><strong>What usually happens:</strong></p>'
          + '<ul><li><strong>Form letter response:</strong> Generic "verified as accurate" language with no documentation. This fails the Johnson v. MBNA standard and sets up Phase 3 escalation.</li><li><strong>No response:</strong> An automatic violation. Triggers immediate Phase 3 escalation to all three bureaus.</li><li><strong>Partial correction:</strong> They fix some issues but not all. Remaining violations are still actionable.</li><li><strong>Full correction/deletion:</strong> The best outcome. Account corrected or removed.</li></ul>'
          + '<p>We monitor every letter and will notify you when responses come in or when windows close.</p>',
      },
      4: {
        subject: 'Your Credit Score: What Moves It and What Doesn\'t',
        headline: 'The mechanics behind the number.',
        content: '<p>Your credit score is a snapshot — it reflects what\'s in your credit file at this exact moment. As inaccurate negative accounts are removed or corrected, the score recalculates.</p>'
          + '<p><strong>What has the biggest impact:</strong></p>'
          + '<ul><li><strong>Payment history (35%):</strong> Late payments, charge-offs, and collections weigh heavily. Deletion is more impactful than correction.</li><li><strong>Amounts owed (30%):</strong> Balances reporting on closed accounts or incorrectly high balances suppress your score artificially.</li><li><strong>Age of accounts (15%):</strong> Older positive accounts help. Negative accounts with incorrect dates may be reporting longer than legally allowed.</li><li><strong>Types of credit (10%) and new inquiries (10%):</strong> Less impactful during a dispute campaign.</li></ul>'
          + '<p><strong>What to expect during your campaign:</strong> Scores may fluctuate as disputes are processed. This is normal. When a negative account is disputed, bureaus may temporarily mark it as "in dispute," which can cause minor score movement. Deletions produce the most significant and permanent score improvement.</p>'
          + '<p>Keep pulling your reports monthly through Privacy Guard. Every deletion confirmed is a win.</p>',
      },
      5: {
        subject: 'After the Deletions: Building What Comes Next',
        headline: 'Your credit is a foundation, not a destination.',
        content: '<p>When negative accounts are deleted, your score improves — but the real opportunity is what you build on top of that foundation.</p>'
          + '<p><strong>Personal credit next steps:</strong></p>'
          + '<ul><li>Secured credit cards from Capital One or Discover to build positive payment history</li><li>Credit-builder loans from local credit unions</li><li>Becoming an authorized user on a long-standing account with a trusted family member</li></ul>'
          + '<p><strong>Business credit — the bigger opportunity:</strong></p>'
          + '<p>Business credit is completely separate from personal credit. You can start building it now, regardless of where your personal scores are. A properly structured business entity with an EIN and business bank account can begin establishing trade lines immediately.</p>'
          + '<p>Our VIP clients get access to our business credit roadmap and a direct introduction to our funding partner, Swiftedly, who specializes in business funding for entrepreneurs building from scratch.</p>'
          + '<p>Ask about upgrading to VIP membership during your next strategy touchpoint.</p>'
          + '<p><strong>You started this process to come back. The comeback is the beginning.</strong></p>',
      },
    };

    const email = emails[emailNumber];
    if (!email) return { statusCode: 400, body: JSON.stringify({ error: 'Unknown emailNumber: ' + emailNumber }) };

    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
      + '<body style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;background:#F8F9FA;">'
      + '<div style="background:#1B2A4A;padding:20px 28px;border-radius:8px 8px 0 0;display:flex;align-items:center;gap:10px;">'
      + '<div style="background:#C9A84C;border-radius:5px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;"><span style="color:#1B2A4A;font-weight:800;font-size:12px;">CC</span></div>'
      + '<div><div style="color:#C9A84C;font-weight:700;font-size:14px;">Credit Comeback Club</div>'
      + '<div style="color:rgba(255,255,255,0.5);font-size:10px;text-transform:uppercase;letter-spacing:0.1em;">Credit Education Series</div></div></div>'
      + '<div style="background:#fff;border:1px solid #E5E7EB;border-top:none;padding:28px;border-radius:0 0 8px 8px;">'
      + '<p style="color:#9CA3AF;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin:0 0 4px;">Hi ' + firstName + ',</p>'
      + '<h1 style="font-size:20px;color:#1B2A4A;margin:0 0 20px;line-height:1.3;">' + email.headline + '</h1>'
      + '<div style="font-size:13px;color:#374151;line-height:1.7;">' + email.content + '</div>'
      + '<hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;">'
      + '<p style="font-size:12px;color:#6B7280;">Track your campaign progress in your <a href="https://ccc-forensic-demo.netlify.app" style="color:#1B2A4A;font-weight:600;">client portal</a>. Questions? Reply here or call 970-644-0063.</p>'
      + '<p style="font-size:11px;color:#9CA3AF;margin:8px 0 0;">Credit Comeback Club | creditcomebackclub.com | Veteran-Owned</p>'
      + '</div></body></html>';

    try {
      await sendViaSendGrid(sgKey, clientEmail, email.subject, html);
      return { statusCode: 200, body: JSON.stringify({ sent: true }) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  if (action === 'affiliate_welcome') {
    const { affiliateName, affiliateEmail, companyName, commissionRate } = payload;
    const sgKey = process.env.SENDGRID_API_KEY;
    if (!sgKey || !affiliateEmail) return { statusCode: 400, body: JSON.stringify({ error: 'Missing fields' }) };
    const subject = 'Welcome to the Credit Comeback Club Partner Program';
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#000;"><div style="background:#0C0C0C;padding:24px 32px;border-radius:4px 4px 0 0;"><h1 style="color:#22C55E;margin:0;font-size:20px;">Credit Comeback Club</h1><p style="color:rgba(255,255,255,0.5);margin:4px 0 0;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Partner Program</p></div><div style="border:1px solid #ddd;border-top:none;padding:24px 32px;border-radius:0 0 4px 4px;"><p>Hi ${affiliateName},</p><p>Welcome to the Credit Comeback Club partner program${companyName ? ' on behalf of ' + companyName : ''}. We're excited to work with you.</p><h3 style="color:#1B2A4A;font-size:14px;margin:24px 0 8px;">How it works:</h3><ol style="padding-left:18px;line-height:1.8;font-size:13px;color:#444;"><li>Log in to your partner portal to submit client referrals</li><li>We handle the full credit repair process — audit, disputes, certified mail, follow-up</li><li>You earn ${Math.round((commissionRate || 0.20) * 100)}% of the initial consultation fee for every client who moves forward</li><li>Track your referrals and commission status in real time from your portal</li></ol><p style="font-size:13px;color:#444;">Your portal access link was sent separately via magic link. Use it to log in — no password needed.</p><p style="font-size:13px;color:#444;">Questions? Reply to this email or call Chris directly at 970-644-0063.</p><hr style="border:none;border-top:1px solid #eee;margin:24px 0;"><p style="font-size:11px;color:#999;">Credit Comeback Club | Grand Junction, CO | creditcomebackclub.com | 970-644-0063</p></div></body></html>`;
    await sendViaSendGrid(sgKey, affiliateEmail, subject, html);
    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  }

  if (action === 'affiliate_new_referral') {
    const { affiliateName, companyName, clientName, clientEmail, clientPhone, clientNotes } = payload;
    const sgKey = process.env.SENDGRID_API_KEY;
    if (!sgKey) return { statusCode: 400, body: JSON.stringify({ error: 'Missing SendGrid key' }) };
    const subject = 'New Referral from ' + (companyName || affiliateName) + ' — ' + clientName;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#000;"><div style="background:#1B2A4A;padding:24px 32px;border-radius:4px 4px 0 0;"><h1 style="color:#C9A84C;margin:0;font-size:20px;">New Partner Referral</h1><p style="color:#fff;margin:4px 0 0;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">${companyName || affiliateName} → Credit Comeback Club</p></div><div style="border:1px solid #ddd;border-top:none;padding:24px 32px;border-radius:0 0 4px 4px;"><p><strong>${affiliateName}${companyName ? ' (' + companyName + ')' : ''}</strong> just submitted a new client referral:</p><table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;"><tr style="background:#F8F9FA;"><td style="padding:10px 14px;font-weight:600;width:140px;">Name</td><td style="padding:10px 14px;">${clientName}</td></tr><tr><td style="padding:10px 14px;font-weight:600;">Email</td><td style="padding:10px 14px;">${clientEmail}</td></tr><tr style="background:#F8F9FA;"><td style="padding:10px 14px;font-weight:600;">Phone</td><td style="padding:10px 14px;">${clientPhone || '—'}</td></tr><tr><td style="padding:10px 14px;font-weight:600;">Notes</td><td style="padding:10px 14px;">${clientNotes || '—'}</td></tr></table><p style="font-size:13px;color:#444;">Log in to your admin dashboard to run their audit and kick off onboarding.</p><hr style="border:none;border-top:1px solid #eee;margin:24px 0;"><p style="font-size:11px;color:#999;">Credit Comeback Club | Grand Junction, CO | creditcomebackclub.com</p></div></body></html>`;
    await sendViaSendGrid(sgKey, 'creditcomebackclub@gmail.com', subject, html);
    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action: ' + action }) };
};
