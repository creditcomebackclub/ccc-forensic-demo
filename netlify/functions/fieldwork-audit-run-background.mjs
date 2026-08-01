/**
 * Fieldwork live audit — Netlify BACKGROUND function (production, up to 15 min).
 * Local netlify dev uses inline fieldwork-audit-run instead.
 *
 * POST JSON: { jobId, base64, mediaType?, fileName?, mode? }
 */
import { createClient } from '@supabase/supabase-js';
import { runFieldworkAuditEngine } from './_fieldworkAuditEngine.mjs';

function fwAdmin() {
  const url = process.env.FIELDWORK_SUPABASE_URL;
  const key = process.env.FIELDWORK_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('FIELDWORK_SUPABASE_* service credentials missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function patchJob(admin, jobId, patch) {
  const { error } = await admin
    .from('fieldwork_audit_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) throw error;
}

export const handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let payload;
  try {
    let raw = event.body || '{}';
    if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
    payload = JSON.parse(raw);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const jobId = payload.jobId;
  const base64 = payload.base64;
  if (!jobId || !base64) {
    return { statusCode: 400, body: 'jobId and base64 required' };
  }

  const admin = fwAdmin();

  try {
    await patchJob(admin, jobId, { status: 'running', progress: 'Starting forensic audit…', error: null });

    const audit = await runFieldworkAuditEngine({
      base64,
      mediaType: payload.mediaType || 'application/pdf',
      fileName: payload.fileName || 'credit-report.pdf',
      mode: payload.mode === 'single' ? 'single' : 'combined',
      bureau: payload.bureau || 'Experian',
      onProgress: async (progress) => {
        await patchJob(admin, jobId, { progress });
      },
    });

    await patchJob(admin, jobId, {
      status: 'done',
      progress: 'Audit complete',
      result_json: audit,
      error: null,
    });

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('fieldwork-audit-run-background failed', err);
    try {
      await patchJob(admin, jobId, {
        status: 'error',
        progress: null,
        error: err.message || 'Audit failed',
      });
    } catch (patchErr) {
      console.error('failed to patch job error state', patchErr);
    }
    // Refund the audit credit reserved at enqueue.
    try {
      const { data: jobRow } = await admin
        .from('fieldwork_audit_jobs')
        .select('subscriber_id')
        .eq('id', jobId)
        .maybeSingle();
      if (jobRow?.subscriber_id) {
        const { data: sub } = await admin
          .from('fieldwork_subscribers')
          .select('audit_credits')
          .eq('id', jobRow.subscriber_id)
          .maybeSingle();
        if (sub && typeof sub.audit_credits === 'number') {
          await admin
            .from('fieldwork_subscribers')
            .update({
              audit_credits: sub.audit_credits + 1,
              updated_at: new Date().toISOString(),
            })
            .eq('id', jobRow.subscriber_id);
        }
      }
    } catch (refundErr) {
      console.error('failed to refund audit credit', refundErr);
    }
    return { statusCode: 500, body: err.message || 'Audit failed' };
  }
};
