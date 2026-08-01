/**
 * Fieldwork audit — enqueue + kick background worker.
 * Live Anthropic work runs in fieldwork-audit-run-background (15‑min window).
 * Falls back to inline engine only when BACKGROUND is unavailable and the
 * request is small enough for the short sync timeout.
 *
 * POST JSON: { base64, mediaType?, fileName?, mode?, subscriberId? }
 * Returns: { jobId, mode: 'queued' } or { audit, mode: 'engine' }
 */
import { createClient } from '@supabase/supabase-js';

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

  let payload;
  try {
    let raw = event.body || '{}';
    if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
    payload = JSON.parse(raw);
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const base64 = payload.base64;
  if (!base64 || typeof base64 !== 'string') {
    return json(400, { error: 'base64 report required' });
  }
  if (base64.length > 12_000_000) {
    return json(413, { error: 'Report too large for Fieldwork audit pass' });
  }

  const admin = fwAdmin();
  if (!admin) {
    return json(503, { error: 'FIELDWORK_SUPABASE_* not configured for audit jobs' });
  }

  const user = await requireUser(event);
  let subscriberId = payload.subscriberId || null;

  if (user && !subscriberId) {
    const { data: sub } = await admin
      .from('fieldwork_subscribers')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    subscriberId = sub?.id || null;
  }

  if (!subscriberId) {
    return json(401, {
      error: 'Sign in to Fieldwork cloud to run a live audit (subscriber required for background jobs).',
    });
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

  // Kick the background worker. On Netlify this returns 202 immediately;
  // locally netlify-cli also supports *-background functions.
  const siteUrl = process.env.URL
    || process.env.DEPLOY_URL
    || process.env.NETLIFY_DEV_SERVER_URL
    || 'http://localhost:8888';

  const workerPayload = {
    jobId: job.id,
    base64,
    mediaType: payload.mediaType || 'application/pdf',
    fileName: payload.fileName || 'credit-report.pdf',
    mode: payload.mode === 'single' ? 'single' : 'combined',
    bureau: payload.bureau || 'Experian',
  };

  // Fire-and-forget invoke; do not await completion.
  const workerUrl = `${siteUrl.replace(/\/$/, '')}/.netlify/functions/fieldwork-audit-run-background`;
  fetch(workerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(workerPayload),
  }).catch((err) => {
    console.error('Failed to invoke fieldwork-audit-run-background', err);
  });

  return json(200, {
    product: 'fieldwork',
    isolated: true,
    mode: 'queued',
    jobId: job.id,
  });
};
