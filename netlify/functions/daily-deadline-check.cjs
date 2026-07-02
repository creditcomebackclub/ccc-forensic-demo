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
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
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
  const ADMIN_EMAIL = 'creditcomebackclub@gmail.com';

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  const today = todayISO();

  const lettersRes = await supabaseRequest(
    '/rest/v1/letters?select=id,client_name,furnisher,phase,mailed_date,delivered_at,response_outcome,notifications_sent&response_outcome=is.null',
    'GET', null, supabaseUrl, supabaseKey
  );

  if (lettersRes.status < 200 || lettersRes.status >= 300) {
    console.error('Failed to fetch letters:', lettersRes.status, lettersRes.body);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to fetch letters' }) };
  }

  const letters = Array.isArray(lettersRes.body) ? lettersRes.body : [];
  const adminDigestItems = [];

  async function fetch_send(action, payload) {
    try {
      const base = process.env.URL || process.env.DEPLOY_URL || '';
      await fetch(base + '/.netlify/functions/send-lpoa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
    } catch (e) {
      console.error('Client notification send failed (non-fatal):', e.message);
    }
  }

  for (const letter of letters) {
    if (!letter.mailed_date) continue;
    const clockStart = letter.delivered_at ? letter.delivered_at.slice(0, 10) : letter.mailed_date;
    const daysElapsed = daysBetween(clockStart, today);
    const sent = letter.notifications_sent || [];
    const newSent = [...sent];
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
      await fetch_send('send_campaign_update', { clientName: letter.client_name, clientEmail, updateType: 'day7_checkin', furnisher: letter.furnisher, daysElapsed });
      newSent.push('day7'); touched = true;
    }

    if (sgKey && clientEmail && daysElapsed >= 28 && daysElapsed < 30 && !sent.includes('day30')) {
      await fetch_send('send_campaign_update', { clientName: letter.client_name, clientEmail, updateType: 'day30_approaching', furnisher: letter.furnisher, daysElapsed });
      newSent.push('day30'); touched = true;
    }

    if (daysElapsed >= 30 && !sent.includes('admin30')) {
      adminDigestItems.push({
        client: letter.client_name,
        furnisher: letter.furnisher,
        phase: letter.phase,
        daysElapsed,
        deliveredOrMailed: letter.delivered_at ? 'delivered ' + clockStart : 'mailed ' + clockStart + ' (no delivery confirmation)',
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

  if (sgKey && adminDigestItems.length > 0) {
    const rows = adminDigestItems.map(it =>
      '<tr>' +
      '<td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;font-size:12px;">' + it.client + '</td>' +
      '<td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;font-size:12px;">' + it.furnisher + '</td>' +
      '<td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;font-size:12px;">' + (it.phase || 'Phase 1') + '</td>' +
      '<td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;font-size:12px;">' + it.daysElapsed + ' days · ' + it.deliveredOrMailed + '</td>' +
      '</tr>'
    ).join('');

    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
      + '<body style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;padding:20px;background:#F8F9FA;">'
      + '<div style="background:#1B2A4A;padding:20px 28px;border-radius:8px 8px 0 0;">'
      + '<div style="color:#C9A84C;font-weight:700;font-size:16px;">Credit Comeback Club — 30-Day Deadline Report</div></div>'
      + '<div style="background:#fff;border:1px solid #E5E7EB;border-top:none;padding:24px;border-radius:0 0 8px 8px;">'
      + '<p style="font-size:13px;color:#374151;">The following letters have crossed the 30-day statutory response window with no response logged. These are ready for Phase 2 non-response analysis and Phase 3 escalation.</p>'
      + '<table style="width:100%;border-collapse:collapse;margin-top:12px;">'
      + '<thead><tr style="background:#F3F4F6;">'
      + '<th style="text-align:left;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#6B7280;">Client</th>'
      + '<th style="text-align:left;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#6B7280;">Furnisher</th>'
      + '<th style="text-align:left;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#6B7280;">Phase</th>'
      + '<th style="text-align:left;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#6B7280;">Status</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table>'
      + '<p style="font-size:12px;color:#6B7280;margin-top:20px;">Log in to the <a href="https://ccc-forensic-demo.netlify.app" style="color:#1B2A4A;font-weight:600;">admin dashboard</a> to review and escalate.</p>'
      + '</div></body></html>';

    await sendgridEmail(ADMIN_EMAIL, '30-Day Deadline Report — ' + adminDigestItems.length + ' letter(s) ready to escalate', html, sgKey);
  }

  // ---- Lead drip sequence ----
  // Schedule: day 0-1, day 3, day 7, day 10, day 14 (5 touches over two weeks)
  let leadsProcessed = 0;
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
            const base = process.env.URL || process.env.DEPLOY_URL || '';
            await fetch(base + '/.netlify/functions/send-lpoa', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'send_lead_drip', leadName: lead.name, leadEmail: lead.email, emailNumber: d.num }),
            });
            newDrips.push(d.key);
            touched = true;
            leadsProcessed++;
          } catch (e) {
            console.error('Lead drip send failed (non-fatal):', e.message);
          }
          break; // only one drip per lead per day
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

  return {
    statusCode: 200,
    body: JSON.stringify({ checked: letters.length, adminDigestSent: adminDigestItems.length > 0, adminDigestCount: adminDigestItems.length, leadsProcessed }),
  };
};

exports.config = {
  schedule: '@daily',
};
