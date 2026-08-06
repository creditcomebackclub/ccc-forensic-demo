import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import authHelpers from './_requireAuth.cjs';

const { requireStaff } = authHelpers;

const ADMIN_CC_EMAIL = 'chris@cccpartners.co';

function response(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function slug(s) {
  return String(s || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'unknown';
}

function monthLabel(dateStr) {
  if (!dateStr) return '';
  return new Date(String(dateStr) + (String(dateStr).includes('T') ? '' : 'T00:00:00'))
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function excerpt(text, wordCount = 60) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (words.length <= wordCount) return words.join(' ');
  return words.slice(0, wordCount).join(' ') + '…';
}

function progressEmailHtml({ firstName, teaser, portalUrl, deletedFurnishers = [] }) {
  const escape = (value) => String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const winBox = deletedFurnishers.length > 0
    ? '<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:16px 20px;margin:0 0 20px;">'
      + '<p style="margin:0 0 6px;font-size:14px;font-weight:800;color:#15803D;">&#127942; '
      + (deletedFurnishers.length === 1 ? 'An account was deleted from your report!' : deletedFurnishers.length + ' accounts were deleted from your report!')
      + '</p>'
      + '<p style="margin:0;font-size:12px;color:#166534;">' + deletedFurnishers.map(escape).join(', ') + '</p>'
      + '</div>'
    : '';
  const teaserHtml = escape(teaser).split(/\n+/).map((p) => `<p style="font-size:13px;color:#374151;margin:0 0 14px;">${p}</p>`).join('');
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
    + '<body style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;background:#F8F9FA;">'
    + '<div style="background:#1B2A4A;padding:20px 28px;border-radius:8px 8px 0 0;display:flex;align-items:center;gap:10px;">'
    + '<div style="background:#C9A84C;border-radius:5px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;"><span style="color:#1B2A4A;font-weight:800;font-size:12px;">CC</span></div>'
    + '<div style="color:#C9A84C;font-weight:700;font-size:14px;">Credit Comeback Club</div></div>'
    + '<div style="background:#fff;border:1px solid #E5E7EB;border-top:none;padding:28px;border-radius:0 0 8px 8px;">'
    + '<p style="color:#6B7280;font-size:12px;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Progress Update</p>'
    + '<h1 style="font-size:20px;color:#1B2A4A;margin:0 0 16px;">Hi ' + escape(firstName) + ',</h1>'
    + winBox
    + teaserHtml
    + '<div style="text-align:center;margin:0 0 20px;"><a href="' + escape(portalUrl) + '" style="background:#1B2A4A;color:#C9A84C;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:bold;font-size:13px;display:inline-block;">View your full update &#8594;</a></div>'
    + '<hr style="border:none;border-top:1px solid #E5E7EB;margin:20px 0;">'
    + '<p style="font-size:11px;color:#9CA3AF;margin:0;">Credit Comeback Club | creditcomebackclub.com | 970-644-0063</p>'
    + '</div></body></html>';
}

function serverClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server environment is not configured.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: ws } });
}

function progressId(clientName, clientId, fromDate, toDate) {
  return clientId
    ? slug(clientName) + '__' + clientId + '__diff__' + fromDate + '__' + toDate
    : slug(clientName) + '__diff__' + fromDate + '__' + toDate;
}

function safeUpdate(row) {
  if (!row) return null;
  const diff = row.diff || {};
  return {
    id: row.id,
    status: row.status || (row.emailed_at ? 'sent' : 'draft'),
    clientId: row.client_id,
    clientName: row.client_name,
    fromReportDate: row.from_report_date,
    toReportDate: row.to_report_date,
    fromAuditId: row.from_audit_id,
    toAuditId: row.to_audit_id,
    narrative: row.narrative || null,
    narrativeGeneratedAt: row.narrative_generated_at || null,
    emailSubject: row.email_subject || null,
    emailBody: row.email_body || null,
    emailedAt: row.emailed_at || null,
    sentTo: row.sent_to || null,
    diff: {
      scoreDeltas: diff.scoreDeltas || {},
      deleted: diff.deleted || [],
      new: diff.new || [],
      changed: diff.changed || [],
      negativeCounts: diff.negativeCounts || null,
      totalDebtRemoved: diff.totalDebtRemoved || 0,
    },
    phaseProgress: row.phase_progress || null,
  };
}

