import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import authHelpers from './_requireAuth.cjs';
import emailHelpers from './_email.cjs';
import { buildProgressUpdatePdf, progressUpdateFilename, monthLabel as pdfMonthLabel } from '../../src/utils/progressUpdatePdf.js';
import { operationalAudits } from '../../src/utils/auditOperational.js';

const { requireStaff } = authHelpers;
const { sendEmail } = emailHelpers;

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
  return pdfMonthLabel(dateStr);
}

function excerpt(text, wordCount = 60) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (words.length <= wordCount) return words.join(' ');
  return words.slice(0, wordCount).join(' ') + '…';
}

function money(value) {
  return '$' + Math.round(Number(value) || 0).toLocaleString('en-US');
}

function progressEmailHtml({
  firstName,
  teaser,
  portalUrl,
  deletedFurnishers = [],
  deletedCount = 0,
  debtRemoved = 0,
  scoreLines = [],
  periodLabel = '',
}) {
  const escape = (value) => String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const winBox = deletedFurnishers.length > 0
    ? '<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:16px 20px;margin:0 0 20px;">'
      + '<p style="margin:0 0 6px;font-size:13px;font-weight:800;color:#15803D;letter-spacing:.04em;text-transform:uppercase;">Accounts removed</p>'
      + '<p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#166534;">' + deletedCount + '</p>'
      + '<p style="margin:0;font-size:12px;color:#166534;line-height:1.5;">' + deletedFurnishers.map(escape).join(' · ') + '</p>'
      + (debtRemoved > 0 ? '<p style="margin:10px 0 0;font-size:12px;color:#166534;">Reported balance cleared: <strong>' + money(debtRemoved) + '</strong></p>' : '')
      + '</div>'
    : '';

  const scoreHtml = scoreLines.length
    ? '<div style="display:flex;gap:8px;margin:0 0 22px;flex-wrap:wrap;">'
      + scoreLines.map((line) => (
        '<div style="flex:1;min-width:120px;background:#121F38;border-radius:10px;padding:14px 16px;">'
        + '<div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#C9A84C;font-weight:700;">' + escape(line.bureau) + '</div>'
        + '<div style="font-size:22px;font-weight:800;color:#fff;margin-top:6px;">' + escape(line.score) + '</div>'
        + '<div style="font-size:11px;color:#9CA3AF;margin-top:4px;">' + escape(line.deltaLabel) + '</div>'
        + '</div>'
      )).join('')
      + '</div>'
    : '';

  const teaserHtml = escape(teaser).split(/\n+/).map((p) => `<p style="font-size:14px;color:#374151;margin:0 0 14px;line-height:1.65;">${p}</p>`).join('');

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
    + '<body style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;padding:20px;background:#F3F0E8;">'
    + '<div style="background:#121F38;padding:28px 32px;border-radius:14px 14px 0 0;">'
    + '<div style="width:36px;height:3px;background:#C9A84C;margin-bottom:16px;"></div>'
    + '<div style="color:#C9A84C;font-size:10px;letter-spacing:.2em;text-transform:uppercase;font-weight:700;">Credit Comeback Club</div>'
    + '<h1 style="color:#fff;font-size:26px;margin:10px 0 6px;font-weight:800;">Your Progress Update</h1>'
    + (periodLabel ? '<p style="margin:0;color:#C9A84C;font-size:13px;">' + escape(periodLabel) + '</p>' : '')
    + '</div>'
    + '<div style="background:#fff;border:1px solid #E8E4DA;border-top:none;padding:28px 32px;border-radius:0 0 14px 14px;">'
    + '<p style="color:#6B7280;font-size:12px;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Hi ' + escape(firstName) + '</p>'
    + winBox
    + scoreHtml
    + teaserHtml
    + '<p style="font-size:13px;color:#6B7280;margin:0 0 22px;line-height:1.55;">Your full Progress Update PDF is attached. You can also review it anytime in your portal.</p>'
    + '<div style="text-align:center;margin:0 0 8px;"><a href="' + escape(portalUrl) + '" style="background:#121F38;color:#C9A84C;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:13px;display:inline-block;letter-spacing:.04em;">Open your portal</a></div>'
    + '<hr style="border:none;border-top:1px solid #E8E4DA;margin:28px 0 16px;">'
    + '<p style="font-size:11px;color:#9CA3AF;margin:0;">Credit Comeback Club · Grand Junction, CO · 970-644-0063 · creditcomebackclub.com</p>'
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
  if (deletedCount > 0) return 'An account was removed from your credit report';
  return 'Your ' + monthLabel(toReportDate) + ' Progress Update is ready';
}

