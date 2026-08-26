// Scheduled safety net for resumable forensic audits. Normal progress chains
// immediately from audit-run-background; this function only reclaims expired
// leases or dispatches a due retry that a deploy/network interruption missed.
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const RESUMABLE_WORKFLOW_VERSION = 'resumable-audit-v1';
const BLOCKED_LEGACY_BROWSER_VERSION = 'legacy-browser-blocked';
// Netlify scheduled functions have a 30-second ceiling. Keep enough headroom
// to serialize the response even when a downstream Storage request stalls.
const WATCHDOG_BUDGET_MS = 24_000;
const RETURN_RESERVE_MS = 1_000;
const RECLAIM_TIMEOUT_MS = 5_000;
const DISPATCH_TIMEOUT_MS = 5_000;
const CLEANUP_QUERY_TIMEOUT_MS = 3_000;
const CLEANUP_OPERATION_TIMEOUT_MS = 3_000;
const CLEANUP_CONCURRENCY = 5;

function isOwnedAuditUpload(path, userId, jobId) {
  return typeof path === 'string' && path.length > 0
    && !path.includes('..') && !path.startsWith('/')
    && path.startsWith(`${userId}/audit-jobs/${jobId}/`);
}

function parseCandidateAuditUpload(path) {
  const match = typeof path === 'string' && path.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/audit-jobs\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/[^/]+$/i,
  );
  return match ? { userId: match[1], jobId: match[2] } : null;
}

function isScheduledInvocation(event = {}) {
  if (process.env.NETLIFY_DEV === 'true') return true;
  let payload;
  try { payload = JSON.parse(event.body || ''); } catch (_) { return false; }
  if (typeof payload?.next_run !== 'string' || !payload.next_run.trim()) return false;
  return Number.isFinite(Date.parse(payload.next_run));
}

function deadlineError(label) {
  const error = new Error(`${label} exceeded the watchdog deadline.`);
  error.code = 'WATCHDOG_DEADLINE';
  return error;
}

