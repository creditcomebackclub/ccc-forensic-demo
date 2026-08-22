// Server-side response analysis — Netlify BACKGROUND function (15-min
// limit), mirroring audit-run-background.mjs. Holds
// ANTHROPIC_API_KEY as a server env var; the browser never sees a key.
//
// Contract: response file(s) already live in the `responses` storage bucket
// (uploaded by the client portal or the admin UI). The browser inserts a
// phase2_jobs row (status 'queued') referencing those paths, then POSTs
// { jobId, mailedDate } here and polls the row. This function claims the
// job atomically, loads the saved CCC letter, extracts response evidence,
// applies deterministic response rules, persists the result, and marks the
// job done. It never drafts a follow-up letter.
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { RESPONSE_EXTRACTION_SCHEMA } from '../../src/utils/creditExtractionSchemas.js';
import { RESPONSE_EXTRACTION_SYSTEM_PROMPT } from '../../src/prompts/extractionPrompts.js';
import {
  buildNonResponseAnalysis,
  evaluateBureauResponse,
  evaluateFurnisherResponse,
  extractDemandsFromLetterHtml,
} from '../../src/utils/deterministicResponse.js';
import { inferMediaType, isAnalyzable } from '../../src/utils/responseFiles.js';
import { splitPdfByPages } from '../../src/utils/pdfPageChunks.js';
import { priorLetterPlainText } from '../../src/utils/roundEvidence.js';
import { responseWindowDays } from '../../src/utils/responseWindow.js';
import { assessPacketAccount } from '../../src/utils/packetResponse.js';
import { requireStaff } from './_requireAuth.cjs';
import storagePaths from './_storagePaths.cjs';
import {
  assertCompletedMessage,
  CLAUDE_CLIENT_OPTIONS,
  CLAUDE_MODEL,
  logClaudeCall,
  preflightTokenCount,
  usageFromMessage,
} from './_claudeRuntime.mjs';

const { responseEvidencePrefixes } = storagePaths;

const MODEL = CLAUDE_MODEL;
const MAX_TOTAL_RESPONSE_BYTES = 18 * 1024 * 1024;
const RESPONSE_PDF_CHUNK_PAGES = 40;
const RESPONSE_EXTRACTION_SYSTEM = [{ type: 'text', text: RESPONSE_EXTRACTION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];

const PHASE2_KINDS = ['response', 'non_response', 'bureau_response'];
const RETIRED_FOLLOW_UP_ERROR =
  'LEGACY FOLLOW-UP GENERATION RETIRED — review the response, then continue through the approved CCC template track. No letter was drafted.';

const today = () => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

function responseFileBlock(base64, mediaType) {
  if (mediaType && mediaType.startsWith('image/')) {
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };
  }
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
}

function isResponsePathForLetter(path, letterId) {
  if (typeof path !== 'string' || !path || path.includes('..') || path.startsWith('/')) return false;
  const segments = path.split('/');
  return segments.length >= 3 && segments[1] === letterId && segments.every(Boolean);
}

