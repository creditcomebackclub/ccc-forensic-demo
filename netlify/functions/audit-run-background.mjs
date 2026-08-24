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
import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument } from 'pdf-lib';
import ws from 'ws';
import { ACCOUNT_ENRICHMENT_SCHEMA } from '../../src/utils/auditSchemas.js';
import { COMBINED_CREDIT_EXTRACTION_SCHEMA, CREDIT_BUREAU_EXTRACTION_SCHEMA } from '../../src/utils/creditExtractionSchemas.js';
import {
  COMPACT_COMBINED_CREDIT_EXTRACTION_SCHEMA,
  COMPACT_CREDIT_BUREAU_EXTRACTION_SCHEMA,
  decodeCompactBureauExtraction,
  decodeCompactCombinedExtraction,
} from '../../src/utils/compactCreditExtractionCodec.js';
import {
  COMBINED_FIXED_COLUMN_CONTEXT_POLICY,
  detectCombinedPdfContextPolicy,
  measureAuditPdfPageDensity,
  planAdaptiveAuditCheckpointRanges,
  resolveFrozenCombinedContextPolicy,
} from '../../src/utils/auditCheckpointPlanner.js';
import { CREDIT_EXTRACTION_SYSTEM_PROMPT, bureauExtractionPrompt, combinedExtractionPrompt } from '../../src/prompts/extractionPrompts.js';
import {
  assertReportCohort,
  assertCombinedCheckpointAttribution,
  assertExtractionPageBounds,
  buildDeterministicAudit,
  coerceBureauExtraction,
  mergeBureauExtractions,
  mergeCombinedExtractions,
  mapExtractionPageRefs,
  rebaseExtractionPageRefs,
} from '../../src/utils/deterministicAudit.js';
import { resolveAuditIdentities } from '../../src/utils/accountIdentity.js';
import { normalizeFurnisher } from '../../src/utils/diffEngine.js';
import { createHash, randomUUID } from 'crypto';
import { requireStaffOrSystem } from './_requireAuth.cjs';
import {
  buildNativeReportContent, buildReportContent, accountEnrichmentPrompt, todayLong,
} from '../../src/utils/auditPrompts.js';
import { extractNativePdfText } from '../../src/utils/nativePdfText.js';
import {
  describePdfChunk, extractPdfPageRange, extractPdfPages, splitPdfByPages,
} from '../../src/utils/pdfPageChunks.js';
import { logClaudeCall, preflightTokenCount, usageFromMessage } from './_claudeRuntime.mjs';
import {
  anthropicJsonSchemaFormat,
  parseAndValidateAnthropicJsonEnvelope,
  withLocalSchemaContract,
} from './_anthropicSchema.mjs';
import { settleEveryAuditCheckpoint } from '../../src/utils/auditResume.js';

// This is deliberately a pinned application choice, not an environment
// fallback. A future model change must be reviewed in code and will be
// rejected at runtime if Anthropic routes the request anywhere else.
const AUDIT_MODEL = 'claude-sonnet-5';
// Credit-report extraction is document transcription, not open-ended
// reasoning. Medium is the cost/latency release candidate and must remain
// covered by the extraction-quality regression gate.
const AUDIT_EFFORT = 'medium';
// Sonnet 5 enables adaptive thinking by default. This pipeline is strict
// document transcription with full local schema/provenance validation, not a
// reasoning task; adaptive thinking added minutes and paid tokens without
// strengthening the deterministic boundary. Disable it explicitly.
const AUDIT_THINKING = Object.freeze({ type: 'disabled' });
const ANTHROPIC_OPTIONS = {
  // Durable checkpoint attempts own retries. SDK retries can otherwise turn
  // one provider dispatch into multiple long requests that outlive both the
  // worker budget and its lease.
  maxRetries: 0,
  timeout: 6 * 60 * 1000,
};
const SYSTEM = [{ type: 'text', text: CREDIT_EXTRACTION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];

// Sonnet 5 intro pricing (per MTok) — valid through 2026-08-31
const PRICE = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };

// A credit report rarely approaches this, but the cap keeps base64 request
// bodies below the provider's transport limit even when an uploaded PDF is a
// scan rather than a normal text export. HTML/text also has the separate
// post-cleanup character cap in reportText.js.
const MAX_TOTAL_REPORT_BYTES = 15 * 1024 * 1024;
const AUDIT_PROVENANCE_VERSION = 'audit-provenance-v1';
const RESUMABLE_WORKFLOW_VERSION = 'resumable-audit-v1';
const WORKER_LEASE_SECONDS = 13 * 60;
const WORKER_BUDGET_MS = 11.5 * 60 * 1000;
const MIN_PROVIDER_BUDGET_MS = 7 * 60 * 1000;
// The real 29-page timeout must never collapse back into one provider call.
// Image-only/unreadable PDFs retain the conservative fixed-page fallback.
// Text-readable PDFs use the compact-contract density planner below.
const RESUMABLE_PDF_CHUNK_PAGES = 8;
// Three extraction calls may overlap inside one exclusively leased worker.
// Checkpoint writes remain serial and immutable after the calls settle.
const MAX_PROVIDER_CONCURRENCY = 3;
// A dense range should split and resume while the overall audit can still meet
// its product latency target; never burn the full six-minute client timeout on
// one provider range.
const EXTRACTION_PROVIDER_TIMEOUT_MS = 3 * 60 * 1000;
const COMBINED_CONTEXT_SOURCE_PAGE = 1;
const COMBINED_SOURCE_PDF_DATA_PAGES = RESUMABLE_PDF_CHUNK_PAGES - 1;
let auditPdfJsRuntimePromise = null;
const auditPdfJsLoader = async () => {
  // PDF.js' Node build normally installs these through a runtime `require`.
  // Netlify bundles the function into ESM/CJS glue where that auto-polyfill
  // path cannot resolve `import.meta.url`, so install the exact canvas-backed
  // primitives before the lazy import. Without this, the deployed function
  // crashes at module initialization with `DOMMatrix is not defined`.
  globalThis.DOMMatrix ||= DOMMatrix;
  globalThis.ImageData ||= ImageData;
  globalThis.Path2D ||= Path2D;
  auditPdfJsRuntimePromise ||= import('pdfjs-dist/legacy/build/pdf.mjs');
  return auditPdfJsRuntimePromise;
};
const auditPdfLibLoader = async () => ({ PDFDocument });

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function nativeTextCanDriveCheckpoint(nativeText) {
  return ['eligible', 'hybrid'].includes(nativeText?.status)
    && typeof nativeText?.compactText === 'string'
    && nativeText.compactText.length > 0;
}

function checkpointSplitReason(error) {
  if (error?.auditNativeFallbackSplit) return 'native_fallback';
  if (error?.auditProviderTimeout) return 'provider_timeout';
  if (error?.auditOutputLimit) return 'output_limit';
  return null;
}

function checkpointSourcePageMap({ kind, startPage, endPage, contextSourcePage = null }) {
  const start = Number(startPage);
  const end = Number(endPage);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    throw new Error('Checkpoint source page range is invalid.');
  }
  const dataPages = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  const contextPage = Number(contextSourcePage);
  return kind === 'combined_chunk'
      && Number.isInteger(contextPage)
      && contextPage > 0
      && contextPage < start
    ? [contextPage, ...dataPages]
    : dataPages;
}

function checkpointInputSha256({
  sourceSha256, startPage, endPage, totalPages, kind = null, contextSourcePage = null,
}) {
  const base = {
    workflowVersion: RESUMABLE_WORKFLOW_VERSION,
    sourceSha256,
    startPage,
    endPage,
    totalPages,
  };
  if (kind === 'combined_chunk' && Number(contextSourcePage) === COMBINED_CONTEXT_SOURCE_PAGE) {
    base.inputPolicy = COMBINED_FIXED_COLUMN_CONTEXT_POLICY;
    base.sourcePageMap = checkpointSourcePageMap({
      kind, startPage, endPage, contextSourcePage,
    });
  }
  return sha256(canonicalJson(base));
}

