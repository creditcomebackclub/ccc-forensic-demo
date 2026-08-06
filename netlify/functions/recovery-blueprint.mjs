import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { buildRecoveryBlueprintModel, RECOVERY_BLUEPRINT_TEMPLATE_VERSION, recoveryBlueprintFilename } from '../../src/utils/recoveryBlueprintModel.js';
import { buildRecoveryBlueprintPdf } from '../../src/utils/recoveryBlueprintPdf.js';
import authHelpers from './_requireAuth.cjs';

const { requireStaff } = authHelpers;
const BUCKET = 'recovery-blueprints';

function response(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function serverClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server environment is not configured.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: ws } });
}

async function loadAudit(db, payload, caller) {
  let query = db.from('audits').select('id,user_id,client_id,client_name,report_date,audit,saved_at');
  if (payload.auditId) {
    query = query.eq('id', payload.auditId);
  } else if (payload.clientId) {
    query = query.eq('client_id', payload.clientId);
    if (payload.reportDate) query = query.eq('report_date', payload.reportDate);
  } else if (payload.clientName) {
    query = query.eq('client_name', payload.clientName);
    if (payload.reportDate) query = query.eq('report_date', payload.reportDate);
    if (caller.role !== 'admin') query = query.eq('user_id', caller.userId);
  } else {
    throw Object.assign(new Error('An audit id or client identifier is required.'), { statusCode: 400 });
  }
  const { data, error } = await query.order('saved_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error('Saved audit not found.'), { statusCode: 404 });
  if (caller.role !== 'admin' && data.user_id !== caller.userId) {
    throw Object.assign(new Error('You do not have access to this audit.'), { statusCode: 403 });
  }
  return data;
}

function auditHash(audit) {
  return crypto.createHash('sha256').update(JSON.stringify(audit)).digest('hex');
}

function safeArtifact(row, signedUrl = null, currentAuditHash = null) {
  if (!row) return null;
  return {
    id: row.id,
    auditId: row.audit_id,
    version: row.version,
    status: row.status,
    templateVersion: row.template_version,
    fileName: row.file_name,
    approvedAt: row.approved_at,
    sentAt: row.sent_at,
    sentTo: row.sent_to,
    deliveryStatus: row.delivery_status,
    deliveryEventAt: row.delivery_event_at,
    deliveryError: row.delivery_error,
    deliveredAt: row.delivered_at,
    viewedAt: row.viewed_at,
    isCurrent: currentAuditHash ? row.audit_sha256 === currentAuditHash : true,
    signedUrl,
  };
}

async function latestArtifact(db, auditId) {
  const { data, error } = await db.from('recovery_blueprints')
    .select('*').eq('audit_id', auditId).order('version', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

async function signedUrl(db, path) {
  if (!path) return null;
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 60 * 15);
  if (error) throw error;
  return data?.signedUrl || null;
}

function pdfBuffer(audit, clientId, reportDate) {
  const model = buildRecoveryBlueprintModel(audit, { clientId, reportDate });
  const doc = buildRecoveryBlueprintPdf(model);
  return { model, buffer: Buffer.from(doc.output('arraybuffer')) };
}

async function sendGridEmail({ to, subject, bodyText, fileName, buffer, artifactId }) {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error('SENDGRID_API_KEY is not configured.');
  const escape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paragraphs = String(bodyText).split(/\n{2,}/).map((paragraph) =>
    `<p style="margin:0 0 14px;">${paragraph.split('\n').map(escape).join('<br>')}</p>`).join('');
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#111827"><div style="background:#1B2A4A;padding:24px 32px"><h1 style="color:#C9A84C;margin:0;font-size:20px">Credit Comeback Club</h1><p style="color:#fff;margin:5px 0 0;font-size:12px;text-transform:uppercase;letter-spacing:.08em">Your Recovery Blueprint</p></div><div style="border:1px solid #ddd;border-top:0;padding:26px 32px;font-size:14px;line-height:1.6">${paragraphs}<hr style="border:0;border-top:1px solid #eee;margin:24px 0"><p style="font-size:11px;color:#999">Credit Comeback Club | Grand Junction, CO | 970-644-0063</p></div></body></html>`;
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }], custom_args: { recovery_blueprint_id: artifactId } }],
      from: { email: 'chris@cccpartners.co', name: 'Credit Comeback Club' },
      subject,
      content: [{ type: 'text/html', value: html }],
      attachments: [{ content: buffer.toString('base64'), filename: fileName, type: 'application/pdf', disposition: 'attachment' }],
    }),
  });
  if (!res.ok) throw new Error(`SendGrid error ${res.status}: ${await res.text()}`);
  return res.headers.get('x-message-id');
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
    const auditRow = await loadAudit(db, payload, caller);
    const action = payload.action;

    if (action === 'status') {
      const artifact = await latestArtifact(db, auditRow.id);
      return response(200, { auditId: auditRow.id, artifact: safeArtifact(artifact, artifact ? await signedUrl(db, artifact.storage_path) : null, auditHash(auditRow.audit)) });
    }

    if (action === 'save_corrections') {
      const corrections = new Map((Array.isArray(payload.accounts) ? payload.accounts : []).map((account) => [account.id, account]));
      const nextAudit = { ...auditRow.audit, accounts: (auditRow.audit.accounts || []).map((account) => {
        const correction = corrections.get(account.id);
        if (!correction) return account;
        return {
          ...account,
          balance: Number.isFinite(Number(correction.balance)) ? Number(correction.balance) : account.balance,
          status: String(correction.status || account.status || '').trim(),
          accountNumberMasked: String(correction.accountNumberMasked || account.accountNumberMasked || '').trim(),
          originalCreditor: correction.originalCreditor == null ? account.originalCreditor : String(correction.originalCreditor).trim() || null,
        };
      }) };
      const { error } = await db.from('audits').update({ audit: nextAudit }).eq('id', auditRow.id).eq('user_id', auditRow.user_id);
      if (error) throw error;
      return response(200, { saved: true, auditId: auditRow.id });
    }

    if (action === 'preview') {
      const { model, buffer } = pdfBuffer(auditRow.audit, auditRow.client_id, auditRow.report_date);
      return response(200, { auditId: auditRow.id, fileName: recoveryBlueprintFilename(model), pdfBase64: buffer.toString('base64'), templateVersion: model.templateVersion });
    }

    if (action === 'approve') {
      const latest = await latestArtifact(db, auditRow.id);
      const version = (latest?.version || 0) + 1;
      const { model, buffer } = pdfBuffer(auditRow.audit, auditRow.client_id, auditRow.report_date);
      const sha = crypto.createHash('sha256').update(buffer).digest('hex');
      const fileName = recoveryBlueprintFilename(model);
      const path = `${auditRow.user_id}/${auditRow.id}/v${version}-${sha.slice(0, 12)}.pdf`;
      const { error: uploadError } = await db.storage.from(BUCKET).upload(path, buffer, { contentType: 'application/pdf', upsert: false });
      if (uploadError) throw uploadError;
      const { data: artifact, error: insertError } = await db.from('recovery_blueprints').insert({
        audit_id: auditRow.id,
        user_id: auditRow.user_id,
        client_id: auditRow.client_id,
        client_name: auditRow.client_name,
        report_date: auditRow.report_date,
        version,
        status: 'approved',
        template_version: RECOVERY_BLUEPRINT_TEMPLATE_VERSION,
        storage_path: path,
        file_name: fileName,
        file_sha256: sha,
        audit_sha256: auditHash(auditRow.audit),
        approved_by: caller.userId,
      }).select('*').single();
      if (insertError) {
        await db.storage.from(BUCKET).remove([path]);
        throw insertError;
      }
      return response(200, { artifact: safeArtifact(artifact, await signedUrl(db, path), auditHash(auditRow.audit)) });
    }

    if (action === 'send') {
      const artifact = payload.artifactId
        ? (await db.from('recovery_blueprints').select('*').eq('id', payload.artifactId).eq('audit_id', auditRow.id).single()).data
        : await latestArtifact(db, auditRow.id);
      if (!artifact) throw Object.assign(new Error('Approve a Recovery Blueprint before sending it.'), { statusCode: 409 });
      if (artifact.audit_sha256 !== auditHash(auditRow.audit)) {
        throw Object.assign(new Error('The reviewed audit changed after this Blueprint was approved. Approve a new version before sending.'), { statusCode: 409 });
      }
      const to = String(payload.clientEmail || '').trim().toLowerCase();
      if (!to || !/^\S+@\S+\.\S+$/.test(to)) throw Object.assign(new Error('A valid recipient email is required.'), { statusCode: 400 });
      const { data: file, error: downloadError } = await db.storage.from(BUCKET).download(artifact.storage_path);
      if (downloadError) throw downloadError;
      const buffer = Buffer.from(await file.arrayBuffer());
      const messageId = await sendGridEmail({
        to,
        subject: String(payload.subject || 'Your Credit Comeback Club Recovery Blueprint is Ready'),
        bodyText: String(payload.bodyText || 'Your Recovery Blueprint is attached.'),
        fileName: artifact.file_name,
        buffer,
        artifactId: artifact.id,
      });
      const now = new Date().toISOString();
      const { data: updated, error: updateError } = await db.from('recovery_blueprints').update({
        status: 'sent', sent_to: to, sent_at: now, sendgrid_message_id: messageId,
        delivery_status: 'accepted', delivery_event_at: now, updated_at: now,
      }).eq('id', artifact.id).select('*').single();
      if (updateError) throw updateError;
      return response(200, { sent: true, artifact: safeArtifact(updated, await signedUrl(db, artifact.storage_path), auditHash(auditRow.audit)) });
    }

    return response(400, { error: 'Unknown action' });
  } catch (error) {
    console.error('[recovery-blueprint]', error);
    return response(error.statusCode || 500, { error: error.message || 'Recovery Blueprint request failed.' });
  }
};
