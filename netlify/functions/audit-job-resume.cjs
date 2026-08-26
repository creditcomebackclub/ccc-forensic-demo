const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const { requireStaff } = require('./_requireAuth.cjs');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_STATUSES = new Set(['queued', 'waiting', 'retryable', 'running', 'finalizing']);
const DISPATCH_TIMEOUT_MS = 5_000;
const RETRY_SAFE_FINALIZATION_PREFIXES = [
  'Could not load completed audit checkpoints:',
  'Could not verify final audit idempotency:',
  'Audit ran but could not be saved:',
  'Could not atomically finish logical audit job:',
];

function isRetrySafeFinalizationError(message) {
  const value = String(message || '');
  return RETRY_SAFE_FINALIZATION_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(payload),
  };
}

function createResumeAuditJobHandler(options = {}) {
  const requireStaffImpl = options.requireStaffImpl || requireStaff;
  const createDbClient = options.createDbClient || createClient;
  const fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
  const env = options.env || process.env;

  return async (event = {}) => {
    if (event.httpMethod !== 'POST') {
      return json(405, { code: 'method_not_allowed', message: 'Method Not Allowed' });
    }

    let caller;
    try {
      caller = await requireStaffImpl(event);
    } catch (error) {
      return error?.statusCode ? error : json(500, {
        code: 'authentication_failed',
        message: 'CCC could not verify the current staff session.',
      });
    }

    let jobId;
    try {
      jobId = JSON.parse(event.body || '{}').jobId;
    } catch (_) {
      return json(400, { code: 'invalid_request', message: 'A valid saved audit ID is required.' });
    }
    if (typeof jobId !== 'string' || !UUID_RE.test(jobId)) {
      return json(400, { code: 'invalid_job_id', message: 'A valid saved audit ID is required.' });
    }

    const supabaseUrl = env.VITE_SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return json(500, { code: 'server_not_configured', message: 'Audit recovery is not configured.' });
    }

    const db = createDbClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
      realtime: { transport: ws },
    });

    const loadOwnedJob = async () => {
      const result = await db.from('audit_jobs')
        .select('id,user_id,status,error,workflow_version,source_cleanup_at,expires_at,expected_checkpoint_count,completed_checkpoint_count')
        .eq('id', jobId)
        .maybeSingle();
      if (result.error) throw result.error;
      if (!result.data || result.data.user_id !== caller.userId) return null;
      return result.data;
    };

    let job;
    try {
      job = await loadOwnedJob();
    } catch (error) {
      console.error('[audit-resume] saved job lookup failed', jobId, error?.message || 'database error');
      return json(500, {
        code: 'lookup_failed',
        message: 'CCC could not verify the saved audit yet. No new audit was created.',
      });
    }
    // Do not reveal whether another staff member owns the supplied UUID.
    if (!job) return json(404, { code: 'not_found', message: 'Saved audit not found.' });

    if (job.status === 'done') {
      return json(200, { jobId, status: 'done', resumed: false, dispatchPending: false });
    }
    if (job.status === 'expired' || job.source_cleanup_at
        || (job.expires_at && Date.parse(job.expires_at) <= Date.now())) {
      return json(410, {
        code: 'source_expired',
        message: 'This saved audit source has expired and can no longer be resumed.',
      });
    }
    if (job.workflow_version !== 'resumable-audit-v1') {
      return json(409, {
        code: 'not_recoverable',
        message: 'This saved audit can no longer be resumed automatically.',
      });
    }

    let resumed = false;
    if (job.status === 'error') {
      // The job-level row intentionally exposes only a safe user message.
      // Verify the exact private checkpoint state before invoking either
      // service-only recovery RPC. Finalization-only recovery is deliberately
      // narrower than a generic job retry: every active checkpoint must be
      // immutable and done, so dispatch cannot repeat provider work.
      let activeCheckpoints;
      try {
        const result = await db.from('audit_job_checkpoints')
          .select('id,status,error_type')
          .eq('job_id', jobId)
          .neq('status', 'superseded');
        if (result.error) throw result.error;
        activeCheckpoints = result.data || [];
      } catch (error) {
        console.error('[audit-resume] checkpoint lookup failed', jobId, error?.message || 'database error');
        return json(500, {
          code: 'lookup_failed',
          message: 'CCC could not verify the saved checkpoint yet. No new audit was created.',
        });
      }

      const errorCheckpoints = activeCheckpoints
        .filter((checkpoint) => checkpoint.status === 'error');
      const providerTimeoutRecovery = errorCheckpoints.length > 0
        && errorCheckpoints.every((checkpoint) => checkpoint.error_type === 'provider_timeout');
      const finalizationOnlyRecovery = activeCheckpoints.length > 0
        && activeCheckpoints.every((checkpoint) => checkpoint.status === 'done')
        && isRetrySafeFinalizationError(job.error);
      if (!providerTimeoutRecovery && !finalizationOnlyRecovery) {
        return json(409, {
          code: 'not_recoverable',
          message: 'This audit stopped for a reason that requires Operations review.',
        });
      }

      const recoveryRpc = finalizationOnlyRecovery
        ? 'ccc_resume_audit_finalization'
        : 'ccc_resume_failed_audit_job';
      const { data, error } = await db.rpc(recoveryRpc, { p_job_id: jobId });
      if (error) {
        console.error('[audit-resume] recovery RPC failed', jobId, error?.message || 'database error');
        return json(500, {
          code: 'resume_failed',
          message: 'CCC could not resume the saved audit yet. No new audit was created.',
        });
      }
      resumed = data === true;
      if (!resumed) {
        // An overlapping click may have won the row lock and resumed this
        // exact job already. Reconcile instead of misreporting a failure.
        try { job = await loadOwnedJob(); } catch (_) { job = null; }
        if (!job || !ACTIVE_STATUSES.has(job.status)) {
          return json(409, {
            code: 'not_recoverable',
            message: 'This saved audit requires Operations review before it can continue.',
          });
        }
      }
    } else if (!ACTIVE_STATUSES.has(job.status)) {
      return json(409, {
        code: 'not_recoverable',
        message: 'This saved audit cannot be resumed automatically.',
      });
    }

    // The recovery transaction above is the durable success boundary. If the
    // detached dispatch is unavailable, the browser poller/watchdog can wake
    // this same job later; never turn that into a prompt to re-upload.
    const base = env.DEPLOY_URL || env.URL || 'https://credit-comeback-club.netlify.app';
    let dispatched = false;
    try {
      const response = await fetchImpl(base + '/.netlify/functions/audit-run-background', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + serviceKey,
          'x-ccc-audit-invoker': 'manual-resume',
        },
        body: JSON.stringify({ jobId }),
        signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
      });
      dispatched = response.ok || response.status === 409;
      if (!dispatched) console.warn('[audit-resume] exact-job dispatch deferred', jobId, response.status);
    } catch (error) {
      console.warn('[audit-resume] exact-job dispatch deferred', jobId, error?.message || 'network error');
    }

    return json(202, {
      jobId,
      status: 'resuming',
      resumed,
      dispatchPending: !dispatched,
    });
  };
}

exports.createResumeAuditJobHandler = createResumeAuditJobHandler;
exports.handler = createResumeAuditJobHandler();
