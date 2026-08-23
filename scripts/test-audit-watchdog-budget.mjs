#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createWatchdogHandler } = require('../netlify/functions/audit-job-watchdog.cjs');

const USER_ID = '53000000-0000-4000-8000-000000000001';
const DUE_SLOW = '53000000-0000-4000-8000-000000000201';
const DUE_FAST = '53000000-0000-4000-8000-000000000202';
const CLEANUP_SLOW = '53000000-0000-4000-8000-000000000101';
const CLEANUP_FAIL = '53000000-0000-4000-8000-000000000102';

function queryResult(result) {
  const query = {
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  for (const method of ['select', 'in', 'eq', 'is', 'limit']) {
    query[method] = () => query;
  }
  return query;
}

const events = [];
const updates = [];
const cleanupJobs = [
  {
    id: CLEANUP_SLOW,
    user_id: USER_ID,
    workflow_version: 'resumable-audit-v1',
    status: 'expired',
    files: [{ path: `${USER_ID}/audit-jobs/${CLEANUP_SLOW}/slow.pdf` }],
  },
  {
    id: CLEANUP_FAIL,
    user_id: USER_ID,
    workflow_version: 'resumable-audit-v1',
    status: 'expired',
    files: [{ path: `${USER_ID}/audit-jobs/${CLEANUP_FAIL}/fail.pdf` }],
  },
];

const db = {
  rpc(name) {
    events.push(name);
    if (name === 'ccc_reclaim_stale_audit_jobs') {
      return Promise.resolve({
        data: [{ job_id: DUE_SLOW }, { job_id: DUE_FAST }],
        error: null,
      });
    }
    if (name === 'ccc_claim_orphan_audit_upload_cleanup') {
      return Promise.resolve({ data: [], error: null });
    }
    throw new Error(`Unexpected RPC ${name}`);
  },
  from(table) {
    return {
      select() {
        events.push(`scan:${table}`);
        return queryResult({ data: cleanupJobs, error: null });
      },
      update(payload) {
        updates.push({ table, payload });
        return queryResult({ data: null, error: null });
      },
    };
  },
  storage: {
    from(bucket) {
      assert.equal(bucket, 'documents');
      return {
        remove(paths) {
          events.push(`cleanup:${paths[0]}`);
          if (paths[0].includes('/slow.pdf')) return new Promise(() => {});
          return Promise.resolve({ error: new Error('simulated storage failure') });
        },
      };
    },
  },
};

const priorEnv = {
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  DEPLOY_URL: process.env.DEPLOY_URL,
};
process.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.DEPLOY_URL = 'https://deploy-preview.example';

const expectedWarnings = [];
const priorWarn = console.warn;
console.warn = (...args) => expectedWarnings.push(args.join(' '));
try {
  const handler = createWatchdogHandler({
    createDbClient: () => db,
    watchdogBudgetMs: 120,
    returnReserveMs: 15,
    reclaimTimeoutMs: 25,
    dispatchTimeoutMs: 25,
    cleanupQueryTimeoutMs: 25,
    cleanupOperationTimeoutMs: 25,
    cleanupConcurrency: 2,
    fetchImpl: async (url, options) => {
      const jobId = JSON.parse(options.body).jobId;
      events.push(`dispatch:${jobId}`);
      assert.equal(url, 'https://deploy-preview.example/.netlify/functions/audit-run-background');
      assert.equal(options.headers.Authorization, 'Bearer test-service-key');
      assert.equal(options.headers['x-ccc-audit-invoker'], 'watchdog');
      assert.ok(options.signal instanceof AbortSignal);
      if (jobId === DUE_SLOW) return new Promise(() => {});
      return { ok: true, status: 202 };
    },
  });

  const startedAt = Date.now();
  const response = await handler({
    body: JSON.stringify({ next_run: '2026-08-23T12:00:00.000Z' }),
  });
  const elapsedMs = Date.now() - startedAt;
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(body, {
    due: 2,
    dispatched: 1,
    cleanupScanned: 2,
    orphanScanned: 0,
  });
  assert.ok(events.includes(`dispatch:${DUE_SLOW}`), 'slow due job was offered a dispatch');
  assert.ok(events.includes(`dispatch:${DUE_FAST}`), 'later due job was not starved by the slow dispatch');
  const firstCleanup = events.findIndex((event) => event.startsWith('cleanup:'));
  assert.ok(firstCleanup > events.indexOf(`dispatch:${DUE_SLOW}`));
  assert.ok(firstCleanup > events.indexOf(`dispatch:${DUE_FAST}`));
  assert.ok(events.indexOf('scan:audit_jobs') > events.indexOf(`dispatch:${DUE_FAST}`),
    'retention scans must not begin before every due dispatch is started and settled');
  assert.ok(elapsedMs < 500,
    `watchdog exceeded its bounded test budget while downstream work hung (${elapsedMs}ms)`);
  assert.equal(updates.length, 2, 'both slow and failed cleanup outcomes remain durably retryable');
  assert.ok(updates.every(({ payload }) => payload.source_cleanup_at === null));
  assert.ok(updates.every(({ payload }) => typeof payload.source_cleanup_error === 'string'));
  assert.ok(expectedWarnings.some((line) => line.includes(`dispatch failed ${DUE_SLOW}`)));
} finally {
  console.warn = priorWarn;
  for (const [key, value] of Object.entries(priorEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('Audit watchdog dispatch-first/bounded-cleanup regression passed.');