function defaultSubject(toReportDate, deletedCount) {
  if (deletedCount > 0) return '\u{1F3C6} An account was deleted from your report!';
  return 'Your ' + monthLabel(toReportDate) + ' credit report update';
}

function defaultEmailBody(narrative) {
  return excerpt(narrative, 60);
}

async function loadLatestPair(db, { userId, clientId, clientName, caller }) {
  let query = db.from('audits').select('id,user_id,client_id,client_name,report_date,audit,saved_at');
  if (clientId) query = query.eq('client_id', clientId);
  else if (clientName) {
    query = query.eq('client_name', clientName);
    if (caller.role !== 'admin') query = query.eq('user_id', userId);
  } else {
    throw Object.assign(new Error('A client id or name is required.'), { statusCode: 400 });
  }
  if (caller.role !== 'admin' && clientId) query = query.eq('user_id', userId);
  const { data, error } = await query.order('report_date', { ascending: false }).limit(2);
  if (error) throw error;
  if (!data || data.length < 2) {
    throw Object.assign(new Error('Need at least two audits for this client to open a Progress Update.'), { statusCode: 409 });
  }
  const [newer, older] = data;
  if (caller.role !== 'admin' && newer.user_id !== userId) {
    throw Object.assign(new Error('You do not have access to this client.'), { statusCode: 403 });
  }
  return { newer, older, clientName: newer.client_name || clientName, clientId: newer.client_id || clientId || null };
}

async function loadOrCreateRow(db, pair, userId) {
  const id = progressId(pair.clientName, pair.clientId, pair.older.report_date, pair.newer.report_date);
  const { data: existing, error } = await db.from('progress_updates').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (existing) return existing;

  // Studio opened before the background narrative job finished — seed the
  // row so staff can poll for narrative. Diff is filled by the background
  // job; we only create a stub keyed to the same id format.
  const { data: created, error: insertError } = await db.from('progress_updates').upsert({
    id,
    user_id: userId,
    client_id: pair.clientId || null,
    client_name: pair.clientName,
    from_audit_id: pair.older.id,
    to_audit_id: pair.newer.id,
    from_report_date: pair.older.report_date,
    to_report_date: pair.newer.report_date,
    diff: {},
    status: 'draft',
  }).select('*').single();
  if (insertError) throw insertError;
  return created;
}

