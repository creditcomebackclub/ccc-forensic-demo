// Server-side audit pipeline — Netlify BACKGROUND function (15-min limit).
// Holds ANTHROPIC_API_KEY as a server env var; the browser never sees a key.
//
// Contract: client uploads report file(s) to Supabase Storage, inserts an
// audit_jobs row (status 'queued'), then POSTs { jobId } here and polls the
// row. This function claims the job atomically, streams the audit through
// Claude with the same schemas/prompts/guards as the old browser pipeline,
// writes progress to the row as it goes, saves the finished audit to the
// audits table (so a closed tab loses nothing), and marks the job done.
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { ACCOUNT_ENRICHMENT_SCHEMA } from '../../src/utils/auditSchemas.js';
import { COMBINED_CREDIT_EXTRACTION_SCHEMA, CREDIT_BUREAU_EXTRACTION_SCHEMA } from '../../src/utils/creditExtractionSchemas.js';
import { CREDIT_EXTRACTION_SYSTEM_PROMPT, bureauExtractionPrompt, combinedExtractionPrompt } from '../../src/prompts/extractionPrompts.js';
import {
  buildDeterministicAudit,
  coerceBureauExtraction,
  mergeBureauExtractions,
  mergeCombinedExtractions,
} from '../../src/utils/deterministicAudit.js';
import { resolveAuditIdentities } from '../../src/utils/accountIdentity.js';
import { normalizeFurnisher } from '../../src/utils/diffEngine.js';
import { randomUUID } from 'crypto';
import { requireStaff } from './_requireAuth.cjs';
import {
  buildReportContent, accountEnrichmentPrompt, todayLong,
} from '../../src/utils/auditPrompts.js';
import { describePdfChunk, splitPdfByPages } from '../../src/utils/pdfPageChunks.js';
import { logClaudeCall, preflightTokenCount, usageFromMessage } from './_claudeRuntime.mjs';

// This is deliberately a pinned application choice, not an environment
// fallback. A future model change must be reviewed in code and will be
// rejected at runtime if Anthropic routes the request anywhere else.
const AUDIT_MODEL = 'claude-sonnet-5';
const AUDIT_EFFORT = 'high';
const ANTHROPIC_OPTIONS = {
  // Bound automatic retries so a transient 429/5xx gets a second chance
  // without a background function spending its whole 15-minute window
  // retrying one request.
  maxRetries: 2,
  timeout: 8 * 60 * 1000,
};
const SYSTEM = [{ type: 'text', text: CREDIT_EXTRACTION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];

// Sonnet 5 intro pricing (per MTok) — valid through 2026-08-31
const PRICE = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };

// A credit report rarely approaches this, but the cap keeps base64 request
// bodies below the provider's transport limit even when an uploaded PDF is a
// scan rather than a normal text export. HTML/text also has the separate
// post-cleanup character cap in reportText.js.
const MAX_TOTAL_REPORT_BYTES = 15 * 1024 * 1024;

function slug(s) {
  return String(s || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'unknown';
}

function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function usdFor(u) {
  return ((u.input_tokens || 0) * PRICE.input + (u.output_tokens || 0) * PRICE.output
    + (u.cache_read_input_tokens || 0) * PRICE.cacheRead
    + (u.cache_creation_input_tokens || 0) * PRICE.cacheWrite) / 1e6;
}

function parseAuditJSON(text) {
  try { return JSON.parse(text); } catch (e) { /* fall through */ }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1];
  const obj = text.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch (e) { /* fall through */ } }
  throw new Error('Could not parse JSON from response');
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertAuditOutput(audit, label = 'Audit') {
  if (!audit || typeof audit !== 'object' || Array.isArray(audit)) {
    throw new Error(`${label} returned an invalid JSON object`);
  }
  if (!audit.client || !nonEmptyString(audit.client.name)) {
    throw new Error(`${label} did not include a client name`);
  }
  if (!Array.isArray(audit.accounts) || !Array.isArray(audit.inquiries)) {
    throw new Error(`${label} is missing required account or inquiry data`);
  }
  if (!audit.accounts.every((account) => account && nonEmptyString(account.id)
      && nonEmptyString(account.furnisher) && Array.isArray(account.violations))) {
    throw new Error(`${label} contains an invalid account record`);
  }
  return audit;
}

function assertBureauOutput(report, bureau) {
  if (!report || typeof report !== 'object' || Array.isArray(report)
      || !report.client || !nonEmptyString(report.client.name)
      || !Array.isArray(report.accounts) || !Array.isArray(report.inquiries)) {
    throw new Error(`${bureau} parsing returned an invalid audit object`);
  }
  return report;
}

function assertEnrichmentOutput(enrichment) {
  if (!enrichment || typeof enrichment !== 'object' || Array.isArray(enrichment)
      || !Array.isArray(enrichment.accounts)) {
    throw new Error('Account enrichment returned an invalid JSON object');
  }
  return enrichment;
}

function textFromVerifiedModelMessage(message, operation) {
  if (!message || message.model !== AUDIT_MODEL) {
    throw new Error(`${operation} model mismatch — expected ${AUDIT_MODEL}, received ${message?.model || 'no model id'}`);
  }
  if (message.stop_reason !== 'end_turn') {
    if (message.stop_reason === 'max_tokens') {
      throw new Error('The analysis hit the output limit before finishing — the report may be too large for one pass. Try Individual mode with one file per bureau (oversized PDFs are auto-split into page chunks).');
    }
    if (message.stop_reason === 'refusal') {
      throw new Error('The model declined this request. Check the report content and try again.');
    }
    throw new Error(`${operation} did not finish cleanly (${message.stop_reason || 'unknown stop reason'})`);
  }
  const text = (message.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('');
  if (!text.trim()) throw new Error(`${operation} returned no text output`);
  return text;
}

// Page-count splitting (pdfChunksForReport) only guards Anthropic's input
// page cap. A report can sit well under that cap and still overflow the
// output token budget purely from tradeline/violation density, so a single
// unsplit call can hit this even though nothing was ever "too many pages."
function isOutputLimitError(err) {
  return err instanceof Error && /hit the output limit/i.test(err.message);
}

function normalizedMediaType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

function isSupportedAuditMediaType(value) {
  const mediaType = normalizedMediaType(value);
  return mediaType === 'application/pdf' || mediaType === 'application/x-pdf'
    || mediaType === 'text/plain' || mediaType === 'text/html'
    || mediaType === 'application/xhtml+xml';
}

// Groups accounts[].violations by field, counting occurrences and keeping
// the first-seen statute for that field — same shape the model used to
// generate directly (removed from the schema to fix the compiled-grammar
// 400; this is deterministic and cheaper than asking the model to
// re-derive data it already produced in accounts[].violations).
function computeViolationsByType(accounts) {
  const byField = new Map();
  for (const acct of accounts || []) {
    for (const v of acct.violations || []) {
      if (!v.field) continue;
      if (!byField.has(v.field)) byField.set(v.field, { type: v.field, count: 0, statute: v.statute || '' });
      byField.get(v.field).count++;
    }
  }
  return [...byField.values()];
}

// Best-effort date parsing from the free-text currentlyReports/shouldReport
// violation fields — "October 2023", "10/2023", "2023-10-20", "10/20/2023"
// all appear in real model output. Returns a Date or null; never throws.
// Exported for unit testing.
export function parseLooseDate(text) {
  if (!text) return null;
  const s = String(text);
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  const mdy = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (mdy) return new Date(Date.UTC(+mdy[3], +mdy[1] - 1, +mdy[2]));
  const my = s.match(/\b(\d{1,2})\/(\d{4})\b/);
  if (my) return new Date(Date.UTC(+my[2], +my[1] - 1, 1));
  const monthName = s.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b\.?\s+(\d{1,2},?\s+)?(\d{4})\b/i);
  if (monthName) {
    const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const m = months.indexOf(monthName[1].toLowerCase());
    const day = monthName[2] ? parseInt(monthName[2]) : 1;
    return new Date(Date.UTC(+monthName[3], m, day));
  }
  return null;
}