function defaultEmailBody(narrative) {
  return excerpt(narrative, 80);
}

function buildScoreLines(scoreDeltas = {}) {
  return ['equifax', 'experian', 'transunion'].map((bureau) => {
    const s = scoreDeltas[bureau];
    if (!s || s.new == null) return null;
    const delta = s.delta;
    const deltaLabel = delta == null ? (s.old != null ? 'Was ' + s.old : 'Current score')
      : delta === 0 ? 'No change'
        : (delta > 0 ? '+' : '') + delta + (s.old != null ? ' from ' + s.old : '');
    return { bureau: bureau.charAt(0).toUpperCase() + bureau.slice(1), score: String(s.new), deltaLabel };
  }).filter(Boolean);
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
  const { data: auditRows, error } = await query.order('report_date', { ascending: false }).limit(25);
  if (error) throw error;
  const data = operationalAudits(auditRows).slice(0, 2);
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

async function sendProgressEmail({ to, subject, html, attachments = [] }) {
  return sendEmail({
    to,
    cc: ADMIN_CC_EMAIL,
    subject,
    html,
    attachments,
  });
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
      if (!row.narrative) {
        const origin = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://credit-comeback-club.netlify.app';
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

      const diff = row.diff || {};
      const deleted = Array.isArray(diff.deleted) ? diff.deleted : [];
      const deletedFurnishers = deleted.map((a) => a.furnisher).filter(Boolean);
      const subject = String(payload.emailSubject || row.email_subject || defaultSubject(row.to_report_date, deletedFurnishers.length)).trim();
      const bodyText = String(payload.emailBody || row.email_body || defaultEmailBody(narrative)).trim();
      if (!subject || !bodyText) {
        throw Object.assign(new Error('Email subject and body are required.'), { statusCode: 400 });
      }

      const pdfInput = {
        clientName: pair.clientName || row.client_name || 'Client',
        fromReportDate: row.from_report_date,
        toReportDate: row.to_report_date,
        narrative,
        diff,
        phaseProgress: row.phase_progress || [],
      };
      const pdfDoc = buildProgressUpdatePdf(pdfInput);
      const pdfBuffer = Buffer.from(pdfDoc.output('arraybuffer'));
      const fileName = progressUpdateFilename({
        clientName: pdfInput.clientName,
        toReportDate: row.to_report_date,
      });

      const origin = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://credit-comeback-club.netlify.app';
      const firstName = String(pair.clientName || 'there').split(' ')[0];
      const periodLabel = [monthLabel(row.from_report_date), monthLabel(row.to_report_date)].filter(Boolean).join(' → ');
      const html = progressEmailHtml({
        firstName,
        teaser: bodyText,
        portalUrl: origin.replace(/\/$/, '') + '/login',
        deletedFurnishers,
        deletedCount: deleted.length,
        debtRemoved: Number(diff.totalDebtRemoved) || 0,
        scoreLines: buildScoreLines(diff.scoreDeltas),
        periodLabel,
      });
      await sendProgressEmail({
        to,
        subject,
        html,
        attachments: [{
          content: pdfBuffer.toString('base64'),
          filename: fileName,
          type: 'application/pdf',
        }],
      });

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
