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
import { PHASE2_SCHEMA } from '../../src/utils/auditSchemas.js';
import { inferMediaType, isAnalyzable } from '../../src/utils/responseFiles.js';

const MODEL = 'claude-sonnet-5';
const SYSTEM = [{ type: 'text', text: PHASE2_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];

const today = () => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

function responseFileBlock(base64, mediaType) {
  if (mediaType && mediaType.startsWith('image/')) {
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };
  }
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
}

export const handler = async (event) => {
  let jobId = null, mailedDateOverride = null;
  try {
    const body = JSON.parse(event.body || '{}');
    jobId = body.jobId;
    mailedDateOverride = body.mailedDate || null;
  } catch (e) { /* handled below */ }
  if (!jobId) return { statusCode: 400, body: 'jobId required' };

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

  // Atomic claim — only proceeds if the row exists and is still 'queued'.
  const { data: claimed, error: claimErr } = await db
    .from('phase2_jobs')
    .update({ status: 'running', started_at: new Date().toISOString(), updated_at: new Date().toISOString(), stage: 'Starting analysis', tokens: 0 })
    .eq('id', jobId)
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
          text: `Today: ${today()}\nClient: ${letter.client_name}\nFurnisher: ${letter.furnisher}\nAccount: ${letter.account_id || ''}\nLetter mailed: ${mailed}\n\nEXHIBIT A — PHASE 1 DISPUTE LETTER (no response was received within 30 days):\n${letter.html}\n\nThe furnisher failed to respond within the 30-day statutory window. This is an automatic 15 U.S.C. 1681s-2(b) violation. Classify this as NON_RESPONSE and generate three Phase 3 CRA letters citing the failure to respond.`,
        }],
      }];
    } else {
      const files = job.files || [];
      if (!files.length) throw new Error('No response file attached to this job.');
      const pageBlocks = [];
      for (const f of files) {
        const { data: blob, error: dlErr } = await db.storage.from('responses').download(f.path);
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
      messages = [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Today: ${today()}\nClient: ${letter.client_name}\nFurnisher: ${letter.furnisher}\nAccount: ${letter.account_id || ''}\n\nEXHIBIT A — PHASE 1 DISPUTE LETTER:\n${letter.html}\n\nEXHIBIT B — FURNISHER RESPONSE${pageNote}`,
          },
          ...pageBlocks,
          { type: 'text', text: 'Perform Phase 2 analysis.' },
        ],
      }];
    }

    await updateJob({ stage: 'Analyzing response against Phase 1 demands' }, true);

    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      system: SYSTEM,
      messages,
      output_config: { format: { type: 'json_schema', schema: PHASE2_SCHEMA } },
    });
    let chars = 0;
    stream.on('text', (delta) => { chars += delta.length; onTokens(Math.round(chars / 4)); });
    const msg = await stream.finalMessage();

    const u = msg.usage || {};
    console.log('[phase2-usage]', JSON.stringify({
      input: u.input_tokens || 0, output: u.output_tokens || 0,
      cache_read: u.cache_read_input_tokens || 0, cache_write: u.cache_creation_input_tokens || 0,
      stop_reason: msg.stop_reason,
    }));
    if (msg.stop_reason === 'max_tokens') {
      throw new Error('The analysis hit the output limit before finishing. Try again.');
    }
    if (msg.stop_reason === 'refusal') {
      throw new Error('The model declined this request. Check the response content and try again.');
    }

    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const analysis = JSON.parse(text);

    // Inject standard letter CSS server-side to save AI tokens and prevent truncation
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

    if (analysis && analysis.letters) {
      for (const bureau of ['equifax', 'experian', 'transunion']) {
        if (analysis.letters[bureau]) {
          let html = analysis.letters[bureau];
          if (html.includes('</head>')) {
            html = html.replace('</head>', `<meta charset="UTF-8"><style>${baseCss}</style></head>`);
          } else if (html.includes('<head>')) {
            html = html.replace('<head>', `<head><meta charset="UTF-8"><style>${baseCss}</style>`);
          } else if (html.includes('<body>')) {
            html = html.replace('<body>', `<head><meta charset="UTF-8"><style>${baseCss}</style></head><body>`);
          } else {
            html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${baseCss}</style></head><body>${html}</body></html>`;
          }
          analysis.letters[bureau] = html;
        }
      }
    }

    // Parse-confidence gate (2026-07-23 defect report, P0-1): if the model's
    // own document-quality self-assessment says an enclosure couldn't be
    // reliably read, block this letter from Lob regardless of what the
    // generated HTML says — enforced server-side in lob.cjs, not just a UI
    // warning. documentQuality is a required schema field, but guard
    // against its absence anyway rather than trust that blindly.
    const dq = analysis && analysis.documentQuality;
    const parseBlocked = !!(dq && dq.enclosureLegible === false);

    // Persist onto the letter row so a closed tab loses nothing — same
    // contract as the old client-side persistAnalysis().
    await db.from('letters').update({
      phase2_analysis: analysis, phase2_analyzed_at: new Date().toISOString(),
      enclosure_parse_blocked: parseBlocked,
      enclosure_parse_issues: (dq && dq.issues) || [],
    }).eq('id', job.letter_id);

    await updateJob({ status: 'done', stage: 'Complete', result: analysis, usage: u, finished_at: new Date().toISOString() }, true);
  } catch (e) {
    console.error('phase2-analyze failed:', e);
    await updateJob({ status: 'error', error: e.message || 'Analysis failed', finished_at: new Date().toISOString() }, true);
  }

  return { statusCode: 200, body: 'ok' };
};
