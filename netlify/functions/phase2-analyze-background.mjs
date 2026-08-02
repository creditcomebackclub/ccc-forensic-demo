// Server-side Phase 2 (furnisher response) analysis — Netlify BACKGROUND
// function (15-min limit), mirroring audit-run-background.mjs. Holds
// ANTHROPIC_API_KEY as a server env var; the browser never sees a key.
//
// Contract: response file(s) already live in the `responses` storage bucket
// (uploaded by the client portal or the admin UI). The browser inserts a
// phase2_jobs row (status 'queued') referencing those paths, then POSTs
// { jobId, mailedDate } here and polls the row. This function claims the
// job atomically, loads the Phase 1 letter, runs the same analysis prompt/
// schema the old browser pipeline used, writes progress to the row, persists
// the result onto the letters row (so a closed tab loses nothing), and
// marks the job done.
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { PHASE2_SYSTEM_PROMPT } from '../../src/prompts/phase2Prompt.js';
import { BUREAU_RESPONSE_SYSTEM_PROMPT } from '../../src/prompts/bureauResponsePrompt.js';
import { BUREAU_FOLLOW_UP_SYSTEM_PROMPT } from '../../src/prompts/bureauFollowUpPrompt.js';
import { BUREAU_FOLLOW_UP_SCHEMA, BUREAU_RESPONSE_SCHEMA, PHASE2_SCHEMA } from '../../src/utils/auditSchemas.js';
import { inferMediaType, isAnalyzable } from '../../src/utils/responseFiles.js';
import {
  assertMapFullySourced,
  collectBureauFollowUpProblems,
  collectPhase3CitationProblems,
} from '../../src/constants/metro2Fields.js';
import { requireStaff } from './_requireAuth.cjs';

assertMapFullySourced();