// Extracts all dollar amounts appearing in a string, as numbers.
function extractDollarAmounts(text) {
  if (!text) return [];
  const matches = String(text).matchAll(/\$\s?([\d,]+(?:\.\d{2})?)/g);
  return [...matches].map((m) => parseFloat(m[1].replace(/,/g, '')));
}

// P2-1 (2026-07-23 defect report): on a purchased charged-off account
// (Type C — third-party collector) with no post-sale activity, Current
// Balance (Field 21) equal to Amount Past Due (Field 22) is standard,
// expected Metro 2 reporting, not a violation — the violation condition is
// strictly Current Balance < Amount Past Due. A real letter cited this as a
// violation when the furnisher's own explanation (standard for collection
// accounts) was correct. Best-effort: only acts when exactly two distinct
// dollar amounts can be extracted from the violation's own text and they
// are equal — anything ambiguous is left alone rather than risk suppressing
// a legitimate violation phrased differently (same conservative approach as
// the DOFD guard above).
export function applyCollectionBalanceGuard(accounts) {
  const suppressed = [];
  for (const acct of accounts || []) {
    if (acct.type !== 'C') continue; // Type C = third-party collector, this app's closest match to "COLLECTION"
    const kept = [];
    for (const v of acct.violations || []) {
      const isBalanceField = /\bfield\s*2[12]\b|current balance|amount past due/i.test(v.field || '');
      if (isBalanceField) {
        // Only the reported state, never shouldReport — shouldReport
        // describes the demanded correction (often a deliberately different
        // number) and would corrupt an "are the reported amounts equal"
        // check if pooled in.
        let amounts = extractDollarAmounts(v.currentlyReports);
        if (amounts.length < 2) amounts = extractDollarAmounts(`${v.currentlyReports || ''} ${v.issue || ''}`);
        const unique = [...new Set(amounts)];
        if (amounts.length >= 2 && unique.length === 1) {
          suppressed.push({
            accountId: acct.id, furnisher: acct.furnisher, field: v.field, amount: unique[0],
            reason: 'Current Balance equals Amount Past Due on a collection account — standard Metro 2 reporting for a purchased charged-off account, not a violation. Field 21/22 count suppressed.',
          });
          continue;
        }
      }
      kept.push(v);
    }
    acct.violations = kept;
  }
  return suppressed;
}

// P0-2 (2026-07-23 defect report): the forensic play on DOFD is almost
// always "the true date is EARLIER than reported" (re-aging forward to
// extend the 7-year §1681c(c)(1) reporting clock). Arguing the true date is
// LATER does the opposite — it extends the client's own reporting window —
// and it slipped through once already (Kilpatrick/Align Balance). A prompt
// instruction alone isn't a guarantee the model won't do this again, so
// this deterministically strips any DOFD violation whose asserted
// (shouldReport) date parses as later than the furnisher-reported
// (currentlyReports) date. Only acts when BOTH dates parse cleanly — an
// unparseable date is not evidence of anything, so it does not block
// (avoids false positives on legitimate violations with free-text dates);
// non-verification framing without a competing date is unaffected either
// way, since there's nothing to compare. Mutates accounts in place and
// returns the list of suppressions for admin visibility.
export function applyDofdDirectionalGuard(accounts) {
  const suppressed = [];
  for (const acct of accounts || []) {
    const kept = [];
    for (const v of acct.violations || []) {
      const isDofd = /\b25\b|DOFD|date of first delinquency/i.test(v.field || '');
      if (isDofd) {
        const reported = parseLooseDate(v.currentlyReports);
        const asserted = parseLooseDate(v.shouldReport);
        if (reported && asserted && asserted.getTime() > reported.getTime()) {
          suppressed.push({
            accountId: acct.id, furnisher: acct.furnisher, field: v.field,
            reportedDOFD: v.currentlyReports, assertedDOFD: v.shouldReport,
            reason: 'Asserted DOFD is later than reported DOFD — this extends the §1681c(c)(1) reporting window and is adverse to the client. Field 25 count suppressed.',
          });
          continue; // drop this violation
        }
      }
      kept.push(v);
    }
    acct.violations = kept;
  }
  return suppressed;
}

function isOwnedAuditUpload(path, userId, jobId) {
  if (typeof path !== 'string' || !path || path.includes('..') || path.startsWith('/')) return false;
  return path.startsWith(`${userId}/audit-jobs/${jobId}/`);
}

