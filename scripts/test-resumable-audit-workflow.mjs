#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PDFDocument } from 'pdf-lib';
import {
  auditJobCanDispatch,
  auditRetryDelayMs,
  buildAuditSourceMeta,
  isResumableAuditActive,
} from '../src/utils/auditResume.js';
import { extractPdfPageRange, splitPdfByPages } from '../src/utils/pdfPageChunks.js';

const require = createRequire(import.meta.url);
const { isScheduledInvocation } = require('../netlify/functions/audit-job-watchdog.cjs');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const worker = read('../netlify/functions/audit-run-background.mjs');
const browser = read('../src/utils/auditJobs.js');
const storage = read('../src/utils/storage.js');
const migration = read('../supabase/migrations/20260820530000_resumable_audit_jobs.sql');
const watchdog = read('../netlify/functions/audit-job-watchdog.cjs');
const config = read('../netlify.toml');

// Browser identity/idempotency: content hashes are durable inputs and an
// existing logical job is polled/resumed instead of creating a retry row.
const sample = new Blob(['same report bytes'], { type: 'application/pdf' });
Object.defineProperty(sample, 'name', { value: 'report.pdf' });
const metaA = await buildAuditSourceMeta(sample, 'Equifax');
const metaB = await buildAuditSourceMeta(sample, 'Equifax');
assert.equal(metaA.sha256, metaB.sha256);
assert.equal(metaA.bytes, 17);
const namelessType = new Blob(['<html>report</html>'], { type: '' });
Object.defineProperty(namelessType, 'name', { value: 'report.html' });
assert.equal((await buildAuditSourceMeta(namelessType)).type, 'text/html');
assert.match(browser, /ccc_create_or_resume_audit_job/);
assert.match(browser, /jobId !== candidateJobId[\s\S]*removeCandidateUploads\(\)/);
assert.match(browser, /Resuming safely from the last saved checkpoint/);
assert.doesNotMatch(browser, /Try again, or audit the largest bureau alone first/);
assert.match(browser, /Do not upload it again—the same job remains queued for Operations review/);
assert.match(browser, /removeCandidateUploads/);
assert.match(browser, /rpcAttempted = true[\s\S]*from\('audit_jobs'\)[\s\S]*eq\('id', candidateJobId\)/);
assert.match(browser, /candidate\.workflow_version === RESUMABLE_AUDIT_VERSION[\s\S]*candidate\.selected_client_id === clientSelection\.id/);
assert.match(browser, /durableCandidate[\s\S]*jobId = durableCandidate\.id[\s\S]*else \{[\s\S]*removeCandidateUploads/);
assert.match(browser, /could not verify whether the durable audit job was created, so the source upload was preserved/);

// Exact client deletion starts with the parent row. PostgreSQL owns the
// atomic CASCADE/RESTRICT decision, so a concurrent audit-job insert cannot
// make parallel child deletes partially erase a retained client record.
const deleteClientBlock = storage.slice(storage.indexOf('export async function deleteClient'), storage.indexOf('export async function createLead'));
const deleteLeadBlock = storage.slice(storage.indexOf('export async function deleteLead'), storage.indexOf('// Recurring rows'));
assert.match(storage, /deleteExactClientRowFirst[\s\S]*from\('clients'\)\.delete\(\)/);
assert.match(deleteClientBlock, /if \(exactClientId\)[\s\S]*deleteExactClientRowFirst[\s\S]*return/);
assert.match(deleteLeadBlock, /if \(exactClientId\)[\s\S]*deleteExactClientRowFirst\(userId, exactClientId, 'lead'\)[\s\S]*return/);
assert.doesNotMatch(deleteClientBlock, /exactClientId[\s\S]*Promise\.all\([\s\S]*client_id/);

// The actual failed 29-page report must be multiple durable calls. The page
// windows overlap by two pages so cross-page tradelines can be de-duplicated.
const sourcePdf = await PDFDocument.create();
for (let page = 0; page < 29; page += 1) sourcePdf.addPage([612, 792]);
const sourcePdfBytes = await sourcePdf.save();
const chunks = await splitPdfByPages(sourcePdfBytes, { maxPages: 8 });
assert.equal(chunks.length, 5);
assert.deepEqual(chunks.map(({ startPage, endPage }) => [startPage, endPage]), [
  [1, 8], [7, 14], [13, 20], [19, 26], [25, 29],
]);
const exactRange = await extractPdfPageRange(sourcePdfBytes, { startPage: 7, endPage: 14 });
assert.equal((await PDFDocument.load(exactRange.bytes)).getPageCount(), 8);
assert.equal(exactRange.totalPages, 29);

// Delayed retries stay on the same job and only dispatch when due/lease-free.
assert.equal(isResumableAuditActive('retryable'), true);
assert.equal(auditJobCanDispatch({ status: 'retryable', next_retry_at: new Date(Date.now() - 1).toISOString() }), true);
assert.equal(auditJobCanDispatch({ status: 'retryable', next_retry_at: new Date(Date.now() + 60_000).toISOString() }), false);
assert.equal(auditJobCanDispatch({ status: 'running', lease_expires_at: new Date(Date.now() + 60_000).toISOString() }), false);
assert.equal(auditJobCanDispatch({ status: 'running', lease_expires_at: new Date(Date.now() - 1).toISOString() }), true);
assert.equal(auditRetryDelayMs(1), 5000);
assert.equal(auditRetryDelayMs(99), 300000);

// One provider-bearing checkpoint per invocation, with a pre-kill deadline
// guard and a durable completion before chaining the next invocation.
assert.match(worker, /WORKER_BUDGET_MS = 11\.5 \* 60 \* 1000/);
assert.match(worker, /maxRetries: 0/);
assert.match(worker, /timeout: 6 \* 60 \* 1000/);
assert.match(worker, /RESUMABLE_PDF_CHUNK_PAGES = 8/);
assert.match(worker, /preflightTokenCount[\s\S]*providerWindowMs[\s\S]*AbortSignal\.timeout/);
assert.match(worker, /remainingBudgetMs\(\) < MIN_PROVIDER_BUDGET_MS[\s\S]*releaseLease[\s\S]*dispatchNext/);
assert.match(worker, /remainingBudgetMs\(\) < MIN_PROVIDER_BUDGET_MS[\s\S]*checkpointId: checkpoint\.id[\s\S]*dispatchNext/);
assert.match(worker, /await completeCheckpoint\(activeCheckpoint, output\)[\s\S]*activeCheckpoint\.kind !== 'merge'[\s\S]*releaseLease[\s\S]*dispatchNext[\s\S]*return \{ statusCode: 200, body: 'checkpoint saved' \}/);
assert.match(worker, /ccc_claim_next_audit_checkpoint/);
assert.match(worker, /checkpoint\.output_sha256 !== parseSha256\(checkpoint\.output\)/);
assert.match(worker, /source\.sha256 !== checkpoint\.source_sha256/);
assert.match(worker, /priorAudits[\s\S]*auditSuffix[\s\S]*ccc_finish_audit_job/);

// Every provider dispatch is logged before the stream and terminally updated
// for completion, output limits, and failures.
const providerBlock = worker.slice(worker.indexOf("from('audit_provider_attempts').insert"), worker.indexOf('const downloadedReports'));
assert.match(providerBlock, /status: 'started'/);
assert.match(providerBlock, /anthropic\.messages\.stream/);
assert.match(providerBlock, /status: 'completed'/);
assert.match(providerBlock, /outputLimit \? 'output_limit' : 'failed'/);
assert.match(worker, /ccc_split_audit_checkpoint/);
assert.match(worker, /sequence: sourceIndex \* 1000000 \+ chunk\.startPage \* 100/);
assert.match(worker, /activeCheckpoint\.end_page[\s\S]*activeCheckpoint\.start_page[\s\S]*>= 4/);

// All four modes route through durable checkpoints and preserve the existing
// deterministic cohort/provenance guards.
assert.match(worker, /\['combined', 'single', 'individual', 'merge'\]\.includes/);
assert.match(worker, /job\.mode === 'combined'/);
assert.match(worker, /job\.mode === 'single'/);
assert.match(worker, /job\.mode === 'merge'/);
assert.match(worker, /mode: 'individual'/);
assert.match(worker, /assertReportCohort/);
assert.match(worker, /assertExtractionPageBounds/);
assert.match(worker, /buildDeterministicAudit/);

// Database owns logical idempotency, leases, immutable checkpoints, and
// service-only mutation. Expired workers are retry-visible and reclaimable.
assert.match(migration, /audit_jobs_user_logical_key_uidx/);
assert.match(migration, /workflow_version = 'legacy'[\s\S]*Legacy audit requires a deliberate rerun/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /force_direct_audit_job_legacy/);
assert.match(migration, /legacy-browser-blocked[\s\S]*Reload required before starting this audit[\s\S]*interval '2 hours'/);
assert.doesNotMatch(migration, /Rollback is code-only/);
assert.match(migration, /Exclude[\s\S]*paths from logical identity/);
assert.match(migration, /create table if not exists public\.audit_job_attempts/);
assert.match(migration, /create table if not exists public\.audit_job_checkpoints/);
assert.match(migration, /create table if not exists public\.audit_provider_attempts/);
assert.match(migration, /prevent_terminal_audit_checkpoint_mutation/);
assert.match(migration, /revoke update on public\.audit_jobs from anon, authenticated/);
assert.match(migration, /grant execute on function public\.ccc_claim_audit_job[\s\S]*to service_role/);
assert.match(migration, /status = 'expired'[\s\S]*Worker lease expired/);
assert.match(migration, /expires_at <= v_now[\s\S]*lease_token is null or lease_expires_at <= v_now/);
assert.match(migration, /Final audit row is not bound to this logical job\/client/);
assert.match(migration, /audit_upload_cleanup_claims[\s\S]*audit-upload:[\s\S]*p_candidate_id/);
assert.match(migration, /ccc_claim_orphan_audit_upload_cleanup[\s\S]*interval '2 hours'[\s\S]*pg_advisory_xact_lock[\s\S]*audit_upload_cleanup_claims/);
assert.match(migration, /revoke all on function public\.ccc_claim_orphan_audit_upload_cleanup\(integer\) from public[\s\S]*grant execute[\s\S]*to service_role/);

assert.match(watchdog, /ccc_reclaim_stale_audit_jobs/);
assert.match(watchdog, /BLOCKED_LEGACY_BROWSER_VERSION[\s\S]*\.in\('workflow_version'/);
assert.match(watchdog, /ccc_claim_orphan_audit_upload_cleanup/);
assert.match(watchdog, /parseCandidateAuditUpload[\s\S]*db\.storage\.from\('documents'\)\.remove\(orphanPaths\)[\s\S]*audit_upload_cleanup_claims/);
assert.match(watchdog, /source_cleanup_at/);
assert.match(watchdog, /isOwnedAuditUpload/);
assert.match(watchdog, /\.eq\('status', 'expired'\)/);
assert.doesNotMatch(watchdog, /\.in\('status', \['done'/,
  'successful deterministic audit sources must remain available for page/SHA verification');
assert.match(watchdog, /Authorization: 'Bearer ' \+ serviceKey/);
assert.match(watchdog, /process\.env\.DEPLOY_URL \|\| process\.env\.URL/);
assert.match(worker, /process\.env\.DEPLOY_URL \|\| process\.env\.URL/);
assert.match(config, /\[functions\."audit-job-watchdog"\][\s\S]*schedule = "\*\/5 \* \* \* \*"/);

const priorNetlifyDev = process.env.NETLIFY_DEV;
delete process.env.NETLIFY_DEV;
assert.equal(isScheduledInvocation({ body: JSON.stringify({ next_run: '2026-08-23T12:00:00.000Z' }) }), true);
assert.equal(isScheduledInvocation({}), false);
assert.equal(isScheduledInvocation({ next_run: '2026-08-23T12:00:00.000Z' }), false);
if (priorNetlifyDev === undefined) delete process.env.NETLIFY_DEV;
else process.env.NETLIFY_DEV = priorNetlifyDev;

console.log('Resumable audit timeout/idempotency/security contracts passed.');