async function withDeadline(operation, {
  deadlineAt,
  maxMs,
  label,
  now,
  abortController = null,
}) {
  const timeoutMs = Math.min(maxMs, deadlineAt - now());
  if (timeoutMs <= 0) throw deadlineError(label);
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          if (abortController) abortController.abort();
          reject(deadlineError(label));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function runBounded(tasks, { concurrency, deadlineAt, now }) {
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length && deadlineAt > now()) {
      const task = tasks[cursor];
      cursor += 1;
      await task();
    }
  }
  const workerCount = Math.min(concurrency, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

function createWatchdogHandler(options = {}) {
  const createDbClient = options.createDbClient || createClient;
  const fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
  const now = options.now || Date.now;
  const watchdogBudgetMs = options.watchdogBudgetMs || WATCHDOG_BUDGET_MS;
  const returnReserveMs = options.returnReserveMs ?? RETURN_RESERVE_MS;
  const reclaimTimeoutMs = options.reclaimTimeoutMs || RECLAIM_TIMEOUT_MS;
  const dispatchTimeoutMs = options.dispatchTimeoutMs || DISPATCH_TIMEOUT_MS;
  const cleanupQueryTimeoutMs = options.cleanupQueryTimeoutMs || CLEANUP_QUERY_TIMEOUT_MS;
  const cleanupOperationTimeoutMs = options.cleanupOperationTimeoutMs || CLEANUP_OPERATION_TIMEOUT_MS;
  const cleanupConcurrency = options.cleanupConcurrency || CLEANUP_CONCURRENCY;

  return async (event = {}) => {
    // Netlify supplies next_run as JSON in the scheduled request body. Do not
    // expose a service-role dispatcher as a normal public function route.
    if (!isScheduledInvocation(event)) {
      return { statusCode: 404, body: 'Not Found' };
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    // Bind dispatch to this deploy artifact during previews and atomic alias
    // transitions so a new schema never chains into an older worker bundle.
    const base = process.env.DEPLOY_URL || process.env.URL || 'https://credit-comeback-club.netlify.app';
    if (!supabaseUrl || !serviceKey) return { statusCode: 500, body: 'server not configured' };

    const deadlineAt = now() + watchdogBudgetMs;
    const cleanupDeadlineAt = deadlineAt - returnReserveMs;
    const db = createDbClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
      realtime: { transport: ws },
    });

    let reclaimResult;
    try {
      reclaimResult = await withDeadline(
        () => db.rpc('ccc_reclaim_stale_audit_jobs', { p_limit: 25 }),
        { deadlineAt: cleanupDeadlineAt, maxMs: reclaimTimeoutMs, label: 'audit reclaim', now },
      );
    } catch (error) {
      console.error('[audit-watchdog] reclaim failed:', error.message);
      return { statusCode: 500, body: 'reclaim failed' };
    }
    const { data: jobs, error } = reclaimResult || {};
    if (error) {
      console.error('[audit-watchdog] reclaim failed:', error.message);
      return { statusCode: 500, body: 'reclaim failed' };
    }

    // Dispatch every due job before starting any retention cleanup. Dispatches
    // run concurrently and each request is abortable, so one slow worker route
    // cannot keep later due jobs from receiving their wake-up.
    let dispatched = 0;
    await Promise.all((jobs || []).map(async (job) => {
      const controller = new AbortController();
      try {
        const response = await withDeadline(
          () => fetchImpl(base + '/.netlify/functions/audit-run-background', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + serviceKey,
              'x-ccc-audit-invoker': 'watchdog',
            },
            body: JSON.stringify({ jobId: job.job_id }),
            signal: controller.signal,
          }),
          {
            deadlineAt: cleanupDeadlineAt,
            maxMs: dispatchTimeoutMs,
            label: `audit dispatch ${job.job_id}`,
            now,
            abortController: controller,
          },
        );
        if (response.ok || response.status === 409) dispatched += 1;
        else console.warn('[audit-watchdog] dispatch rejected', job.job_id, response.status);
      } catch (dispatchError) {
        console.warn('[audit-watchdog] dispatch failed', job.job_id, dispatchError.message);
      }
    }));

    let cleanupJobs = [];
    let orphanRows = [];
    if (now() < cleanupDeadlineAt) {
      // The two independent scans share one bounded phase. Orphan claims are
      // durable tombstones, so a claimed row remains retryable if this
      // invocation reaches its deadline before Storage deletion completes.
      const [cleanupResult, orphanResult] = await Promise.all([
        withDeadline(
          () => db.from('audit_jobs')
            .select('id,user_id,files,status,workflow_version')
            .in('workflow_version', [RESUMABLE_WORKFLOW_VERSION, BLOCKED_LEGACY_BROWSER_VERSION])
            .eq('status', 'expired')
            .is('source_cleanup_at', null)
            .limit(25),
          { deadlineAt: cleanupDeadlineAt, maxMs: cleanupQueryTimeoutMs, label: 'expired source scan', now },
        ).catch((scanError) => ({ data: [], error: scanError })),
        withDeadline(
          () => db.rpc('ccc_claim_orphan_audit_upload_cleanup', { p_limit: 25 }),
          { deadlineAt: cleanupDeadlineAt, maxMs: cleanupQueryTimeoutMs, label: 'orphan source scan', now },
        ).catch((scanError) => ({ data: [], error: scanError })),
      ]);
      cleanupJobs = cleanupResult?.data || [];
      orphanRows = orphanResult?.data || [];
      if (cleanupResult?.error) console.warn('[audit-watchdog] cleanup scan failed:', cleanupResult.error.message);
      if (orphanResult?.error) console.warn('[audit-watchdog] orphan scan failed:', orphanResult.error.message);
    }

    const cleanupTasks = cleanupJobs.map((cleanupJob) => async () => {
      const paths = (cleanupJob.files || []).map((file) => file?.path)
        .filter((path) => isOwnedAuditUpload(path, cleanupJob.user_id, cleanupJob.id));
      let cleanupError = null;
      if (paths.length) {
        try {
          const result = await withDeadline(
            () => db.storage.from('documents').remove(paths),
            {
              deadlineAt: cleanupDeadlineAt,
              maxMs: cleanupOperationTimeoutMs,
              label: `expired source cleanup ${cleanupJob.id}`,
              now,
            },
          );
          cleanupError = result.error || null;
        } catch (error) {
          cleanupError = error;
        }
      }
      try {
        const result = await withDeadline(
          () => db.from('audit_jobs').update({
            source_cleanup_at: cleanupError ? null : new Date().toISOString(),
            source_cleanup_error: cleanupError ? String(cleanupError.message || cleanupError).slice(0, 1000) : null,
          }).eq('id', cleanupJob.id).eq('workflow_version', cleanupJob.workflow_version)
            .eq('status', 'expired'),
          {
            deadlineAt: cleanupDeadlineAt,
            maxMs: cleanupOperationTimeoutMs,
            label: `expired cleanup record ${cleanupJob.id}`,
            now,
          },
        );
        if (result.error) console.warn('[audit-watchdog] cleanup record failed:', result.error.message);
      } catch (updateError) {
        console.warn('[audit-watchdog] cleanup record failed:', updateError.message);
      }
    });

    cleanupTasks.push(...orphanRows.map((orphan) => async () => {
      const orphanPaths = Array.isArray(orphan?.paths) ? orphan.paths : [];
      const pathsAreBound = orphanPaths.length > 0 && orphanPaths.every((path) => {
        const identity = parseCandidateAuditUpload(path);
        return identity
          && identity.userId === orphan.user_id
          && identity.jobId === orphan.candidate_job_id
          && isOwnedAuditUpload(path, orphan.user_id, orphan.candidate_job_id);
      });
      let cleanupError = pathsAreBound ? null : new Error('Orphan cleanup claim contained an invalid path binding.');
      if (pathsAreBound) {
        try {
          const result = await withDeadline(
            () => db.storage.from('documents').remove(orphanPaths),
            {
              deadlineAt: cleanupDeadlineAt,
              maxMs: cleanupOperationTimeoutMs,
              label: `orphan source cleanup ${orphan.candidate_job_id}`,
              now,
            },
          );
          cleanupError = result.error || null;
        } catch (error) {
          cleanupError = error;
        }
      }
      try {
        const result = await withDeadline(
          () => db.from('audit_upload_cleanup_claims').update({
            completed_at: cleanupError ? null : new Date().toISOString(),
            cleanup_error: cleanupError ? String(cleanupError.message || cleanupError).slice(0, 1000) : null,
          }).eq('candidate_job_id', orphan.candidate_job_id).is('completed_at', null),
          {
            deadlineAt: cleanupDeadlineAt,
            maxMs: cleanupOperationTimeoutMs,
            label: `orphan cleanup record ${orphan.candidate_job_id}`,
            now,
          },
        );
        if (result.error) console.warn('[audit-watchdog] orphan claim update failed:', result.error.message);
      } catch (claimUpdateError) {
        console.warn('[audit-watchdog] orphan claim update failed:', claimUpdateError.message);
      }
      if (cleanupError) console.warn('[audit-watchdog] orphan cleanup failed:', cleanupError.message);
    }));

    await runBounded(cleanupTasks, {
      concurrency: cleanupConcurrency,
      deadlineAt: cleanupDeadlineAt,
      now,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        due: (jobs || []).length,
        dispatched,
        cleanupScanned: cleanupJobs.length,
        orphanScanned: orphanRows.length,
      }),
    };
  };
}

exports.isScheduledInvocation = isScheduledInvocation;
exports.createWatchdogHandler = createWatchdogHandler;
exports.handler = createWatchdogHandler();
