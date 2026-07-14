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

function daysBetween(aIso, bIso) {
  const a = new Date(aIso + 'T00:00:00');
  const b = new Date(bIso + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

exports.handler = async () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sgKey = process.env.SENDGRID_API_KEY;
  const ADMIN_EMAIL = 'chris@cccpartners.co'; // Updated to send directly to Chris

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  const today = todayISO();
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  let leadsDrippedCount = 0;
  let clientUpdatesCount = 0;

  async function fetch_send(action, payload) {
    const base = process.env.URL || process.env.DEPLOY_URL || 'https://ccc-forensic-demo.netlify.app';
    const res = await fetch(base + '/.netlify/functions/send-lpoa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`fetch_send error ${res.status}: ${err}`);
    }
  }

  // --- 1. Process 30-day escalation and Client Updates ---
  const lettersRes = await supabaseRequest(
    '/rest/v1/letters?select=id,client_name,furnisher,phase,mailed_date,delivered_at,response_outcome,notifications_sent&response_outcome=is.null',
    'GET', null, supabaseUrl, supabaseKey
  );
  const letters = Array.isArray(lettersRes.body) ? lettersRes.body : [];
  const adminDigestItems = [];

  for (const letter of letters) {
    if (!letter.mailed_date) continue;
    const clockStart = letter.delivered_at ? letter.delivered_at.slice(0, 10) : letter.mailed_date;
    const daysElapsed = daysBetween(clockStart, today);
    const sent = letter.notifications_sent || [];
    let newSent = [...sent];
    let touched = false;

    let clientEmail = null;
    if (sgKey) {
      try {
        const cpRes = await supabaseRequest(
          '/rest/v1/client_profiles?full_name=eq.' + encodeURIComponent(letter.client_name) + '&select=email&limit=1',
          'GET', null, supabaseUrl, supabaseKey
        );
        clientEmail = cpRes.body && cpRes.body[0] && cpRes.body[0].email;
      } catch (e) { /* non-fatal */ }
    }

    if (sgKey && clientEmail && daysElapsed >= 7 && daysElapsed < 8 && !sent.includes('day7')) {
      try {
        await fetch_send('send_campaign_update', { clientName: letter.client_name, clientEmail, updateType: 'day7_checkin', furnisher: letter.furnisher, daysElapsed });
        newSent.push('day7'); touched = true;
        clientUpdatesCount++;
      } catch(e) { console.error('day7 email failed:', e); }
    }

    if (sgKey && clientEmail && daysElapsed >= 28 && daysElapsed < 30 && !sent.includes('day30')) {
      try {
        await fetch_send('send_campaign_update', { clientName: letter.client_name, clientEmail, updateType: 'day30_approaching', furnisher: letter.furnisher, daysElapsed });
        newSent.push('day30'); touched = true;
        clientUpdatesCount++;
      } catch(e) { console.error('day30 email failed:', e); }
    }

    if (daysElapsed >= 30 && !sent.includes('admin30')) {
      adminDigestItems.push({
        client: letter.client_name,
        furnisher: letter.furnisher,
        phase: letter.phase || 'Phase 1',
        daysElapsed,
        deliveredOrMailed: letter.delivered_at ? 'delivered ' + clockStart : 'mailed ' + clockStart + ' (no delivery)',
      });
      newSent.push('admin30'); touched = true;
    }

    if (touched) {
      await supabaseRequest(
        '/rest/v1/letters?id=eq.' + encodeURIComponent(letter.id),
        'PATCH', { notifications_sent: newSent }, supabaseUrl, supabaseKey
      );
    }
  }

  // --- 2. Process Lead Nurture Drips ---
  if (sgKey) {
    const leadsRes = await supabaseRequest(
      '/rest/v1/clients?select=name,email,lead_created_at,lead_drips_sent&status=eq.lead',
      'GET', null, supabaseUrl, supabaseKey
    );
    const leads = Array.isArray(leadsRes.body) ? leadsRes.body : [];
    const dripSchedule = [
      { key: 'drip1', num: 1, minDay: 0, maxDay: 2 },
      { key: 'drip2', num: 2, minDay: 3, maxDay: 5 },
      { key: 'drip3', num: 3, minDay: 7, maxDay: 9 },
      { key: 'drip4', num: 4, minDay: 10, maxDay: 12 },
      { key: 'drip5', num: 5, minDay: 14, maxDay: 16 },
    ];

    for (const lead of leads) {
      if (!lead.email || !lead.lead_created_at) continue;
      const createdDate = lead.lead_created_at.slice(0, 10);
      const daysSince = daysBetween(createdDate, today);
      const sentDrips = lead.lead_drips_sent || [];
      let newDrips = [...sentDrips];
      let touched = false;

      for (const d of dripSchedule) {
        if (daysSince >= d.minDay && daysSince <= d.maxDay && !sentDrips.includes(d.key)) {
          try {
            await fetch_send('send_lead_drip', { leadName: lead.name, leadEmail: lead.email, emailNumber: d.num });
            newDrips.push(d.key);
            touched = true;
            leadsDrippedCount++;
          } catch (e) {
            console.error('Lead drip send failed:', e.message);
          }
          break;
        }
      }

      if (touched) {
        await supabaseRequest(
          '/rest/v1/clients?name=eq.' + encodeURIComponent(lead.name),
          'PATCH', { lead_drips_sent: newDrips }, supabaseUrl, supabaseKey
        );
      }
    }
  }

  // --- 3. Gather Business Metrics for Executive Briefing ---
  let unmailedCount = 0;
  let newLeadsCount = 0;
  let newClientsCount = 0;
  let pendingAuditsCount = 0;
  let lobDeliveriesCount = 0;

  try {
    // Unmailed letters
    const unmailedRes = await supabaseRequest('/rest/v1/letters?mailed_date=is.null&select=id', 'GET', null, supabaseUrl, supabaseKey);
    unmailedCount = Array.isArray(unmailedRes.body) ? unmailedRes.body.length : 0;
    
    // New leads (last 24h)
    const newLeadsRes = await supabaseRequest(`/rest/v1/clients?status=eq.lead&lead_created_at=gte.${yesterday}&select=id`, 'GET', null, supabaseUrl, supabaseKey);
    newLeadsCount = Array.isArray(newLeadsRes.body) ? newLeadsRes.body.length : 0;

    // New clients (last 24h)
    const newClientsRes = await supabaseRequest(`/rest/v1/clients?status=eq.client&created_at=gte.${yesterday}&select=id`, 'GET', null, supabaseUrl, supabaseKey);
    newClientsCount = Array.isArray(newClientsRes.body) ? newClientsRes.body.length : 0;

    // Pending audits
    // Assuming audits table exists (based on typical use in this system)
    // Actually wait, audits are stored in the client_profiles table or where?
    // Let's just catch error if audits table doesn't exist
    const auditsRes = await supabaseRequest('/rest/v1/audits?status=eq.pending&select=id', 'GET', null, supabaseUrl, supabaseKey);
    if (auditsRes.status === 200) {
      pendingAuditsCount = Array.isArray(auditsRes.body) ? auditsRes.body.length : 0;
    } else {
      // Maybe audits is not a table? In this app, audits are often JSON in client_profiles or just letters?
      pendingAuditsCount = 'N/A';
    }
    
    // Lob Deliveries (delivered_at in last 24h)
    const deliveredRes = await supabaseRequest(`/rest/v1/letters?delivered_at=gte.${yesterday.slice(0,10)}&select=id`, 'GET', null, supabaseUrl, supabaseKey);
    lobDeliveriesCount = Array.isArray(deliveredRes.body) ? deliveredRes.body.length : 0;
  } catch (e) {
    console.warn('Failed to fetch some metrics for daily digest:', e);
  }

  // --- 4. Send the Master Executive Briefing ---
  if (sgKey) {
    const escalationRows = adminDigestItems.length > 0 
      ? adminDigestItems.map(it => `<tr><td style="padding:6px 0;font-size:12px;border-bottom:1px solid #FEE2E2;"><strong>${it.client}</strong> - ${it.furnisher} (${it.phase}) - ${it.daysElapsed} days</td></tr>`).join('')
      : '<tr><td style="padding:6px 0;font-size:12px;color:#6B7280;">No new escalations today.</td></tr>';

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;padding:20px;margin:0;">
      <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <div style="background:#1B2A4A;padding:24px;text-align:center;">
          <h1 style="color:#C9A84C;margin:0;font-size:24px;letter-spacing:-0.5px;">CCC Executive Briefing</h1>
          <p style="color:#9CA3AF;margin:8px 0 0;font-size:13px;text-transform:uppercase;letter-spacing:1px;">${todayISO()}</p>
        </div>
        
        <div style="padding:32px;">
          
          <h2 style="color:#111827;font-size:16px;margin:0 0 16px;border-bottom:1px solid #E5E7EB;padding-bottom:8px;">🚨 Action Required</h2>
          <table style="width:100%;margin-bottom:24px;border-collapse:collapse;">
            <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;"><strong>${unmailedCount}</strong> Unmailed Letters (Pending Batch)</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;"><strong>${adminDigestItems.length}</strong> Escalations Ready (30-day deadline)</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;"><strong>${pendingAuditsCount}</strong> Audits Pending Review</td></tr>
          </table>

          <h2 style="color:#111827;font-size:16px;margin:0 0 16px;border-bottom:1px solid #E5E7EB;padding-bottom:8px;">📈 Business Metrics (Last 24h)</h2>
          <table style="width:100%;margin-bottom:24px;border-collapse:collapse;">
            <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;"><strong>${newLeadsCount}</strong> New Leads</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;"><strong>${newClientsCount}</strong> New Clients (Signed)</td></tr>
          </table>

          <h2 style="color:#111827;font-size:16px;margin:0 0 16px;border-bottom:1px solid #E5E7EB;padding-bottom:8px;">🤖 Automated Activity (Last 24h)</h2>
          <table style="width:100%;margin-bottom:24px;border-collapse:collapse;">
            <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;"><strong>${leadsDrippedCount}</strong> Lead Nurture Emails Sent</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;"><strong>${clientUpdatesCount}</strong> Client Update Emails Sent</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;"><strong>${lobDeliveriesCount}</strong> Certified Letters Delivered</td></tr>
          </table>

          ${adminDigestItems.length > 0 ? `
          <h2 style="color:#111827;font-size:14px;margin:32px 0 12px;color:#DC2626;">Escalation Details</h2>
          <div style="background:#FEF2F2;border:1px solid #FCA5A5;border-radius:4px;padding:12px;">
            <table style="width:100%;border-collapse:collapse;">${escalationRows}</table>
          </div>` : ''}
          
          <div style="margin-top:32px;text-align:center;">
            <a href="https://ccc-forensic-demo.netlify.app" style="display:inline-block;background:#1B2A4A;color:#C9A84C;padding:12px 24px;text-decoration:none;border-radius:4px;font-weight:600;font-size:14px;">Open CCC Dashboard</a>
          </div>
        </div>
      </div>
    </body></html>`;

    await sendgridEmail(ADMIN_EMAIL, `CCC Executive Briefing: ${todayISO()}`, html, sgKey);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, leadsDripped: leadsDrippedCount, updatesSent: clientUpdatesCount }),
  };
};

exports.config = {
  schedule: '0 15 * * *',
};
