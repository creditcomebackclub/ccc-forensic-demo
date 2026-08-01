/**
 * Fieldwork audit entrypoint.
 *
 * Local `netlify dev`: runs Anthropic inline (background workers often never
 * execute after the 202 queue). Production: enqueues a job and expects the
 * client to invoke fieldwork-audit-run-background + poll.
 *
 * POST JSON: { base64, mediaType?, fileName?, mode?, subscriberId? }
 */
import { createClient } from '@supabase/supabase-js';
import { isNetlifyLocalDev, runFieldworkAuditEngine } from './_fieldworkAuditEngine.mjs';

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function fwAdmin() {
  const url = process.env.FIELDWORK_SUPABASE_URL;
  const key = process.env.FIELDWORK_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function requireUser(event) {
  const headers = event.headers || {};
  const authHeader = headers.authorization || headers.Authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const url = process.env.FIELDWORK_SUPABASE_URL;
  const anon = process.env.FIELDWORK_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  if (!process.env.FIELDWORK_ANTHROPIC_API_KEY) {
    return json(503, {
      error: 'FIELDWORK_ANTHROPIC_API_KEY not configured',
      mode: 'demo',
    });
  }

  let payload = {};
  try {
    let raw = event.body || '{}';
    if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
    payload = JSON.parse(raw);
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const local = isNetlifyLocalDev();

  // -------- Local / netlify dev: run inline (avoid 202-and-never-run) --------
  if (local) {
    const base64 = payload.base64;
    if (!base64 || typeof base64 !== 'string') {
      return json(400, { error: 'base64 report required' });
    }
    if (base64.length > 12_000_000) {
      return json(413, { error: 'Report too large for Fieldwork audit pass' });
    }
    try {
      const audit = await runFieldworkAuditEngine({
        base64,
        mediaType: payload.mediaType || 'application/pdf',
        fileName: payload.fileName || 'credit-report.pdf',
        mode: payload.mode === 'single' ? 'single' : 'combined',
        bureau: payload.bureau || 'Experian',
      });
      return json(200, {
        product: 'fieldwork',
        isolated: true,
        mode: 'engine-local',
        audit,
      });
    } catch (err) {
      console.error('fieldwork-audit-run local inline failed', err);
      return json(err.statusCode || 500, {
        error: err.message || 'Audit failed',
        mode: 'engine-local',
      });
    }
  }

  // -------- Production: enqueue job for background worker --------
  const admin = fwAdmin();
  if (!admin) {
    return json(503, { error: 'FIELDWORK_SUPABASE_* not configured for audit jobs' });
  }

  const user = await requireUser(event);
  if (!user) {
    return json(401, { error: 'Sign in required for live Fieldwork audits' });
  }

  let subscriberId = payload.subscriberId || null;
  if (!subscriberId) {
    const { data: sub } = await admin
      .from('fieldwork_subscribers')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    subscriberId = sub?.id || null;
  }

  if (!subscriberId) {
    return json(401, {
      error: 'No Fieldwork subscriber row — finish signup/bootstrap first.',
    });
  }

  const { data: owned } = await admin
    .from('fieldwork_subscribers')
    .select('id')
    .eq('id', subscriberId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!owned) {
    return json(403, { error: 'Subscriber mismatch' });
  }

  const { data: job, error: jobErr } = await admin
    .from('fieldwork_audit_jobs')
    .insert({
      subscriber_id: subscriberId,
      status: 'queued',
      progress: 'Queued…',
    })
    .select('id')
    .single();

  if (jobErr || !job) {
    return json(500, { error: jobErr?.message || 'Could not create audit job' });
  }

  return json(200, {
    product: 'fieldwork',
    isolated: true,
    mode: 'queued',
    jobId: job.id,
  });
};