function uuidFromSha256(value) {
  const hex = sha256(value).slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  const joined = hex.join('');
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function parseSha256(parse) {
  return sha256(canonicalJson(parse));
}

function provenanceSha256(provenance) {
  const payload = { ...provenance };
  delete payload.provenanceSha256;
  delete payload.provenanceCanonical;
  return sha256(canonicalJson(payload));
}

function provenanceCanonical(provenance) {
  const payload = { ...provenance };
  delete payload.provenanceSha256;
  delete payload.provenanceCanonical;
  return canonicalJson(payload);
}

function cohortKeyFor(clientId, cohort) {
  return sha256(canonicalJson({
    clientId,
    reportDate: cohort.reportDate,
    canonicalName: cohort.identity.canonicalName,
  }));
}

function sourceRecord({
  bureauParse, report, file, parseId = null, sourceJobId,
  pageCount = null, chunkCount = null, extractionInputs = null,
}) {
  return {
    bureau: bureauParse.bureau,
    reportDate: bureauParse.reportDate,
    reportDateRaw: bureauParse.reportDateRaw || null,
    reportDateEvidencePage: bureauParse.reportDateEvidencePage ?? null,
    bureauEvidencePage: bureauParse.bureauEvidencePage ?? null,
    reportSectionStartEvidencePage: bureauParse.reportSectionStartEvidencePage ?? null,
    clientName: bureauParse.client?.name || null,
    clientNameEvidencePage: bureauParse.client?.nameEvidencePage ?? null,
    dateOfBirth: bureauParse.personalInfo?.dateOfBirth || null,
    dateOfBirthEvidencePage: bureauParse.personalInfo?.dateOfBirthEvidencePage ?? null,
    sourceJobId,
    parseId,
    parseSha256: parseSha256(bureauParse),
    filePath: report?.sourcePath || file?.path || null,
    fileSha256: report?.sourceSha256 || null,
    fileBytes: report?.sourceBytes || null,
    mediaType: report?.mediaType || null,
    pageCount,
    chunkCount,
    ...(Array.isArray(extractionInputs) && extractionInputs.length
      ? { extractionInputs }
      : {}),
  };
}

function extractionInputsFromCheckpoints(checkpoints) {
  return (checkpoints || []).flatMap((checkpoint) => {
    const input = checkpoint?.usage?.input_provenance;
    if (!input || ![
      'native_pdf_text', 'hybrid_native_pdf', 'source_pdf', 'source_html', 'source_text',
    ].includes(input.inputMode)) return [];
    if (!Number.isInteger(Number(input.localPageCount))
        || !Number.isInteger(Number(input.sourceStartPage))
        || !Number.isInteger(Number(input.sourceEndPage))) return [];
    if (['native_pdf_text', 'hybrid_native_pdf', 'source_html', 'source_text'].includes(input.inputMode)
        && (typeof input.parserVersion !== 'string'
          || !/^[0-9a-f]{64}$/.test(String(input.derivedPayloadSha256 || '')))) return [];
    const sourcePageMap = Array.isArray(input.sourcePageMap)
      ? input.sourcePageMap.map(Number)
      : null;
    if (sourcePageMap && (sourcePageMap.length !== Number(input.localPageCount)
        || sourcePageMap.some((page) => !Number.isInteger(page) || page < 1))) return [];
    const contextLocalPages = Array.isArray(input.contextLocalPages)
      ? input.contextLocalPages.map(Number)
      : [];
    if (contextLocalPages.some((page) => (
      !Number.isInteger(page) || page < 1 || page > Number(input.localPageCount)
    ))) return [];
    return [{
      inputMode: input.inputMode,
      parserVersion: input.parserVersion || null,
      derivedPayloadSha256: input.derivedPayloadSha256 || null,
      localPageCount: Number(input.localPageCount),
      sourceStartPage: Number(input.sourceStartPage),
      sourceEndPage: Number(input.sourceEndPage),
      ...(input.inputPolicy === COMBINED_FIXED_COLUMN_CONTEXT_POLICY && sourcePageMap
        ? {
          inputPolicy: input.inputPolicy,
          sourcePageMap,
          contextLocalPages,
        }
        : {}),
      ...(input.inputMode === 'hybrid_native_pdf' && Array.isArray(input.visionSupplements)
        ? {
          visionSupplements: input.visionSupplements.flatMap((supplement) => (
            Number.isInteger(Number(supplement?.localPage))
              && /^[0-9a-f]{64}$/.test(String(supplement?.sha256 || ''))
              ? [{ localPage: Number(supplement.localPage), sha256: supplement.sha256 }]
              : []
          )),
        }
        : {}),
      ...(/^[0-9a-f]{64}$/.test(String(checkpoint?.usage?.request_sha256 || ''))
        ? { requestSha256: checkpoint.usage.request_sha256 }
        : {}),
      ...(/^[0-9a-f]{64}$/.test(String(checkpoint?.output_sha256 || ''))
        ? { outputSha256: checkpoint.output_sha256 }
        : {}),
      ...(input.fallbackReason ? { fallbackReason: String(input.fallbackReason) } : {}),
    }];
  });
}

function buildAuditProvenance({ mode, sourceJobId, cohort, cohortKey, sources, evaluatedAt }) {
  const orderedSources = [...(sources || [])].sort((a, b) => String(a.bureau).localeCompare(String(b.bureau)));
  const base = {
    version: AUDIT_PROVENANCE_VERSION,
    mode,
    sourceJobId,
    evaluatedAt,
    reportDate: cohort.reportDate,
    ageDaysAtEvaluation: cohort.ageDays,
    cohortKey,
    coherent: true,
    exactThreeBureau: cohort.complete === true,
    clientIdentity: cohort.identity,
    sources: orderedSources,
  };
  const canonical = canonicalJson(base);
  return {
    ...base,
    provenanceCanonical: canonical,
    provenanceSha256: sha256(canonical),
  };
}

function slug(s) {
  return String(s || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'unknown';
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

export function isProviderTimeoutError(err, providerSignal = null) {
  // Anthropic's streaming SDK translates an externally aborted signal into
  // APIUserAbortError, but that instance has name === 'Error' and the generic
  // message "Request was aborted.". Prefer the worker-owned timeout signal as
  // the authoritative cause so this controlled deadline follows the durable
  // split/resume path instead of retrying the same checkpoint unchanged.
  if (providerSignal?.aborted && providerSignal.reason?.name === 'TimeoutError') return true;
  if (!(err instanceof Error)) return false;
  const errorNames = [err.name, err.constructor?.name].filter(Boolean);
  return errorNames.some((name) => [
    'APIConnectionTimeoutError', 'TimeoutError', 'AbortError', 'APIUserAbortError',
  ].includes(name))
    || /\b(?:timed?\s*out|timeout)\b/i.test(err.message || '');
}

function isProviderInvalidRequestError(err) {
  if (!err || Number(err.status) !== 400) return false;
  const type = err.type || err.error?.error?.type || err.error?.type;
  return type === 'invalid_request_error' || /invalid_request_error/i.test(err.message || '');
}

function terminalAuditError(message, type = 'audit_integrity_error') {
  const error = new Error(message);
  error.auditTerminal = true;
  error.auditErrorType = type;
  return error;
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
    const selection = job.merge_selection;
    const parseIds = Array.isArray(selection?.parseIds) ? selection.parseIds : [];
    return files.length === 0 && !!job.selected_client_id
      && typeof selection?.cohortKey === 'string' && /^[0-9a-f]{64}$/i.test(selection.cohortKey)
      && parseIds.length === 3 && new Set(parseIds).size === 3
      && parseIds.every((id) => isUuid(id));
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
  const invocationStartedAt = Date.now();

  let caller;
  try {
    caller = await requireStaffOrSystem(event);
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
  if (!supabaseUrl || !serviceKey) {
    console.error('audit-run: missing Supabase server environment');
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

  // Resolve ownership before the service-role claim. Browser calls must own
  // the row; chained/watchdog calls authenticate with the server-only key and
  // derive the owner from the durable row rather than trusting request JSON.
  let jobQuery = db.from('audit_jobs').select('*').eq('id', jobId);
  if (!caller.isSystem) jobQuery = jobQuery.eq('user_id', caller.userId);
  const { data: availableJob, error: availableJobErr } = await jobQuery.maybeSingle();
  if (availableJobErr || !availableJob) {
    console.warn('audit-run: job not available to caller', jobId, availableJobErr?.message);
    return { statusCode: 409, body: 'job not claimable' };
  }
  if (availableJob.status === 'done') return { statusCode: 200, body: 'already complete' };
  if (availableJob.workflow_version !== RESUMABLE_WORKFLOW_VERSION) {
    return { statusCode: 409, body: 'legacy audit job cannot resume without source digests' };
  }
  if (!anthropicKey) {
    console.error('audit-run: missing ANTHROPIC_API_KEY');
    await db.from('audit_jobs').update({
      status: 'error', stage: 'Audit server configuration required',
      error: 'The audit provider is not configured. No provider request was made.',
      retryable: false, next_retry_at: null, finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', jobId).eq('user_id', availableJob.user_id)
      .eq('workflow_version', RESUMABLE_WORKFLOW_VERSION)
      .in('status', ['queued', 'waiting', 'retryable']);
    return { statusCode: 500, body: 'audit provider not configured' };
  }

  const ownerUserId = availableJob.user_id;
  const leaseToken = randomUUID();
  const invokedBy = caller.isSystem
    ? (String(event.headers?.['x-ccc-audit-invoker'] || '').toLowerCase() === 'watchdog' ? 'watchdog' : 'chain')
    : 'staff';
  const { data: claimResult, error: claimErr } = await db.rpc('ccc_claim_audit_job', {
    p_job_id: jobId,
    p_lease_token: leaseToken,
    p_invoked_by: invokedBy,
    p_lease_seconds: WORKER_LEASE_SECONDS,
  });
  if (claimErr || claimResult !== true) {
    if (claimErr) console.warn('audit-run: lease claim failed', jobId, claimErr.message);
    return { statusCode: 409, body: 'job already leased or not ready' };
  }

  const { data: job, error: claimedJobErr } = await db.from('audit_jobs').select('*')
    .eq('id', jobId).eq('user_id', ownerUserId).eq('lease_token', leaseToken).maybeSingle();
  if (claimedJobErr || !job) return { statusCode: 409, body: 'claimed job unavailable' };

  // Confirm source paths and mode again under the lease before any provider
  // call. The worker later verifies byte size and SHA-256 against the manifest.
  if (!hasExpectedAuditFiles(job, ownerUserId, jobId)) {
    // Fail closed rather than leaving a malformed caller-owned job queued
    // indefinitely. Only validated owned paths are removed.
    await db.rpc('ccc_release_audit_job', {
      p_job_id: jobId, p_lease_token: leaseToken, p_status: 'error',
      p_stage: 'Rejected invalid report upload', p_error_type: 'invalid_manifest',
      p_error_message: 'Audit job contains invalid report files or mode.',
    });
    const ownedPaths = (job.files || []).map((file) => file?.path)
      .filter((path) => isOwnedAuditUpload(path, ownerUserId, jobId));
    if (ownedPaths.length) await db.storage.from('documents').remove(ownedPaths).catch(() => {});
    return { statusCode: 400, body: 'job contains invalid report upload paths' };
  }

  // Every current audit must point at one explicit CRM identity before any
  // model call. A new prospect is created by the staff picker first and then
  // arrives here as that exact UUID. Never let extracted names select, merge,
  // or create a client implicitly.
  if (job.selected_client_is_new || !isUuid(job.selected_client_id)) {
    await db.rpc('ccc_release_audit_job', {
      p_job_id: jobId, p_lease_token: leaseToken, p_status: 'error',
      p_stage: 'Exact client selection required', p_error_type: 'invalid_client',
      p_error_message: 'Create or select the exact CRM lead before running this audit.',
    });
    const ownedPaths = (job.files || []).map((file) => file?.path)
      .filter((path) => isOwnedAuditUpload(path, ownerUserId, jobId));
    if (ownedPaths.length) await db.storage.from('documents').remove(ownedPaths).catch(() => {});
    return { statusCode: 400, body: 'exact client selection required' };
  }

  const { data: selectedRows, error: selectedClientError } = await db.from('clients')
    .select('id,name,date_of_birth')
    .eq('id', job.selected_client_id)
    .eq('user_id', ownerUserId)
    .limit(2);
  if (selectedClientError || !selectedRows || selectedRows.length !== 1) {
    await db.rpc('ccc_release_audit_job', {
      p_job_id: jobId, p_lease_token: leaseToken, p_status: 'error',
      p_stage: 'Selected client unavailable', p_error_type: 'client_unavailable',
      p_error_message: 'The selected CRM client no longer exists or is not available to this staff account.',
    });
    const ownedPaths = (job.files || []).map((file) => file?.path)
      .filter((path) => isOwnedAuditUpload(path, ownerUserId, jobId));
    if (ownedPaths.length) await db.storage.from('documents').remove(ownedPaths).catch(() => {});
    return { statusCode: 403, body: 'selected client unavailable' };
  }
  const selectedJobClient = selectedRows[0];
  if (!job.created_at || !Number.isFinite(new Date(job.created_at).getTime())) {
    await db.rpc('ccc_release_audit_job', {
      p_job_id: jobId, p_lease_token: leaseToken, p_status: 'error',
      p_stage: 'Invalid immutable evaluation clock', p_error_type: 'invalid_clock',
      p_error_message: 'This audit job has no valid creation timestamp and cannot produce a reproducible audit.',
    });
    return { statusCode: 500, body: 'audit job is missing its immutable evaluation timestamp' };
  }

  const anthropic = new Anthropic({ apiKey: anthropicKey, ...ANTHROPIC_OPTIONS });
  const usageLog = [];
  const usageByCheckpoint = new Map();
  // Every claimed checkpoint remains here until a confirmed DB transition
  // (done/superseded/retryable/error). The outer catch uses this map to settle
  // the whole batch instead of leaking sibling leases after one RPC failure.
  const unsettledCheckpoints = new Map();
  let lastWrite = 0;

  const updateJob = async (patch, force = false) => {
    const now = Date.now();
    if (!force && now - lastWrite < 1200) return; // throttle progress writes
    lastWrite = now;
    const { error } = await db.from('audit_jobs')
      .update({ ...patch, updated_at: new Date().toISOString(), last_heartbeat_at: new Date().toISOString() })
      .eq('id', jobId).eq('lease_token', leaseToken);
    if (error) throw new Error('Could not persist audit job state: ' + error.message);
  };

  const progress = (stage, pct) => (tokens) =>
    updateJob({ stage, pct, tokens: tokens || 0 }, tokens === 0);

  async function claudeCall(userContent, {
    maxTokens = 64000, schema = null, onTokens = null, effort = AUDIT_EFFORT,
    operation = 'audit.analysis', checkpoint = null,
    providerTimeoutMs = ANTHROPIC_OPTIONS.timeout,
    inputProvenance = null,
  } = {}) {
    // Anthropic rejects both several standard validation keywords and the
    // compiled size of this full extraction contract. Keep that exact schema
    // in the prompt/local validators and constrain only a tiny JSON envelope
    // at the provider boundary.
    const providerFormat = schema ? anthropicJsonSchemaFormat() : null;
    const providerSchema = providerFormat?.schema || null;
    const providerContent = schema ? withLocalSchemaContract(userContent, schema) : userContent;
    const providerContentSha256 = sha256(canonicalJson(providerContent));
    const params = {
      model: AUDIT_MODEL,
      max_tokens: maxTokens,
      thinking: AUDIT_THINKING,
      system: SYSTEM,
      messages: [{ role: 'user', content: providerContent }],
      output_config: { effort },
    };
    if (providerFormat) {
      params.output_config.format = {
        type: providerFormat.type,
        schema: providerSchema,
      };
    }
    const startedAt = new Date();
    let providerAttempt = null;
    let requestSha256 = null;
    let providerSignal = null;
    let providerStream = null;
    let preflightInputTokens = 0;
    let streamedTextChars = 0;
    let streamedThinkingChars = 0;
    let msg = null;
    if (checkpoint) {
      const { data: attemptRow } = await db.from('audit_job_attempts')
        .select('id').eq('job_id', jobId).eq('lease_token', leaseToken).eq('status', 'running').maybeSingle();
      requestSha256 = sha256(canonicalJson({
        model: AUDIT_MODEL, effort, maxTokens, operation,
        thinking: AUDIT_THINKING,
        checkpointId: checkpoint.id, inputSha256: checkpoint.input_sha256,
        // Bind the durable provider attempt to both the envelope sent to the
        // grammar compiler and the richer local contract carried in prompt.
        schema: providerSchema,
        localSchemaSha256: schema ? sha256(canonicalJson(schema)) : null,
        providerContentSha256,
        systemSha256: sha256(canonicalJson(SYSTEM)),
        inputProvenance,
      }));
      const { data: providerRow, error: providerInsertError } = await db.from('audit_provider_attempts').insert({
        job_id: jobId,
        checkpoint_id: checkpoint.id,
        job_attempt_id: attemptRow?.id || null,
        model: AUDIT_MODEL,
        operation,
        attempt_no: checkpoint.attempt_count,
        request_sha256: requestSha256,
        status: 'started',
        started_at: startedAt.toISOString(),
      }).select('id').single();
      if (providerInsertError) throw new Error('Could not record provider attempt before dispatch: ' + providerInsertError.message);
      providerAttempt = providerRow;
    }

    try {
      preflightInputTokens = await preflightTokenCount(anthropic, params, { operation: 'Credit report analysis' });
      // Count-tokens is also a network request. Recompute the hard window
      // after it returns, then abort the provider stream before either the
      // durable lease or Netlify budget can expire.
      const leaseRemainingMs = new Date(job.lease_expires_at || 0).getTime() - Date.now();
      const providerWindowMs = Math.min(
        providerTimeoutMs,
        remainingBudgetMs() - 30_000,
        leaseRemainingMs - 30_000,
      );
      if (!Number.isFinite(providerWindowMs) || providerWindowMs < 60_000) {
        const deadlineError = new Error('Provider dispatch deferred because the worker deadline is too close.');
        deadlineError.auditDeadline = true;
        throw deadlineError;
      }
      providerSignal = AbortSignal.timeout(Math.floor(providerWindowMs));
      providerStream = anthropic.messages.stream(params, { signal: providerSignal });
      if (onTokens) {
        let chars = 0;
        providerStream.on('text', (delta) => {
          chars += delta.length;
          streamedTextChars += delta.length;
          // Progress is operational telemetry; an intermittent write must not
          // crash an otherwise-valid model stream through an unhandled promise.
          void onTokens(Math.round(chars / 4)).catch((e) => {
            console.warn('audit-run: progress write failed', e.message);
          }); // ~4 chars/token readout
        });
      }
      providerStream.on('thinking', (delta) => {
        streamedThinkingChars += delta.length;
      });
      msg = await providerStream.finalMessage();
      const providerText = textFromVerifiedModelMessage(msg, 'Audit analysis');
      const text = schema
        ? JSON.stringify(parseAndValidateAnthropicJsonEnvelope(providerText, schema))
        : providerText;
      const u = usageFromMessage(msg);
      const callUsage = {
        model: msg.model,
        effort,
        input: u.input_tokens || 0,
        output: u.output_tokens || 0,
        cache_read: u.cache_read_input_tokens || 0,
        cache_write: u.cache_creation_input_tokens || 0,
        est_cost_usd: Math.round(usdFor(u) * 10000) / 10000,
        stop_reason: msg.stop_reason,
        input_provenance: inputProvenance,
        request_sha256: requestSha256,
      };
      // The checkpoint row is the authoritative paid-output boundary. Record
      // usage in memory before best-effort telemetry so an observability write
      // can never turn a valid provider response into another paid request.
      usageLog.push(callUsage);
      if (checkpoint?.id) usageByCheckpoint.set(checkpoint.id, callUsage);
      if (providerAttempt) {
        try {
          const { error: providerUpdateError } = await db.from('audit_provider_attempts').update({
            status: 'completed', provider_request_id: msg._request_id || null,
            stop_reason: msg.stop_reason || null, response_sha256: sha256(text),
            usage: callUsage, finished_at: new Date().toISOString(),
          }).eq('id', providerAttempt.id).eq('status', 'started');
          if (providerUpdateError) throw providerUpdateError;
        } catch (telemetryError) {
          console.warn('[audit] completed provider-attempt telemetry write failed; preserving paid output', JSON.stringify({
            jobId,
            checkpointId: checkpoint?.id || null,
            providerAttemptId: providerAttempt.id,
            error: telemetryError?.message || 'telemetry write failed',
          }));
        }
      }
      try {
        await logClaudeCall(db, {
          userId: ownerUserId, operation, entityType: 'audit_job', entityId: jobId,
          model: AUDIT_MODEL, effort, promptVersion: 'audit-v2', attempt: checkpoint?.attempt_count || usageLog.length,
          status: 'completed', startedAt, requestId: msg._request_id, usage: u,
          stopReason: msg.stop_reason,
        });
      } catch (telemetryError) {
        console.warn('[audit] Claude telemetry write failed; preserving paid output', JSON.stringify({
          jobId,
          checkpointId: checkpoint?.id || null,
          error: telemetryError?.message || 'telemetry write failed',
        }));
      }
      console.log('[audit-usage]', JSON.stringify(callUsage));
      return text;
    } catch (error) {
      const outputLimit = isOutputLimitError(error) || msg?.stop_reason === 'max_tokens';
      if (outputLimit && error && typeof error === 'object') error.auditOutputLimit = true;
      const providerTimeout = isProviderTimeoutError(error, providerSignal);
      if (providerTimeout && error && typeof error === 'object') {
        error.auditProviderTimeout = true;
        error.auditErrorType = 'provider_timeout';
        error.auditUserMessage = 'A report section took too long to analyze. Completed sections are saved, and this same audit can resume without another upload.';
      }
      const invalidRequest = isProviderInvalidRequestError(error);
      const providerRequestId = msg?._request_id || providerStream?.request_id
        || error?.requestID || error?.request_id || error?.error?.request_id || null;
      const providerErrorType = error?.type || error?.error?.error?.type || error?.error?.type || error?.name || 'provider_error';
      if (invalidRequest && error && typeof error === 'object') {
        // A provider 400 is deterministic configuration/schema failure, not
        // a transient report failure. Retrying the same checkpoint only burns
        // attempts and can never repair the request.
        error.auditTerminal = true;
        error.auditErrorType = 'provider_invalid_request';
        error.auditUserMessage = providerRequestId
          ? `The audit provider rejected the request configuration. No audit result was saved. Reference: ${providerRequestId}`
          : 'The audit provider rejected the request configuration. No audit result was saved.';
      }
      if (providerAttempt) {
        const partialUsage = usageFromMessage(providerStream?.currentMessage || null);
        await db.from('audit_provider_attempts').update({
          status: outputLimit ? 'output_limit' : 'failed',
          provider_request_id: providerRequestId,
          stop_reason: msg?.stop_reason || null,
          error_type: outputLimit ? 'output_limit' : providerErrorType,
          error_message: error?.message || 'Provider request failed',
          usage: {
            observation: 'partial_not_final',
            preflight_input_tokens: preflightInputTokens,
            input: partialUsage.input_tokens || 0,
            output: partialUsage.output_tokens || 0,
            thinking: partialUsage.thinking_tokens || 0,
            cache_read: partialUsage.cache_read_input_tokens || 0,
            cache_write: partialUsage.cache_creation_input_tokens || 0,
            streamed_text_chars: streamedTextChars,
            streamed_thinking_chars: streamedThinkingChars,
            elapsed_ms: Math.max(0, Date.now() - startedAt.getTime()),
          },
          finished_at: new Date().toISOString(),
        }).eq('id', providerAttempt.id).eq('status', 'started');
      }
      await logClaudeCall(db, {
        userId: ownerUserId, operation, entityType: 'audit_job', entityId: jobId,
        model: AUDIT_MODEL, effort, promptVersion: 'audit-v2',
        attempt: checkpoint?.attempt_count || usageLog.length + 1,
        status: 'error', startedAt, requestId: providerRequestId,
        stopReason: msg?.stop_reason, errorType: providerErrorType, errorMessage: error?.message,
      }).catch(() => {});
      throw error;
    }
  }

  const downloadedReports = new Map();
  const combinedContextPolicyBySource = new Map();
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
    const report = {
      bytes,
      base64: bytes.toString('base64'),
      mediaType,
      sourcePath: file.path,
      sourceSha256: sha256(bytes),
      sourceBytes: bytes.length,
    };
    if (!/^[0-9a-f]{64}$/i.test(String(file.sha256 || ''))
        || report.sourceSha256 !== String(file.sha256).toLowerCase()
        || report.sourceBytes !== Number(file.bytes)) {
      throw terminalAuditError('Uploaded report bytes do not match the immutable source manifest. Re-upload the original report.', 'source_digest_mismatch');
    }
    const manifestSource = (job.source_manifest || []).find((source) => source?.path === file.path);
    if (!manifestSource
        || manifestSource.sha256 !== report.sourceSha256
        || Number(manifestSource.bytes) !== report.sourceBytes
        || Number(manifestSource.index) !== (job.files || []).findIndex((candidate) => candidate?.path === file.path)) {
      throw terminalAuditError('Uploaded report is not bound to this logical audit manifest.', 'source_manifest_mismatch');
    }
    downloadedReportBytes += bytes.length;
    downloadedReports.set(file.path, report);
    return report;
  }

  async function combinedContextPolicy(report) {
    if (job.mode !== 'combined' || !report?.mediaType?.includes('pdf')) {
      return {
        matched: false, policy: null, contextSourcePage: null, columns: [],
        detectionStatus: 'proven_no_match', detectionErrorCode: null,
      };
    }
    if (!combinedContextPolicyBySource.has(report.sourceSha256)) {
      combinedContextPolicyBySource.set(
        report.sourceSha256,
        detectCombinedPdfContextPolicy(report.bytes, { pdfJsLoader: auditPdfJsLoader }),
      );
    }
    const detection = await combinedContextPolicyBySource.get(report.sourceSha256);
    if (detection?.detectionStatus === 'detection_error') {
      const error = new Error('Combined-report context detection could not read the source layout. The saved audit will retry without changing its parsing policy.');
      error.auditErrorType = detection.detectionErrorCode || 'pdf_context_detection_failed';
      error.auditUserMessage = 'CCC could not verify the report layout yet. The same saved audit will retry; do not upload a duplicate.';
      throw error;
    }
    if (!['matched', 'proven_no_match'].includes(detection?.detectionStatus)) {
      throw terminalAuditError('Combined-report context detector returned an invalid state.', 'invalid_context_detection_state');
    }
    return detection;
  }

  function frozenCheckpointContextPolicy(checkpoint) {
    if (checkpoint.kind !== 'combined_chunk') {
      return { matched: false, policy: null, contextSourcePage: null, detectionStatus: 'proven_no_match' };
    }
    return resolveFrozenCombinedContextPolicy(checkpoint);
  }

  async function pdfChunksForReport(report) {
    if (!report?.mediaType || !report.mediaType.includes('pdf')) {
      return null;
    }
    const pdfBytes = report.bytes || Buffer.from(report.base64, 'base64');
    return splitPdfByPages(pdfBytes);
  }

  const remainingBudgetMs = () => WORKER_BUDGET_MS - (Date.now() - invocationStartedAt);
  let leaseClosed = false;

  async function dispatchNext(invoker = 'chain') {
    const base = process.env.DEPLOY_URL || process.env.URL || 'https://ccc-forensic-demo.netlify.app';
    const response = await fetch(base + '/.netlify/functions/audit-run-background', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + serviceKey,
        'x-ccc-audit-invoker': invoker,
      },
      body: JSON.stringify({ jobId }),
    });
    if (!response.ok && response.status !== 409) {
      throw new Error(`Could not chain audit checkpoint worker (HTTP ${response.status}).`);
    }
  }

  async function releaseLease({
    status = 'waiting', stage = 'Continuing from saved checkpoint',
    errorType = null, errorMessage = null, retryAt = new Date().toISOString(), checkpointId = null,
  } = {}) {
    const { data, error } = await db.rpc('ccc_release_audit_job', {
      p_job_id: jobId,
      p_lease_token: leaseToken,
      p_status: status,
      p_stage: stage,
      p_error_type: errorType,
      p_error_message: errorMessage,
      p_next_retry_at: retryAt,
      p_checkpoint_id: checkpointId,
    });
    if (error || data !== true) throw new Error('Could not release audit lease safely: ' + (error?.message || 'lease mismatch'));
    leaseClosed = true;
  }

  function checkpointKey(spec) {
    return sha256(canonicalJson({
      version: RESUMABLE_WORKFLOW_VERSION,
      kind: spec.kind,
      bureau: spec.bureau || null,
      sourceIndex: spec.source_index ?? null,
      sourceSha256: spec.source_sha256 || null,
      inputSha256: spec.input_sha256 || null,
      startPage: spec.start_page || null,
      endPage: spec.end_page || null,
    }));
  }

  async function ensureCheckpointPlan() {
    const { data: existingRows, error: existingError } = await db.from('audit_job_checkpoints')
      .select('id,checkpoint_key,status,source_index,source_path,source_sha256,source_bytes,input_sha256,start_page,end_page,total_pages,chunk_index,chunk_count,kind,bureau,sequence,context_policy_state,context_policy,context_source_page')
      .eq('job_id', jobId).order('sequence');
    if (existingError) throw new Error('Could not load audit checkpoint plan: ' + existingError.message);
    if ((job.expected_checkpoint_count || 0) > 0) {
      const active = (existingRows || []).filter((row) => row.status !== 'superseded');
      if (active.length !== Number(job.expected_checkpoint_count)) {
        throw terminalAuditError('Saved audit checkpoint plan count no longer matches the logical job.', 'checkpoint_plan_mismatch');
      }
      for (const checkpoint of active) {
        if (checkpoint.kind === 'merge') continue;
        const file = (job.files || [])[Number(checkpoint.source_index)];
        if (!file || file.path !== checkpoint.source_path) {
          throw terminalAuditError('Saved checkpoint source binding is invalid.', 'checkpoint_source_mismatch');
        }
        await downloadReport(file);
        const contextPolicy = frozenCheckpointContextPolicy(checkpoint);
        if (!contextPolicy) {
          if (job.mode === 'combined') {
            const { data: retired, error: retirementError } = await db.rpc(
              'ccc_retire_incompatible_combined_audit_job',
              { p_job_id: jobId, p_lease_token: leaseToken },
            );
            if (!retirementError && retired === true) {
              leaseClosed = true;
              return null;
            }
            throw new Error('Could not retire an incompatible combined-report checkpoint plan: '
              + (retirementError?.message || 'lease mismatch'));
          }
          throw terminalAuditError('Saved audit checkpoint context policy is invalid.', 'checkpoint_context_policy_mismatch');
        }
        const expectedInputSha256 = checkpointInputSha256({
          sourceSha256: checkpoint.source_sha256,
          startPage: checkpoint.start_page,
          endPage: checkpoint.end_page,
          totalPages: checkpoint.total_pages,
          kind: checkpoint.kind,
          contextSourcePage: contextPolicy.matched ? contextPolicy.contextSourcePage : null,
        });
        if (checkpoint.input_sha256 === expectedInputSha256) continue;
        if (job.mode === 'combined') {
          throw terminalAuditError(
            'Saved combined-report checkpoint digest does not match its frozen context policy.',
            'checkpoint_context_policy_mismatch',
          );
        }
        throw terminalAuditError('Saved audit checkpoint input no longer matches its source-bound plan.', 'checkpoint_input_mismatch');
      }
      return active;
    }

    const rows = [];
    if (job.mode === 'merge') {
      const spec = {
        job_id: jobId, sequence: 0, kind: 'merge', bureau: null,
        source_index: null, source_path: null, source_sha256: null,
        source_bytes: null, source_media_type: null, input_sha256: null,
        start_page: null, end_page: null, total_pages: null,
        chunk_index: null, chunk_count: null, status: 'pending',
      };
      rows.push({ ...spec, checkpoint_key: checkpointKey(spec) });
    } else {
      for (let sourceIndex = 0; sourceIndex < (job.files || []).length; sourceIndex += 1) {
        const file = job.files[sourceIndex];
        const report = await downloadReport(file);
        const bureau = job.mode === 'combined' ? null : normalizeBureauKey(file.bureau);
        const kind = job.mode === 'combined' ? 'combined_chunk' : 'bureau_chunk';
        const contextPolicy = kind === 'combined_chunk'
          ? await combinedContextPolicy(report)
          : { matched: false, contextSourcePage: null };
        const contextSourcePage = contextPolicy.matched
          ? contextPolicy.contextSourcePage
          : null;
        let chunks;
        if (report.mediaType.includes('pdf')) {
          const measurement = await measureAuditPdfPageDensity(report.bytes, {
            pdfJsLoader: auditPdfJsLoader,
          });
          if (measurement.status === 'measured') {
            const adaptivePlan = planAdaptiveAuditCheckpointRanges(measurement.pages, {
              contextPageMetric: contextSourcePage === COMBINED_CONTEXT_SOURCE_PAGE
                ? measurement.pages[0]
                : null,
            });
            const adaptiveChunks = adaptivePlan.ranges.map((range, index) => ({
              startPage: range.startPage,
              endPage: range.endPage,
              totalPages: adaptivePlan.totalPages,
              index,
              chunkCount: adaptivePlan.ranges.length,
            }));
            let strictNativePlan = true;
            let strictFallbackReason = null;
            for (const candidate of adaptiveChunks) {
              const sourcePageMap = checkpointSourcePageMap({
                kind,
                startPage: candidate.startPage,
                endPage: candidate.endPage,
                contextSourcePage,
              });
              const candidateRange = sourcePageMap.length
                  > (candidate.endPage - candidate.startPage + 1)
                ? await extractPdfPages(report.bytes, { pageNumbers: sourcePageMap })
                : await extractPdfPageRange(report.bytes, {
                  startPage: candidate.startPage,
                  endPage: candidate.endPage,
                });
              const nativeCandidate = await extractNativePdfText(candidateRange.bytes, {
                pdfJsLoader: auditPdfJsLoader,
                pdfLibLoader: auditPdfLibLoader,
              });
              if (!nativeTextCanDriveCheckpoint(nativeCandidate)) {
                strictNativePlan = false;
                strictFallbackReason = nativeCandidate?.eligibility?.reasonCodes?.[0]
                  || 'native_text_unavailable';
                break;
              }
            }
            if (strictNativePlan) {
              chunks = adaptiveChunks;
              console.log('[audit-plan]', JSON.stringify({
                planner: adaptivePlan.plannerVersion,
                metric: adaptivePlan.metricVersion,
                sourceIndex,
                inputMode: 'native_or_hybrid',
                totalPages: adaptivePlan.totalPages,
                checkpointCount: adaptivePlan.ranges.length,
                ranges: adaptivePlan.ranges.map((range) => ({
                  startPage: range.startPage,
                  endPage: range.endPage,
                  overlapPages: range.overlapPages,
                  contextSourcePage: range.contextSourcePage,
                  providerPageCount: range.providerPageCount,
                  exceededLimits: range.exceededLimits,
                })),
              }));
            } else {
              chunks = await splitPdfByPages(report.bytes, {
                maxPages: contextSourcePage === COMBINED_CONTEXT_SOURCE_PAGE
                  ? COMBINED_SOURCE_PDF_DATA_PAGES
                  : RESUMABLE_PDF_CHUNK_PAGES,
              });
              console.warn('[audit-plan] strict native layout unavailable; capping source-PDF vision ranges', JSON.stringify({
                sourceIndex,
                totalPages: adaptivePlan.totalPages,
                reason: strictFallbackReason,
                checkpointCount: chunks.length,
                maxPages: contextSourcePage === COMBINED_CONTEXT_SOURCE_PAGE
                  ? COMBINED_SOURCE_PDF_DATA_PAGES
                  : RESUMABLE_PDF_CHUNK_PAGES,
              }));
            }
          } else {
            chunks = await splitPdfByPages(report.bytes, {
              maxPages: contextSourcePage === COMBINED_CONTEXT_SOURCE_PAGE
                ? COMBINED_SOURCE_PDF_DATA_PAGES
                : RESUMABLE_PDF_CHUNK_PAGES,
            });
            console.warn('[audit-plan] PDF text density unavailable; using conservative fixed-page fallback', JSON.stringify({
              sourceIndex,
              totalPages: measurement.totalPages,
              reason: measurement.fallback?.reason || 'density_unavailable',
              checkpointCount: chunks.length,
            }));
          }
        } else {
          chunks = [{
            bytes: report.bytes, base64: report.base64,
            startPage: 1, endPage: 1, totalPages: 1, index: 0, chunkCount: 1,
          }];
        }
        for (const chunk of chunks) {
          const spec = {
            job_id: jobId,
            // Page-derived ordering stays stable even if a dense range must
            // be split more than once. The superseded parent may share the
            // left child's start page, but only active rows reach the merge.
            sequence: sourceIndex * 1000000 + chunk.startPage * 100,
            kind,
            bureau,
            source_index: sourceIndex,
            source_path: report.sourcePath,
            source_sha256: report.sourceSha256,
            source_bytes: report.sourceBytes,
            source_media_type: report.mediaType,
            context_policy_state: kind === 'combined_chunk'
              ? contextPolicy.detectionStatus
              : null,
            context_policy: kind === 'combined_chunk' && contextPolicy.matched
              ? contextPolicy.policy
              : null,
            context_source_page: kind === 'combined_chunk' && contextPolicy.matched
              ? contextPolicy.contextSourcePage
              : null,
            input_sha256: checkpointInputSha256({
              sourceSha256: report.sourceSha256,
              startPage: chunk.startPage,
              endPage: chunk.endPage,
              totalPages: chunk.totalPages,
              kind,
              contextSourcePage,
            }),
            start_page: chunk.startPage,
            end_page: chunk.endPage,
            total_pages: chunk.totalPages,
            chunk_index: chunk.index,
            chunk_count: chunk.chunkCount,
            status: 'pending',
          };
          rows.push({ ...spec, checkpoint_key: checkpointKey(spec) });
        }
      }
    }
    if (!rows.length) throw new Error('Audit checkpoint planning produced no work.');
    const { error: planInsertError } = await db.from('audit_job_checkpoints')
      .upsert(rows, { onConflict: 'job_id,checkpoint_key', ignoreDuplicates: true });
    if (planInsertError) throw new Error('Could not persist audit checkpoint plan: ' + planInsertError.message);
    const { data: plannedRows, error: plannedError } = await db.from('audit_job_checkpoints')
      .select('*').eq('job_id', jobId).neq('status', 'superseded').order('sequence');
    if (plannedError || !plannedRows || plannedRows.length !== rows.length) {
      throw new Error('Audit checkpoint plan could not be verified after creation.');
    }
    const { error: jobPlanError } = await db.from('audit_jobs').update({
      expected_checkpoint_count: plannedRows.length,
      completed_checkpoint_count: plannedRows.filter((row) => row.status === 'done').length,
      stage: `Prepared ${plannedRows.length} durable checkpoint${plannedRows.length === 1 ? '' : 's'}`,
      updated_at: new Date().toISOString(), last_heartbeat_at: new Date().toISOString(),
    }).eq('id', jobId).eq('lease_token', leaseToken);
    if (jobPlanError) throw new Error('Could not bind checkpoint plan to audit job: ' + jobPlanError.message);
    job.expected_checkpoint_count = plannedRows.length;
    return plannedRows;
  }

  async function checkpointInput(checkpoint) {
    if (checkpoint.kind === 'merge') return null;
    const file = (job.files || [])[Number(checkpoint.source_index)];
    if (!file || file.path !== checkpoint.source_path) throw terminalAuditError('Checkpoint source index/path binding is invalid.', 'checkpoint_source_mismatch');
    const report = await downloadReport(file);
    if (report.sourceSha256 !== checkpoint.source_sha256
        || report.sourceBytes !== Number(checkpoint.source_bytes)
        || report.mediaType !== checkpoint.source_media_type) {
      throw terminalAuditError('Checkpoint source no longer matches its immutable manifest.', 'checkpoint_source_mismatch');
    }
    const contextPolicy = frozenCheckpointContextPolicy(checkpoint);
    if (!contextPolicy) {
      throw terminalAuditError('Checkpoint context policy no longer matches its immutable input digest.', 'checkpoint_context_policy_mismatch');
    }
    const contextSourcePage = contextPolicy.matched
      ? contextPolicy.contextSourcePage
      : null;
    let chunk;
    const sourcePageMap = checkpoint.kind === 'merge'
      ? []
      : checkpointSourcePageMap({
        kind: checkpoint.kind,
        startPage: checkpoint.start_page,
        endPage: checkpoint.end_page,
        contextSourcePage,
      });
    const contextLocalPages = checkpoint.kind === 'combined_chunk'
        && sourcePageMap.length > (Number(checkpoint.end_page) - Number(checkpoint.start_page) + 1)
      ? [1]
      : [];
    if (report.mediaType.includes('pdf')) {
      chunk = contextLocalPages.length
        ? await extractPdfPages(report.bytes, { pageNumbers: sourcePageMap })
        : await extractPdfPageRange(report.bytes, {
          startPage: checkpoint.start_page,
          endPage: checkpoint.end_page,
        });
      chunk.startPage = Number(checkpoint.start_page);
      chunk.endPage = Number(checkpoint.end_page);
      chunk.index = checkpoint.chunk_index;
      chunk.chunkCount = checkpoint.chunk_count;
      chunk.sourcePageMap = sourcePageMap;
      chunk.contextLocalPages = contextLocalPages;
      chunk.contextSourcePage = contextSourcePage;
      chunk.dataLocalPages = sourcePageMap.flatMap((sourcePage, index) => (
        contextLocalPages.includes(index + 1) ? [] : [index + 1]
      ));
    } else {
      chunk = {
        bytes: report.bytes, base64: report.base64,
        startPage: 1, endPage: 1, totalPages: 1, index: 0, chunkCount: 1,
        sourcePageMap: [1], contextLocalPages: [], dataLocalPages: [1],
      };
    }
    const expectedInputSha256 = checkpointInputSha256({
      sourceSha256: report.sourceSha256,
      startPage: checkpoint.start_page,
      endPage: checkpoint.end_page,
      totalPages: checkpoint.total_pages,
      kind: checkpoint.kind,
      contextSourcePage,
    });
    if (!chunk || expectedInputSha256 !== checkpoint.input_sha256
        || chunk.totalPages !== checkpoint.total_pages) {
      throw terminalAuditError('Checkpoint input page range no longer matches the saved source-bound plan.', 'checkpoint_input_mismatch');
    }
    let nativeText = null;
    if (report.mediaType.includes('pdf')) {
      nativeText = await extractNativePdfText(chunk.bytes, {
        pdfJsLoader: auditPdfJsLoader,
        pdfLibLoader: auditPdfLibLoader,
      });
    }
    const localPageCount = chunk.sourcePageMap.length;
    const nativeEligible = nativeTextCanDriveCheckpoint(nativeText)
      && nativeText.totalPages === localPageCount
      && typeof nativeText.compactText === 'string';
    if (report.mediaType.includes('pdf') && !nativeEligible
        && localPageCount > RESUMABLE_PDF_CHUNK_PAGES) {
      const fallbackSplit = new Error('Native text became unavailable for a range larger than the source-PDF vision limit.');
      fallbackSplit.auditNativeFallbackSplit = true;
      fallbackSplit.auditErrorType = 'native_fallback_split';
      fallbackSplit.auditUserMessage = 'A report range needs smaller vision checkpoints. CCC will split and resume it before any paid analysis.';
      throw fallbackSplit;
    }
    const visionSupplements = [];
    if (nativeEligible && nativeText.status === 'hybrid') {
      for (const localPage of nativeText.visionSupplementPageNumbers || []) {
        const supplement = await extractPdfPageRange(chunk.bytes, {
          startPage: localPage,
          endPage: localPage,
        });
        visionSupplements.push({
          localPage,
          base64: supplement.base64,
          sha256: sha256(supplement.bytes),
        });
      }
    }
    let nonPdfPayloadSha256 = null;
    let nonPdfMode = null;
    let nonPdfParserVersion = null;
    if (!report.mediaType.includes('pdf')) {
      const sourceBlock = buildReportContent(chunk.base64, '', report.mediaType)[0];
      nonPdfPayloadSha256 = sha256(canonicalJson(sourceBlock));
      nonPdfMode = report.mediaType.includes('html') ? 'source_html' : 'source_text';
      nonPdfParserVersion = report.mediaType.includes('html')
        ? 'ccc-html-to-text-v1'
        : 'ccc-utf8-text-v1';
    }
    const inputProvenance = nativeEligible ? {
      inputMode: nativeText.status === 'hybrid' ? 'hybrid_native_pdf' : 'native_pdf_text',
      parserVersion: nativeText.format,
      derivedPayloadSha256: sha256(nativeText.compactText),
      visionSupplements: visionSupplements.map((supplement) => ({
        localPage: supplement.localPage,
        sha256: supplement.sha256,
      })),
      localPageCount,
      sourceStartPage: Number(checkpoint.start_page),
      sourceEndPage: Number(checkpoint.end_page),
      ...(checkpoint.kind === 'combined_chunk' && contextSourcePage === COMBINED_CONTEXT_SOURCE_PAGE
        ? {
          inputPolicy: COMBINED_FIXED_COLUMN_CONTEXT_POLICY,
          sourcePageMap: chunk.sourcePageMap,
          contextLocalPages: chunk.contextLocalPages,
        }
        : {}),
    } : {
      inputMode: nonPdfMode || 'source_pdf',
      parserVersion: nonPdfParserVersion,
      derivedPayloadSha256: nonPdfPayloadSha256,
      localPageCount,
      sourceStartPage: Number(checkpoint.start_page),
      sourceEndPage: Number(checkpoint.end_page),
      fallbackReason: nativeText?.eligibility?.reasonCodes?.[0] || null,
      ...(checkpoint.kind === 'combined_chunk' && contextSourcePage === COMBINED_CONTEXT_SOURCE_PAGE
        ? {
          inputPolicy: COMBINED_FIXED_COLUMN_CONTEXT_POLICY,
          sourcePageMap: chunk.sourcePageMap,
          contextLocalPages: chunk.contextLocalPages,
        }
        : {}),
    };
    return {
      file,
      report,
      chunk,
      nativeText: nativeEligible ? nativeText : null,
      visionSupplements,
      inputProvenance,
    };
  }

  function checkpointProviderContent(input, prompt) {
    if (input.nativeText) {
      return buildNativeReportContent(input.nativeText.compactText, prompt, {
        format: input.nativeText.format,
        localPageCount: input.inputProvenance.localPageCount,
        visionSupplements: input.visionSupplements,
        sourcePageMap: input.chunk.sourcePageMap,
        contextLocalPages: input.chunk.contextLocalPages,
      });
    }
    return buildReportContent(input.chunk.base64, prompt, input.report.mediaType);
  }

  function checkpointStage(checkpoint) {
    if (checkpoint.kind === 'merge') return 'Merging saved bureau parses';
    const label = checkpoint.bureau ? bureauDisplayName(checkpoint.bureau) : '3-bureau report';
    return `Extracting ${label} · pages ${checkpoint.start_page}–${checkpoint.end_page} of ${checkpoint.total_pages}`;
  }

  async function processExtractionCheckpoint(checkpoint, preparedInput = null) {
    const input = preparedInput || await checkpointInput(checkpoint);
    const stage = checkpointStage(checkpoint);
    const pct = Math.max(2, Math.min(82, Math.round(
      2 + ((Number(checkpoint.start_page || 1) - 1) / Math.max(1, Number(checkpoint.total_pages || 1))) * 78,
    )));
    await progress(stage, pct)(0);

    let raw;
    if (checkpoint.kind === 'combined_chunk') {
      raw = await claudeCall(
        checkpointProviderContent(input, combinedExtractionPrompt(input.chunk, {
          contextLocalPage: input.chunk.contextLocalPages[0] || null,
          dataLocalPages: input.chunk.dataLocalPages,
        })),
        {
          schema: COMPACT_COMBINED_CREDIT_EXTRACTION_SCHEMA,
          onTokens: progress(stage, pct),
          operation: 'audit.report_extraction', checkpoint,
          providerTimeoutMs: EXTRACTION_PROVIDER_TIMEOUT_MS,
          inputProvenance: input.inputProvenance,
        },
      );
      const parsed = decodeCompactCombinedExtraction(parseAuditJSON(raw));
      const localPageCount = input.chunk.sourcePageMap.length;
      for (const extractedReport of parsed?.reports || []) {
        assertExtractionPageBounds(extractedReport, localPageCount);
      }
      assertCombinedCheckpointAttribution(parsed, {
        contextLocalPages: input.chunk.contextLocalPages,
      });
      const mapped = mapExtractionPageRefs(parsed, input.chunk.sourcePageMap);
      for (const extractedReport of mapped?.reports || []) {
        assertExtractionPageBounds(extractedReport, checkpoint.total_pages);
      }
      return mapped;
    }

    const bureauKey = normalizeBureauKey(checkpoint.bureau);
    raw = await claudeCall(
      checkpointProviderContent(input, bureauExtractionPrompt(bureauKey, input.chunk)),
      {
        schema: COMPACT_CREDIT_BUREAU_EXTRACTION_SCHEMA,
        onTokens: progress(stage, pct),
        operation: 'audit.report_extraction', checkpoint,
        providerTimeoutMs: EXTRACTION_PROVIDER_TIMEOUT_MS,
        inputProvenance: input.inputProvenance,
      },
    );
    const decoded = decodeCompactBureauExtraction(parseAuditJSON(raw));
    const localPageCount = Number(checkpoint.end_page) - Number(checkpoint.start_page) + 1;
    assertExtractionPageBounds(decoded, localPageCount);
    const rebased = rebaseExtractionPageRefs(decoded, checkpoint.start_page - 1);
    assertExtractionPageBounds(rebased, checkpoint.total_pages);
    return rebased;
  }

  async function completeCheckpoint(checkpoint, output) {
    const callUsage = usageByCheckpoint.get(checkpoint.id) || null;
    const outputSha256 = parseSha256(output);
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data, error } = await db.rpc('ccc_complete_audit_checkpoint', {
        p_checkpoint_id: checkpoint.id,
        p_lease_token: leaseToken,
        p_output: output,
        p_output_sha256: outputSha256,
        p_usage: callUsage,
      });
      if (!error && data === true) {
        usageByCheckpoint.delete(checkpoint.id);
        unsettledCheckpoints.delete(checkpoint.id);
        return;
      }
      lastError = error;
      // A committed RPC whose HTTP response was lost is already safe. Re-read
      // the exact immutable digest before deciding to pay for this range again.
      const { data: saved } = await db.from('audit_job_checkpoints')
        .select('status,output_sha256').eq('id', checkpoint.id).eq('job_id', jobId).maybeSingle();
      if (saved?.status === 'done' && saved.output_sha256 === outputSha256) {
        usageByCheckpoint.delete(checkpoint.id);
        unsettledCheckpoints.delete(checkpoint.id);
        return;
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
    throw new Error('Could not save completed audit checkpoint: ' + (lastError?.message || 'lease mismatch'));
  }

  async function deferCheckpoint(checkpoint, {
    status, errorType = null, errorMessage = null, retryAt = null,
  }) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data, error } = await db.rpc('ccc_defer_audit_checkpoint', {
        p_job_id: jobId,
        p_checkpoint_id: checkpoint.id,
        p_lease_token: leaseToken,
        p_status: status,
        p_error_type: errorType,
        p_error_message: errorMessage,
        p_next_retry_at: retryAt,
      });
      if (!error && data === true) {
        unsettledCheckpoints.delete(checkpoint.id);
        return;
      }
      lastError = error;
      const { data: saved } = await db.from('audit_job_checkpoints')
        .select('status,lease_token').eq('id', checkpoint.id).eq('job_id', jobId).maybeSingle();
      if (saved?.status === status && saved.lease_token == null) {
        unsettledCheckpoints.delete(checkpoint.id);
        return;
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
    throw new Error('Could not settle audit checkpoint safely: ' + (lastError?.message || 'lease mismatch'));
  }

  async function splitCheckpoint(checkpoint, reason) {
    if (!['output_limit', 'provider_timeout', 'native_fallback'].includes(reason)) {
      throw new Error('Checkpoint split reason is invalid.');
    }
    const pageCount = Number(checkpoint.end_page) - Number(checkpoint.start_page) + 1;
    if (pageCount < 3) throw new Error('Checkpoint page range cannot be split safely.');
    const mid = Math.floor((Number(checkpoint.start_page) + Number(checkpoint.end_page)) / 2);
    const leftEnd = pageCount === 3 ? mid : mid + 1;
    const contextSourcePage = checkpoint.kind === 'combined_chunk'
        && checkpoint.input_sha256 === checkpointInputSha256({
          sourceSha256: checkpoint.source_sha256,
          startPage: Number(checkpoint.start_page),
          endPage: Number(checkpoint.end_page),
          totalPages: Number(checkpoint.total_pages),
          kind: checkpoint.kind,
          contextSourcePage: COMBINED_CONTEXT_SOURCE_PAGE,
        })
      ? COMBINED_CONTEXT_SOURCE_PAGE
      : null;
    const leftInputSha256 = checkpointInputSha256({
      sourceSha256: checkpoint.source_sha256,
      startPage: Number(checkpoint.start_page),
      endPage: leftEnd,
      totalPages: Number(checkpoint.total_pages),
      kind: checkpoint.kind,
      contextSourcePage,
    });
    const rightInputSha256 = checkpointInputSha256({
      sourceSha256: checkpoint.source_sha256,
      startPage: mid,
      endPage: Number(checkpoint.end_page),
      totalPages: Number(checkpoint.total_pages),
      kind: checkpoint.kind,
      contextSourcePage,
    });
    const { data, error } = await db.rpc('ccc_split_audit_checkpoint_v2', {
      p_checkpoint_id: checkpoint.id,
      p_lease_token: leaseToken,
      p_left_input_sha256: leftInputSha256,
      p_right_input_sha256: rightInputSha256,
      p_reason: reason,
    });
    if (!error && data === true) {
      unsettledCheckpoints.delete(checkpoint.id);
      return;
    }
    const { data: saved } = await db.from('audit_job_checkpoints')
      .select('status,error_type').eq('id', checkpoint.id).eq('job_id', jobId).maybeSingle();
    if (saved?.status === 'superseded' && saved.error_type === `${reason}_split`) {
      unsettledCheckpoints.delete(checkpoint.id);
      return;
    }
    throw new Error('Could not split a dense audit checkpoint safely: ' + (error?.message || 'lease mismatch'));
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
      const rebased = rebaseExtractionPageRefs(parseAuditJSON(raw), chunk.startPage - 1);
      assertExtractionPageBounds(rebased, chunk.totalPages);
      parts.push(rebased);
    }
    return assertBureauOutput(mergeBureauExtractions(parts, bureauKey), bureauName);
  }

  async function parseBureauReportChunked({ report, bureauName, stage, pct, today }) {
    const bureauKey = normalizeBureauKey(bureauName);
    const chunks = await pdfChunksForReport(report);
    if (chunks && chunks.length > 1) {
      const parse = await runBureauChunks(chunks, { bureauKey, bureauName, stage, pct });
      assertExtractionPageBounds(parse, chunks[0].totalPages);
      return { parse, pageCount: chunks[0].totalPages, chunkCount: chunks.length };
    }

    try {
      const raw = await claudeCall(
        buildReportContent(report.base64, bureauExtractionPrompt(bureauKey), report.mediaType),
        { schema: CREDIT_BUREAU_EXTRACTION_SCHEMA, onTokens: progress(stage, pct), operation: 'audit.report_extraction' },
      );
      const pageCount = chunks?.[0]?.totalPages || 1;
      const rawParse = parseAuditJSON(raw);
      assertExtractionPageBounds(rawParse, pageCount);
      const parse = assertBureauOutput(coerceBureauExtraction(rawParse, bureauKey), bureauName);
      assertExtractionPageBounds(parse, pageCount);
      return { parse, pageCount, chunkCount: 1 };
    } catch (err) {
      const totalPages = chunks?.[0]?.totalPages || 0;
      if (!isOutputLimitError(err) || totalPages < 2) throw err;
      console.warn(`[audit] ${bureauName} hit the output limit at ${totalPages} pages (under the page-split threshold) — forcing a split and retrying`);
      const forcedChunks = await splitPdfByPages(report.bytes || Buffer.from(report.base64, 'base64'), {
        maxPages: Math.max(1, Math.ceil(totalPages / 2)),
      });
      const parse = await runBureauChunks(forcedChunks, { bureauKey, bureauName, stage, pct });
      assertExtractionPageBounds(parse, forcedChunks[0].totalPages);
      return { parse, pageCount: forcedChunks[0].totalPages, chunkCount: forcedChunks.length };
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
      const rebased = rebaseExtractionPageRefs(parseAuditJSON(raw), chunk.startPage - 1);
      for (const extractedReport of rebased?.reports || []) {
        assertExtractionPageBounds(extractedReport, chunk.totalPages);
      }
      parts.push(rebased);
    }
    return mergeCombinedExtractions(parts);
  }

  async function parseCombinedExtractionChunked({ report, stage }) {
    const chunks = await pdfChunksForReport(report);
    if (chunks && chunks.length > 1) {
      const reports = await runCombinedChunks(chunks, { stage });
      reports.forEach((parsed) => assertExtractionPageBounds(parsed, chunks[0].totalPages));
      return { reports, pageCount: chunks[0].totalPages, chunkCount: chunks.length };
    }

    try {
      const raw = await claudeCall(
        buildReportContent(report.base64, combinedExtractionPrompt(null), report.mediaType),
        { schema: COMBINED_CREDIT_EXTRACTION_SCHEMA, onTokens: progress(stage, null), operation: 'audit.report_extraction' },
      );
      const pageCount = chunks?.[0]?.totalPages || 1;
      const rawExtraction = parseAuditJSON(raw);
      for (const extractedReport of rawExtraction?.reports || []) {
        assertExtractionPageBounds(extractedReport, pageCount);
      }
      const reports = mergeCombinedExtractions([rawExtraction]);
      reports.forEach((parsed) => assertExtractionPageBounds(parsed, pageCount));
      return { reports, pageCount, chunkCount: 1 };
    } catch (err) {
      const totalPages = chunks?.[0]?.totalPages || 0;
      if (!isOutputLimitError(err) || totalPages < 2) throw err;
      console.warn(`[audit] combined report hit the output limit at ${totalPages} pages (under the page-split threshold) — forcing a split and retrying`);
      const forcedChunks = await splitPdfByPages(report.bytes || Buffer.from(report.base64, 'base64'), {
        maxPages: Math.max(1, Math.ceil(totalPages / 2)),
      });
      const reports = await runCombinedChunks(forcedChunks, { stage });
      reports.forEach((parsed) => assertExtractionPageBounds(parsed, forcedChunks[0].totalPages));
      return { reports, pageCount: forcedChunks[0].totalPages, chunkCount: forcedChunks.length };
    }
  }

  async function resolveClientForParse(bureauParse) {
    void bureauParse;
    return { clientName: selectedJobClient.name, clientId: selectedJobClient.id };
  }

  async function saveBureauParseRow({
    bureauKey, bureauParse, report, file, pageCount = null, chunkCount = null,
    extractionInputs = null,
  }) {
    const { clientName, clientId } = await resolveClientForParse(bureauParse);
    const cohort = assertReportCohort([bureauParse], {
      requireThree: false,
      selectedClient: selectedJobClient,
      now: job.created_at,
    });
    const cohortKey = cohortKeyFor(clientId, cohort);
    const parseId = uuidFromSha256(`${jobId}:${bureauKey}:${report.sourceSha256}`);
    const source = sourceRecord({
      bureauParse, report, file, parseId, sourceJobId: jobId, pageCount, chunkCount,
      extractionInputs,
    });
    const provenance = buildAuditProvenance({
      mode: 'single', sourceJobId: jobId, cohort, cohortKey,
      sources: [source], evaluatedAt: job.created_at,
    });
    const row = {
      id: parseId,
      user_id: job.user_id,
      client_id: clientId,
      client_name: clientName,
      bureau: bureauKey,
      report_date: cohort.reportDate,
      parse: bureauParse,
      source_job_id: jobId,
      source_path: report.sourcePath,
      source_sha256: report.sourceSha256,
      source_bytes: report.sourceBytes,
      source_media_type: report.mediaType,
      parse_sha256: source.parseSha256,
      cohort_key: cohortKey,
      provenance,
      page_count: pageCount,
      chunk_count: chunkCount,
    };

    // A worker can be terminated after this immutable staging insert but
    // before the parent job is marked done. Resume the exact source-bound row
    // instead of creating a second parse version for the same logical job.
    const { data: priorRows, error: priorError } = await db.from('audit_bureau_parses')
      .select('id,parse_sha256,source_sha256,cohort_key,provenance')
      .eq('source_job_id', jobId).eq('bureau', bureauKey).limit(2);
    if (priorError) throw new Error('Could not verify prior bureau staging state: ' + priorError.message);
    if ((priorRows || []).length > 1) throw new Error('Logical audit has duplicate immutable bureau staging rows.');
    if (priorRows?.length === 1) {
      const prior = priorRows[0];
      if (prior.parse_sha256 !== row.parse_sha256
          || prior.source_sha256 !== row.source_sha256
          || prior.cohort_key !== row.cohort_key
          || prior.provenance?.provenanceSha256 !== row.provenance.provenanceSha256) {
        throw new Error('Prior staged bureau row does not match the resumed checkpoint output.');
      }
      row.id = prior.id;
      row.provenance = prior.provenance;
    }

    // Immutable/versioned insert. A rerun creates a new source-bound row; it
    // never mutates or deletes the prior parse. The source-job unique index
    // makes an accidental same-job replay observable instead of overwriting.
    if (!priorRows?.length) {
      const { error } = await db.from('audit_bureau_parses').insert(row);
      if (error) throw new Error('Could not save bureau parse: ' + error.message);
    }

    let readyQuery = db.from('audit_bureau_parses')
      .select('id,bureau,cohort_key,created_at')
      .eq('user_id', job.user_id)
      .eq('cohort_key', cohortKey)
      .order('created_at', { ascending: false });
    if (clientId) readyQuery = readyQuery.eq('client_id', clientId);
    else readyQuery = readyQuery.is('client_id', null).eq('client_name', clientName);
    const { data: readyRows } = await readyQuery;
    const selectedByBureau = {};
    const versionCounts = {};
    for (const candidate of readyRows || []) {
      const key = normalizeBureauKey(candidate.bureau);
      if (key) versionCounts[key] = (versionCounts[key] || 0) + 1;
      if (key && !selectedByBureau[key]) selectedByBureau[key] = candidate;
    }
    const ready = Object.keys(selectedByBureau);
    const exactVersionSet = ready.length === 3
      && (readyRows || []).length === 3
      && ['equifax', 'experian', 'transunion'].every((key) => versionCounts[key] === 1);
    const mergeSelection = exactVersionSet ? {
      cohortKey,
      parseIds: ['equifax', 'experian', 'transunion'].map((key) => selectedByBureau[key].id),
    } : null;

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
      canMerge: exactVersionSet,
      cohortKey,
      parseId: row.id,
      mergeSelection,
      provenance,
      parse: bureauParse,
    };
  }

  async function loadBureauParsesForMerge() {
    if (!job.selected_client_id) {
      throw new Error('Merge requires an existing client selection so the three bureau parses can be found.');
    }
    const selection = job.merge_selection || {};
    const parseIds = Array.isArray(selection.parseIds) ? selection.parseIds : [];
    if (parseIds.length !== 3 || new Set(parseIds).size !== 3 || !/^[0-9a-f]{64}$/i.test(String(selection.cohortKey || ''))) {
      throw new Error('Merge requires one exact source-bound parse from each bureau cohort.');
    }
    const { data, error } = await db.from('audit_bureau_parses')
      .select('id,bureau,parse,parse_sha256,client_id,client_name,report_date,source_job_id,source_path,source_sha256,source_bytes,source_media_type,cohort_key,provenance,page_count,chunk_count,created_at')
      .eq('user_id', job.user_id)
      .eq('client_id', job.selected_client_id)
      .in('id', parseIds);
    if (error) throw new Error('Could not load bureau parses: ' + error.message);
    if (!data || data.length !== 3) throw new Error('One or more selected staged parses no longer exists. Re-run the missing bureau.');

    const { data: cohortRows, error: cohortRowsError } = await db.from('audit_bureau_parses')
      .select('id,bureau')
      .eq('user_id', job.user_id)
      .eq('client_id', job.selected_client_id)
      .eq('cohort_key', selection.cohortKey);
    if (cohortRowsError) throw new Error('Could not verify the exact staged cohort: ' + cohortRowsError.message);
    const selectedIds = new Set(parseIds);
    if (!cohortRows || cohortRows.length !== 3 || cohortRows.some((row) => !selectedIds.has(row.id))) {
      throw new Error('This staged cohort contains multiple same-date parse versions. Use one new Combined or 3 Individual Reports audit so report cycles cannot be mixed.');
    }

    const byBureau = {};
    const sources = [];
    for (const row of data) {
      const key = normalizeBureauKey(row.bureau);
      if (!key || byBureau[key]) throw new Error('Selected staged parses do not contain exactly one row per bureau.');
      if (row.cohort_key !== selection.cohortKey) throw new Error('Selected staged parses belong to different report cohorts.');
      if (!/^[0-9a-f]{64}$/i.test(String(row.source_sha256 || ''))
          || !/^[0-9a-f]{64}$/i.test(String(row.parse_sha256 || ''))
          || row.parse_sha256 !== parseSha256(row.parse)) {
        throw new Error(`The saved ${bureauDisplayName(key)} parse no longer matches its immutable source digest.`);
      }
      if (row.provenance?.version !== AUDIT_PROVENANCE_VERSION
          || row.provenance?.provenanceCanonical !== provenanceCanonical(row.provenance)
          || row.provenance?.provenanceSha256 !== provenanceSha256(row.provenance)) {
        throw new Error(`The saved ${bureauDisplayName(key)} provenance record is incomplete or altered.`);
      }
      const boundSources = Array.isArray(row.provenance.sources) ? row.provenance.sources : [];
      const bound = boundSources[0];
      if (boundSources.length !== 1
          || row.provenance.exactThreeBureau !== false
          || row.provenance.cohortKey !== row.cohort_key
          || row.provenance.reportDate !== String(row.report_date)
          || row.provenance.sourceJobId !== row.source_job_id
          || bound?.bureau !== key
          || bound?.reportDate !== String(row.report_date)
          || bound?.sourceJobId !== row.source_job_id
          || bound?.parseId !== row.id
          || bound?.parseSha256 !== row.parse_sha256
          || bound?.filePath !== row.source_path
          || bound?.fileSha256 !== row.source_sha256
          || Number(bound?.fileBytes) !== Number(row.source_bytes)
          || bound?.mediaType !== row.source_media_type
          || Number(bound?.pageCount) !== Number(row.page_count)
          || Number(bound?.chunkCount) !== Number(row.chunk_count)
          || bound?.clientName !== row.parse?.client?.name
          || Number(bound?.clientNameEvidencePage) !== Number(row.parse?.client?.nameEvidencePage)
          || Number(bound?.reportSectionStartEvidencePage) !== Number(row.parse?.reportSectionStartEvidencePage)
          || (bound?.dateOfBirth || null) !== (row.parse?.personalInfo?.dateOfBirth || null)
          || Number(bound?.dateOfBirthEvidencePage || 0) !== Number(row.parse?.personalInfo?.dateOfBirthEvidencePage || 0)) {
        throw new Error(`The saved ${bureauDisplayName(key)} parse is not bound to the exact selected source record.`);
      }
      assertExtractionPageBounds(row.parse, Number(row.page_count) || 1);
      byBureau[key] = assertBureauOutput(coerceBureauExtraction(row.parse, key), bureauDisplayName(key));
      assertExtractionPageBounds(byBureau[key], Number(row.page_count) || 1);
      sources.push({
        bureau: key,
        reportDate: String(row.report_date),
        reportDateRaw: row.parse?.reportDateRaw || null,
        reportDateEvidencePage: row.parse?.reportDateEvidencePage ?? null,
        bureauEvidencePage: row.parse?.bureauEvidencePage ?? null,
        reportSectionStartEvidencePage: row.parse?.reportSectionStartEvidencePage ?? null,
        clientName: row.parse?.client?.name || null,
        clientNameEvidencePage: row.parse?.client?.nameEvidencePage ?? null,
        dateOfBirth: row.parse?.personalInfo?.dateOfBirth || null,
        dateOfBirthEvidencePage: row.parse?.personalInfo?.dateOfBirthEvidencePage ?? null,
        sourceJobId: row.source_job_id,
        parseId: row.id,
        parseSha256: row.parse_sha256,
        filePath: row.source_path,
        fileSha256: row.source_sha256,
        fileBytes: row.source_bytes,
        mediaType: row.source_media_type,
        pageCount: row.page_count,
        chunkCount: row.chunk_count,
      });
    }
    for (const key of ['equifax', 'experian', 'transunion']) {
      if (!byBureau[key]) {
        throw new Error(`Missing ${bureauDisplayName(key)} parse for this client. Run Single Bureau for each bureau first, then merge.`);
      }
    }
    const reports = [byBureau.equifax, byBureau.experian, byBureau.transunion];
    const cohort = assertReportCohort(reports, {
      requireThree: true,
      selectedClient: selectedJobClient,
      now: job.created_at,
    });
    const expectedCohortKey = cohortKeyFor(job.selected_client_id, cohort);
    if (expectedCohortKey !== selection.cohortKey) throw new Error('Selected staged parses do not match their bound client/report cohort.');
    return { byBureau, reports, sources, cohort, cohortKey: expectedCohortKey };
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

    if (audit.reportCoverage?.complete === true) (async () => {
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
    const isComplete3B = audit?.reportCoverage?.complete === true;
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
    const reportDate = audit && audit.client && audit.client.reportDate;
    if (audit?.evaluationMode === 'deterministic' && !/^\d{4}-\d{2}-\d{2}$/.test(String(reportDate || ''))) {
      throw new Error('Deterministic audit has no source-derived report date and cannot be saved.');
    }
    const clientId = selectedJobClient.id;
    if (extractedClientName.trim().toLowerCase() !== clientName.trim().toLowerCase()) {
      console.info('[audit] source consumer name includes a permitted middle-name/suffix formatting difference from the selected CRM client');
    }

    if (isComplete3B) try {
      const scores = audit.scores || (audit.client && audit.client.scores);
      if (clientName && scores) {
        const PROFILE_COLS = 'score_eq_start,score_exp_start,score_tu_start,phone';
        const existingQuery = db.from('clients').select(PROFILE_COLS)
          .eq('id', clientId).eq('user_id', userId).limit(1);
        const { data: existing } = await existingQuery;
        if (existing && existing.length > 0) {
          const eq = scores.equifax || scores.eq || null;
          const exp = scores.experian || scores.exp || null;
          const tu = scores.transunion || scores.tu || null;
          const scorePatch = {};
          if (!existing[0].score_eq_start && eq) scorePatch.score_eq_start = parseInt(eq);
          if (!existing[0].score_exp_start && exp) scorePatch.score_exp_start = parseInt(exp);
          if (!existing[0].score_tu_start && tu) scorePatch.score_tu_start = parseInt(tu);
          if (Object.keys(scorePatch).length) {
            await db.from('clients').update(scorePatch).eq('id', clientId).eq('user_id', userId);
          }
        }

        // A report may contain historical identity/contact values. Keep those
        // inside the audit evidence; only a source-backed phone may fill a
        // blank contact field. DOB and current mailing address remain explicit
        // CRM/verified-letter-identity inputs and are never mutated by an audit.
        const pi = audit.personalInfo || (audit.client && audit.client.personalInfo);
        if (pi && existing && existing.length > 0) {
          const profilePatch = {};
          if (pi.phone && pi.phoneEvidence?.page && !existing[0].phone) profilePatch.phone = pi.phone;

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
    if (isComplete3B) try {
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
      ? slug(clientName) + '__' + clientId + '__' + reportDate + '__' + job.id
      : slug(clientName) + '__' + reportDate + '__' + job.id;

    if (audit.client && clientId) audit.client.id = clientId;

    const savedAt = new Date().toISOString();
    const { error } = await db.from('audits').insert({
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
    if (isComplete3B) {
      await db.from('clients').upsert({
        user_id: userId, name: clientName, address: clientAddress, status: 'lead',
      }, { onConflict: 'user_id,name', ignoreDuplicates: true });
    }

    return { clientName, clientId, auditId, savedAt };
  }

  let activeCheckpoint = null;
  try {
    const t = todayLong();
    const files = job.files || [];
    const checkpointPlan = await ensureCheckpointPlan();
    if (!checkpointPlan) {
      return { statusCode: 409, body: 'saved combined audit retired for parser upgrade' };
    }

    const claimedCheckpoints = [];
    for (let index = 0; index < MAX_PROVIDER_CONCURRENCY; index += 1) {
      const { data: claimedCheckpointRows, error: checkpointClaimError } = await db.rpc(
        'ccc_claim_next_audit_checkpoint',
        { p_job_id: jobId, p_lease_token: leaseToken },
      );
      if (checkpointClaimError) throw new Error('Could not claim the next audit checkpoint: ' + checkpointClaimError.message);
      const checkpoint = Array.isArray(claimedCheckpointRows) ? claimedCheckpointRows[0] : claimedCheckpointRows;
      if (!checkpoint) break;
      claimedCheckpoints.push(checkpoint);
      unsettledCheckpoints.set(checkpoint.id, checkpoint);
      // Merge mode contains no provider work and must finalize under this
      // same exclusive job lease rather than claiming unrelated work.
      if (checkpoint.kind === 'merge') break;
    }

    if (claimedCheckpoints.length) {
      if (claimedCheckpoints[0].kind === 'merge') {
        activeCheckpoint = claimedCheckpoints[0];
        await completeCheckpoint(activeCheckpoint, {
          ready: true,
          mergeSelectionSha256: sha256(canonicalJson(job.merge_selection || null)),
        });
      } else {
        if (remainingBudgetMs() < MIN_PROVIDER_BUDGET_MS) {
          const retryAt = new Date().toISOString();
          for (const checkpoint of claimedCheckpoints) {
            await deferCheckpoint(checkpoint, {
              status: 'retryable',
              errorType: 'worker_budget_deferred',
              errorMessage: 'Checkpoint is ready for a fresh provider window.',
              retryAt,
            });
          }
          await releaseLease({ status: 'waiting', stage: 'Saved checkpoints ready for the next worker', retryAt });
          try { await dispatchNext(); } catch (chainError) {
            console.warn('[audit] deferred batch saved; watchdog will resume after chain failure:', chainError.message);
          }
          return { statusCode: 200, body: 'yielded before provider batch' };
        }

        // PDFDocument.load/copy can briefly hold the whole source plus a
        // generated range in memory. Materialize ranges serially, then overlap
        // only the provider network/model work below. This keeps a large 3B
        // from tripling its peak PDF memory when three checkpoints are claimed.
        const preparedInputs = [];
        for (const checkpoint of claimedCheckpoints) {
          try {
            preparedInputs.push({ status: 'fulfilled', value: await checkpointInput(checkpoint) });
          } catch (error) {
            preparedInputs.push({ status: 'rejected', reason: error });
          }
        }
        if (remainingBudgetMs() < MIN_PROVIDER_BUDGET_MS) {
          const retryAt = new Date().toISOString();
          for (const checkpoint of claimedCheckpoints) {
            await deferCheckpoint(checkpoint, {
              status: 'retryable',
              errorType: 'worker_budget_deferred',
              errorMessage: 'Checkpoint is ready for a fresh provider window.',
              retryAt,
            });
          }
          await releaseLease({ status: 'waiting', stage: 'Prepared checkpoints ready for the next worker', retryAt });
          try { await dispatchNext(); } catch (chainError) {
            console.warn('[audit] prepared batch saved; watchdog will resume after chain failure:', chainError.message);
          }
          return { statusCode: 200, body: 'yielded after safe checkpoint preparation' };
        }

        // Only provider-bound extraction runs concurrently. Every checkpoint
        // completion/split/defer write is settled serially below so immutable
        // provenance and aggregate counters remain deterministic.
        const results = await Promise.allSettled(
          claimedCheckpoints.map((checkpoint, index) => (
            preparedInputs[index].status === 'fulfilled'
              ? processExtractionCheckpoint(checkpoint, preparedInputs[index].value)
              : Promise.reject(preparedInputs[index].reason)
          )),
        );
        activeCheckpoint = null;
        let terminalFailure = null;
        let earliestRetryAt = null;
        let completedCount = 0;
        let splitCount = 0;
        const settlementCauses = new Map();

        const settlementFailures = await settleEveryAuditCheckpoint(results, async (result, index) => {
          const checkpoint = claimedCheckpoints[index];
          let providerFailure = null;
          if (result.status === 'fulfilled') {
            await completeCheckpoint(checkpoint, result.value);
            completedCount += 1;
            return;
          }

          const error = result.reason instanceof Error ? result.reason : new Error('Audit provider request failed.');
          providerFailure = error;
          settlementCauses.set(checkpoint.id, providerFailure);
          const splitReason = checkpointSplitReason(error);
          const canSplit = splitReason
            && Number(checkpoint.end_page) - Number(checkpoint.start_page) + 1 >= 3;
          if (canSplit) {
            console.warn('[audit] recoverable provider limit; splitting saved checkpoint', JSON.stringify({
              jobId,
              checkpointId: checkpoint.id,
              startPage: checkpoint.start_page,
              endPage: checkpoint.end_page,
              reason: splitReason,
            }));
            await splitCheckpoint(checkpoint, splitReason);
            splitCount += 1;
            return;
          }

          const attempts = Number(checkpoint.attempt_count || 0);
          const unsplittableTimeout = error.auditProviderTimeout
            && Number(checkpoint.end_page) - Number(checkpoint.start_page) + 1 < 3;
          const retryable = !error.auditTerminal && !error.auditOutputLimit
            && !error.auditNativeFallbackSplit
            && attempts < (unsplittableTimeout ? 2 : 3);
          const delayMs = Math.min(5 * 60 * 1000, 5000 * (2 ** Math.max(0, attempts - 1)));
          const retryAt = retryable ? new Date(Date.now() + delayMs).toISOString() : null;
          await deferCheckpoint(checkpoint, {
            status: retryable ? 'retryable' : 'error',
            errorType: error.auditErrorType || error.name || 'audit_error',
            errorMessage: error.auditUserMessage || error.message || 'Audit failed',
            retryAt,
          });
          if (retryAt && (!earliestRetryAt || retryAt < earliestRetryAt)) earliestRetryAt = retryAt;
          if (!retryable && !terminalFailure) terminalFailure = error;
        });

        for (const failure of settlementFailures) {
          const checkpoint = claimedCheckpoints[failure.index];
          if (!settlementCauses.has(checkpoint.id)) settlementCauses.set(checkpoint.id, failure.error);
          console.error('[audit] checkpoint settlement failed after preserving sibling work', JSON.stringify({
            jobId,
            checkpointId: checkpoint.id,
            error: failure.error?.message || 'checkpoint settlement failed',
          }));
        }

        if (settlementFailures.length) {
          const settlementError = new Error(`Could not durably settle ${settlementFailures.length} audit checkpoint${settlementFailures.length === 1 ? '' : 's'}.`);
          settlementError.auditCheckpointCauses = settlementCauses;
          settlementError.auditTerminalSibling = terminalFailure;
          throw settlementError;
        }

        if (terminalFailure) {
          await releaseLease({
            status: 'error',
            stage: 'Audit stopped for review',
            errorType: terminalFailure.auditErrorType || terminalFailure.name || 'audit_error',
            errorMessage: terminalFailure.auditUserMessage || terminalFailure.message || 'Audit failed',
          });
          return { statusCode: 500, body: 'audit checkpoint stopped for review' };
        }

        const stage = [
          completedCount ? `${completedCount} checkpoint${completedCount === 1 ? '' : 's'} saved` : null,
          splitCount ? `${splitCount} slow range${splitCount === 1 ? '' : 's'} split` : null,
        ].filter(Boolean).join(' · ') || 'Checkpoint batch safely deferred';
        await releaseLease({ status: 'waiting', stage: `${stage} · continuing audit`, retryAt: earliestRetryAt });
        try { await dispatchNext(); } catch (chainError) {
          console.warn('[audit] checkpoint batch saved; watchdog will resume after chain failure:', chainError.message);
        }
        return { statusCode: 200, body: 'checkpoint batch saved' };
      }
    }

    // A merge checkpoint can finalize in the same invocation. Once every
    // checkpoint is durable, later failures belong to finalization—not to the
    // already-terminal checkpoint—and must never try to mutate it.
    activeCheckpoint = null;

    const { data: checkpoints, error: checkpointLoadError } = await db.from('audit_job_checkpoints')
      .select('*').eq('job_id', jobId).neq('status', 'superseded').order('sequence');
    if (checkpointLoadError) throw new Error('Could not load completed audit checkpoints: ' + checkpointLoadError.message);
    const expected = Number(job.expected_checkpoint_count) || checkpoints?.length || 0;
    if (!checkpoints || checkpoints.length !== expected || checkpoints.some((checkpoint) => checkpoint.status !== 'done')) {
      const retryAt = (checkpoints || [])
        .filter((checkpoint) => checkpoint.status === 'retryable' && checkpoint.next_retry_at)
        .map((checkpoint) => checkpoint.next_retry_at).sort()[0] || new Date().toISOString();
      await releaseLease({ status: 'waiting', stage: 'Waiting to resume saved audit checkpoints', retryAt });
      return { statusCode: 200, body: 'waiting for checkpoint retry' };
    }

    for (const checkpoint of checkpoints) {
      if (checkpoint.output_sha256 !== parseSha256(checkpoint.output)) {
        throw terminalAuditError('Completed checkpoint output no longer matches its immutable digest.', 'checkpoint_output_mismatch');
      }
      if (checkpoint.kind !== 'merge') {
        const source = (job.source_manifest || [])[Number(checkpoint.source_index)];
        if (!source || source.path !== checkpoint.source_path
            || source.sha256 !== checkpoint.source_sha256
            || Number(source.bytes) !== Number(checkpoint.source_bytes)) {
          throw terminalAuditError('Completed checkpoint provenance no longer matches the logical source manifest.', 'checkpoint_provenance_mismatch');
        }
      } else if (checkpoint.output?.mergeSelectionSha256 !== sha256(canonicalJson(job.merge_selection || null))) {
        throw terminalAuditError('Merge checkpoint no longer matches the exact staged parse selection.', 'merge_selection_mismatch');
      }
    }

    // If Netlify stopped after the audit insert but before job completion,
    // finish the same logical job from that exact row instead of repeating
    // final-save side effects or creating a duplicate audit.
    const auditSuffix = `__${job.id}`;
    const { data: priorAudits, error: priorAuditError } = await db.from('audits')
      .select('id,audit').eq('user_id', ownerUserId).eq('client_id', job.selected_client_id)
      .like('id', `%${auditSuffix}`).limit(2);
    if (priorAuditError) throw new Error('Could not verify final audit idempotency: ' + priorAuditError.message);

    let jobResult;
    if ((priorAudits || []).length === 1) {
      jobResult = { ...priorAudits[0].audit, auditId: priorAudits[0].id };
    } else {
      if ((priorAudits || []).length > 1) throw terminalAuditError('Logical job is associated with multiple persisted audits.', 'duplicate_final_audit');
      let audit;
      if (job.mode === 'merge') {
        await progress('Loading exact staged bureau cohort', 84)(0);
        const staged = await loadBureauParsesForMerge();
        const provenance = buildAuditProvenance({
          mode: 'merge', sourceJobId: jobId, cohort: staged.cohort, cohortKey: staged.cohortKey,
          sources: staged.sources, evaluatedAt: job.created_at,
        });
        audit = assertAuditOutput(buildDeterministicAudit(staged.reports, {
          reportDate: staged.cohort.reportDate, evaluatedAt: job.created_at, provenance,
        }));
        jobResult = await finalizeUnifiedAudit(audit, { skipEnrichment: true, files: [], today: t });
      } else if (job.mode === 'combined') {
        const reports = mergeCombinedExtractions(checkpoints.map((checkpoint) => checkpoint.output));
        const pageCount = Number(checkpoints[0]?.total_pages) || 1;
        reports.forEach((reportParse) => assertExtractionPageBounds(reportParse, pageCount));
        const cohort = assertReportCohort(reports, {
          requireThree: true, selectedClient: selectedJobClient, now: job.created_at,
        });
        const cohortKey = cohortKeyFor(selectedJobClient.id, cohort);
        const sourceReport = await downloadReport(files[0]);
        const extractionInputs = extractionInputsFromCheckpoints(checkpoints);
        const sources = reports.map((bureauParse) => sourceRecord({
          bureauParse, report: sourceReport, file: files[0], sourceJobId: jobId,
          pageCount, chunkCount: checkpoints.length, extractionInputs,
        }));
        const provenance = buildAuditProvenance({
          mode: 'combined', sourceJobId: jobId, cohort, cohortKey, sources, evaluatedAt: job.created_at,
        });
        audit = assertAuditOutput(buildDeterministicAudit(reports, {
          reportDate: cohort.reportDate, evaluatedAt: job.created_at, provenance,
        }));
        jobResult = await finalizeUnifiedAudit(audit, { skipEnrichment: true, files, today: t });
      } else {
        const parsed = {};
        const meta = {};
        for (const key of (job.mode === 'single'
          ? [normalizeBureauKey(files[0]?.bureau)]
          : ['equifax', 'experian', 'transunion'])) {
          if (!key) throw new Error('Audit checkpoint has no valid bureau binding.');
          const bureauCheckpoints = checkpoints.filter((checkpoint) => checkpoint.bureau === key);
          if (!bureauCheckpoints.length) throw new Error(`Missing ${bureauDisplayName(key)} checkpoints.`);
          parsed[key] = assertBureauOutput(mergeBureauExtractions(
            bureauCheckpoints.map((checkpoint) => checkpoint.output), key,
          ), bureauDisplayName(key));
          const pageCount = Number(bureauCheckpoints[0].total_pages) || 1;
          assertExtractionPageBounds(parsed[key], pageCount);
          meta[key] = {
            pageCount,
            chunkCount: bureauCheckpoints.length,
            extractionInputs: extractionInputsFromCheckpoints(bureauCheckpoints),
          };
        }

        if (job.mode === 'single') {
          const key = normalizeBureauKey(files[0]?.bureau);
          const report = await downloadReport(files[0]);
          const staged = await saveBureauParseRow({
            bureauKey: key, bureauParse: parsed[key], report, file: files[0],
            pageCount: meta[key].pageCount, chunkCount: meta[key].chunkCount,
            extractionInputs: meta[key].extractionInputs,
          });
          audit = assertAuditOutput(buildDeterministicAudit([parsed[key]], {
            reportDate: parsed[key].reportDate, evaluatedAt: job.created_at, provenance: staged.provenance,
          }), `${bureauDisplayName(key)} standalone audit`);
          audit.kind = 'single_bureau_audit';
          audit.singleBureauStatus = {
            bureau: staged.bureau, parseId: staged.parseId, cohortKey: staged.cohortKey,
            readyBureaus: staged.readyBureaus, missingBureaus: staged.missingBureaus,
            canMerge: staged.canMerge, mergeSelection: staged.mergeSelection,
            r1Eligible: false, reason: 'A single-bureau audit is incomplete and cannot initialize R1.',
          };
          jobResult = await finalizeUnifiedAudit(audit, { skipEnrichment: true, files, today: t });
        } else {
          const reports = [parsed.equifax, parsed.experian, parsed.transunion];
          const cohort = assertReportCohort(reports, {
            requireThree: true, selectedClient: selectedJobClient, now: job.created_at,
          });
          const cohortKey = cohortKeyFor(selectedJobClient.id, cohort);
          const fileByBureau = Object.fromEntries(files.map((file) => [normalizeBureauKey(file.bureau), file]));
          const reportByBureau = {};
          for (const key of ['equifax', 'experian', 'transunion']) {
            reportByBureau[key] = await downloadReport(fileByBureau[key]);
          }
          const sources = reports.map((bureauParse) => sourceRecord({
            bureauParse,
            report: reportByBureau[bureauParse.bureau],
            file: fileByBureau[bureauParse.bureau], sourceJobId: jobId,
            pageCount: meta[bureauParse.bureau].pageCount,
            chunkCount: meta[bureauParse.bureau].chunkCount,
            extractionInputs: meta[bureauParse.bureau].extractionInputs,
          }));
          const provenance = buildAuditProvenance({
            mode: 'individual', sourceJobId: jobId, cohort, cohortKey, sources, evaluatedAt: job.created_at,
          });
          audit = assertAuditOutput(buildDeterministicAudit(reports, {
            reportDate: cohort.reportDate, evaluatedAt: job.created_at, provenance,
          }));
          jobResult = await finalizeUnifiedAudit(audit, { skipEnrichment: true, files, today: t });
        }
      }
    }

    const calls = checkpoints.map((checkpoint) => checkpoint.usage).filter(Boolean);
    const totals = calls.reduce((sum, call) => ({
      input: sum.input + Number(call.input || 0),
      output: sum.output + Number(call.output || 0),
      cache_read: sum.cache_read + Number(call.cache_read || 0),
      cache_write: sum.cache_write + Number(call.cache_write || 0),
      est_cost_usd: Math.round((sum.est_cost_usd + Number(call.est_cost_usd || 0)) * 10000) / 10000,
    }), { input: 0, output: 0, cache_read: 0, cache_write: 0, est_cost_usd: 0 });
    const finalUsage = { model: AUDIT_MODEL, effort: AUDIT_EFFORT, calls, totals };
    const finalAuditId = jobResult?.auditId;
    if (!finalAuditId) throw new Error('Final audit save did not return an immutable audit id.');
    const { data: finished, error: finishError } = await db.rpc('ccc_finish_audit_job', {
      p_job_id: jobId, p_lease_token: leaseToken, p_result: jobResult,
      p_usage: finalUsage, p_final_audit_id: finalAuditId,
    });
    if (finishError || finished !== true) throw new Error('Could not atomically finish logical audit job: ' + (finishError?.message || 'lease mismatch'));
    leaseClosed = true;
  } catch (e) {
    if (unsettledCheckpoints.size > 0) {
      let anyTerminal = Boolean(e?.auditTerminalSibling);
      let earliestRetryAt = null;
      let settlementWriteFailed = false;
      for (const checkpoint of [...unsettledCheckpoints.values()]) {
        try {
          const checkpointError = e?.auditCheckpointCauses?.get?.(checkpoint.id) || e;
          const pageCount = Number(checkpoint.end_page) - Number(checkpoint.start_page) + 1;
          const splitReason = checkpointSplitReason(checkpointError);
          if (splitReason && pageCount >= 3) {
            await splitCheckpoint(checkpoint, splitReason);
            continue;
          }
          const attempts = Number(checkpoint.attempt_count || 0);
          const unsplittableTimeout = checkpointError?.auditProviderTimeout && pageCount < 3;
          const retryableCheckpoint = !checkpointError?.auditTerminal && !checkpointError?.auditOutputLimit
            && !checkpointError?.auditNativeFallbackSplit
            && attempts < (unsplittableTimeout ? 2 : 3);
          const delayMs = Math.min(5 * 60 * 1000, 5000 * (2 ** Math.max(0, attempts - 1)));
          const retryAt = retryableCheckpoint ? new Date(Date.now() + delayMs).toISOString() : null;
          await deferCheckpoint(checkpoint, {
            status: retryableCheckpoint ? 'retryable' : 'error',
            errorType: checkpointError?.auditErrorType || checkpointError?.name || 'audit_error',
            errorMessage: checkpointError?.auditUserMessage || checkpointError?.message || 'Audit failed',
            retryAt,
          });
          if (!retryableCheckpoint) anyTerminal = true;
          if (retryAt && (!earliestRetryAt || retryAt < earliestRetryAt)) earliestRetryAt = retryAt;
        } catch (settlementError) {
          settlementWriteFailed = true;
          console.error('[audit] could not settle claimed checkpoint before job release', JSON.stringify({
            jobId,
            checkpointId: checkpoint.id,
            error: settlementError?.message || 'checkpoint settlement failed',
          }));
        }
      }

      // Release the job once after attempting every exact checkpoint. Any row
      // still carrying the lease is recovered by the watchdog only after that
      // lease expires; siblings already transitioned above never repeat.
      const recoverable = !anyTerminal;
      const releaseError = e?.auditTerminalSibling || e;
      if (!leaseClosed) {
        try {
          await releaseLease({
            status: recoverable ? 'retryable' : 'error',
            stage: recoverable
              ? 'Saved checkpoint batch paused · safe resume scheduled'
              : 'Audit stopped for review',
            errorType: releaseError?.auditErrorType || releaseError?.name || 'audit_error',
            errorMessage: recoverable
              ? (settlementWriteFailed
                ? 'One saved checkpoint is waiting for lease recovery; completed siblings were preserved.'
                : null)
              : (releaseError?.auditUserMessage || releaseError?.message || 'Audit failed'),
            retryAt: recoverable ? (earliestRetryAt || new Date().toISOString()) : null,
          });
        } catch (jobWriteError) {
          console.error('audit-run: could not release checkpoint batch', jobWriteError.message);
        }
      }
      if (recoverable) {
        try { await dispatchNext(); } catch (chainError) {
          console.warn('[audit] deferred batch will resume through watchdog:', chainError.message);
        }
        return { statusCode: 200, body: 'checkpoint batch safely deferred' };
      }
      console.error('audit-run failed:', e);
      return { statusCode: 500, body: 'audit checkpoint batch stopped for review' };
    }

    const activeSplitReason = checkpointSplitReason(e);
    const canSplitCheckpoint = activeSplitReason && activeCheckpoint
      && Number(activeCheckpoint.end_page) - Number(activeCheckpoint.start_page) + 1 >= 3;
    if (canSplitCheckpoint) {
      console.warn('[audit] recoverable provider limit; splitting saved checkpoint', JSON.stringify({
        jobId,
        checkpointId: activeCheckpoint.id,
        startPage: activeCheckpoint.start_page,
        endPage: activeCheckpoint.end_page,
        reason: activeSplitReason,
      }));
      try {
        await splitCheckpoint(activeCheckpoint, activeSplitReason);
        await releaseLease({ status: 'waiting', stage: 'Dense or slow pages saved as smaller checkpoints' });
        try { await dispatchNext(); } catch (chainError) {
          console.warn('[audit] split saved; watchdog will resume after chain failure:', chainError.message);
        }
        return { statusCode: 200, body: 'dense checkpoint split safely' };
      } catch (splitError) {
        console.error('audit-run: provider-limit split failed', splitError?.message || 'lease mismatch');
      }
    }
    console.error('audit-run failed:', e);
    const attempts = Number(activeCheckpoint?.attempt_count || 0);
    const consecutiveJobRetries = Number(job?.retry_count || 0);
    // Never pay for the exact same deterministic output-limit failure again.
    // Eligible PDF ranges were split above; a minimum-size range is terminal
    // and needs operator review rather than blind provider retries.
    const retryable = !e?.auditTerminal && !e?.auditOutputLimit
      && (activeCheckpoint ? attempts < 3 : consecutiveJobRetries < 3);
    const delayMs = Math.min(5 * 60 * 1000, 5000 * (2 ** Math.max(0, attempts - 1)));
    await logClaudeCall(db, {
      userId: ownerUserId, operation: 'audit.pipeline', entityType: 'audit_job', entityId: jobId,
      model: AUDIT_MODEL, effort: AUDIT_EFFORT, promptVersion: 'audit-v2', status: 'error',
      startedAt: new Date(), errorType: e.name, errorMessage: e.message,
    }).catch(() => {});
    if (!leaseClosed) {
      try {
        await releaseLease({
          status: retryable ? 'retryable' : 'error',
          stage: retryable ? 'Checkpoint paused · safe resume scheduled' : 'Audit stopped for review',
          errorType: e.auditErrorType || e.name || 'audit_error',
          errorMessage: e.auditUserMessage || e.message || 'Audit failed',
          retryAt: retryable ? new Date(Date.now() + delayMs).toISOString() : null,
          checkpointId: activeCheckpoint?.id || null,
        });
      } catch (jobWriteErr) {
        // The watchdog owns recovery when a platform kill prevents the
        // terminal/retryable write. It reclaims only an expired lease.
        console.error('audit-run: could not persist retry state', jobWriteErr.message);
      }
    }
  }

  return { statusCode: 200, body: 'ok' };
};
