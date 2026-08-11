const https = require('https');
const { sendQueuedClientEmails } = require('./_roundEmail.cjs');
const { shouldSuppressGenericNurture } = require('./_leadNurture.cjs');

function supabaseRequest(path, method, body, url, key, extraHeaders = {}) {
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
        ...extraHeaders,
      },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {}, headers: res.headers }); }
        catch (e) { resolve({ status: res.statusCode, body: raw, headers: res.headers }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// PostgREST caps un-ranged responses (often at 1,000 rows). A cron that
// silently receives only its first page is worse than one that takes an
// extra request: older in-flight letters would stop receiving reminders.
// Keep each page comfortably below the hosted API's default maximum.
const REST_PAGE_SIZE = 250;

function isSuccessful(response) {
  return response && response.status >= 200 && response.status < 300;
}

async function listAllRows(path, url, key, pageSize = REST_PAGE_SIZE) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const response = await supabaseRequest(path, 'GET', null, url, key, {
      'Range-Unit': 'items',
      'Range': from + '-' + (from + pageSize - 1),
    });
    if (!isSuccessful(response)) {
      throw new Error('Supabase list failed (' + response.status + ') for ' + path.split('?')[0]);
    }
    const page = Array.isArray(response.body) ? response.body : [];
    // A proxy which ignored Range could return its own default (for example
    // 1,000 rows) on every pass. Refuse to loop over duplicated pages.
    if (page.length > pageSize) {
      throw new Error('Supabase ignored the requested page size for ' + path.split('?')[0]);
    }
    const contentRange = response.headers && response.headers['content-range'];
    const rangeMatch = contentRange && String(contentRange).match(/^(\d+)-\d+\/(?:\d+|\*)$/);
    if (page.length && rangeMatch && Number(rangeMatch[1]) !== from) {
      throw new Error('Supabase returned the wrong page for ' + path.split('?')[0]);
    }
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function countRows(path, url, key) {
  const response = await supabaseRequest(path, 'HEAD', null, url, key, { Prefer: 'count=exact' });
  if (!isSuccessful(response)) {
    throw new Error('Supabase count failed (' + response.status + ') for ' + path.split('?')[0]);
  }
  const range = response.headers && response.headers['content-range'];
  const match = range && String(range).match(/\/(\d+|\*)$/);
  return match && match[1] !== '*' ? Number(match[1]) : 0;
}

function chunks(values, size = 100) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

const TEMP_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function storageList(bucket, prefix, url, key) {
  return new Promise((resolve, reject) => {
    const path = '/storage/v1/object/list/' + bucket;
    const body = JSON.stringify({ prefix: prefix || '', limit: 100, offset: 0 });
    const u = new URL(url + path);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : [] }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function storageRemove(bucket, paths, url, key) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ prefixes: paths });
    const u = new URL(url + '/storage/v1/object/' + bucket);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname,
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function listStorageRecursive(bucket, prefix, url, key) {
  const out = [];
  const queue = [prefix || ''];
  while (queue.length) {
    const current = queue.shift();
    const res = await storageList(bucket, current, url, key);
    if (res.status < 200 || res.status >= 300 || !Array.isArray(res.body)) continue;
    for (const item of res.body) {
      const full = current ? current + '/' + item.name : item.name;
      if (item.id == null && !item.metadata) queue.push(full);
      else out.push({ path: full, updatedAt: item.updated_at || item.created_at });
    }
  }
  return out;
}

/** Delete documents/{firm}/temp/** and legacy temp-letters piles older than 48h. */
async function purgeExpiredMailTemps(supabaseUrl, supabaseKey) {
  const cutoff = Date.now() - TEMP_MAX_AGE_MS;
  // List top-level firm folders, then their temp trees.
  const top = await storageList('documents', '', supabaseUrl, supabaseKey);
  if (!Array.isArray(top.body)) return 0;
  const toDelete = [];
  for (const firm of top.body) {
    if (!firm.name || firm.id) continue; // only folders
    const firmId = firm.name;
    for (const sub of ['temp', 'temp-letters', 'temp-letter-assets']) {
      const objects = await listStorageRecursive('documents', firmId + '/' + sub, supabaseUrl, supabaseKey);
      for (const obj of objects) {
        const updated = obj.updatedAt ? Date.parse(obj.updatedAt) : 0;
        if (!updated || updated <= cutoff) toDelete.push(obj.path);
      }
    }
  }
  for (const batch of chunks(toDelete, 50)) {
    await storageRemove('documents', batch, supabaseUrl, supabaseKey);
  }
  return toDelete.length;
}

// PostgREST's `in.(...)` syntax needs quotes for names/emails. Encode the
// complete parenthesized value so a comma, ampersand, or quote in an email
// cannot change the surrounding REST query.
function inFilter(values) {
  const members = values.map((value) => '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"');
  return 'in.' + encodeURIComponent('(' + members.join(',') + ')');
}

function rememberUnique(map, key, row) {
  if (!key) return;
  if (!map.has(key)) {
    map.set(key, row);
  } else {
    const current = map.get(key);
    // The same profile can arrive once through the client-id batch and again
    // through the email batch. That is not ambiguity; a different profile is.
    const sameProfile = current && row
      && current.client_id === row.client_id
      && String(current.email || '').toLowerCase() === String(row.email || '').toLowerCase();
    if (sameProfile || current === null) return;
    // An email/name fallback that matches more than one portal profile is
    // unsafe. Preserve the ambiguity explicitly rather than selecting an
    // arbitrary client to email.
    map.set(key, null);
  }
}

async function loadClientProfiles({ clientIds = [], emails = [] }, url, key) {
  const byClientId = new Map();
  const byEmail = new Map();
  const uniqueIds = [...new Set(clientIds.filter(Boolean))];
  const uniqueEmails = [...new Set(emails.filter(Boolean).map((email) => String(email).toLowerCase()))];
  const fields = 'client_id,email,onboarding_complete,agreement_signed_at,signature_data';

  for (const part of chunks(uniqueIds)) {
    const rows = await listAllRows('/rest/v1/client_profiles?select=' + fields + '&client_id=' + inFilter(part) + '&order=client_id.asc', url, key);
    for (const row of rows) {
      rememberUnique(byClientId, row.client_id, row);
      rememberUnique(byEmail, row.email && String(row.email).toLowerCase(), row);
    }
  }
  for (const part of chunks(uniqueEmails)) {
    const rows = await listAllRows('/rest/v1/client_profiles?select=' + fields + '&email=' + inFilter(part) + '&order=email.asc', url, key);
    for (const row of rows) {
      rememberUnique(byClientId, row.client_id, row);
      rememberUnique(byEmail, row.email && String(row.email).toLowerCase(), row);
    }
  }
  return { byClientId, byEmail };
}

async function loadClientsByIds(ids, fields, url, key) {
  const byId = new Map();
  for (const part of chunks([...new Set(ids.filter(Boolean))])) {
    const rows = await listAllRows('/rest/v1/clients?select=' + fields + '&id=' + inFilter(part) + '&order=id.asc', url, key);
    for (const row of rows) byId.set(row.id, row);
  }
  return byId;
}

async function loadLatestAuditSummariesByClientIds(ids, url, key) {
  const latestByClientId = new Map();
  for (const part of chunks([...new Set(ids.filter(Boolean))])) {
    const rows = await listAllRows(
      '/rest/v1/audits?select=client_id,audit,saved_at,report_date&client_id=' + inFilter(part) + '&order=saved_at.desc',
      url,
      key
    );
    for (const row of rows) {
      if (!row.client_id) continue;
      const current = latestByClientId.get(row.client_id);
      const currentDate = current && (current.saved_at || current.report_date) || '';
      const rowDate = row.saved_at || row.report_date || '';
      if (!current || rowDate > currentDate) latestByClientId.set(row.client_id, row);
    }
  }
  return latestByClientId;
}

function sendMailQuiet(to, subject, html) {
  const { sendEmail } = require('./_email.cjs');
  return sendEmail({ to, subject, html })
    .then(() => ({ status: 200 }))
    .catch((e) => {
      console.error('Resend Error:', e.message || e);
      return { status: 500 };
    });
}

async function automatedEmailClaim(eventKey, eventType, recipient, clientId, supabaseUrl, supabaseKey) {
  const response = await supabaseRequest('/rest/v1/rpc/claim_automated_email_send', 'POST', {
    p_event_key: eventKey,
    p_event_type: eventType,
    p_recipient: recipient,
    p_client_id: clientId || null,
  }, supabaseUrl, supabaseKey);
  if (!isSuccessful(response)) throw new Error('Could not claim automated email: ' + response.status);
  return response.body || {};
}

async function updateAutomatedEmailSend(id, changes, supabaseUrl, supabaseKey) {
  const response = await supabaseRequest('/rest/v1/automated_email_sends?id=eq.' + encodeURIComponent(id), 'PATCH', {
    ...changes,
    updated_at: new Date().toISOString(),
  }, supabaseUrl, supabaseKey);
  if (!isSuccessful(response)) throw new Error('Could not update automated email record: ' + response.status);
}

async function sendAutomatedEmail({ eventKey, eventType, recipient, clientId, subject, html }, supabaseUrl, supabaseKey) {
  const claim = await automatedEmailClaim(eventKey, eventType, recipient, clientId, supabaseUrl, supabaseKey);
  if (!claim.claimed) return { skipped: 'already_claimed' };
  try {
    const { sendEmail } = require('./_email.cjs');
    const resendId = await sendEmail({
      to: recipient,
      subject,
      html,
      idempotencyKey: claim.idempotency_key,
      tags: { automated_email_send_id: claim.id },
    });
    await updateAutomatedEmailSend(claim.id, {
      send_status: 'sent', resend_email_id: resendId, sent_at: new Date().toISOString(), delivery_error: null,
    }, supabaseUrl, supabaseKey);
    return { sent: true, resendId };
  } catch (error) {
    // Keep the claim after an ambiguous failure: blindly retrying could send a
    // second notice if the provider accepted the first request before timing out.
    await updateAutomatedEmailSend(claim.id, {
      send_status: 'failed', delivery_error: String(error.message || error).slice(0, 1000),
    }, supabaseUrl, supabaseKey).catch((updateError) => console.error('Could not record automated email failure:', updateError.message));
    console.error('Automated email failed:', error.message || error);
    return { sent: false, error: String(error.message || error) };
  }
}

async function claimBillingInvoice({ clientId, billingPeriod, amount, description }, supabaseUrl, supabaseKey) {
  const response = await supabaseRequest('/rest/v1/rpc/claim_billing_invoice', 'POST', {
    p_client_id: clientId,
    p_billing_period: billingPeriod,
    p_amount: amount,
    p_description: description,
  }, supabaseUrl, supabaseKey);
  if (!isSuccessful(response)) throw new Error('Could not claim billing invoice: ' + response.status);
  return response.body || {};
}

function billingNoticeHtml({ name, eyebrow, paragraphs, tone, ctaLabel }) {
  const { wrapClientEmail, escapeHtml, BRAND } = require('./_email.cjs');
  const safeName = escapeHtml(name || 'there');
  const bodyHtml = `<p style="margin:0 0 14px;">Hi ${safeName},</p>`
    + (paragraphs || []).map((p) => `<p style="margin:0 0 14px;">${p}</p>`).join('')
    + `<p style="margin:0;">Thank you,<br/>Credit Comeback Club</p>`;
  return wrapClientEmail({
    eyebrow,
    tone: tone || 'default',
    bodyHtml,
    cta: { href: BRAND.portalUrl, label: ctaLabel || 'Open your portal →' },
    preheader: paragraphs && paragraphs[0] ? String(paragraphs[0]).replace(/<[^>]+>/g, '') : undefined,
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
  const { isConfigured } = require('./_email.cjs');
  const mailReady = isConfigured();
  const ADMIN_EMAIL = 'chris@cccpartners.co'; // Updated to send directly to Chris

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  const today = todayISO();
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  let leadsDrippedCount = 0;
  let clientUpdatesCount = 0;
  let clientEmailRetries = { processed: 0, sent: 0 };

  // "Action Required Escalations" in Settings > Notifications previously had
  // no effect anywhere — the daily digest below always includes escalations
  // regardless. Fetched once here to gate a real, immediate alert (see
  // admin30 handling in section 1) instead of just the once-a-day digest.
  let emailEscalationsEnabled = true;
  try {
    const settingsRes = await new Promise((resolve, reject) => {
      // Authenticated object path — client-docs is private after storage reorg.
      const u = new URL(supabaseUrl + '/storage/v1/object/authenticated/client-docs/admin/settings.json');
      https.get(u, { headers: { apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey } }, (res) => {
        let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      }).on('error', reject);
    });
    if (settingsRes.status === 200) {
      const parsed = JSON.parse(settingsRes.body);
      if (parsed?.notifications?.emailEscalations === false) emailEscalationsEnabled = false;
    }
  } catch (e) { /* default to enabled if settings can't be read */ }

  // Purge Lob mail temp objects older than 48h (canonical temp/ + legacy piles).
  let tempsPurged = 0;
  try {
    tempsPurged = await purgeExpiredMailTemps(supabaseUrl, supabaseKey);
  } catch (e) {
    console.warn('temp mail purge failed (non-fatal):', e.message || e);
  }

  async function fetch_send(action, payload) {
    const base = process.env.URL || process.env.DEPLOY_URL || 'https://ccc-forensic-demo.netlify.app';
    const res = await fetch(base + '/.netlify/functions/send-lpoa', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({ action, ...payload }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`fetch_send error ${res.status}: ${err}`);
    }
  }

  // --- 1. Process tracked delivery clocks and client updates ---
  const letters = await listAllRows(
    '/rest/v1/letters?select=id,client_id,client_name,furnisher,phase,round_number,target_type,target_bureau,mailed_date,delivered_at,response_due_at,response_outcome,notifications_sent,bureau_review_status,round_review_status&response_outcome=is.null&order=id.asc',
    supabaseUrl,
    supabaseKey
  );
  let profilesByClientId = new Map();
  if (mailReady) {
    try {
      const profiles = await loadClientProfiles({ clientIds: letters.map((letter) => letter.client_id) }, supabaseUrl, supabaseKey);
      profilesByClientId = profiles.byClientId;
    } catch (e) {
      // Delivery clocks and admin alerts must still run if a non-critical
      // client-email lookup fails. Never fall back to an ambiguous name.
      console.error('Could not batch-load client profiles for delivery notices:', e.message);
    }
  }
  const adminDigestItems = [];

  for (const letter of letters) {
    // Certified Mail is the source of truth for this operation. A letter
    // with no delivery event is an exception to reconcile with Lob/USPS, not
    // a silently assumed deadline based on its mailing date.
    if (!letter.delivered_at) continue;
    const isBureauDispute = letter.target_type === 'bureau' || String(letter.phase || '').startsWith('Phase 3');
    const isStructuredRound = !!letter.target_type;
    const baseWindowDays = isStructuredRound ? 30 : (isBureauDispute ? 45 : 30);
    const adminNotificationKey = isStructuredRound ? 'adminDue' : (isBureauDispute ? 'admin45' : 'admin30');
    const clockStart = letter.delivered_at.slice(0, 10);
    const daysElapsed = daysBetween(clockStart, today);
    const windowDays = letter.response_due_at
      ? Math.max(baseWindowDays, daysBetween(clockStart, String(letter.response_due_at).slice(0, 10)))
      : baseWindowDays;
    const sent = letter.notifications_sent || [];
    let newSent = [...sent];
    let touched = false;

    let clientEmail = null;
    if (mailReady) {
      const profile = letter.client_id ? profilesByClientId.get(letter.client_id) : null;
      // Legacy rows without client_id deliberately do not use full_name as a
      // fallback. `client_profiles` is not firm-scoped by name, and choosing
      // one same-named person would email the wrong consumer.
      clientEmail = profile && profile.email || null;
    }

    // Structured rounds use the durable client_emails milestones. Keep these
    // campaign drips only for unreconciled legacy phase rows so clients do not
    // receive duplicate or contradictory status messages.
    if (!isStructuredRound && mailReady && clientEmail && daysElapsed >= 7 && daysElapsed < 8 && !sent.includes('day7')) {
      try {
        await fetch_send('send_campaign_update', { clientName: letter.client_name, clientEmail, updateType: 'day7_checkin', furnisher: letter.furnisher, daysElapsed });
        newSent.push('day7'); touched = true;
        clientUpdatesCount++;
      } catch(e) { console.error('day7 email failed:', e); }
    }

    if (!isStructuredRound && !isBureauDispute && mailReady && clientEmail && daysElapsed >= 28 && daysElapsed < 30 && !sent.includes('day30')) {
      try {
        await fetch_send('send_campaign_update', { clientName: letter.client_name, clientEmail, updateType: 'day30_approaching', furnisher: letter.furnisher, daysElapsed });
        newSent.push('day30'); touched = true;
        clientUpdatesCount++;
      } catch(e) { console.error('day30 email failed:', e); }
    }

    if (daysElapsed >= windowDays && !sent.includes(adminNotificationKey)) {
      adminDigestItems.push({
        client: letter.client_name,
        furnisher: letter.furnisher,
        phase: letter.phase || 'Phase 1',
        daysElapsed,
        deliveredOrMailed: 'delivered ' + clockStart,
      });
      newSent.push(adminNotificationKey); touched = true;

      if (mailReady && emailEscalationsEnabled) {
        try {
          await sendMailQuiet(ADMIN_EMAIL, (isBureauDispute ? 'Bureau Response Review: ' : 'Response Review: ') + letter.client_name + ' / ' + letter.furnisher, (() => {
            const { wrapStaffEmail } = require('./_email.cjs');
            return wrapStaffEmail({
              eyebrow: isBureauDispute ? 'Bureau Response Review' : 'Response Review',
              title: letter.client_name + ' — ' + letter.furnisher,
              rows: [
                ['Phase', letter.phase || 'Phase 1'],
                ['Days elapsed', String(daysElapsed)],
                ['Clock start', String(clockStart || '—')],
              ],
              footer: `<p style="font-size:13px;color:#4B5563;margin:0;">${daysElapsed} days since confirmed delivery with no logged response. This has crossed the ${windowDays}-day operational review window and is ready for staff review.</p>`,
            });
          })());
        } catch (e) { console.error('Escalation alert email failed:', e.message); }
      }
    }

    if (touched) {
      await supabaseRequest(
        '/rest/v1/letters?id=eq.' + encodeURIComponent(letter.id),
        'PATCH', { notifications_sent: newSent }, supabaseUrl, supabaseKey
      );
    }
  }

  // --- 1.5 Process 35-Day Report Reminders ---
  let reportRefreshDripsCount = 0;
  if (mailReady) {
    try {
      const audits = await listAllRows(
        '/rest/v1/audits?select=id,client_id,client_name,user_id,saved_at,report_date&order=saved_at.desc,id.asc',
        supabaseUrl,
        supabaseKey
      );

      // Group by client_id when available (falls back to user_id+client_name
      // for rows not yet backfilled — see the client_id migration plan).
      // Grouping by client_name alone, with no user_id, used to let two
      // different firms' same-named clients collide into one "latest audit"
      // bucket below, which could then email/patch the WRONG firm's client
      // record entirely — client_id closes that, not just the same-tenant
      // same-name case.
      const latestAudits = new Map();
      for (const a of audits) {
        const dateStr = a.saved_at || a.report_date;
        if (!dateStr) continue;
        const key = a.client_id || (a.user_id + '::' + a.client_name);
        const currentLatest = latestAudits.get(key);
        if (!currentLatest || dateStr > (currentLatest.saved_at || currentLatest.report_date)) {
          latestAudits.set(key, a);
        }
      }

      const dueAudits = [...latestAudits.values()].filter((audit) => {
        const dateStr = audit.saved_at || audit.report_date;
        return !!dateStr && daysBetween(dateStr.slice(0, 10), today) >= 35;
      });
      const clientsById = await loadClientsByIds(
        dueAudits.map((audit) => audit.client_id),
        'id,email,lead_drips_sent',
        supabaseUrl,
        supabaseKey
      );

      for (const audit of dueAudits) {
        const clientName = audit.client_name;
        const dateStr = audit.saved_at || audit.report_date;
        const daysElapsed = daysBetween(dateStr.slice(0, 10), today);

        if (daysElapsed >= 35) {
          // A client id is mandatory for automation. The migration backfills
          // unambiguous legacy records; an unresolved duplicate name is a
          // staff-reconciliation case, never a reason to guess a recipient.
          if (!audit.client_id) {
            console.warn('Skipping 35-day report reminder for legacy audit without client_id:', audit.id);
            continue;
          }
          const clientRow = clientsById.get(audit.client_id) || null;

          if (clientRow && clientRow.email) {
            const sentDrips = clientRow.lead_drips_sent || [];
            const dripKey = `report35_${audit.id}`;

            if (!sentDrips.includes(dripKey)) {
              try {
                await fetch_send('send_report_refresh', { clientName, clientEmail: clientRow.email });
                const newDrips = [...sentDrips, dripKey];
                await supabaseRequest('/rest/v1/clients?id=eq.' + encodeURIComponent(audit.client_id), 'PATCH', { lead_drips_sent: newDrips }, supabaseUrl, supabaseKey);
                reportRefreshDripsCount++;
              } catch (e) {
                console.error('Report refresh email failed:', e);
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to process 35-day report reminders:', e);
    }
  }

  // --- 2. Lead Nurture: Track A (pre-invite) & Track B (post-invite) ---
  // Two tracks, gated on whether client_profiles has a row for this email at
  // all — that row is only created when staff sends a portal invite
  // (provision-user.cjs), so its mere existence (regardless of completion)
  // is what actually distinguishes "never invited" from "invited, hasn't
  // finished." The old single-track logic conflated the two and sent
  // "log in and sign your LPOA" emails to leads who'd never been given
  // portal access at all.
  //
  // Both tracks use daysSince >= target (not ===) so a day the cron fails
  // or doesn't run on doesn't permanently lose that touch — the next
  // successful run catches up the earliest unsent-and-due stage. Only ever
  // sends one email per lead per run, even when catching up multiple missed
  // stages, so a long gap doesn't dump a backlog on someone at once.
  let onboardingDripsCount = 0;
  let nurtureDripsCount = 0;
  if (mailReady) {
    const leads = await listAllRows(
      '/rest/v1/clients?select=id,user_id,name,email,lead_created_at,lead_drips_sent,tags,consultation_status&status=eq.lead&order=lead_created_at.asc,id.asc',
      supabaseUrl,
      supabaseKey
    );
    let leadProfiles = null;
    try {
      leadProfiles = await loadClientProfiles({
        clientIds: leads.map((lead) => lead.id),
        emails: leads.map((lead) => lead.email),
      }, supabaseUrl, supabaseKey);
    } catch (e) {
      // Do not accidentally send Track A to an already-invited client when
      // we cannot establish their portal state.
      console.error('Skipping lead drips because client profiles could not be batch-loaded:', e.message);
    }
    let latestLeadAudits = new Map();
    try {
      latestLeadAudits = await loadLatestAuditSummariesByClientIds(leads.map((lead) => lead.id), supabaseUrl, supabaseKey);
    } catch (e) {
      // Audit facts only personalize the email; generic copy remains safe.
      console.error('Could not batch-load lead audit summaries:', e.message);
    }

    // Track B — invited, hasn't finished signing LPOA / connecting monitoring.
    const onboardingSchedule = [
      { key: 'onboarding1', day: 1 },
      { key: 'onboarding2', day: 2 },
      { key: 'onboarding4', day: 4 },
      { key: 'onboarding7', day: 7 },
    ];
    // Track A — never invited yet; educational/social-proof nurture.
    const nurtureSchedule = [
      { key: 'nurtureA_day1', day: 1 },
      { key: 'nurtureA_day3', day: 3 },
      { key: 'nurtureA_day6', day: 6 },
      { key: 'nurtureA_day10', day: 10 },
      { key: 'nurtureA_day15', day: 15 },
      { key: 'nurtureA_day21', day: 21 },
      { key: 'nurtureA_day30', day: 30 },
    ];

    for (const lead of leads) {
      if (!leadProfiles) break;
      if (!lead.email || !lead.lead_created_at) continue;

      const profile = leadProfiles.byClientId.get(lead.id)
        || leadProfiles.byEmail.get(String(lead.email).toLowerCase())
        || null;
      const wasInvited = !!profile;
      const isOnboarded = profile && (profile.onboarding_complete || profile.signature_data);
      if (isOnboarded) continue; // fully signed up — neither track applies

      const createdDate = lead.lead_created_at.slice(0, 10);
      const daysSince = daysBetween(createdDate, today);
      const sentDrips = lead.lead_drips_sent || [];
      let newDrips = [...sentDrips];
      let touched = false;

      if (wasInvited) {
        for (const d of onboardingSchedule) {
          if (daysSince >= d.day && !sentDrips.includes(d.key)) {
            try {
              await fetch_send('send_onboarding_reminder', { clientName: lead.name, clientEmail: lead.email, day: d.day });
              newDrips.push(d.key);
              touched = true;
              onboardingDripsCount++;
            } catch (e) {
              console.error('Onboarding drip send failed:', e.message);
            }
            break;
          }
        }
      } else if (shouldSuppressGenericNurture(lead)) {
        // A Calendly booking or any staff-owned pipeline stage stops generic
        // acquisition nurture. Track B is untouched: it is a concrete pending
        // onboarding action, not persuasion.
      } else {
        for (const d of nurtureSchedule) {
          if (daysSince >= d.day && !sentDrips.includes(d.key)) {
            let auditSummary = null;
            // Audit `client_id` is the only acceptable association here. A
            // same-named legacy audit is not safe personalization data.
            const latest = latestLeadAudits.get(lead.id)?.audit || null;
            if (latest && latest.totalViolations != null) {
              auditSummary = {
                totalViolations: latest.totalViolations,
                accountsTargeted: latest.accountsTargeted,
                accountsScanned: latest.accountsScanned,
              };
            }

            try {
              await fetch_send('send_lead_nurture', { clientName: lead.name, clientEmail: lead.email, day: d.day, auditSummary });
              newDrips.push(d.key);
              touched = true;
              nurtureDripsCount++;
            } catch (e) {
              console.error('Lead nurture drip send failed:', e.message);
            }
            break;
          }
        }
      }

      if (touched) {
        await supabaseRequest(
          '/rest/v1/clients?id=eq.' + encodeURIComponent(lead.id),
          'PATCH', { lead_drips_sent: newDrips }, supabaseUrl, supabaseKey
        );
        leadsDrippedCount++;
      }
    }
  }

  // --- 2.5 Paused Client Winback Sweep (Retention Build 6) ---
  // This is a status update, not a marketing email: paused clients still
  // have statutory deadlines running on their file whether they're paying
  // or not. Depends on Build 5's shared in-flight-letter helper (this .cjs
  // file can't `require()` an ES module, so it's loaded via dynamic import,
  // which works from CommonJS) and Build 3's status_changed_at (the pause
  // clock the 21/45-day thresholds are measured from).
  let winbackSentCount = 0;
  if (mailReady) {
    try {
      const { inFlightLettersForClient } = await import('../../src/utils/inFlightLetters.js');

      const pausedClients = await listAllRows(
        '/rest/v1/clients?billing_status=eq.Paused&select=id,name,status_changed_at,winback_notifications_sent&order=status_changed_at.asc,id.asc',
        supabaseUrl,
        supabaseKey
      );
      let pausedProfilesByClientId = new Map();
      try {
        const profiles = await loadClientProfiles({ clientIds: pausedClients.map((client) => client.id) }, supabaseUrl, supabaseKey);
        pausedProfilesByClientId = profiles.byClientId;
      } catch (e) {
        console.error('Could not batch-load paused-client profiles:', e.message);
      }

      // Reuse the `letters` array already fetched above (all unresolved,
      // response_outcome is null) instead of a second per-client query.
      // Only client_id may associate an operational letter with a paused
      // client. A name fallback could disclose another same-named client's
      // deadline in this status email.
      const lettersByClient = new Map();
      for (const l of letters) {
        const key = l.client_id;
        if (!key) continue;
        if (!lettersByClient.has(key)) lettersByClient.set(key, []);
        lettersByClient.get(key).push({
          id: l.id, furnisher: l.furnisher, phase: l.phase,
          mailedDate: l.mailed_date, deliveredAt: l.delivered_at, responseOutcome: l.response_outcome,
          bureauReviewStatus: l.bureau_review_status || 'not_reviewed',
        });
      }

      for (const c of pausedClients) {
        if (!c.status_changed_at) continue; // no pause clock to measure from — pre-Build-3 data gap
        const pausedDate = c.status_changed_at.slice(0, 10);
        const daysPaused = daysBetween(pausedDate, today);
        const sentMarkers = c.winback_notifications_sent || [];
        // Keyed by pausedDate, not just the step name, so a client who
        // un-pauses and later pauses again (a new status_changed_at) starts
        // the sequence fresh instead of being skipped by a stale marker.
        const step2Marker = 'step2@' + pausedDate;
        const step1Marker = 'step1@' + pausedDate;

        let step = null;
        if (daysPaused >= 45 && !sentMarkers.includes(step2Marker)) step = 2;
        else if (daysPaused >= 21 && !sentMarkers.includes(step1Marker)) step = 1;
        if (!step) continue;

        const inFlight = inFlightLettersForClient(c.name, lettersByClient.get(c.id) || [], []);
        if (inFlight.length === 0) continue; // nothing worth sending — same rule for both steps

        const clientEmail = pausedProfilesByClientId.get(c.id)?.email || null;
        if (!clientEmail) continue;

        const remainLabel = (r) => r.daysRemaining === null ? 'In transit' : (r.daysRemaining <= 0 ? Math.abs(r.daysRemaining) + 'd overdue' : r.daysRemaining + 'd');
        const rows = [...inFlight]
          .sort((a, b) => (a.daysRemaining ?? Infinity) - (b.daysRemaining ?? Infinity))
          .map((r) => '<tr>'
            + '<td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #E5E7EB;">' + r.furnisher + '</td>'
            + '<td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #E5E7EB;">' + (r.mailDate ? r.mailDate.slice(0, 10) : '—') + '</td>'
            + '<td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #E5E7EB;">' + (r.deadline || '—') + '</td>'
            + '<td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #E5E7EB;text-align:right;">' + remainLabel(r) + '</td>'
            + '</tr>')
          .join('');

        const firstName = c.name.split(' ')[0] || c.name;
        const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
          + '<body style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;background:#F8F9FA;">'
          + '<div style="background:#1B2A4A;padding:20px 28px;border-radius:8px 8px 0 0;display:flex;align-items:center;gap:10px;">'
          + '<div style="background:#C9A84C;border-radius:5px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;"><span style="color:#1B2A4A;font-weight:800;font-size:12px;">CC</span></div>'
          + '<div style="color:#C9A84C;font-weight:700;font-size:14px;">Credit Comeback Club</div></div>'
          + '<div style="background:#fff;border:1px solid #E5E7EB;border-top:none;padding:28px;border-radius:0 0 8px 8px;">'
          + '<p style="color:#6B7280;font-size:12px;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Status Update</p>'
          + '<h1 style="font-size:18px;color:#1B2A4A;margin:0 0 16px;">Hi ' + firstName + ',</h1>'
          + '<p style="font-size:13px;color:#374151;margin:0 0 16px;">Your file has ' + inFlight.length + ' dispute letter' + (inFlight.length === 1 ? '' : 's') + ' with active statutory deadlines, whether or not your account is currently billing.</p>'
          + '<table style="width:100%;border-collapse:collapse;margin:0 0 16px;">'
          + '<thead><tr>'
          + '<th style="text-align:left;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#6B7280;border-bottom:1px solid #E5E7EB;">Furnisher</th>'
          + '<th style="text-align:left;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#6B7280;border-bottom:1px solid #E5E7EB;">Mailed</th>'
          + '<th style="text-align:left;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#6B7280;border-bottom:1px solid #E5E7EB;">Deadline</th>'
          + '<th style="text-align:right;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#6B7280;border-bottom:1px solid #E5E7EB;">Remaining</th>'
          + '</tr></thead><tbody>' + rows + '</tbody></table>'
          + '<p style="font-size:13px;color:#374151;margin:0 0 20px;">Any deadline that passes without a response becomes the basis for the next round.</p>'
          + '<div style="text-align:center;margin:0 0 20px;"><a href="https://ccc-forensic-demo.netlify.app" style="background:#1B2A4A;color:#C9A84C;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:bold;font-size:13px;display:inline-block;">View your portal &#8594;</a></div>'
          + '<hr style="border:none;border-top:1px solid #E5E7EB;margin:20px 0;">'
          + '<p style="font-size:11px;color:#9CA3AF;margin:0;">Credit Comeback Club | creditcomebackclub.com | 970-644-0063</p>'
          + '</div></body></html>';

        try {
          await sendMailQuiet(clientEmail, 'Status on your file — ' + inFlight.length + ' letter' + (inFlight.length === 1 ? '' : 's') + ' still active', html);
          await supabaseRequest(
            '/rest/v1/clients?id=eq.' + c.id,
            'PATCH', { winback_notifications_sent: [...sentMarkers, 'step' + step + '@' + pausedDate] }, supabaseUrl, supabaseKey
          );
          winbackSentCount++;
        } catch (e) {
          console.error('Winback email failed for', c.name, e.message);
        }
      }
    } catch (e) {
      console.error('Winback sweep failed:', e);
    }
  }

  // --- 3. Gather Business Metrics for Executive Briefing ---
  let unmailedCount = 0;
  let newLeadsCount = 0;
  let newClientsCount = 0;
  let pendingAuditsCount = 0;
  let lobDeliveriesCount = 0;

  // --- 4. Run Automated Billing Sweep ---
  let billingAlerts = [];
  try {
    const activeClients = await listAllRows(
      '/rest/v1/clients?billing_status=eq.Active&billing_type=eq.Automated%20Recurring&select=id,name,email,ledger,billing_start_date,billing_tier,referred_by&order=id.asc',
      supabaseUrl,
      supabaseKey
    );
    
    for (const c of activeClients) {
      const ledger = Array.isArray(c.ledger) ? c.ledger : [];
      // Amount Due = sum of unpaid invoices only, matching the UI logic in
      // ClientBillingPanel/BillingTab (commit 3d24663). round2 avoids float drift.
      const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
      let balanceDue = round2(ledger.reduce((sum, tx) => {
        if (tx.type === 'Invoice' && tx.status !== 'Paid') return sum + (parseFloat(tx.amount) || 0);
        return sum;
      }, 0));

      // 1. Calculate Next Invoice Date for Pre-Reminders
      if (c.billing_start_date) {
        const invoices = ledger.filter(t => t.type === 'Invoice');
        const payments = ledger.filter(t => t.type === 'Payment');
        // "Already billed before" must include Payment-type rows, not just
        // Invoice rows — clients backfilled with manually-logged payment
        // history (no Invoice rows at all) were previously treated as
        // brand new and re-charged the one-time "Initial Month & First
        // Work Fee" on top of months of real payments (caught 2026-07-23:
        // Austin Mote, William Pope, Stefani Bryant all got a bogus $154
        // invoice despite an active payment history).
        const billingEvents = [...invoices, ...payments];
        const hasPriorBilling = billingEvents.length > 0;
        const lastEvent = billingEvents.sort((a, b) => b.date.localeCompare(a.date))[0];
        const lastDateStr = lastEvent ? lastEvent.date : c.billing_start_date;
        const daysSinceLastBilling = Math.floor((new Date(today) - new Date(lastDateStr)) / (1000 * 60 * 60 * 24));

        const daysUntilDue = hasPriorBilling ? (30 - daysSinceLastBilling) : (0 - daysSinceLastBilling);

        if (c.billing_tier !== 'Paid In Full' || !hasPriorBilling) {
          if (daysUntilDue === 5 && c.email && mailReady) {
            await sendAutomatedEmail({
              eventKey: `billing:${c.id}:${lastDateStr}:pre_due_5`,
              eventType: 'billing_pre_due_5', recipient: c.email, clientId: c.id,
              subject: 'Upcoming Invoice in 5 Days',
              html: billingNoticeHtml({
                name: c.name, eyebrow: 'Billing Reminder',
                paragraphs: ['This is a quick reminder that your service fee will be due in 5 days.'],
                ctaLabel: 'View billing in your portal →',
              }),
            }, supabaseUrl, supabaseKey);
          } else if (daysUntilDue === 3 && c.email && mailReady) {
            await sendAutomatedEmail({
              eventKey: `billing:${c.id}:${lastDateStr}:pre_due_3`,
              eventType: 'billing_pre_due_3', recipient: c.email, clientId: c.id,
              subject: 'Upcoming Invoice in 3 Days',
              html: billingNoticeHtml({
                name: c.name, eyebrow: 'Billing Reminder',
                paragraphs: ['Your service fee will be due in 3 days. Please ensure your payment method on file is up to date.'],
                ctaLabel: 'Update payment in your portal →',
              }),
            }, supabaseUrl, supabaseKey);
          }
        }

        // 2. Generate Invoice if due today (or overdue)
        const isDue = (!hasPriorBilling && daysSinceLastBilling >= 0) || (hasPriorBilling && daysSinceLastBilling >= 30);

        if (isDue) {
          let amount = 99.00;
          let description = 'Monthly Service Fee';

          if (!hasPriorBilling) {
            if (c.billing_tier === 'Standard') { amount = 154.00; description = 'Initial Month & First Work Fee'; }
            else if (c.billing_tier === 'VIP') { amount = 248.00; description = 'VIP Initial Month & First Work Fee'; }
            else if (c.billing_tier === 'Paid In Full') { amount = 499.00; description = 'Paid In Full Service'; }
            else { amount = 99.00; description = 'Initial Service Fee'; }
          } else {
            if (c.billing_tier === 'Standard') { amount = 79.00; description = 'Standard Monthly Service Fee'; }
            else if (c.billing_tier === 'VIP') { amount = 149.00; description = 'VIP Monthly Service Fee'; }
          }

          if (hasPriorBilling && c.billing_tier === 'Paid In Full') {
             // Do not generate recurring invoices for Paid In Full
          } else {
            const newTx = {
              id: require('crypto').randomUUID(),
              date: today,
              type: 'Invoice',
              amount: amount,
              description: description,
              status: 'Due',
              created_at: new Date().toISOString()
            };
            const invoiceClaim = await claimBillingInvoice({
              clientId: c.id,
              billingPeriod: today,
              amount,
              description,
            }, supabaseUrl, supabaseKey);
            if (!invoiceClaim.created) continue;
            const createdInvoice = invoiceClaim.invoice || newTx;
            balanceDue = round2(balanceDue + amount);

            if (c.email && mailReady) {
              await sendAutomatedEmail({
                eventKey: `billing:${c.id}:${createdInvoice.id}:due_today`,
                eventType: 'billing_invoice_due_today',
                recipient: c.email,
                clientId: c.id,
                subject: 'Invoice Due Today',
                html: billingNoticeHtml({
                name: c.name,
                eyebrow: 'Invoice Due',
                paragraphs: [
                  'Your service fee of <strong>$' + amount.toFixed(2) + '</strong> is due today.',
                  'Please log in to your client portal to remit payment.',
                ],
                ctaLabel: 'Pay invoice →',
                }),
              }, supabaseUrl, supabaseKey);
            }
          }
        }
      }

      // 3. Check for PAST DUE invoices
      const unpaidInvoices = ledger.filter(t => t.type === 'Invoice' && t.status === 'Due');
      let isPausedNow = false;
      
      for (const inv of unpaidInvoices) {
        const daysPastDue = Math.floor((new Date(today) - new Date(inv.date)) / (1000 * 60 * 60 * 24));
        const invoiceKey = String(inv.id || `${c.id}:${inv.date}:${inv.amount}:${inv.description || ''}`);
        if (daysPastDue === 1 && c.email && mailReady) {
          await sendAutomatedEmail({
            eventKey: `billing:${c.id}:${invoiceKey}:past_due_1`,
            eventType: 'billing_past_due_1',
            recipient: c.email,
            clientId: c.id,
            subject: 'Invoice 1 Day Past Due',
            html: billingNoticeHtml({
            name: c.name,
            eyebrow: 'Past Due Notice',
            tone: 'warning',
            paragraphs: [
              'Your invoice is <strong>1 day past due</strong>.',
              'Please submit your payment to avoid service interruption.',
            ],
            ctaLabel: 'Pay now →',
            }),
          }, supabaseUrl, supabaseKey);
        } else if (daysPastDue === 3 && c.email && mailReady) {
          await sendAutomatedEmail({
            eventKey: `billing:${c.id}:${invoiceKey}:past_due_3`,
            eventType: 'billing_past_due_3',
            recipient: c.email,
            clientId: c.id,
            subject: 'Invoice 3 Days Past Due - Urgent',
            html: billingNoticeHtml({
            name: c.name,
            eyebrow: 'Urgent — Past Due',
            tone: 'urgent',
            paragraphs: [
              'Your invoice is <strong>3 days past due</strong>.',
              'Your service will be paused in 2 days if payment is not received.',
            ],
            ctaLabel: 'Pay now to avoid pause →',
            }),
          }, supabaseUrl, supabaseKey);
        } else if (daysPastDue === 5 && !isPausedNow) {
          if (c.email && mailReady) {
            await sendAutomatedEmail({
              eventKey: `billing:${c.id}:${invoiceKey}:service_paused`,
              eventType: 'billing_service_paused',
              recipient: c.email,
              clientId: c.id,
              subject: 'Final Notice: Service Paused',
              html: billingNoticeHtml({
              name: c.name,
              eyebrow: 'Service Paused',
              tone: 'urgent',
              paragraphs: [
                'Your service has been paused due to non-payment.',
                'Please remit payment immediately to resume services.',
              ],
              ctaLabel: 'Pay to resume →',
              }),
            }, supabaseUrl, supabaseKey);
          }
          await supabaseRequest(
            '/rest/v1/clients?id=eq.' + encodeURIComponent(c.id),
            'PATCH', { billing_status: 'Paused', exit_reason: 'non_payment' }, supabaseUrl, supabaseKey
          );
          isPausedNow = true;
          billingAlerts.push({ client: c.name, type: 'PAUSED', balance: balanceDue });
          if (c.referred_by && mailReady) {
            try {
              const base = process.env.URL || process.env.DEPLOY_URL || 'https://ccc-forensic-demo.netlify.app';
              const partnerRes = await fetch(base + '/.netlify/functions/notify-affiliate', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: 'Bearer ' + supabaseKey,
                },
                body: JSON.stringify({
                  event: 'exited',
                  clientId: c.id,
                  affiliateId: c.referred_by,
                  billingStatus: 'Paused',
                  exitReason: 'non_payment',
                }),
              });
              if (!partnerRes.ok) console.warn('daily-cron: affiliate exit email failed', await partnerRes.text());
            } catch (err) {
              console.warn('daily-cron: affiliate exit email error', err.message);
            }
          }
        }
      }


      // Simple heuristic: if balance > 0, they are overdue/due
      if (balanceDue > 0 && !isPausedNow) {
        billingAlerts.push({ client: c.name, type: 'DUE', balance: balanceDue });
      }
    }
  } catch (e) {
    console.error('Failed billing sweep:', e);
  }

  try {
    // Metrics are counts, not lists. HEAD + Content-Range avoids loading
    // every matching id merely to call `.length`.
    unmailedCount = await countRows('/rest/v1/letters?mailed_date=is.null', supabaseUrl, supabaseKey);
    newLeadsCount = await countRows(`/rest/v1/clients?status=eq.lead&lead_created_at=gte.${yesterday}`, supabaseUrl, supabaseKey);
    newClientsCount = await countRows(`/rest/v1/clients?status=eq.client&created_at=gte.${yesterday}`, supabaseUrl, supabaseKey);

    // Pending audits
    // Assuming audits table exists (based on typical use in this system)
    // Actually wait, audits are stored in the client_profiles table or where?
    // Let's just catch error if audits table doesn't exist
    try {
      pendingAuditsCount = await countRows('/rest/v1/audits?status=eq.pending', supabaseUrl, supabaseKey);
    } catch (e) {
      // Maybe audits is not a table? In this app, audits are often JSON in client_profiles or just letters?
      pendingAuditsCount = 'N/A';
    }

    lobDeliveriesCount = await countRows(`/rest/v1/letters?delivered_at=gte.${yesterday.slice(0,10)}`, supabaseUrl, supabaseKey);
  } catch (e) {
    console.warn('Failed to fetch some metrics for daily digest:', e);
  }

  // --- 4. Send the Master Executive Briefing ---
  if (mailReady) {
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
          <h2 style="color:#111827;font-size:14px;margin:32px 0 12px;color:#DC2626;">🚨 Escalation Details</h2>
          <div style="background:#FEF2F2;border:1px solid #FCA5A5;border-radius:4px;padding:12px;">
            <table style="width:100%;border-collapse:collapse;">${escalationRows}</table>
          </div>` : ''}

          ${billingAlerts.length > 0 ? `
          <h2 style="color:#111827;font-size:14px;margin:32px 0 12px;color:#047857;">💰 Billing Alerts</h2>
          <div style="background:#ECFDF5;border:1px solid #6EE7B7;border-radius:4px;padding:12px;">
            <table style="width:100%;border-collapse:collapse;">
              ${billingAlerts.map(b => {
                if (b.type === 'PAUSED') {
                  return '<tr><td style="padding:6px 0;font-size:12px;border-bottom:1px solid #D1FAE5;"><strong style="color:#DC2626">PAUSED</strong> <strong>' + b.client + '</strong> (Owes <strong>$' + b.balance.toFixed(2) + '</strong>)</td></tr>';
                } else {
                  return '<tr><td style="padding:6px 0;font-size:12px;border-bottom:1px solid #D1FAE5;"><strong>' + b.client + '</strong> is due for <strong>$' + b.balance.toFixed(2) + '</strong></td></tr>';
                }
              }).join('')}
            </table>
          </div>` : ''}
          
          <div style="margin-top:32px;text-align:center;">
            <a href="https://ccc-forensic-demo.netlify.app" style="display:inline-block;background:#1B2A4A;color:#C9A84C;padding:12px 24px;text-decoration:none;border-radius:4px;font-weight:600;font-size:14px;">Open CCC Dashboard</a>
          </div>
        </div>
      </div>
    </body></html>`;

    await sendAutomatedEmail({
      eventKey: `executive_briefing:${todayISO()}`,
      eventType: 'executive_briefing',
      recipient: ADMIN_EMAIL,
      clientId: null,
      subject: `CCC Executive Briefing: ${todayISO()}`,
      html,
    }, supabaseUrl, supabaseKey);
  }

  // --- Partner monthly summary (1st of month) ---
  let affiliateSummariesSent = 0;
  if (mailReady && todayISO().slice(8, 10) === '01') {
    try {
      const base = process.env.URL || process.env.DEPLOY_URL || 'https://ccc-forensic-demo.netlify.app';
      // Summarize the month that just ended.
      const prior = new Date(Date.UTC(
        Number(todayISO().slice(0, 4)),
        Number(todayISO().slice(5, 7)) - 2,
        1
      ));
      const monthKey = prior.toISOString().slice(0, 7);
      const partnerRes = await fetch(base + '/.netlify/functions/notify-affiliate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + supabaseKey,
        },
        body: JSON.stringify({ event: 'monthly_summary', monthKey }),
      });
      if (partnerRes.ok) {
        const body = await partnerRes.json().catch(() => ({}));
        affiliateSummariesSent = body.count || 0;
      } else {
        console.warn('daily-cron: affiliate monthly summary failed', await partnerRes.text());
      }
    } catch (e) {
      console.warn('daily-cron: affiliate monthly summary error', e.message);
    }
  }

  if (mailReady) {
    try {
      clientEmailRetries = await sendQueuedClientEmails(25);
    } catch (e) {
      console.warn('daily-cron: queued client email retry failed', e.message || e);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      onboardingRemindersSent: onboardingDripsCount,
      leadNurtureSent: nurtureDripsCount,
      updatesSent: clientUpdatesCount,
      winbackSent: winbackSentCount,
      affiliateSummariesSent,
      clientEmailRetries,
      tempsPurged,
    }),
  };
};

exports.config = {
  schedule: '0 15 * * *',
};
