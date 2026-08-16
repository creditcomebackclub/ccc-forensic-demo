import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { buildRecoveryBlueprintModel, RECOVERY_BLUEPRINT_TEMPLATE_VERSION, recoveryBlueprintFilename } from '../../src/utils/recoveryBlueprintModel.js';
import { buildRecoveryBlueprintPdf } from '../../src/utils/recoveryBlueprintPdf.js';
import authHelpers from './_requireAuth.cjs';
import storagePaths from './_storagePaths.cjs';
import emailHelpers from './_email.cjs';

// Netlify's Node runtime (and any pin below 22) has no reliable global
// WebSocket. supabase-js always constructs a RealtimeClient in createClient()
// even for pure REST/storage — pass `ws` via realtime.transport. Do NOT use
// createRequire(import.meta.url): Netlify esbuild emits CJS where
// import.meta.url is undefined and the function 502s on cold start.

const { requireStaff } = authHelpers;
const { BLUEPRINTS_BUCKET: BUCKET, recoveryBlueprintPath } = storagePaths;
const { sendEmail } = emailHelpers;

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

async function sendBlueprintEmail({ to, subject, bodyText, fileName, buffer, artifactId }) {
  const { wrapClientEmail, escapeHtml } = emailHelpers;
  const paragraphs = String(bodyText).split(/\n{2,}/).map((paragraph) =>
    `<p style="margin:0 0 14px;">${paragraph.split('\n').map(escapeHtml).join('<br>')}</p>`).join('');
  const html = wrapClientEmail({
    eyebrow: 'Your Recovery Blueprint',
    bodyHtml: paragraphs,
    cta: null,
  });
  return sendEmail({
    to,
    subject,
    html,
    attachments: [{
      content: buffer.toString('base64'),
      filename: fileName,
      type: 'application/pdf',
    }],
    tags: [{ name: 'recovery_blueprint_id', value: String(artifactId) }],
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
        const next = {
          ...account,
          balance: Number.isFinite(Number(correction.balance)) ? Number(correction.balance) : account.balance,
          status: String(correction.status || account.status || '').trim(),
          accountNumberMasked: String(correction.accountNumberMasked || account.accountNumberMasked || '').trim(),
          originalCreditor: correction.originalCreditor == null ? account.originalCreditor : String(correction.originalCreditor).trim() || null,
        };
        // Staff adjudication of deterministic findings (Authorize / Suppress / Needs fact)
        if (Array.isArray(correction.findings)) next.findings = correction.findings;
        if (Array.isArray(correction.violations)) next.violations = correction.violations;
        if (Array.isArray(correction.authorizedFindingIds)) next.authorizedFindingIds = correction.authorizedFindingIds;
        if (correction.primaryViolation != null) next.primaryViolation = String(correction.primaryViolation);
        if (correction.primaryChallengeStatement != null) next.primaryChallengeStatement = String(correction.primaryChallengeStatement);
        if (correction.strategy != null) next.strategy = String(correction.strategy);
        if (Number.isFinite(Number(correction.priorityScore))) next.priorityScore = Number(correction.priorityScore);
        if (correction.batch === 1 || correction.batch === 2) next.batch = correction.batch;
        return next;
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
      if (!auditRow.client_id) {
        throw Object.assign(new Error('This audit is missing a client_id; link it before approving a Blueprint.'), { statusCode: 409 });
      }
      const path = recoveryBlueprintPath(auditRow.user_id, auditRow.client_id, auditRow.id, version, sha.slice(0, 12));
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
      const messageId = await sendBlueprintEmail({
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

    if (action === 'delete') {
      const artifactId = payload.artifactId;
      if (!artifactId) throw Object.assign(new Error('artifactId is required to delete a Blueprint version.'), { statusCode: 400 });
      const { data: artifact, error: loadError } = await db.from('recovery_blueprints')
        .select('*').eq('id', artifactId).eq('audit_id', auditRow.id).maybeSingle();
      if (loadError) throw loadError;
      if (!artifact) throw Object.assign(new Error('Blueprint version not found for this audit.'), { statusCode: 404 });

      const storagePath = artifact.storage_path;
      const { error: deleteError } = await db.from('recovery_blueprints')
        .delete().eq('id', artifact.id).eq('audit_id', auditRow.id);
      if (deleteError) throw deleteError;

      if (storagePath) {
        const { error: removeError } = await db.storage.from(BUCKET).remove([storagePath]);
        if (removeError) {
          // DB row is already gone — log and continue so staff aren't stuck.
          console.warn('[recovery-blueprint] storage remove failed after DB delete', removeError.message || removeError);
        }
      }

      const next = await latestArtifact(db, auditRow.id);
      return response(200, {
        deleted: true,
        deletedId: artifactId,
        artifact: safeArtifact(next, next ? await signedUrl(db, next.storage_path) : null, auditHash(auditRow.audit)),
      });
    }

    return response(400, { error: 'Unknown action' });
  } catch (error) {
    console.error('[recovery-blueprint]', error);
    return response(error.statusCode || 500, { error: error.message || 'Recovery Blueprint request failed.' });
  }
};