const MODEL = 'claude-sonnet-5';
const FURNISHER_SYSTEM = [{ type: 'text', text: PHASE2_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];
const BUREAU_SYSTEM = [{ type: 'text', text: BUREAU_RESPONSE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];
const BUREAU_FOLLOW_UP_SYSTEM = [{ type: 'text', text: BUREAU_FOLLOW_UP_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];

const PHASE2_KINDS = ['response', 'non_response', 'bureau_response', 'bureau_follow_up'];

function bureauFromPhase(phase) {
  const p = String(phase || '').toLowerCase();
  if (p.includes('equifax')) return 'equifax';
  if (p.includes('experian')) return 'experian';
  if (p.includes('transunion') || p.includes('trans union')) return 'transunion';
  return null;
}

function injectLetterCss(html, baseCss) {
  if (!html) return html;
  if (html.includes('</head>')) {
    return html.replace('</head>', `<meta charset="UTF-8"><style>${baseCss}</style></head>`);
  }
  if (html.includes('<head>')) {
    return html.replace('<head>', `<head><meta charset="UTF-8"><style>${baseCss}</style>`);
  }
  if (html.includes('<body>')) {
    return html.replace('<body>', `<head><meta charset="UTF-8"><style>${baseCss}</style></head><body>`);
  }
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${baseCss}</style></head><body>${html}</body></html>`;
}

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
  const prefix = `${evidence.firm_user_id}/response-evidence/${evidence.id}/`;
  return path.startsWith(prefix) && path.length > prefix.length;
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
  if (!supabaseUrl || !serviceKey || !anthropicKey) {
    console.error('phase2-analyze: missing env (supabase or ANTHROPIC_API_KEY)');
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
  if (typeof queuedJob.letter_id !== 'string' || !queuedJob.letter_id
      || !PHASE2_KINDS.includes(queuedJob.kind)) {
    return { statusCode: 400, body: 'job contains invalid analysis data' };
  }
  const responseFiles = Array.isArray(queuedJob.files) ? queuedJob.files : [];
  if ((queuedJob.kind === 'non_response' && responseFiles.length)
      || ((queuedJob.kind === 'bureau_response' || queuedJob.kind === 'bureau_follow_up') && !queuedJob.response_evidence_id)
      || (queuedJob.kind === 'response' && !queuedJob.response_evidence_id
          && (!responseFiles.length || !responseFiles.every((file) => isResponsePathForLetter(file?.path, queuedJob.letter_id))))) {
    return { statusCode: 400, body: 'job contains invalid response upload paths' };
  }

  const { data: targetLetter, error: targetLetterErr } = await db
    .from('letters')
    .select('id, user_id, client_id')
    .eq('id', queuedJob.letter_id)
    .maybeSingle();
  if (targetLetterErr || !targetLetter) return { statusCode: 404, body: 'letter not found' };
  if (caller.role !== 'admin' && targetLetter.user_id !== caller.userId) {
    return { statusCode: 403, body: 'not authorized for this letter' };
  }

  // New uploads are bound to an immutable evidence row before a service-role
  // function reads them. This closes the old path-injection shape where a
  // browser-created job could point a paid model call at another file.
  let evidence = null;
  let filesForAnalysis = responseFiles;
  if (queuedJob.response_evidence_id) {
    const { data: evidenceRow, error: evidenceErr } = await db
      .from('response_evidence')
      .select('id,firm_user_id,client_id,letter_id,response_kind,storage_bucket,storage_paths,upload_status,analysis,analysis_status')
      .eq('id', queuedJob.response_evidence_id)
      .maybeSingle();
    if (evidenceErr || !evidenceRow) return { statusCode: 400, body: 'response evidence not found' };

    const expectedKind = (queuedJob.kind === 'bureau_response' || queuedJob.kind === 'bureau_follow_up')
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
    if (queuedJob.kind === 'bureau_follow_up') {
      if (evidenceRow.analysis_status !== 'analyzed' || !evidenceRow.analysis) {
        return { statusCode: 400, body: 'bureau response must be analyzed before follow-up letter generation' };
      }
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

  const anthropic = new Anthropic({ apiKey: anthropicKey, maxRetries: 5 });
  let lastWrite = 0;
  const updateJob = async (patch, force = false) => {
    const now = Date.now();
    if (!force && now - lastWrite < 1200) return; // throttle progress writes
    lastWrite = now;
    await db.from('phase2_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', jobId);
  };
  const onTokens = (tokens) => updateJob({ tokens }, tokens === 0);

  try {
    const { data: letter, error: letterErr } = await db.from('letters').select('*').eq('id', job.letter_id).single();
    if (letterErr || !letter) throw new Error('Could not find the Phase 1 letter for this job.');

    // Follow-up drafts reuse an already-analyzed evidence row. Do not flip
    // analysis_status to running/error — that would clobber the prior review.
    if (evidence && job.kind !== 'bureau_follow_up') {
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
          text: `Today: ${today()}\nClient: ${letter.client_name}\nFurnisher: ${letter.furnisher}\nAccount: ${letter.account_id || ''}\nLetter mailed: ${mailed}\n\nEXHIBIT A — PHASE 1 DISPUTE LETTER (no response was received within 30 days):\n${letter.html}\n\nThe furnisher failed to respond to the direct dispute within 30 days. IMPORTANT LEGAL FRAMING: this non-response is a failure of the furnisher's direct-dispute investigation duties under 12 CFR §1022.43(e) — it is NOT itself a §1681s-2(b) violation, because §1681s-2(b) duties only attach after the furnisher receives CRA notice under §1681i(a)(2), which is exactly what these Phase 3 letters now initiate. Frame it correctly: the documented non-response is powerful Johnson v. MBNA evidence of what this furnisher's "investigation" looks like, and once the bureau forwards this dispute, the furnisher's §1681s-2(b) duties attach against that record. Classify this as NON_RESPONSE and generate three Phase 3 CRA letters on that framing.`,
        }],
      }];
    } else {
      const files = filesForAnalysis || [];
      if (!files.length) throw new Error('No response file attached to this job.');
      const pageBlocks = [];
      for (const f of files) {
        const { data: blob, error: dlErr } = await db.storage.from(evidence?.storage_bucket || 'responses').download(f.path);
        if (dlErr || !blob) throw new Error('Could not read uploaded response (' + (dlErr?.message || 'missing file') + ')');
        const buf = Buffer.from(await blob.arrayBuffer());
        const fileName = f.path.split('/').pop();
        const mediaType = inferMediaType(fileName, blob.type);
        if (!isAnalyzable(mediaType)) throw new Error(fileName + ' is not a supported format (PDF, JPG, PNG, WEBP only).');
        pageBlocks.push(responseFileBlock(buf.toString('base64'), mediaType));
      }
      const pageNote = pageBlocks.length > 1
        ? ` — ${pageBlocks.length} pages/photos of the same response, attached in order. Read them as one continuous document.`
        : ' (attached document):';
      if (job.kind === 'bureau_follow_up') {
        const expectedBureau = bureauFromPhase(letter.phase);
        if (!expectedBureau) throw new Error('Could not determine bureau from Phase 3 letter phase.');
        const prior = evidence?.analysis || {};
        messages = [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Today: ${today()}\nClient: ${letter.client_name}\nBureau target (must match output.bureau): ${expectedBureau}\nPhase label: ${letter.phase || ''}\nRelated furnisher: ${letter.furnisher}\nAccount: ${letter.account_id || ''}\n\nPRIOR BUREAU-RESPONSE ANALYSIS (JSON — staff already reviewed; continue bureau path):\n${JSON.stringify(prior, null, 2)}\n\nEXHIBIT A — ORIGINAL PHASE 3 BUREAU DISPUTE LETTER:\n${letter.html}\n\nEXHIBIT B — BUREAU RESPONSE${pageNote}`,
            },
            ...pageBlocks,
            {
              type: 'text',
              text: `Draft the supplemental Phase 3 follow-up letter to ${expectedBureau}. Output bureau must be "${expectedBureau}". Correct unsupported premises from the prior letter/analysis instead of copying them. HARD RULES for letterHtml: no "1681s-2(a)"; Johnson governs the furnisher's §1681s-2(b) investigation, not the CRA; Seamans is limited to supported dispute-status issues; Field 19 is Special Comment and Field 20 is Compliance Condition Code; Field 23 is Original Charge-off Amount and Field 27 is Date of Last Payment; Field 18 is a rolling 24-month profile; Status 97 may carry a balance/past due; balance equaling past due is not a violation by itself; post-closure C/O entries are not wrong solely because the account is closed; a returned payment date alone is not DOFD; do not state that a CRA must produce UDF/source documents or confirm transaction-level records reviewed — request only the §1681i(a)(6)(B)(iii)/(a)(7) procedure description. Enclosures must be exactly Exhibit A prior Phase 3, Exhibit B bureau response, Exhibit C LPOA.`,
            },
          ],
        }];
      } else {
        const bureauResponse = job.kind === 'bureau_response';
        messages = [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: bureauResponse
                ? `Today: ${today()}\nClient: ${letter.client_name}\nBureau target: ${letter.phase || ''}\nRelated furnisher: ${letter.furnisher}\nAccount: ${letter.account_id || ''}\n\nEXHIBIT A — PHASE 3 BUREAU DISPUTE LETTER:\n${letter.html}\n\nEXHIBIT B — BUREAU RESPONSE${pageNote}`
                : `Today: ${today()}\nClient: ${letter.client_name}\nFurnisher: ${letter.furnisher}\nAccount: ${letter.account_id || ''}\n\nEXHIBIT A — PHASE 1 DISPUTE LETTER:\n${letter.html}\n\nEXHIBIT B — FURNISHER RESPONSE${pageNote}`,
            },
            ...pageBlocks,
            { type: 'text', text: bureauResponse ? 'Perform the bureau-response staff review analysis.' : 'Perform Phase 2 analysis.' },
          ],
        }];
      }
    }

    const isBureauResponse = job.kind === 'bureau_response';
    const isBureauFollowUp = job.kind === 'bureau_follow_up';
    await updateJob({
      stage: isBureauFollowUp
        ? 'Drafting bureau follow-up letter'
        : (isBureauResponse ? 'Analyzing bureau response against Phase 3 dispute' : 'Analyzing response against Phase 1 demands'),
    }, true);

    // 64000 (matches audit-run-background). 32000 was fine while ledgers
    // came back illegible and analyses stayed thin, but a legible enclosure
    // produces a much richer analysis plus three full Phase 3 letters and
    // hit the cap mid-generation (stop_reason: max_tokens). The three-letter
    // output is itself the main cost — the schema requires equifax,
    // experian and transunion even when the account reports to only one
    // bureau; a future optimization is to generate only the bureaus the
    // account is actually on.
    let streamedTokenTotal = 0;
    const runModel = async (modelMessages, stageLabel) => {
      if (stageLabel) await updateJob({ stage: stageLabel }, true);
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: isBureauFollowUp ? 24000 : (isBureauResponse ? 12000 : 64000),
        system: isBureauFollowUp ? BUREAU_FOLLOW_UP_SYSTEM : (isBureauResponse ? BUREAU_SYSTEM : FURNISHER_SYSTEM),
        messages: modelMessages,
        output_config: {
          format: {
            type: 'json_schema',
            schema: isBureauFollowUp
              ? BUREAU_FOLLOW_UP_SCHEMA
              : (isBureauResponse ? BUREAU_RESPONSE_SCHEMA : PHASE2_SCHEMA),
          },
        },
      });
      let chars = 0;
      stream.on('text', (delta) => {
        chars += delta.length;
        onTokens(streamedTokenTotal + Math.round(chars / 4));
      });
      const msg = await stream.finalMessage();
      streamedTokenTotal += Math.round(chars / 4);
      const usage = msg.usage || {};
      console.log('[phase2-usage]', JSON.stringify({
        input: usage.input_tokens || 0, output: usage.output_tokens || 0,
        cache_read: usage.cache_read_input_tokens || 0, cache_write: usage.cache_creation_input_tokens || 0,
        stop_reason: msg.stop_reason,
      }));
      if (msg.stop_reason === 'max_tokens') {
        throw new Error('The analysis hit the output limit before finishing. Try again.');
      }
      if (msg.stop_reason === 'refusal') {
        throw new Error('The model declined this request. Check the response content and try again.');
      }
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      return { parsed: JSON.parse(text), usage };
    };

    let { parsed: analysis, usage: u } = await runModel(messages);
    // One automatic rebuild if the follow-up fails production-safety lint.
    // Prompt hardening alone is not enough when Exhibit A / analysis JSON
    // still contain old citations, unsupported premises, or enclosure labels.
    if (isBureauFollowUp && analysis?.letterHtml) {
      const citationProblems = collectBureauFollowUpProblems(analysis.letterHtml);
      if (citationProblems.length) {
        console.warn('[phase2] bureau_follow_up production lint failed; requesting one rewrite', citationProblems);
        const rewriteMessages = [
          ...messages,
          {
            role: 'user',
            content: [{
              type: 'text',
              text: `CRITICAL CORRECTION: The draft letterHtml failed production-safety lint. Return a complete corrected JSON object for this follow-up. Fix EVERY issue below — do not leave any of them in letterHtml. Keep only supported focus issues. Do not mention that a correction was required.\n\nLINT FAILURES:\n- ${citationProblems.join('\n- ')}\n\nREMINDERS:\n- Never cite "1681s-2(a)"; use CRA duties under §1681i and describe the furnisher's separate §1681s-2(b) duty accurately.\n- Field 19 = Special Comment; Field 20 = Compliance Condition Code; Field 23 = Original Charge-off Amount; Field 27 = Date of Last Payment.\n- Status 97 may carry a balance/past due; equality of those figures is not a violation by itself.\n- Field 18 is rolling 24 months. Do not challenge C/O after closure solely because it follows closure.\n- A returned payment date alone is not DOFD.\n- Request the §1681i(a)(6)(B)(iii)/(a)(7) procedure description; do not claim a right to UDF/source documents or transaction-level-record review confirmation.\n- Enclosures: Exhibit A prior Phase 3; Exhibit B bureau response; Exhibit C LPOA. No Phase 1/furnisher response/ID/address.\n\nBAD DRAFT letterHtml:\n${analysis.letterHtml}`,
            }],
          },
        ];
        const rebuilt = await runModel(rewriteMessages, 'Rewriting follow-up to fix citation lint');
        analysis = rebuilt.parsed;
        u = {
          input_tokens: (u.input_tokens || 0) + (rebuilt.usage.input_tokens || 0),
          output_tokens: (u.output_tokens || 0) + (rebuilt.usage.output_tokens || 0),
          cache_read_input_tokens: (u.cache_read_input_tokens || 0) + (rebuilt.usage.cache_read_input_tokens || 0),
          cache_creation_input_tokens: (u.cache_creation_input_tokens || 0) + (rebuilt.usage.cache_creation_input_tokens || 0),
        };
      }
    }

    // Inject standard letter CSS only for the furnisher workflow, which is
    // the one that generates Phase 3 letters. Bureau analysis records facts
    // and a staff recommendation; it never drafts another letter.
    const baseCss = `
      body { font-family: Arial, sans-serif; line-height: 1.5; margin: 1in; color: #333333; }
      .date-line { margin-bottom: 20px; }
      .sender-block { margin-bottom: 20px; line-height: 1.3; }
      .recipient-block { margin-bottom: 20px; line-height: 1.3; }
      .re-line { font-weight: bold; margin-bottom: 20px; }
      .section-header { background-color: #1B2A4A; color: #ffffff; font-weight: bold; padding: 6px 10px; margin-top: 20px; margin-bottom: 10px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
      .id-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
      .id-table td { padding: 8px 12px; border: 1px solid #E5E7EB; font-size: 13px; }
      .id-table td.label { font-weight: bold; background-color: #F9FAFB; width: 30%; }
      .list-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
      .list-table th, .list-table td { padding: 8px 12px; border: 1px solid #E5E7EB; font-size: 13px; text-align: left; }
      .list-table th { background-color: #1B2A4A; color: #ffffff; font-weight: bold; }
      .demands-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
      .demands-table td { padding: 8px 12px; border: 1px solid #E5E7EB; font-size: 13px; vertical-align: top; }
      .demands-table td.demand-num { background-color: #1B2A4A; color: #ffffff; font-weight: bold; text-align: center; width: 30px; border-radius: 3px; }
      .closing-statement { font-weight: bold; margin-top: 20px; margin-bottom: 20px; }
      .signature-block { margin-top: 50px; }
      .signature-block img { max-height: 60px; display: block; margin-bottom: 6px; }
      .sig-line { margin-top: 40px; border-top: 1px solid #000; width: 250px; }
      .printed-name { margin-top: 6px; font-weight: bold; }
      .mail-notation { margin-top: 30px; font-style: italic; }
      .enclosures { margin-top: 14px; }
    `;

    if (!isBureauResponse && !isBureauFollowUp && analysis && analysis.letters) {
      for (const bureau of ['equifax', 'experian', 'transunion']) {
        if (analysis.letters[bureau]) {
          analysis.letters[bureau] = injectLetterCss(analysis.letters[bureau], baseCss);
        }
      }
    }
    if (isBureauFollowUp && analysis?.letterHtml) {
      analysis.letterHtml = injectLetterCss(analysis.letterHtml, baseCss);
      const expectedBureau = bureauFromPhase(letter.phase);
      if (expectedBureau && analysis.bureau && analysis.bureau !== expectedBureau) {
        analysis.bureau = expectedBureau;
      }
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

    // Production-safety lint: citation, substantive, and enclosure failures.
    if (!isBureauResponse) {
      if (isBureauFollowUp) {
        const html = analysis && analysis.letterHtml;
        const bureau = (analysis && analysis.bureau) || bureauFromPhase(letter.phase) || 'bureau';
        for (const p of collectBureauFollowUpProblems(html)) {
          blockIssues.push(`The generated ${bureau} follow-up letter failed production-safety lint: ${p}`);
        }
      } else {
        for (const bureau of ['equifax', 'experian', 'transunion']) {
          const html = analysis && analysis.letters && analysis.letters[bureau];
          for (const p of collectPhase3CitationProblems(html)) {
            blockIssues.push(`The generated ${bureau} letter failed production-safety lint: ${p}`);
          }
        }
      }
    }
    const parseBlocked = blockIssues.length > 0;
    if (isBureauFollowUp) {
      analysis.enclosure_parse_blocked = parseBlocked;
      analysis.enclosure_parse_issues = blockIssues;
      analysis.source_letter_id = letter.id;
      analysis.source_evidence_id = evidence?.id || null;
    }

    const analyzedAt = new Date().toISOString();
    if (isBureauFollowUp) {
      // Follow-up draft lives on the job result for the client to saveLetter.
      // Do not overwrite the prior bureau-response analysis on evidence.
      await db.from('letters').update({
        bureau_next_action: 'bureau_follow_up',
        bureau_review_status: 'follow_up',
        bureau_response_status: 'reviewed',
      }).eq('id', job.letter_id);
    } else if (isBureauResponse) {
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
      // Preserve the established Phase 2 contract for legacy UI and Phase 3
      // generation, while also attaching the immutable evidence record when
      // this analysis came through the new intake path.
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
    if (evidence && job.kind !== 'bureau_follow_up') {
      await db.from('response_evidence').update({
        analysis_status: 'error',
        updated_at: new Date().toISOString(),
      }).eq('id', evidence.id).catch(() => {});
      if (job.kind === 'bureau_response') {
        await db.from('letters').update({ bureau_response_status: 'received' }).eq('id', job.letter_id).catch(() => {});
      }
    }
    await updateJob({ status: 'error', error: e.message || 'Analysis failed', finished_at: new Date().toISOString() }, true);
  }

  return { statusCode: 200, body: 'ok' };
};