function hasExpectedAuditFiles(job, userId, jobId) {
  const files = Array.isArray(job?.files) ? job.files : [];
  if (!['combined', 'single', 'individual', 'merge'].includes(job?.mode)) return false;

  // Merge jobs reuse staged bureau parses — no PDF upload required.
  if (job.mode === 'merge') {
    return files.length === 0 && !!job.selected_client_id;
  }

  if (!files.length || !files.every((file) => isOwnedAuditUpload(file?.path, userId, jobId))) return false;
  if (job.mode !== 'individual') return files.length === 1;

  if (files.length !== 3) return false;
  const bureaus = files.map((file) => String(file?.bureau || '').toLowerCase());
  return bureaus.length === new Set(bureaus).size
    && ['equifax', 'experian', 'transunion'].every((bureau) => bureaus.includes(bureau));
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function normalizeBureauKey(bureau) {
  const key = String(bureau || '').trim().toLowerCase();
  if (key === 'eq' || key === 'equifax') return 'equifax';
  if (key === 'exp' || key === 'experian') return 'experian';
  if (key === 'tu' || key === 'transunion') return 'transunion';
  return null;
}

function bureauDisplayName(key) {
  if (key === 'equifax') return 'Equifax';
  if (key === 'experian') return 'Experian';
  if (key === 'transunion') return 'TransUnion';
  return key || 'Bureau';
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let caller;
  try {
    caller = await requireStaff(event);
  } catch (e) {
    if (e && e.statusCode) return e;
    console.error('audit-run: could not authenticate caller', e);
    return { statusCode: 500, body: 'authentication failed' };
  }

  let jobId = null;
  try { jobId = JSON.parse(event.body || '{}').jobId; } catch (e) { /* handled below */ }
  if (typeof jobId !== 'string' || !jobId) return { statusCode: 400, body: 'jobId required' };

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!supabaseUrl || !serviceKey || !anthropicKey) {
    console.error('audit-run: missing env (supabase or ANTHROPIC_API_KEY)');
    return { statusCode: 500, body: 'server not configured' };
  }

  // Netlify's Node 20 runtime has no global WebSocket, and supabase-js always
  // constructs a RealtimeClient in createClient() even though this function
  // only does REST calls — without a real transport it throws synchronously
  // here. `transport: null`/`{enabled:false}` do NOT suppress this (realtime-js
  // treats null as nullish and still resolves a constructor); only a real
  // WebSocket implementation avoids the throw.
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  });

  // A process can be terminated after claiming a job (deployment, provider
  // outage, or the background-function limit). Mark abandoned work terminal
  // before accepting new work from the same staff member so it is visible and
  // retryable instead of remaining "running" forever. Active streams refresh
  // updated_at continuously, so this does not touch a live job.
  const staleCutoff = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const { error: staleRecoveryErr } = await db
    .from('audit_jobs')
    .update({
      status: 'error',
      stage: 'Interrupted — retry required',
      error: 'Audit worker stopped before completing. Please retry the audit.',
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', caller.userId)
    .eq('status', 'running')
    .lt('updated_at', staleCutoff);
  if (staleRecoveryErr) console.warn('audit-run: stale-job recovery failed', staleRecoveryErr.message);

  // Confirm the queued job belongs to the authenticated staff member and
  // only references that member's transient upload directory before any
  // service-role mutation or model call.
  const { data: queuedJob, error: queuedJobErr } = await db
    .from('audit_jobs')
    .select('id, mode, files, selected_client_id, selected_client_is_new')
    .eq('id', jobId)
    .eq('user_id', caller.userId)
    .eq('status', 'queued')
    .maybeSingle();
  if (queuedJobErr || !queuedJob) {
    console.warn('audit-run: job not available to caller', jobId, queuedJobErr?.message);
    return { statusCode: 409, body: 'job not claimable' };
  }
  if (!hasExpectedAuditFiles(queuedJob, caller.userId, jobId)) {
    // Fail closed rather than leaving a malformed caller-owned job queued
    // indefinitely. Only validated owned paths are removed.
    const now = new Date().toISOString();
    const { error: rejectErr } = await db.from('audit_jobs').update({
      status: 'error', stage: 'Rejected invalid report upload',
      error: 'Audit job contains invalid report files or mode.',
      finished_at: now, updated_at: now,
    }).eq('id', jobId).eq('user_id', caller.userId).eq('status', 'queued');
    if (rejectErr) console.warn('audit-run: could not mark invalid job failed', rejectErr.message);
    const ownedPaths = (queuedJob.files || []).map((file) => file?.path)
      .filter((path) => isOwnedAuditUpload(path, caller.userId, jobId));
    if (ownedPaths.length) await db.storage.from('documents').remove(ownedPaths).catch(() => {});
    return { statusCode: 400, body: 'job contains invalid report upload paths' };
  }

  // Every current audit must point at one explicit CRM identity before any
  // model call. A new prospect is created by the staff picker first and then
  // arrives here as that exact UUID. Never let extracted names select, merge,
  // or create a client implicitly.
  if (queuedJob.selected_client_is_new || !isUuid(queuedJob.selected_client_id)) {
    const now = new Date().toISOString();
    await db.from('audit_jobs').update({
      status: 'error', stage: 'Exact client selection required',
      error: 'Create or select the exact CRM lead before running this audit.',
      finished_at: now, updated_at: now,
    }).eq('id', jobId).eq('user_id', caller.userId).eq('status', 'queued');
    const ownedPaths = (queuedJob.files || []).map((file) => file?.path)
      .filter((path) => isOwnedAuditUpload(path, caller.userId, jobId));
    if (ownedPaths.length) await db.storage.from('documents').remove(ownedPaths).catch(() => {});
    return { statusCode: 400, body: 'exact client selection required' };
  }

  const { data: selectedRows, error: selectedClientError } = await db.from('clients')
    .select('id,name')
    .eq('id', queuedJob.selected_client_id)
    .eq('user_id', caller.userId)
    .limit(2);
  if (selectedClientError || !selectedRows || selectedRows.length !== 1) {
    const now = new Date().toISOString();
    await db.from('audit_jobs').update({
      status: 'error', stage: 'Selected client unavailable',
      error: 'The selected CRM client no longer exists or is not available to this staff account.',
      finished_at: now, updated_at: now,
    }).eq('id', jobId).eq('user_id', caller.userId).eq('status', 'queued');
    const ownedPaths = (queuedJob.files || []).map((file) => file?.path)
      .filter((path) => isOwnedAuditUpload(path, caller.userId, jobId));
    if (ownedPaths.length) await db.storage.from('documents').remove(ownedPaths).catch(() => {});
    return { statusCode: 403, body: 'selected client unavailable' };
  }
  const selectedJobClient = selectedRows[0];

  // Atomic claim — only proceeds if the caller owns a row that is still
  // queued. Authenticated clients cannot reach this point, and one staff
  // member cannot consume another staff member's queued job.
  const { data: claimed, error: claimErr } = await db
    .from('audit_jobs')
    .update({ status: 'running', started_at: new Date().toISOString(), updated_at: new Date().toISOString(), stage: 'Starting analysis', pct: null, tokens: 0 })
    .eq('id', jobId)
    .eq('user_id', caller.userId)
    .eq('status', 'queued')
    .select();
  if (claimErr || !claimed || claimed.length === 0) {
    console.warn('audit-run: job not claimable', jobId, claimErr?.message);
    return { statusCode: 409, body: 'job not claimable' };
  }
  const job = claimed[0];

  const anthropic = new Anthropic({ apiKey: anthropicKey, ...ANTHROPIC_OPTIONS });
  const usageLog = [];
  let lastWrite = 0;

  const updateJob = async (patch, force = false) => {
    const now = Date.now();
    if (!force && now - lastWrite < 1200) return; // throttle progress writes
    lastWrite = now;
    const { error } = await db.from('audit_jobs')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', jobId);
    if (error) throw new Error('Could not persist audit job state: ' + error.message);
  };

  const progress = (stage, pct) => (tokens) =>
    updateJob({ stage, pct, tokens: tokens || 0 }, tokens === 0);

  async function claudeCall(userContent, { maxTokens = 64000, schema = null, onTokens = null, effort = AUDIT_EFFORT, operation = 'audit.analysis' } = {}) {
    const params = {
      model: AUDIT_MODEL,
      max_tokens: maxTokens,
      system: SYSTEM,
      messages: [{ role: 'user', content: userContent }],
      output_config: { effort },
    };
    if (schema) params.output_config.format = { type: 'json_schema', schema };
    await preflightTokenCount(anthropic, params, { operation: 'Credit report analysis' });

    const startedAt = new Date();
    const stream = anthropic.messages.stream(params);
    if (onTokens) {
      let chars = 0;
      stream.on('text', (delta) => {
        chars += delta.length;
        // Progress is operational telemetry; an intermittent write must not
        // crash an otherwise-valid model stream through an unhandled promise.
        void onTokens(Math.round(chars / 4)).catch((e) => {
          console.warn('audit-run: progress write failed', e.message);
        }); // ~4 chars/token readout
      });
    }
    const msg = await stream.finalMessage();
    const text = textFromVerifiedModelMessage(msg, 'Audit analysis');

    const u = usageFromMessage(msg);
    await logClaudeCall(db, {
      userId: caller.userId, operation, entityType: 'audit_job', entityId: jobId,
      model: AUDIT_MODEL, effort, promptVersion: 'audit-v2', attempt: usageLog.length + 1,
      status: 'completed', startedAt, requestId: msg._request_id, usage: u,
      stopReason: msg.stop_reason,
    });
    usageLog.push({
      model: msg.model,
      effort,
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      cache_read: u.cache_read_input_tokens || 0,
      cache_write: u.cache_creation_input_tokens || 0,
      est_cost_usd: Math.round(usdFor(u) * 10000) / 10000,
      stop_reason: msg.stop_reason,
    });
    console.log('[audit-usage]', JSON.stringify(usageLog[usageLog.length - 1]));

    return text;
  }

  const downloadedReports = new Map();
  let downloadedReportBytes = 0;
  async function downloadReport(file) {
    if (downloadedReports.has(file.path)) return downloadedReports.get(file.path);
    const { data, error } = await db.storage.from('documents').download(file.path);
    if (error || !data) throw new Error('Could not read uploaded report (' + (error?.message || 'missing file') + ')');
    const bytes = Buffer.from(await data.arrayBuffer());
    if (!bytes.length) throw new Error('Uploaded report is empty.');
    if (downloadedReportBytes + bytes.length > MAX_TOTAL_REPORT_BYTES) {
      throw new Error('The uploaded report files exceed the 15 MB server processing limit. Export a smaller report or use Individual mode with lighter bureau files.');
    }

    // Prefer Storage's content type when it is usable, otherwise retain the
    // original browser declaration. The latter covers a few browsers that
    // upload HTML/TXT with application/octet-stream.
    const storageType = normalizedMediaType(data.type);
    const declaredType = normalizedMediaType(file.type);
    const mediaType = isSupportedAuditMediaType(storageType) ? storageType : declaredType;
    if (!isSupportedAuditMediaType(mediaType)) {
      throw new Error('Unsupported report format. Upload a PDF, HTML, or plain-text credit report.');
    }
    const report = { bytes, base64: bytes.toString('base64'), mediaType };
    downloadedReportBytes += bytes.length;
    downloadedReports.set(file.path, report);
    return report;
  }

  async function pdfChunksForReport(report) {
    if (!report?.mediaType || !report.mediaType.includes('pdf')) {
      return null;
    }
    const pdfBytes = report.bytes || Buffer.from(report.base64, 'base64');
    return splitPdfByPages(pdfBytes);
  }

  async function runBureauChunks(chunks, { bureauKey, bureauName, stage, pct }) {
    console.log(`[audit] ${bureauName} PDF is ${chunks[0].totalPages} pages — splitting into ${chunks.length} parts`);
    const parts = [];
    for (const chunk of chunks) {
      const chunkStage = `${stage} (${describePdfChunk(chunk)})`;
      await progress(chunkStage, pct)(0);
      const prompt = bureauExtractionPrompt(bureauKey, chunk);
      const raw = await claudeCall(
        buildReportContent(chunk.base64, prompt, 'application/pdf'),
        { schema: CREDIT_BUREAU_EXTRACTION_SCHEMA, onTokens: progress(chunkStage, pct), operation: 'audit.report_extraction' },
      );
      parts.push(assertBureauOutput(coerceBureauExtraction(parseAuditJSON(raw), bureauKey), bureauName));
    }
    return assertBureauOutput(mergeBureauExtractions(parts, bureauKey), bureauName);
  }

  async function parseBureauReportChunked({ report, bureauName, stage, pct, today }) {
    const bureauKey = normalizeBureauKey(bureauName);
    const chunks = await pdfChunksForReport(report);
    if (chunks && chunks.length > 1) {
      return runBureauChunks(chunks, { bureauKey, bureauName, stage, pct });
    }

    try {
      const raw = await claudeCall(
        buildReportContent(report.base64, bureauExtractionPrompt(bureauKey), report.mediaType),
        { schema: CREDIT_BUREAU_EXTRACTION_SCHEMA, onTokens: progress(stage, pct), operation: 'audit.report_extraction' },
      );
      return assertBureauOutput(coerceBureauExtraction(parseAuditJSON(raw), bureauKey), bureauName);
    } catch (err) {
      const totalPages = chunks?.[0]?.totalPages || 0;
      if (!isOutputLimitError(err) || totalPages < 2) throw err;
      console.warn(`[audit] ${bureauName} hit the output limit at ${totalPages} pages (under the page-split threshold) — forcing a split and retrying`);
      const forcedChunks = await splitPdfByPages(report.bytes || Buffer.from(report.base64, 'base64'), {
        maxPages: Math.max(1, Math.ceil(totalPages / 2)),
      });
      return runBureauChunks(forcedChunks, { bureauKey, bureauName, stage, pct });
    }
  }

  async function runCombinedChunks(chunks, { stage }) {
    console.log(`[audit] report PDF is ${chunks[0].totalPages} pages — splitting into ${chunks.length} parts`);
    const parts = [];
    for (const chunk of chunks) {
      const chunkStage = `${stage} (${describePdfChunk(chunk)})`;
      await progress(chunkStage, null)(0);
      const raw = await claudeCall(buildReportContent(chunk.base64, combinedExtractionPrompt(chunk), 'application/pdf'), {
        schema: COMBINED_CREDIT_EXTRACTION_SCHEMA,
        onTokens: progress(chunkStage, null),
        operation: 'audit.report_extraction',
      });
      parts.push(parseAuditJSON(raw));
    }
    return mergeCombinedExtractions(parts);
  }

  async function parseCombinedExtractionChunked({ report, stage }) {
    const chunks = await pdfChunksForReport(report);
    if (chunks && chunks.length > 1) {
      return runCombinedChunks(chunks, { stage });
    }

    try {
      const raw = await claudeCall(
        buildReportContent(report.base64, combinedExtractionPrompt(null), report.mediaType),
        { schema: COMBINED_CREDIT_EXTRACTION_SCHEMA, onTokens: progress(stage, null), operation: 'audit.report_extraction' },
      );
      return mergeCombinedExtractions([parseAuditJSON(raw)]);
    } catch (err) {
      const totalPages = chunks?.[0]?.totalPages || 0;
      if (!isOutputLimitError(err) || totalPages < 2) throw err;
      console.warn(`[audit] combined report hit the output limit at ${totalPages} pages (under the page-split threshold) — forcing a split and retrying`);
      const forcedChunks = await splitPdfByPages(report.bytes || Buffer.from(report.base64, 'base64'), {
        maxPages: Math.max(1, Math.ceil(totalPages / 2)),
      });
      return runCombinedChunks(forcedChunks, { stage });
    }
  }

  async function resolveClientForParse(bureauParse) {
    void bureauParse;
    return { clientName: selectedJobClient.name, clientId: selectedJobClient.id };
  }

  async function saveBureauParseRow({ bureauKey, bureauParse, pageCount = null, chunkCount = null }) {
    const { clientName, clientId } = await resolveClientForParse(bureauParse);
    const row = {
      user_id: job.user_id,
      client_id: clientId,
      client_name: clientName,
      bureau: bureauKey,
      report_date: todayISO(),
      parse: bureauParse,
      source_job_id: jobId,
      page_count: pageCount,
      chunk_count: chunkCount,
      updated_at: new Date().toISOString(),
    };

    // Upsert by deleting prior row for this staff+client+bureau, then insert.
    // Partial unique indexes make ON CONFLICT awkward across null client_id.
    let del = db.from('audit_bureau_parses').delete().eq('user_id', job.user_id).eq('bureau', bureauKey);
    if (clientId) del = del.eq('client_id', clientId);
    else del = del.is('client_id', null).eq('client_name', clientName);
    await del;

    const { error } = await db.from('audit_bureau_parses').insert(row);
    if (error) throw new Error('Could not save bureau parse: ' + error.message);

    let readyQuery = db.from('audit_bureau_parses')
      .select('bureau,updated_at')
      .eq('user_id', job.user_id);
    if (clientId) readyQuery = readyQuery.eq('client_id', clientId);
    else readyQuery = readyQuery.is('client_id', null).eq('client_name', clientName);
    const { data: readyRows } = await readyQuery;
    const ready = [...new Set((readyRows || []).map((r) => normalizeBureauKey(r.bureau)).filter(Boolean))];

    return {
      kind: 'bureau_parse',
      bureau: bureauKey,
      bureauLabel: bureauDisplayName(bureauKey),
      clientName,
      clientId,
      pageCount,
      chunkCount,
      readyBureaus: ready,
      missingBureaus: ['equifax', 'experian', 'transunion'].filter((b) => !ready.includes(b)),
      canMerge: ready.length === 3,
      parse: bureauParse,
    };
  }

  async function loadBureauParsesForMerge() {
    if (!job.selected_client_id) {
      throw new Error('Merge requires an existing client selection so the three bureau parses can be found.');
    }
    const { data, error } = await db.from('audit_bureau_parses')
      .select('bureau,parse,client_id,client_name,updated_at')
      .eq('user_id', job.user_id)
      .eq('client_id', job.selected_client_id)
      .order('updated_at', { ascending: false });
    if (error) throw new Error('Could not load bureau parses: ' + error.message);

    const byBureau = {};
    for (const row of data || []) {
      const key = normalizeBureauKey(row.bureau);
      if (!key || byBureau[key]) continue;
      byBureau[key] = assertBureauOutput(coerceBureauExtraction(row.parse, key), bureauDisplayName(key));
    }
    for (const key of ['equifax', 'experian', 'transunion']) {
      if (!byBureau[key]) {
        throw new Error(`Missing ${bureauDisplayName(key)} parse for this client. Run Single Bureau for each bureau first, then merge.`);
      }
    }
    return byBureau;
  }

  async function finalizeUnifiedAudit(audit, { skipEnrichment = false, files = [], today } = {}) {
    if (!audit || !audit.client) throw new Error('Audit produced no client data.');

    const legacyEvaluation = audit.evaluationMode !== 'deterministic';
    const dofdSuppressions = legacyEvaluation ? applyDofdDirectionalGuard(audit.accounts) : [];
    if (dofdSuppressions.length) {
      console.warn('[dofd-guard] suppressed adverse-direction DOFD violation(s):', JSON.stringify(dofdSuppressions));
      audit.dofdGuardSuppressions = dofdSuppressions;
      audit.totalViolations = Math.max(0, (audit.totalViolations || 0) - dofdSuppressions.length);
    }
    const balanceSuppressions = legacyEvaluation ? applyCollectionBalanceGuard(audit.accounts) : [];
    if (balanceSuppressions.length) {
      console.warn('[balance-guard] suppressed collection-account balance==past-due violation(s):', JSON.stringify(balanceSuppressions));
      audit.collectionBalanceGuardSuppressions = balanceSuppressions;
      audit.totalViolations = Math.max(0, (audit.totalViolations || 0) - balanceSuppressions.length);
    }

    audit.totalViolations = (audit.accounts || []).reduce((sum, account) => sum + (account.violations || []).length, 0);
    audit.accountsTargeted = (audit.accounts || []).filter((account) => (account.violations || []).length > 0).length;
    audit.violationsByType = computeViolationsByType(audit.accounts);

    // Deterministic audits already carry extraction-backed field values. The
    // legacy enrichment call remains available only for historical audit
    // objects that predate the extraction schema.
    if (!skipEnrichment && audit.evaluationMode !== 'deterministic') {
      await progress('Enriching account details', 90)(0);
      try {
        const enrichmentContent = [];
        let attachedReportPages = 0;
        for (const f of files) {
          const report = await downloadReport(f);
          const chunks = await pdfChunksForReport(report);
          if (chunks && chunks.length > 1) {
            console.warn(`[audit] skipping oversized ${f.bureau || 'report'} PDF in enrichment (${chunks[0].totalPages} pages)`);
            continue;
          }
          if (chunks && chunks[0]) attachedReportPages += chunks[0].totalPages;
          if (attachedReportPages > 95) {
            console.warn('[audit] enrichment page budget reached — skipping remaining report attachments');
            continue;
          }
          enrichmentContent.push(buildReportContent(report.base64, '', report.mediaType)[0]);
        }
        enrichmentContent.push({ type: 'text', text: accountEnrichmentPrompt(today, audit.accounts) });

        const enrichRaw = await claudeCall(enrichmentContent, {
          schema: ACCOUNT_ENRICHMENT_SCHEMA,
          maxTokens: 8000,
          effort: 'medium',
          operation: 'audit.account_enrichment',
          onTokens: progress('Enriching account details', 90),
        });
        const enrichment = assertEnrichmentOutput(parseAuditJSON(enrichRaw));
        const byId = new Map((enrichment?.accounts || []).map((e) => [e.id, e]));
        for (const acct of audit.accounts || []) {
          const e = byId.get(acct.id);
          acct.paymentRating = e ? e.paymentRating : null;
          acct.dateOfFirstDelinquency = e ? e.dateOfFirstDelinquency : null;
          acct.remarks = e ? e.remarks : null;
          acct.disputeFlag = e ? !!e.disputeFlag : false;
          acct.accountKind = e ? e.accountKind : null;
          acct.latePaymentCount = e ? e.latePaymentCount : null;
          acct.latePaymentBand = e ? e.latePaymentBand : 'unclear';
        }
      } catch (e) {
        console.warn('[audit-enrichment] failed (non-fatal, audit continues without these fields):', e.message);
      }
    }

    const {
      clientName: savedClientName,
      clientId: savedClientId,
      auditId: savedAuditId,
    } = await saveAuditAs(job.user_id, audit, job);
    // Carry the exact persisted row identity through the background-job result.
    // Classification review must bind to this row, never re-resolve by a
    // potentially duplicated client name/report date.
    audit.auditId = savedAuditId;

    (async () => {
      try {
        const clientName = savedClientName || (audit && audit.client && audit.client.name) || null;
        if (!clientName) return;
        const base = process.env.URL || process.env.DEPLOY_URL || 'https://ccc-forensic-demo.netlify.app';
        await fetch(base + '/.netlify/functions/progress-narrative-background', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + serviceKey },
          body: JSON.stringify({ clientName, clientId: savedClientId || null, userId: job.user_id }),
        });
      } catch (e) {
        console.warn('[audit] progress-narrative trigger failed (non-fatal):', e.message);
      }
    })();

    return audit;
  }

  // Mirrors client-side saveAudit(): starting-score auto-populate, audits
  // upsert (same slug__date id), and the lead-row upsert — attributed to the
  // job's user so the audit lands in their records even if the tab closed.
  async function saveAuditAs(userId, audit, job) {
    // Enforce the addressStatus/furnisherAddress pairing server-side rather
    // than trusting masterPrompt.js's instructions alone — confirmed live
    // (William Pope's Navy Federal, Austin Mote's Suzuki account) that the
    // model sometimes sets CONFIRM without ever populating furnisherAddress,
    // leaving the Kanban "Address Confirm" card with nothing to confirm.
    // CONFIRM/YES with no address is downgraded to PENDING (the only status
    // that's actually true of an empty address); YES is never a legitimate
    // audit-generation output per masterPrompt.js §10, so any account still
    // carrying it this early (before the furnisher_addresses backfill below,
    // which is the sole legitimate source of YES) is treated the same way.
    for (const acct of (audit && audit.accounts) || []) {
      const hasAddress = !!(acct.furnisherAddress && acct.furnisherAddress.trim());
      if ((acct.addressStatus === 'CONFIRM' || acct.addressStatus === 'YES') && !hasAddress) {
        acct.addressStatus = 'PENDING';
      } else if (acct.addressStatus === 'YES' && hasAddress) {
        acct.addressStatus = 'CONFIRM';
      }
    }

    const extractedClientName = (audit && audit.client && audit.client.name) || 'Unknown Client';
    const clientName = selectedJobClient.name;
    const clientAddress = (audit && audit.client && audit.client.address) || null;
    const reportDate = (audit && audit.client && audit.client.reportDate) || todayISO();
    const clientId = selectedJobClient.id;
    if (extractedClientName.trim().toLowerCase() !== clientName.trim().toLowerCase()) {
      console.warn('[audit] report name differs from exact staff-selected CRM client; attribution remains bound to selected UUID');
    }

    try {
      const scores = audit.scores || (audit.client && audit.client.scores);
      if (clientName && scores) {
        // address MUST be in this select list: the auto-populate below guards
        // on `!existing[0].address` to "only fill blanks", and a column that
        // isn't selected reads back undefined — so that guard silently
        // inverted itself and overwrote the stored address on EVERY audit run.
        // Cost a real correction: staff set Stefani Bryant's current Mesa AZ
        // address by hand, then her next audit replaced it with the stale
        // Alabama address her credit file still lists. date_of_birth and phone
        // were already selected here, so only address was affected.
        const PROFILE_COLS = 'score_eq_start,score_exp_start,score_tu_start,date_of_birth,phone,address';
        const existingQuery = db.from('clients').select(PROFILE_COLS)
          .eq('id', clientId).eq('user_id', userId).limit(1);
        const { data: existing } = await existingQuery;
        const hasScores = existing && existing.length > 0 && (existing[0].score_eq_start || existing[0].score_exp_start || existing[0].score_tu_start);
        if (!hasScores) {
          const eq = scores.equifax || scores.eq || null;
          const exp = scores.experian || scores.exp || null;
          const tu = scores.transunion || scores.tu || null;
          if (eq || exp || tu) {
            await db.from('clients').update({
              score_eq_start: eq ? parseInt(eq) : null,
              score_exp_start: exp ? parseInt(exp) : null,
              score_tu_start: tu ? parseInt(tu) : null,
            }).eq('id', clientId).eq('user_id', userId);
          }
        }

        // Auto-populate DOB, phone, and address from personalInfo — only fills blanks
        const pi = audit.personalInfo || (audit.client && audit.client.personalInfo);
        if (pi && existing && existing.length > 0) {
          const profilePatch = {};
          if (pi.dateOfBirth && !existing[0].date_of_birth) profilePatch.date_of_birth = pi.dateOfBirth;
          if (pi.phone && !existing[0].phone) profilePatch.phone = pi.phone;
          // currentAddress in personalInfo is the "listed address on report" — only use as address fallback
          const reportCurrentAddress = pi.currentAddress || clientAddress;
          if (reportCurrentAddress && !existing[0].address) profilePatch.address = reportCurrentAddress;

          if (Object.keys(profilePatch).length > 0) {
            // Key on the resolved id when we have one — clients.name has no
            // unique constraint, so a name-only match here could patch a
            // same-named client's profile instead (standing client_id rule).
            const patchQuery = db.from('clients').update(profilePatch)
              .eq('id', clientId).eq('user_id', userId);
            await patchQuery;
            console.log('[audit] auto-populated profile fields:', Object.keys(profilePatch).join(', '));
          }
        }
      }
    } catch (e) { console.warn('score/profile auto-populate failed:', e.message); }

    // Persistent account identity: assign each tradeline a stable UUID
    // (client_accounts) that survives audit re-runs, so letters/bureau-gating
    // never key on the positional acct_N id. Best-effort — a failure here
    // must never block the audit save; accounts simply won't carry a
    // clientAccountId and Phase 3 falls back to (and blocks on) furnisher
    // matching.
    try {
      const identityQuery = db.from('client_accounts')
        .select('id,norm_furnisher,original_creditor,account_last4')
        .eq('user_id', userId).eq('client_id', clientId);
      const { data: existingIds } = await identityQuery;
      const existing = existingIds || [];
      const accounts = (audit && audit.accounts) || [];
      const { assignments, creates, enriches, reviews } = resolveAuditIdentities(accounts, existing, randomUUID);

      if (creates.length) {
        const rows = creates.map((c) => ({
          id: c.id, user_id: userId, client_id: clientId, client_name: clientName,
          norm_furnisher: c.norm_furnisher, display_furnisher: c.display_furnisher,
          original_creditor: c.original_creditor, account_last4: c.account_last4,
        }));
        const { error: cErr } = await db.from('client_accounts').insert(rows);
        if (cErr) throw cErr;
      }
      for (const en of enriches) {
        await db.from('client_accounts').update({ account_last4: en.account_last4, updated_at: new Date().toISOString() }).eq('id', en.id);
      }
      // Flag any identity involved in a collision for manual review; accounts
      // left unassigned (null) simply carry no clientAccountId and will block
      // at Phase 3 rather than misroute.
      for (const rv of reviews) {
        if (rv.identityId) {
          await db.from('client_accounts').update({ needs_review: true, review_reason: rv.reason, updated_at: new Date().toISOString() }).eq('id', rv.identityId);
        }
      }
      if (reviews.length) console.warn('[identity] ' + reviews.length + ' account(s) flagged for review:', JSON.stringify(reviews));

      // Inject the resolved UUID onto each account in the stored audit JSON.
      for (const acct of accounts) acct.clientAccountId = assignments.get(acct.id) || null;
    } catch (e) { console.warn('[identity] resolution failed (non-fatal):', e.message); }

    // Fill in any account the audit-generation LLM left PENDING (no address
    // match at all) or CONFIRM (matched masterPrompt.js's own static list,
    // pre-filled but not yet human-approved) using addresses staff have
    // already confirmed for other clients — this is what actually makes a
    // confirmation reusable instead of one-off. Covers CONFIRM too, not
    // just PENDING: a furnisher a human already verified via this table
    // shouldn't need a redundant click just because masterPrompt.js's
    // static list also happens to have a (still human-unapproved) guess for
    // it — a match against a real prior human confirmation is strictly
    // more trustworthy than the static list's own unconfirmed suggestion.
    // This used to only exist in the client-side saveAudit() (dead —
    // nothing calls it, the real upload flow is this background job), so
    // the furnisher_addresses table was being written to by confirmations
    // but never read back. This is the fix.
    try {
      const accounts = (audit && audit.accounts) || [];
      if (accounts.some((a) => a.addressStatus === 'PENDING' || a.addressStatus === 'CONFIRM')) {
        const { data: known } = await db.from('furnisher_addresses').select('*').eq('user_id', userId);
        const byKey = new Map((known || []).map((r) => [r.furnisher_key, r]));
        for (const acct of accounts) {
          if (acct.addressStatus !== 'PENDING' && acct.addressStatus !== 'CONFIRM') continue;
          const match = byKey.get(normalizeFurnisher(acct.furnisher));
          if (match) {
            acct.furnisherAddress = [match.address_line1, match.address_line2, match.city + ', ' + match.state + ' ' + match.zip].filter(Boolean).join(', ');
            acct.addressStatus = 'YES';
          }
        }
      }
    } catch (e) { console.warn('[audit] furnisher-address backfill failed (non-fatal):', e.message); }

    // id embeds clientId (when resolved) alongside the readable slug, not
    // just slug(clientName)+date — two same-named clients auditing on the
    // same report date used to collide on this literal primary key, one
    // upsert silently overwriting the other's saved audit. Nothing parses
    // this id back apart (confirmed before making this change), and it's
    // never shown to end users (PDF filenames/portal views derive from
    // audit.client.name directly), so widening the format is safe. Only
    // falls back to the old bare format in the rare case clientId
    // genuinely couldn't be resolved (exact-name ambiguity) — same
    // collision risk that already existed there, not a new one.
    const auditId = clientId
      ? slug(clientName) + '__' + clientId + '__' + reportDate
      : slug(clientName) + '__' + reportDate;

    if (audit.client && clientId) audit.client.id = clientId;

    const savedAt = new Date().toISOString();
    const { error } = await db.from('audits').upsert({
      id: auditId,
      user_id: userId,
      created_by: userId,
      client_id: clientId,
      client_name: clientName,
      client_address: clientAddress,
      report_date: reportDate,
      saved_at: savedAt,
      audit,
    });
    if (error) throw new Error('Audit ran but could not be saved: ' + error.message);

    // status: 'lead' here is a no-op for any row that already exists
    // (ignoreDuplicates means ON CONFLICT DO NOTHING) — it only ever applies
    // to a genuinely new row. Without it, a brand-new client whose audit
    // came back with no extractable score on any bureau (the score-populate
    // block above is the only other place that stamps 'lead', and it's
    // gated on having at least one score) would fall through to this insert
    // with no status at all, silently defaulting to the table's own column
    // default — which is 'active', not 'lead'. Whether someone shows up
    // under Leads or Clients must never depend on whether the model could
    // read a score off their report.
    await db.from('clients').upsert({
      user_id: userId, name: clientName, address: clientAddress, status: 'lead',
    }, { onConflict: 'user_id,name', ignoreDuplicates: true });

    return { clientName, clientId, auditId, savedAt };
  }

  const filePaths = (job.files || []).map((f) => f.path);
  try {
    const t = todayLong();
    const files = job.files || [];
    let audit;
    let jobResult = null;

    if (job.mode === 'single') {
      const f = files[0];
      if (!f) throw new Error('No report file attached to this job.');
      const bureauKey = normalizeBureauKey(f.bureau);
      if (!bureauKey) throw new Error('Single bureau jobs require Equifax, Experian, or TransUnion.');
      const bureauName = bureauDisplayName(bureauKey);
      const stage = `Parsing ${bureauName} report`;
      await progress(stage, 10)(0);
      const report = await downloadReport(f);
      const chunks = await pdfChunksForReport(report);
      const bureauParse = await parseBureauReportChunked({
        report, bureauName, stage, pct: 10, today: t,
      });
      await progress(`Saving ${bureauName} parse`, 90)(0);
      jobResult = await saveBureauParseRow({
        bureauKey,
        bureauParse,
        pageCount: chunks?.[0]?.totalPages || null,
        chunkCount: chunks?.length || 1,
      });
    } else if (job.mode === 'merge') {
      await progress('Loading staged bureau parses', 10)(0);
      const parsed = await loadBureauParsesForMerge();
      await progress('Applying deterministic cross-bureau rules', 40)(0);
      audit = assertAuditOutput(buildDeterministicAudit(
        [parsed.equifax, parsed.experian, parsed.transunion],
        { reportDate: todayISO() },
      ));
      audit = await finalizeUnifiedAudit(audit, { skipEnrichment: true, files: [], today: t });
      jobResult = audit;
    } else if (job.mode === 'combined') {
      const f = files[0];
      if (!f) throw new Error('No report file attached to this job.');
      const stage = 'Extracting 3-bureau report';
      await progress(stage, null)(0);
      const report = await downloadReport(f);
      const extracted = await parseCombinedExtractionChunked({ report, stage });
      await progress('Applying deterministic report rules', 85)(0);
      audit = assertAuditOutput(buildDeterministicAudit(extracted, { reportDate: todayISO() }));
      audit = await finalizeUnifiedAudit(audit, { skipEnrichment: true, files, today: t });
      jobResult = audit;
    } else if (job.mode === 'individual') {
      const byBureau = {};
      for (const f of files) byBureau[(f.bureau || '').toLowerCase()] = f;
      const parsed = {};
      const stages = [
        ['equifax', 'Extracting Equifax report', 5],
        ['experian', 'Extracting Experian report', 30],
        ['transunion', 'Extracting TransUnion report', 55],
      ];
      for (const [key, stage, pct] of stages) {
        const f = byBureau[key];
        if (!f) throw new Error('Missing ' + key + ' file on this job.');
        await progress(stage, pct)(0);
        const report = await downloadReport(f);
        const bureauName = bureauDisplayName(key);
        parsed[key] = await parseBureauReportChunked({
          report, bureauName, stage, pct, today: t,
        });
      }
      await progress('Applying deterministic cross-bureau rules', 80)(0);
      audit = assertAuditOutput(buildDeterministicAudit(
        [parsed.equifax, parsed.experian, parsed.transunion],
        { reportDate: todayISO() },
      ));
      audit = await finalizeUnifiedAudit(audit, { skipEnrichment: true, files, today: t });
      jobResult = audit;
    } else {
      throw new Error('Unknown audit mode: ' + job.mode);
    }

    const totals = usageLog.reduce((s, u) => ({
      input: s.input + u.input, output: s.output + u.output,
      cache_read: s.cache_read + u.cache_read, cache_write: s.cache_write + u.cache_write,
      est_cost_usd: Math.round((s.est_cost_usd + u.est_cost_usd) * 10000) / 10000,
    }), { input: 0, output: 0, cache_read: 0, cache_write: 0, est_cost_usd: 0 });

    await updateJob({
      status: 'done', stage: 'Complete', pct: 100, result: jobResult,
      usage: {
        model: AUDIT_MODEL,
        effort: AUDIT_EFFORT,
        calls: usageLog,
        totals,
      },
      finished_at: new Date().toISOString(),
    }, true);
  } catch (e) {
    console.error('audit-run failed:', e);
    await logClaudeCall(db, {
      userId: caller.userId, operation: 'audit.pipeline', entityType: 'audit_job', entityId: jobId,
      model: AUDIT_MODEL, effort: AUDIT_EFFORT, promptVersion: 'audit-v2', status: 'error',
      startedAt: new Date(), errorType: e.name, errorMessage: e.message,
    });
    try {
      await updateJob({
        status: 'error', error: e.message || 'Audit failed',
        usage: usageLog.length ? {
          model: AUDIT_MODEL,
          effort: AUDIT_EFFORT,
          calls: usageLog,
        } : null,
        finished_at: new Date().toISOString(),
      }, true);
    } catch (jobWriteErr) {
      // Stale-job recovery at the start of the next request makes a failed
      // terminal write observable/retryable instead of silently stranding it.
      console.error('audit-run: could not persist failed job state', jobWriteErr.message);
    }
  } finally {
    // Uploaded report files are transient — remove them either way
    if (filePaths.length) {
      await db.storage.from('documents').remove(filePaths).catch(() => {});
    }
  }

  return { statusCode: 200, body: 'ok' };
};