async function sendGridProgressEmail({ to, subject, html }) {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error('SENDGRID_API_KEY is not configured.');
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }], cc: [{ email: ADMIN_CC_EMAIL }] }],
      from: { email: 'chris@cccpartners.co', name: 'Credit Comeback Club' },
      subject,
      content: [{ type: 'text/html', value: html }],
    }),
  });
  if (!res.ok) throw new Error(`SendGrid error ${res.status}: ${await res.text()}`);
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });
  let caller;
  try { caller = await requireStaff(event); }
  catch (error) { return error?.statusCode ? error : response(401, { error: 'Staff session required' }); }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return response(400, { error: 'Invalid JSON' }); }

  try {
    const db = serverClient();
    const action = payload.action;
    const pair = await loadLatestPair(db, {
      userId: caller.userId,
      clientId: payload.clientId || null,
      clientName: payload.clientName || null,
      caller,
    });

    if (action === 'status') {
      const row = await loadOrCreateRow(db, pair, pair.newer.user_id || caller.userId);
      const update = safeUpdate(row);
      if (!update.emailSubject) {
        update.emailSubject = defaultSubject(update.toReportDate, (update.diff.deleted || []).length);
      }
      if (!update.emailBody && update.narrative) {
        update.emailBody = defaultEmailBody(update.narrative);
      }
      // Kick generation if the draft has no narrative yet (idempotent bg job).
      if (!row.narrative) {
        const origin = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://ccc-forensic-demo.netlify.app';
        fetch(`${origin}/.netlify/functions/progress-narrative-background`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            clientName: pair.clientName,
            clientId: pair.clientId,
            userId: pair.newer.user_id || caller.userId,
          }),
        }).catch((err) => console.warn('[progress-update] narrative trigger failed', err.message));
      }
      return response(200, { update, generating: !row.narrative });
    }

    if (action === 'save') {
      const row = await loadOrCreateRow(db, pair, pair.newer.user_id || caller.userId);
      if (row.status === 'sent' || row.emailed_at) {
        throw Object.assign(new Error('This progress update was already sent. Open a newer audit pair to edit a draft.'), { statusCode: 409 });
      }
      const narrative = payload.narrative != null ? String(payload.narrative) : row.narrative;
      const emailSubject = payload.emailSubject != null ? String(payload.emailSubject) : row.email_subject;
      const emailBody = payload.emailBody != null ? String(payload.emailBody) : row.email_body;
      if (!String(narrative || '').trim()) {
        throw Object.assign(new Error('Narrative is required before saving.'), { statusCode: 400 });
      }
      const { data: updated, error } = await db.from('progress_updates').update({
        narrative: String(narrative).trim(),
        email_subject: String(emailSubject || '').trim() || null,
        email_body: String(emailBody || '').trim() || null,
        status: 'draft',
      }).eq('id', row.id).select('*').single();
      if (error) throw error;
      return response(200, { update: safeUpdate(updated), saved: true });
    }

    if (action === 'send') {
      const row = await loadOrCreateRow(db, pair, pair.newer.user_id || caller.userId);
      if (row.status === 'sent' || row.emailed_at) {
        return response(200, { update: safeUpdate(row), sent: true, alreadySent: true });
      }
      const narrative = String(payload.narrative != null ? payload.narrative : row.narrative || '').trim();
      if (!narrative) throw Object.assign(new Error('Wait for the narrative to finish generating, then review it before sending.'), { statusCode: 409 });

      const to = String(payload.clientEmail || '').trim().toLowerCase();
      if (!to || !/^\S+@\S+\.\S+$/.test(to)) {
        throw Object.assign(new Error('A valid recipient email is required.'), { statusCode: 400 });
      }

      const deletedFurnishers = ((row.diff && row.diff.deleted) || []).map((a) => a.furnisher).filter(Boolean);
      const subject = String(payload.emailSubject || row.email_subject || defaultSubject(row.to_report_date, deletedFurnishers.length)).trim();
      const bodyText = String(payload.emailBody || row.email_body || defaultEmailBody(narrative)).trim();
      if (!subject || !bodyText) {
        throw Object.assign(new Error('Email subject and body are required.'), { statusCode: 400 });
      }

      const origin = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://ccc-forensic-demo.netlify.app';
      const firstName = String(pair.clientName || 'there').split(' ')[0];
      const html = progressEmailHtml({
        firstName,
        teaser: bodyText,
        portalUrl: origin.replace(/\/$/, '') + '/login',
        deletedFurnishers,
      });
      await sendGridProgressEmail({ to, subject, html });

      const now = new Date().toISOString();
      const { data: updated, error } = await db.from('progress_updates').update({
        narrative,
        email_subject: subject,
        email_body: bodyText,
        status: 'sent',
        emailed_at: now,
        sent_to: to,
        sent_by: caller.userId,
      }).eq('id', row.id).select('*').single();
      if (error) throw error;
      return response(200, { update: safeUpdate(updated), sent: true });
    }

    return response(400, { error: 'Unknown action' });
  } catch (error) {
    console.error('[progress-update]', error);
    return response(error.statusCode || 500, { error: error.message || 'Progress Update request failed.' });
  }
};