function isResponsePathForEvidence(path, evidence) {
  if (typeof path !== 'string' || !path || path.includes('..') || path.startsWith('/')) return false;
  return responseEvidencePrefixes(evidence.firm_user_id, evidence.client_id, evidence.id)
    .some((prefix) => path.startsWith(prefix) && path.length > prefix.length);
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let caller;
  try {
    caller = await requireStaff(event);
  } catch (e) {
    if (e && e.statusCode) return e;
    console.error('phase2-analyze: could not authenticate caller', e);
    return { statusCode: 500, body: 'authentication failed' };
  }

  let jobId = null, mailedDateOverride = null;
  try {
    const body = JSON.parse(event.body || '{}');
    jobId = body.jobId;
    mailedDateOverride = body.mailedDate || null;
  } catch (e) { /* handled below */ }
  if (typeof jobId !== 'string' || !jobId) return { statusCode: 400, body: 'jobId required' };

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('phase2-analyze: missing Supabase server configuration');
    return { statusCode: 500, body: 'server not configured' };
  }

  // Same WebSocket workaround as audit-run-background.mjs — Netlify's Node 20
  // runtime has no global WebSocket, and supabase-js always constructs a
  // RealtimeClient in createClient() even for pure REST usage.
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  });

  // Read and validate the queued job under the caller's identity before the
  // service role can touch a response file or call the model.
  const { data: queuedJob, error: queuedJobErr } = await db
    .from('phase2_jobs')
    .select('id, letter_id, kind, files, response_evidence_id')
    .eq('id', jobId)
    .eq('user_id', caller.userId)
    .eq('status', 'queued')
    .maybeSingle();
  if (queuedJobErr || !queuedJob) {
    console.warn('phase2-analyze: job not available to caller', jobId, queuedJobErr?.message);
    return { statusCode: 409, body: 'job not claimable' };
  }
  if (queuedJob.kind === 'bureau_follow_up') {
    await db.from('phase2_jobs').update({
      status: 'error',
      stage: 'Retired workflow blocked',
      error: RETIRED_FOLLOW_UP_ERROR,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', jobId).eq('user_id', caller.userId).eq('status', 'queued');
    return { statusCode: 410, body: RETIRED_FOLLOW_UP_ERROR };
  }
  if (typeof queuedJob.letter_id !== 'string' || !queuedJob.letter_id
      || !PHASE2_KINDS.includes(queuedJob.kind)) {
    return { statusCode: 400, body: 'job contains invalid analysis data' };
  }
  const responseFiles = Array.isArray(queuedJob.files) ? queuedJob.files : [];
  if ((queuedJob.kind === 'non_response' && responseFiles.length)
      || (queuedJob.kind === 'bureau_response' && !queuedJob.response_evidence_id)
      || (queuedJob.kind === 'response' && !queuedJob.response_evidence_id
          && (!responseFiles.length || !responseFiles.every((file) => isResponsePathForLetter(file?.path, queuedJob.letter_id))))) {
    return { statusCode: 400, body: 'job contains invalid response upload paths' };
  }

  const { data: targetLetter, error: targetLetterErr } = await db
    .from('letters')
    .select('id, user_id, client_id, phase')
    .eq('id', queuedJob.letter_id)
    .maybeSingle();
  if (targetLetterErr || !targetLetter) return { statusCode: 404, body: 'letter not found' };
  if (caller.role !== 'admin' && targetLetter.user_id !== caller.userId) {
    return { statusCode: 403, body: 'not authorized for this letter' };
  }
  if (!String(targetLetter.phase || '').startsWith('CCC Dispute —')) {
    const error = 'LEGACY RESPONSE WORKFLOW RETIRED — this historical letter remains readable, but it cannot start a new response-analysis or letter-generation job.';
    await db.from('phase2_jobs').update({
      status: 'error',
      stage: 'Retired workflow blocked',
      error,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', jobId).eq('user_id', caller.userId).eq('status', 'queued');
    return { statusCode: 410, body: error };
  }
  if (!anthropicKey) {
    console.error('phase2-analyze: missing ANTHROPIC_API_KEY');
    return { statusCode: 500, body: 'server not configured' };
  }

  // New uploads are bound to an immutable evidence row before a service-role
  // function reads them. This closes the old path-injection shape where a
  // browser-created job could point a paid model call at another file.
  let evidence = null;
  let filesForAnalysis = responseFiles;
  if (queuedJob.response_evidence_id) {
    const { data: evidenceRow, error: evidenceErr } = await db
      .from('response_evidence')
      .select('id,firm_user_id,client_id,letter_id,response_kind,storage_bucket,storage_paths,upload_status,received_at,analysis,analysis_status')
      .eq('id', queuedJob.response_evidence_id)
      .maybeSingle();
    if (evidenceErr || !evidenceRow) return { statusCode: 400, body: 'response evidence not found' };

    const expectedKind = queuedJob.kind === 'bureau_response'
      ? 'bureau'
      : 'furnisher';
    const evidencePaths = Array.isArray(evidenceRow.storage_paths) ? evidenceRow.storage_paths : [];
    if (
      evidenceRow.letter_id !== targetLetter.id
      || evidenceRow.firm_user_id !== targetLetter.user_id
      || (targetLetter.client_id && evidenceRow.client_id && evidenceRow.client_id !== targetLetter.client_id)
      || evidenceRow.response_kind !== expectedKind
      || evidenceRow.upload_status !== 'received'
      || !evidencePaths.length
      || !evidencePaths.every((path) => isResponsePathForEvidence(path, evidenceRow))
    ) {
      return { statusCode: 400, body: 'response evidence does not match this analysis job' };
    }
    evidence = evidenceRow;
    filesForAnalysis = evidencePaths.map((path) => ({ path }));
  }

  // Atomic claim — only proceeds if the authenticated staff caller owns a
  // queued job. This prevents both client-triggered runs and cross-user job
  // consumption.
  const { data: claimed, error: claimErr } = await db
    .from('phase2_jobs')
    .update({ status: 'running', started_at: new Date().toISOString(), updated_at: new Date().toISOString(), stage: 'Starting analysis', tokens: 0 })
    .eq('id', jobId)
    .eq('user_id', caller.userId)
    .eq('status', 'queued')
    .select();
  if (claimErr || !claimed || claimed.length === 0) {
    console.warn('phase2-analyze: job not claimable', jobId, claimErr?.message);
    return { statusCode: 409, body: 'job not claimable' };
  }
  const job = claimed[0];

  const anthropic = new Anthropic({ apiKey: anthropicKey, ...CLAUDE_CLIENT_OPTIONS });
  let lastWrite = 0;
  const updateJob = async (patch, force = false) => {
    const now = Date.now();
    if (!force && now - lastWrite < 1200) return; // throttle progress writes
    lastWrite = now;
    await db.from('phase2_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', jobId);
  };
  const onTokens = (tokens) => updateJob({ tokens }, tokens === 0);
  let packetCoverage = [];

  try {
    const { data: letter, error: letterErr } = await db.from('letters').select('*').eq('id', job.letter_id).single();
    if (letterErr || !letter) throw new Error('Could not find the saved CCC letter for this job.');
    const priorLetterText = priorLetterPlainText(letter.html, 16000);
    const priorDemands = extractDemandsFromLetterHtml(letter.html);
    const { data: loadedPacketCoverage, error: packetCoverageError } = Number(letter.packet_version || 1) === 2
      ? await db.from('letter_account_coverage')
        .select('id,user_id,client_account_id,coverage_order').eq('letter_id', letter.id).order('coverage_order')
      : { data: [], error: null };
    if (packetCoverageError) throw packetCoverageError;
    packetCoverage = loadedPacketCoverage || [];
    if (Number(letter.packet_version || 1) === 2 && !packetCoverage?.length) throw new Error('Packet response analysis requires account coverage.');
    const packetSuffixes = Number(letter.packet_version || 1) === 2
      ? [...String(letter.html || '').matchAll(/Masked account:\s*([^<\s]+)/gi)].map((match) => match[1])
      : [];
    if (packetCoverage?.length) {
      await db.from('letter_account_coverage').update({
        response_status: 'analyzing', updated_at: new Date().toISOString(),
      }).eq('letter_id', letter.id);
    }
    if (job.kind === 'non_response') {
      const clockStart = letter.delivered_at || mailedDateOverride || letter.mailed_date;
      const computedDue = clockStart
        ? new Date(new Date(clockStart).getTime() + responseWindowDays(letter) * 86400000)
        : null;
      const due = letter.response_due_at ? new Date(letter.response_due_at) : computedDue;
      if (!due || Number.isNaN(due.getTime())) {
        throw new Error('A non-response finding requires a recorded delivery or mailing date and response window.');
      }
      if (Date.now() < due.getTime()) {
        throw new Error(`The recorded response window remains open until ${due.toLocaleDateString('en-US')}.`);
      }
    }
    // Silence is evidence too. Persist an explicit nonresponse record so a
    // later round links the reviewed pair rather than inferring an absence.
    if (job.kind === 'non_response' && !evidence) {
      const { data: row, error: createError } = await db.from('response_evidence').insert({
        firm_user_id: letter.user_id,
        client_id: letter.client_id,
        client_account_id: letter.client_account_id,
        client_name: letter.client_name,
        letter_id: letter.id,
        response_kind: letter.target_type === 'bureau' ? 'bureau' : 'furnisher',
        source: 'staff_nonresponse',
        evidence_kind: 'non_response',
        storage_paths: [],
        file_names: [],
        upload_status: 'received',
        received_at: new Date().toISOString(),
        submitted_by: caller.userId,
        analysis_status: 'running',
      }).select('*').single();
      if (createError || !row) throw new Error('Could not create non-response evidence: ' + (createError?.message || 'unknown error'));
      evidence = row;
      await db.from('phase2_jobs').update({ response_evidence_id: evidence.id }).eq('id', jobId);
    }

    if (evidence) {
      await db.from('response_evidence').update({
        analysis_status: 'running',
        updated_at: new Date().toISOString(),
      }).eq('id', evidence.id);
    }
    if (job.kind === 'bureau_response') {
      await db.from('letters').update({ bureau_response_status: 'analyzing' }).eq('id', job.letter_id);
    }

    let messages;
    if (job.kind === 'non_response') {
      const mailedDate = mailedDateOverride || letter.mailed_date;
      const mailed = mailedDate
        ? new Date(mailedDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : 'unknown date';
      messages = [{
        role: 'user',
        content: [{
          type: 'text',
          text: `Today: ${today()}\nClient: ${letter.client_name}\nFurnisher: ${letter.furnisher}\nAccount: ${letter.account_id || ''}\nLetter mailed: ${mailed}\n\nMAILED CCC DISPUTE LETTER (normalized text; no response was received within the recorded response window):\n${priorLetterText}\n\nClassify this as NON_RESPONSE and perform the same forensic demand-by-demand analysis. Do not call silence an automatic §1681s-2(b) violation; §1681s-2(b) attaches only after CRA notice under §1681i(a)(2). Analyze only. Do not draft a follow-up letter.`,
        }],
      }];
    } else {
      const files = filesForAnalysis || [];
      if (!files.length) throw new Error('No response file attached to this job.');
      const pageBlocks = [];
      let totalResponseBytes = 0;
      for (const f of files) {
        const { data: blob, error: dlErr } = await db.storage.from(evidence?.storage_bucket || 'responses').download(f.path);
        if (dlErr || !blob) throw new Error('Could not read uploaded response (' + (dlErr?.message || 'missing file') + ')');
        const buf = Buffer.from(await blob.arrayBuffer());
        totalResponseBytes += buf.byteLength;
        if (totalResponseBytes > MAX_TOTAL_RESPONSE_BYTES) {
          throw new Error('The response files exceed the 18 MB aggregate analysis limit. Split the response into a smaller upload.');
        }
        const fileName = f.path.split('/').pop();
        const mediaType = inferMediaType(fileName, blob.type);
        if (!isAnalyzable(mediaType)) throw new Error(fileName + ' is not a supported format (PDF, JPG, PNG, WEBP only).');
        if (mediaType === 'application/pdf') {
          const chunks = await splitPdfByPages(buf, { maxPages: RESPONSE_PDF_CHUNK_PAGES, overlap: 1 });
          for (const chunk of chunks) pageBlocks.push(responseFileBlock(chunk.base64, mediaType));
        } else {
          pageBlocks.push(responseFileBlock(buf.toString('base64'), mediaType));
        }
      }
      const pageNote = pageBlocks.length > 1
        ? ` — ${pageBlocks.length} pages/photos of the same response, attached in order. Read them as one continuous document.`
        : ' (attached document):';
      const bureauResponse = job.kind === 'bureau_response';
      messages = [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: bureauResponse
              ? `Today: ${today()}\nExpected sender: ${letter.phase || ''}\n${packetSuffixes.length ? `Packet covered account suffixes: ${packetSuffixes.join(', ')}\nFor every account-related claim, copy the visible account suffix into accountSuffix. Never apply one account's statement to another.\n` : `Related account suffix: ${letter.account_id || ''}\n`}\nBUREAU RESPONSE DOCUMENT${pageNote}`
              : `Today: ${today()}\nExpected sender: ${letter.furnisher}\n${packetSuffixes.length ? `Packet covered account suffixes: ${packetSuffixes.join(', ')}\nFor every account-related claim, copy the visible account suffix into accountSuffix. Never apply one account's statement to another.\n` : `Related account suffix: ${letter.account_id || ''}\n`}\nFURNISHER RESPONSE DOCUMENT${pageNote}`,
          },
          ...pageBlocks,
          { type: 'text', text: 'Extract only the response statements and document-quality facts into the extraction schema. Do not draft correspondence. Deterministic code will classify the response.' },
        ],
      }];
    }

    const isBureauResponse = job.kind === 'bureau_response';
    await updateJob({
      stage: isBureauResponse ? 'Extracting bureau response evidence' : 'Extracting furnisher response evidence',
    }, true);

    // Response review remains detailed. Letter drafting now occurs only after
    // staff disposition and explicit target selection.
    let streamedTokenTotal = 0;
    let modelAttempt = 0;
    const runModel = async (modelMessages, stageLabel) => {
      if (stageLabel) await updateJob({ stage: stageLabel }, true);
      modelAttempt += 1;
      const effort = 'high';
      const params = {
        model: MODEL,
        max_tokens: isBureauResponse ? 12000 : 16000,
        system: RESPONSE_EXTRACTION_SYSTEM,
        messages: modelMessages,
        output_config: {
          effort,
          format: {
            type: 'json_schema',
            schema: RESPONSE_EXTRACTION_SCHEMA,
          },
        },
      };
      await preflightTokenCount(anthropic, params, { operation: 'Response analysis' });
      const startedAt = new Date();
      const stream = anthropic.messages.stream(params);
      let chars = 0;
      stream.on('text', (delta) => {
        chars += delta.length;
        onTokens(streamedTokenTotal + Math.round(chars / 4));
      });
      // Structured-output models can spend several minutes reasoning before
      // emitting the next text delta. Keep updated_at alive independently so
      // the browser never mistakes model silence for a dead Netlify function.
      const heartbeat = setInterval(() => {
        void db.from('phase2_jobs')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', jobId);
      }, 20 * 1000);
      heartbeat.unref?.();
      let msg;
      try {
        msg = await stream.finalMessage();
      } finally {
        clearInterval(heartbeat);
      }
      assertCompletedMessage(msg, 'Response analysis', MODEL);
      streamedTokenTotal += Math.round(chars / 4);
      const usage = usageFromMessage(msg);
      await logClaudeCall(db, {
        userId: letter.user_id,
        operation: isBureauResponse ? 'response.bureau_analysis' : 'response.furnisher_analysis',
        entityType: 'phase2_job',
        entityId: jobId,
        model: MODEL,
        effort,
        promptVersion: 'phase2-v2',
        attempt: modelAttempt,
        status: 'completed',
        startedAt,
        requestId: msg._request_id,
        usage,
        stopReason: msg.stop_reason,
      });
      console.log('[phase2-usage]', JSON.stringify({
        input: usage.input_tokens || 0, output: usage.output_tokens || 0,
        cache_read: usage.cache_read_input_tokens || 0, cache_write: usage.cache_creation_input_tokens || 0,
        stop_reason: msg.stop_reason,
      }));
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      return { parsed: JSON.parse(text), usage };
    };

    let analysis;
    let responseExtraction = null;
    let u = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    if (job.kind === 'non_response') {
      analysis = buildNonResponseAnalysis(priorDemands, {
        mailedDate: mailedDateOverride || letter.mailed_date || null,
        responseDueAt: letter.response_due_at || null,
      });
    } else {
      const extracted = await runModel(messages);
      responseExtraction = extracted.parsed;
      u = extracted.usage;
      await updateJob({ stage: 'Applying deterministic response rules' }, true);
      analysis = isBureauResponse
        ? evaluateBureauResponse(priorDemands, extracted.parsed)
        : evaluateFurnisherResponse(priorDemands, extracted.parsed);
    }

    // Parse-confidence gate (2026-07-23 defect report, P0-1): if the model's
    // own document-quality self-assessment says an enclosure couldn't be
    // reliably read, block this letter from Lob regardless of what the
    // generated HTML says — enforced server-side in lob.cjs, not just a UI
    // warning. documentQuality is a required schema field, but guard
    // against its absence anyway rather than trust that blindly.
    const dq = analysis && analysis.documentQuality;
    const blockIssues = [];
    if (dq && dq.enclosureLegible === false) {
      blockIssues.push(...(dq.issues && dq.issues.length ? dq.issues : ['An enclosed document could not be reliably read.']));
    }

    const parseBlocked = blockIssues.length > 0;
    if (evidence) analysis.responseEvidenceId = evidence.id;

    const analyzedAt = new Date().toISOString();
    if (packetCoverage?.length && evidence) {
      const assessmentRows = packetCoverage.map((coverage) => {
        const result = assessPacketAccount({
          letterHtml: letter.html,
          coverageOrder: coverage.coverage_order,
          responseKind: evidence.response_kind,
          extraction: responseExtraction,
          nonResponse: job.kind === 'non_response',
          metadata: {
            mailedDate: mailedDateOverride || letter.mailed_date || null,
            responseDueAt: letter.response_due_at || null,
          },
        });
        return {
          user_id: coverage.user_id,
          response_evidence_id: evidence.id,
          coverage_id: coverage.id,
          client_account_id: coverage.client_account_id,
          disposition: result.proposedDisposition,
          next_action: result.proposedNextAction,
          cited_pages: result.citedPages,
          analysis: result.analysis,
          review_status: 'not_reviewed',
          updated_at: analyzedAt,
        };
      });
      const { error: assessmentError } = await db.from('response_evidence_account_assessment')
        .upsert(assessmentRows, { onConflict: 'response_evidence_id,coverage_id' });
      if (assessmentError) throw assessmentError;
      await db.from('letter_account_coverage').update({
        response_status: 'review_ready', updated_at: analyzedAt,
      }).eq('letter_id', letter.id);
    }
    if (isBureauResponse) {
      // The full analysis stays private in response_evidence. The linked
      // letter gets only a safe lifecycle status used by staff/dashboard and
      // the client portal; no staff notes or raw model output leak to client.
      await db.from('response_evidence').update({
        analysis,
        analysis_status: 'analyzed',
        analyzed_at: analyzedAt,
        document_quality: dq || null,
        updated_at: analyzedAt,
      }).eq('id', evidence.id);
      await db.from('letters').update({
        bureau_response_status: 'review_ready',
        bureau_response_analyzed_at: analyzedAt,
      }).eq('id', job.letter_id);
    } else {
      // Preserve response evidence for staff review. New correspondence is
      // selected later from the approved CCC template track.
      await db.from('letters').update({
        phase2_analysis: analysis, phase2_analyzed_at: analyzedAt,
        enclosure_parse_blocked: parseBlocked,
        enclosure_parse_issues: blockIssues,
      }).eq('id', job.letter_id);
      if (evidence) {
        await db.from('response_evidence').update({
          analysis,
          analysis_status: 'analyzed',
          analyzed_at: analyzedAt,
          document_quality: dq || null,
          updated_at: analyzedAt,
        }).eq('id', evidence.id);
      }
    }

    await updateJob({
      status: 'done',
      stage: 'Complete',
      tokens: streamedTokenTotal,
      result: analysis,
      usage: u,
      finished_at: new Date().toISOString(),
    }, true);
  } catch (e) {
    console.error('phase2-analyze failed:', e);
    await logClaudeCall(db, {
      userId: caller.userId, operation: 'response.pipeline', entityType: 'phase2_job', entityId: jobId,
      model: MODEL, effort: 'high', promptVersion: 'phase2-v2',
      status: 'error', startedAt: new Date(), errorType: e.name, errorMessage: e.message,
    });
    if (evidence) {
      await db.from('response_evidence').update({
        analysis_status: 'error',
        updated_at: new Date().toISOString(),
      }).eq('id', evidence.id).catch(() => {});
      if (job.kind === 'bureau_response') {
        await db.from('letters').update({ bureau_response_status: 'received' }).eq('id', job.letter_id).catch(() => {});
      }
    }
    if (packetCoverage?.length) {
      await db.from('letter_account_coverage').update({
        response_status: 'received', updated_at: new Date().toISOString(),
      }).eq('letter_id', job.letter_id).catch(() => {});
    }
    await updateJob({ status: 'error', error: e.message || 'Analysis failed', finished_at: new Date().toISOString() }, true);
  }

  return { statusCode: 200, body: 'ok' };
};
