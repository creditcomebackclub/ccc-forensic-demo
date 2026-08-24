#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createResumeAuditJobHandler } = require('../netlify/functions/audit-job-resume.cjs');

const JOB_ID = '53000000-0000-4000-8000-000000000201';
const OWNER_ID = '53000000-0000-4000-8000-000000000001';
const OTHER_ID = '53000000-0000-4000-8000-000000000002';
const env = {
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  DEPLOY_URL: 'https://deploy-preview.example',
};

function createMockDb({
  ownerId = OWNER_ID,
  initialStatus = 'error',
  jobError = 'A report section took too long to analyze.',
  checkpoint = { id: 'checkpoint-1', status: 'error', error_type: 'provider_timeout' },
  checkpoints = null,
  sourceCleanupAt = null,
  expiresAt = '2099-01-01T00:00:00.000Z',
  rpcError = null,
} = {}) {
  const calls = [];
  const job = {
    id: JOB_ID,
    user_id: ownerId,
    status: initialStatus,
    error: jobError,
    workflow_version: 'resumable-audit-v1',
    source_cleanup_at: sourceCleanupAt,
    expires_at: expiresAt,
  };
  const db = {
    calls,
    from(table) {
      calls.push(`from:${table}`);
      const checkpointRows = checkpoints || (checkpoint ? [checkpoint] : []);
      const query = {
        select() { return query; },
        eq() { return query; },
        neq() { return query; },
        in() { return query; },
        limit() { return query; },
        maybeSingle() {
          if (table === 'audit_jobs') return Promise.resolve({ data: { ...job }, error: null });
          if (table === 'audit_job_checkpoints') return Promise.resolve({ data: checkpointRows[0] || null, error: null });
          throw new Error(`Unexpected table ${table}`);
        },
        then(resolve, reject) {
          if (table !== 'audit_job_checkpoints') return Promise.reject(new Error(`Unexpected awaited table ${table}`)).then(resolve, reject);
          return Promise.resolve({ data: checkpointRows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    rpc(name, args) {
      calls.push(`rpc:${name}`);
      assert.deepEqual(args, { p_job_id: JOB_ID });
      if (rpcError) return Promise.resolve({ data: null, error: rpcError });
      job.status = 'waiting';
      return Promise.resolve({ data: true, error: null });
    },
  };
  return db;
}

function event(jobId = JOB_ID) {
  return {
    httpMethod: 'POST',
    headers: { authorization: 'Bearer owner-session' },
    body: JSON.stringify({ jobId }),
  };
}

{
  const db = createMockDb();
  const dispatches = [];
  const handler = createResumeAuditJobHandler({
    env,
    createDbClient: () => db,
    requireStaffImpl: async () => ({ userId: OWNER_ID, role: 'admin' }),
    fetchImpl: async (url, options) => {
      dispatches.push({ url, options });
      return { ok: true, status: 202 };
    },
  });
  const response = await handler(event());
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 202);
  assert.deepEqual(body, {
    jobId: JOB_ID,
    status: 'resuming',
    resumed: true,
    dispatchPending: false,
  });
  assert.deepEqual(db.calls.filter((call) => call.startsWith('rpc:')), [
    'rpc:ccc_resume_failed_audit_job',
  ]);
  assert.ok(!db.calls.some((call) => call.includes('ccc_create_or_resume_audit_job')),
    'Recovery must not create a second logical audit job.');
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].url, 'https://deploy-preview.example/.netlify/functions/audit-run-background');
  assert.equal(dispatches[0].options.headers.Authorization, 'Bearer test-service-key');
  assert.equal(dispatches[0].options.headers['x-ccc-audit-invoker'], 'manual-resume');
  assert.deepEqual(JSON.parse(dispatches[0].options.body), { jobId: JOB_ID });
  assert.ok(dispatches[0].options.signal instanceof AbortSignal);
}

// A retry-safe coordinator failure after every active checkpoint is done uses
// the finalization-only RPC. No checkpoint is cloned or sent back to the
// provider; the exact job is merely returned to the coordinator.
{
  const db = createMockDb({
    jobError: 'Audit ran but could not be saved: injected database failure',
    checkpoints: [
      { id: 'checkpoint-done-1', status: 'done', error_type: null },
      { id: 'checkpoint-done-2', status: 'done', error_type: null },
    ],
  });
  const handler = createResumeAuditJobHandler({
    env,
    createDbClient: () => db,
    requireStaffImpl: async () => ({ userId: OWNER_ID, role: 'admin' }),
    fetchImpl: async () => ({ ok: true, status: 202 }),
  });
  const response = await handler(event());
  assert.equal(response.statusCode, 202);
  assert.deepEqual(db.calls.filter((call) => call.startsWith('rpc:')), [
    'rpc:ccc_resume_audit_finalization',
  ]);
  assert.ok(!db.calls.some((call) => call.includes('ccc_resume_failed_audit_job')),
    'Finalization recovery must not clone a provider checkpoint.');
}

// Mixed done/nonterminal checkpoint state is not a finalization failure. It
// remains Operations-only instead of risking another provider request.
{
  const db = createMockDb({
    jobError: 'Could not atomically finish logical audit job: lease mismatch',
    checkpoints: [
      { id: 'checkpoint-done', status: 'done', error_type: null },
      { id: 'checkpoint-pending', status: 'pending', error_type: null },
    ],
  });
  const handler = createResumeAuditJobHandler({
    env,
    createDbClient: () => db,
    requireStaffImpl: async () => ({ userId: OWNER_ID, role: 'admin' }),
  });
  const response = await handler(event());
  assert.equal(response.statusCode, 409);
  assert.equal(db.calls.some((call) => call.startsWith('rpc:')), false);
}

// The legacy side-by-side parser discarded bureau-column identity. Even with
// every checkpoint done, replaying those immutable outputs is not safe and
// must never call the finalization RPC.
{
  const db = createMockDb({
    jobError: 'A combined-report chunk contains data without a visible bureau identity.',
    checkpoints: [
      { id: 'legacy-done-1', status: 'done', error_type: null },
      { id: 'legacy-done-2', status: 'done', error_type: null },
    ],
  });
  const handler = createResumeAuditJobHandler({
    env,
    createDbClient: () => db,
    requireStaffImpl: async () => ({ userId: OWNER_ID, role: 'admin' }),
  });
  const response = await handler(event());
  assert.equal(response.statusCode, 409);
  assert.equal(db.calls.some((call) => call.startsWith('rpc:')), false);
}

// An authenticated staff member cannot resume a job owned by another staff
// account, and the response does not reveal that the UUID exists.
{
  const db = createMockDb();
  const handler = createResumeAuditJobHandler({
    env,
    createDbClient: () => db,
    requireStaffImpl: async () => ({ userId: OTHER_ID, role: 'auditor' }),
    fetchImpl: async () => { throw new Error('must not dispatch'); },
  });
  const response = await handler(event());
  assert.equal(response.statusCode, 404);
  assert.equal(JSON.parse(response.body).code, 'not_found');
  assert.equal(db.calls.some((call) => call.startsWith('rpc:')), false);
}

// A lost detached-dispatch response does not undo the committed resume. The
// same job remains waiting for the browser poller/watchdog; no re-upload is
// requested and no second job is created.
{
  const db = createMockDb();
  const priorWarn = console.warn;
  console.warn = () => {};
  try {
    const handler = createResumeAuditJobHandler({
      env,
      createDbClient: () => db,
      requireStaffImpl: async () => ({ userId: OWNER_ID, role: 'admin' }),
      fetchImpl: async () => { throw new Error('simulated dispatch loss'); },
    });
    const response = await handler(event());
    assert.equal(response.statusCode, 202);
    assert.equal(JSON.parse(response.body).dispatchPending, true);
    assert.deepEqual(db.calls.filter((call) => call.startsWith('rpc:')), [
      'rpc:ccc_resume_failed_audit_job',
    ]);
  } finally {
    console.warn = priorWarn;
  }
}

// Raw database/provider details are server-log-only, never returned to the
// browser in the recovery response.
{
  const db = createMockDb({ rpcError: new Error('APIUserAbortError secret request_id=req_raw') });
  const priorError = console.error;
  console.error = () => {};
  try {
    const handler = createResumeAuditJobHandler({
      env,
      createDbClient: () => db,
      requireStaffImpl: async () => ({ userId: OWNER_ID, role: 'admin' }),
    });
    const response = await handler(event());
    assert.equal(response.statusCode, 500);
    assert.equal(response.body.includes('APIUserAbortError'), false);
    assert.equal(response.body.includes('req_raw'), false);
    assert.match(JSON.parse(response.body).message, /No new audit was created/);
  } finally {
    console.error = priorError;
  }
}

{
  const db = createMockDb();
  const handler = createResumeAuditJobHandler({
    env,
    createDbClient: () => db,
    requireStaffImpl: async () => ({ userId: OWNER_ID, role: 'admin' }),
  });
  const response = await handler(event('not-a-uuid'));
  assert.equal(response.statusCode, 400);
  assert.equal(db.calls.length, 0);
}

// Replayed/concurrent resume requests dispatch the same active job without
// cloning checkpoints or invoking any create/resume-generation RPC.
{
  const db = createMockDb({ initialStatus: 'waiting' });
  const handler = createResumeAuditJobHandler({
    env,
    createDbClient: () => db,
    requireStaffImpl: async () => ({ userId: OWNER_ID, role: 'admin' }),
    fetchImpl: async () => ({ ok: true, status: 202 }),
  });
  const response = await handler(event());
  assert.equal(response.statusCode, 202);
  assert.equal(JSON.parse(response.body).resumed, false);
  assert.equal(db.calls.some((call) => call.startsWith('rpc:')), false);
}

// Only the exact provider_timeout checkpoint accepted by the SQL recovery
// function is eligible; a generic provider/validation Error stays in Ops.
{
  const db = createMockDb({ checkpoint: null });
  const handler = createResumeAuditJobHandler({
    env,
    createDbClient: () => db,
    requireStaffImpl: async () => ({ userId: OWNER_ID, role: 'admin' }),
  });
  const response = await handler(event());
  assert.equal(response.statusCode, 409);
  assert.equal(db.calls.some((call) => call.startsWith('rpc:')), false);
}

// A timeout checkpoint cannot mask a second terminal cause. That job must
// remain locked for Operations instead of entering a recovery loop that can
// never finalize.
{
  const db = createMockDb({
    checkpoints: [
      { id: 'checkpoint-timeout', status: 'error', error_type: 'provider_timeout' },
      { id: 'checkpoint-invalid', status: 'error', error_type: 'validation_error' },
    ],
  });
  const handler = createResumeAuditJobHandler({
    env,
    createDbClient: () => db,
    requireStaffImpl: async () => ({ userId: OWNER_ID, role: 'admin' }),
  });
  const response = await handler(event());
  assert.equal(response.statusCode, 409);
  assert.equal(db.calls.some((call) => call.startsWith('rpc:')), false);
}

// Source cleanup/expiry is the one post-hydration transition that safely
// unlocks a fresh upload; no recovery RPC or dispatch may run.
{
  const db = createMockDb({ sourceCleanupAt: '2026-08-24T00:00:00.000Z' });
  const handler = createResumeAuditJobHandler({
    env,
    createDbClient: () => db,
    requireStaffImpl: async () => ({ userId: OWNER_ID, role: 'admin' }),
  });
  const response = await handler(event());
  assert.equal(response.statusCode, 410);
  assert.equal(JSON.parse(response.body).code, 'source_expired');
  assert.equal(db.calls.some((call) => call.startsWith('rpc:')), false);
}

const clientSource = readFileSync(new URL('../src/utils/auditJobs.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const finalizationMigration = readFileSync(
  new URL('../supabase/migrations/20260820560000_audit_finalization_only_resume.sql', import.meta.url),
  'utf8',
);

const finalizationRpcStart = finalizationMigration.indexOf(
  'create or replace function public.ccc_resume_audit_finalization',
);
const legacyRetirementStart = finalizationMigration.indexOf('update public.audit_jobs job set');
assert.ok(legacyRetirementStart >= 0 && finalizationRpcStart > legacyRetirementStart);
const legacyRetirement = finalizationMigration.slice(legacyRetirementStart, finalizationRpcStart);
assert.match(legacyRetirement, /status = 'expired'/);
assert.match(legacyRetirement, /workflow_version = 'resumable-audit-v1'[\s\S]*job\.status = 'error'/);
assert.match(legacyRetirement, /A combined-report chunk contains data without a visible bureau identity\./);
assert.match(legacyRetirement, /final_audit_id is null/);
assert.match(legacyRetirement, /lease_token is null or job\.lease_expires_at <=/);
assert.match(legacyRetirement, /source_cleanup_at is null/);
assert.match(legacyRetirement, /checkpoint\.status <> 'superseded'[\s\S]*not exists[\s\S]*checkpoint\.status <> 'done'/);
assert.doesNotMatch(legacyRetirement, /source_cleanup_at\s*=/,
  'retirement must leave source cleanup to the bounded watchdog');
const finalizationRpcEnd = finalizationMigration.indexOf('\nrevoke all on function', finalizationRpcStart);
assert.ok(finalizationRpcStart >= 0 && finalizationRpcEnd > finalizationRpcStart);
const finalizationRpc = finalizationMigration.slice(finalizationRpcStart, finalizationRpcEnd);
assert.match(finalizationRpc, /workflow_version = 'resumable-audit-v1'[\s\S]*job\.status = 'error'/);
assert.match(finalizationRpc, /error is distinct from 'A combined-report chunk contains data without a visible bureau identity\.'/);
assert.match(finalizationRpc, /Audit ran but could not be saved:/);
assert.match(finalizationRpc, /Could not atomically finish logical audit job:/);
assert.match(finalizationRpc, /source_cleanup_at is null[\s\S]*expires_at > v_now/);
assert.match(finalizationRpc, /pg_advisory_xact_lock[\s\S]*for update/);
assert.match(finalizationRpc, /other\.logical_key = v_job\.logical_key[\s\S]*'done'/);
assert.match(finalizationRpc, /checkpoint\.status <> 'superseded'[\s\S]*checkpoint\.status = 'done'/);
assert.match(finalizationRpc, /v_active_checkpoint_count = 0[\s\S]*v_done_checkpoint_count <> v_active_checkpoint_count/);
assert.match(finalizationRpc, /status = 'waiting'[\s\S]*Resuming deterministic finalization from completed checkpoints/);
assert.doesNotMatch(finalizationRpc, /insert into public\.audit_job_checkpoints|update public\.audit_job_checkpoints/);
assert.doesNotMatch(finalizationRpc, /audit_provider_attempts/);
assert.match(finalizationMigration, /revoke all on function public\.ccc_resume_audit_finalization\(uuid\)[\s\S]*from public, anon, authenticated/);
assert.match(finalizationMigration, /grant execute on function public\.ccc_resume_audit_finalization\(uuid\)[\s\S]*to service_role/);

// Execute the browser module with a tiny dependency harness. Timers are
// shortened only in this in-memory test copy; production source is unchanged.
let fromImpl = () => { throw new Error('Unexpected Supabase query'); };
const storageValues = new Map();
globalThis.localStorage = {
  getItem: (key) => storageValues.get(key) ?? null,
  setItem: (key, value) => storageValues.set(key, String(value)),
  removeItem: (key) => storageValues.delete(key),
};
globalThis.__auditResumeTestSupabase = {
  auth: {
    getSession: async () => ({ data: { session: { access_token: 'owner-token' } } }),
    getUser: async () => ({ data: { user: { id: OWNER_ID } } }),
  },
  from: (...args) => fromImpl(...args),
};
let executableClient = clientSource
  .replace("import { supabase } from './supabase';", 'const supabase = globalThis.__auditResumeTestSupabase;')
  .replace(
    "import { MAX_REPORT_CHARS, htmlToText } from './reportText.js';",
    'const MAX_REPORT_CHARS = 750000; const htmlToText = (value) => value;',
  )
  .replace(
    /import \{\n  RESUMABLE_AUDIT_VERSION,[\s\S]*?\} from '\.\/auditResume\.js';/,
    "const RESUMABLE_AUDIT_VERSION = 'resumable-audit-v1'; const auditJobCanDispatch = () => false; const buildAuditSourceMeta = async () => ({});",
  )
  .replace('const POLL_MS = 2000;', 'const POLL_MS = 0;')
  .replace('const MAX_READ_FAILURES = 15;', 'const MAX_READ_FAILURES = 2;');
const clientModule = await import(`data:text/javascript;base64,${Buffer.from(executableClient).toString('base64')}`);

await assert.rejects(
  () => clientModule.withAuditRecoveryDeadline(new Promise(() => {}), 5),
  /Saved audit lookup timed out/,
  'a stalled saved-audit read must leave the spinner through a bounded error path',
);

assert.equal(clientModule.rememberAuditRecovery(OWNER_ID, JOB_ID), true);
assert.equal(clientModule.readRememberedAuditRecovery(OWNER_ID), JOB_ID,
  'a refresh must be able to hydrate the exact saved job from durable browser storage');
clientModule.forgetAuditRecovery(OWNER_ID, JOB_ID);
assert.equal(clientModule.readRememberedAuditRecovery(OWNER_ID), null);

const sanitizedFailure = clientModule.auditJobFailureFromRow({
  id: JOB_ID,
  status: 'error',
  workflow_version: 'resumable-audit-v1',
  error: 'Request was aborted. request_id=req_secret',
});
assert.equal(sanitizedFailure.auditJobId, JOB_ID);
assert.equal(sanitizedFailure.auditCanResume, true);
assert.equal(sanitizedFailure.auditSafeToUpload, false);
assert.equal(sanitizedFailure.message.includes('req_secret'), false);

const finalizationFailure = clientModule.auditJobFailureFromRow({
  id: JOB_ID,
  status: 'error',
  workflow_version: 'resumable-audit-v1',
  expected_checkpoint_count: 5,
  completed_checkpoint_count: 5,
  error: 'Could not atomically finish logical audit job: lease mismatch',
});
assert.equal(finalizationFailure.auditCanResume, true);
assert.equal(finalizationFailure.auditSafeToUpload, false);
assert.equal(finalizationFailure.message, clientModule.SAVED_AUDIT_FINALIZATION_MESSAGE);

assert.deepEqual(clientModule.auditRecoveryDisposition(null), { kind: 'missing' });
assert.equal(clientModule.auditRecoveryDisposition({
  status: 'done', result: { id: 'saved-result' },
}).kind, 'done');
assert.equal(clientModule.auditRecoveryDisposition({
  status: 'expired', workflow_version: 'resumable-audit-v1',
}).kind, 'expired');
assert.equal(clientModule.auditRecoveryDisposition({
  status: 'waiting', workflow_version: 'resumable-audit-v1', expires_at: '2099-01-01T00:00:00Z',
}).kind, 'resume');
assert.deepEqual(clientModule.auditRecoveryDisposition({
  status: 'error',
  workflow_version: 'resumable-audit-v1',
  expires_at: '2099-01-01T00:00:00Z',
  expected_checkpoint_count: 5,
  completed_checkpoint_count: 5,
  error: 'Could not verify final audit idempotency: database unavailable',
}), {
  kind: 'resume',
  canResume: true,
  message: clientModule.SAVED_AUDIT_FINALIZATION_MESSAGE,
});
assert.equal(clientModule.auditRecoveryDisposition({
  status: 'error', workflow_version: 'resumable-audit-v1', expires_at: '2099-01-01T00:00:00Z',
  expected_checkpoint_count: 5, completed_checkpoint_count: 4, error: 'unrelated failure',
}).kind, 'operations');
assert.equal(clientModule.auditRecoveryDisposition({
  status: 'error',
  workflow_version: 'resumable-audit-v1',
  expires_at: '2099-01-01T00:00:00Z',
  expected_checkpoint_count: 5,
  completed_checkpoint_count: 5,
  error: 'A combined-report chunk contains data without a visible bureau identity.',
}).kind, 'operations', 'legacy side-by-side outputs must require a fresh parser run');
assert.deepEqual(
  clientModule.selectAuditRecoveryCandidate(
    { id: 'older-done', status: 'done', result: { id: 'older-result' } },
    {
      id: JOB_ID,
      status: 'error',
      workflow_version: 'resumable-audit-v1',
      error: 'A report section took too long to analyze.',
    },
  ),
  {
    kind: 'resume',
    jobId: JOB_ID,
    canResume: true,
    message: clientModule.SAVED_AUDIT_TIMEOUT_MESSAGE,
  },
  'a newer failed job must lock recovery even when localStorage points at an older completed job',
);
assert.deepEqual(
  clientModule.selectAuditRecoveryCandidate(
    null,
    {
      id: JOB_ID,
      status: 'error',
      workflow_version: 'resumable-audit-v1',
      expected_checkpoint_count: 5,
      completed_checkpoint_count: 5,
      error: 'Could not load completed audit checkpoints: database unavailable',
    },
  ),
  {
    kind: 'resume',
    jobId: JOB_ID,
    canResume: true,
    message: clientModule.SAVED_AUDIT_FINALIZATION_MESSAGE,
  },
  'an all-done job-level failure must be discoverable after a refresh',
);

fromImpl = (table) => {
  assert.equal(table, 'audit_jobs');
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({
      data: {
        id: JOB_ID,
        user_id: OWNER_ID,
        status: 'done',
        workflow_version: 'resumable-audit-v1',
        result: { id: 'saved-result' },
      },
      error: null,
    }),
  };
  return query;
};
assert.equal((await clientModule.findOwnedAuditJob(JOB_ID, OWNER_ID))?.status, 'done',
  'a remembered job must be verified exactly before the upload screen is exposed');

const priorFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => ({ ok: false, status: 401 });
  await assert.rejects(
    () => clientModule.resumeAuditJob(JOB_ID),
    (error) => error.auditJobId === JOB_ID
      && error.auditCanResume === true
      && error.auditSafeToUpload === false,
    'an expired browser session must keep the exact saved job locked for recovery',
  );

  globalThis.fetch = async () => ({ ok: false, status: 410 });
  await assert.rejects(
    () => clientModule.resumeAuditJob(JOB_ID),
    (error) => error.auditJobId === JOB_ID
      && error.auditCanResume === false
      && error.auditSafeToUpload === true,
    'an expired exact source must unlock a fresh upload instead of trapping the open tab',
  );

  fromImpl = () => {
    const query = { select: () => query, eq: () => query, single: async () => ({ data: null, error: new Error('offline') }) };
    return query;
  };
  await assert.rejects(
    () => clientModule.pollAuditJob(JOB_ID),
    (error) => error.auditJobId === JOB_ID
      && error.auditCanResume === true
      && error.auditSafeToUpload === false,
    'transient polling loss must not expose a second upload',
  );

  fromImpl = () => {
    const query = {
      select: () => query,
      eq: () => query,
      single: async () => ({
        data: {
          id: JOB_ID,
          status: 'queued',
          attempt_count: 0,
          updated_at: '2020-01-01T00:00:00.000Z',
        },
        error: null,
      }),
    };
    return query;
  };
  await assert.rejects(
    () => clientModule.pollAuditJob(JOB_ID),
    (error) => error.auditJobId === JOB_ID
      && error.auditCanResume === true
      && error.auditSafeToUpload === false,
    'a dispatch visibility delay must keep the saved job locked',
  );
} finally {
  globalThis.fetch = priorFetch;
  delete globalThis.__auditResumeTestSupabase;
  delete globalThis.localStorage;
}

const resumeStart = clientSource.indexOf('export async function resumeAuditJob');
const resumeEnd = clientSource.indexOf('\nasync function dispatchAuditJob', resumeStart);
assert.ok(resumeStart >= 0 && resumeEnd > resumeStart);
const resumeSource = clientSource.slice(resumeStart, resumeEnd);
assert.match(resumeSource, /\/\.netlify\/functions\/audit-job-resume/);
assert.match(resumeSource, /return pollAuditJob\(jobId/);
assert.doesNotMatch(resumeSource, /crypto\.randomUUID|storage\.from|ccc_create_or_resume_audit_job|\.upload\(/);
assert.match(clientSource, /auditJobId = jobId/);
assert.match(clientSource, /auditCanResume = canResume === true/);
assert.match(clientSource, /auditSafeToUpload = safeToUpload === true/);
assert.match(clientSource, /looksLikeProviderInternals[\s\S]*Request was aborted/i);
assert.match(clientSource, /isRecoverableFinalizationJob[\s\S]*expected_checkpoint_count[\s\S]*completed_checkpoint_count/);
assert.match(clientSource, /SAVED_AUDIT_FINALIZATION_MESSAGE/);
assert.match(clientSource, /findLatestRecoverableAuditJob[\s\S]*expected_checkpoint_count,completed_checkpoint_count/);
assert.match(appSource, /Resume saved audit/);
assert.match(appSource, /It will not upload the report or create a new audit job\./);
assert.match(appSource, /readRememberedAuditRecovery\(userId\)/);
assert.match(appSource, /findOwnedAuditJob\(rememberedJobId, userId\)/);
assert.match(appSource, /selectAuditRecoveryCandidate\(exactJob, latestJob\)/);
assert.match(appSource, /\['done', 'missing', 'expired'\]\.includes\(disposition\.kind\)/);
const hydrationStart = appSource.indexOf('// A terminal provider timeout owns a durable report');
const hydrationEnd = appSource.indexOf('\n  useEffect(() => {\n    const initAuth', hydrationStart);
assert.ok(hydrationStart >= 0 && hydrationEnd > hydrationStart);
const hydrationSource = appSource.slice(hydrationStart, hydrationEnd);
assert.doesNotMatch(hydrationSource, /recoveryHydratedForUser/,
  'auth refresh cleanup must not leave a one-way hydration latch behind');
assert.match(
  hydrationSource,
  /\[auditRecoveryUserId, auditRecoveryProfileId, isClient, isAffiliate, auditRecoveryRetryKey\]/,
  'saved-audit hydration must depend on stable identity primitives and an explicit retry key',
);
assert.match(hydrationSource, /finally[\s\S]*setAuditRecoveryChecked\(true\)/,
  'every live hydration attempt must leave the loading screen');
assert.match(appSource, /Retry saved-audit check/,
  'a bounded lookup failure must expose a safe retry instead of the upload screen');
assert.match(appSource, /if \(!auditRecoveryChecked \|\| failedAuditRecovery\)/);
assert.match(appSource, /if \(failedAuditRecovery\) \{/);
assert.match(appSource, /state === STATE\.IDLE && auditRecoveryChecked && <UploadZone/);
const errorViewSource = appSource.slice(appSource.indexOf('function ErrorView'));
assert.doesNotMatch(errorViewSource, />\s*Try Again\s*</);
assert.match(errorViewSource, /!locked &&/);

console.log('Failed audit exact-job resume regression passed.');
