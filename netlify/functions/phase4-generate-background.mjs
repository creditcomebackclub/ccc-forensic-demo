// Server-side Phase 4 (CFPB/state-AG narrative) generation — Netlify
// BACKGROUND function (15-min limit), mirroring phase2-analyze-background.mjs.
// Holds ANTHROPIC_API_KEY as a server env var; the browser never sees a key.
//
// Contract: an escalations row already exists (status 'draft', created via
// escalations.js's createEscalation — one row per furnisher/bureau target,
// never per-client). The browser inserts a phase4_jobs row referencing it,
// POSTs { jobId } here and polls. This function claims the job atomically,
// gathers the track-specific factual context (Phase 1/Phase 3 letters, the
// matched audit account's violations), runs phase4Prompt.js's narrative
// generation, persists the result onto the escalations row, and marks the
// job done.
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { PHASE4_SYSTEM_PROMPT } from '../../src/prompts/phase4Prompt.js';
import { PHASE4_SCHEMA } from '../../src/utils/auditSchemas.js';
import { requireStaff } from './_requireAuth.cjs';

const MODEL = 'claude-sonnet-5';
const SYSTEM = [{ type: 'text', text: PHASE4_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];

const today = () => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'unknown date';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let caller;
  try {
    caller = await requireStaff(event);
  } catch (e) {
    if (e && e.statusCode) return e;
    console.error('phase4-generate: could not authenticate caller', e);
    return { statusCode: 500, body: 'authentication failed' };
  }

  let jobId = null;
  try {
    const body = JSON.parse(event.body || '{}');
    jobId = body.jobId;
  } catch (e) { /* handled below */ }
  if (typeof jobId !== 'string' || !jobId) return { statusCode: 400, body: 'jobId required' };

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!supabaseUrl || !serviceKey || !anthropicKey) {
    console.error('phase4-generate: missing env (supabase or ANTHROPIC_API_KEY)');
    return { statusCode: 500, body: 'server not configured' };
  }

  // Same WebSocket workaround as audit-run-background.mjs / phase2-analyze-
  // background.mjs — Netlify's Node 20 runtime has no global WebSocket, and
  // supabase-js always constructs a RealtimeClient in createClient() even
  // for pure REST usage.
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  });

  // Validate both the queued job and its target record while the caller's
  // identity is known. An auditor can only generate for their own escalation;
  // an admin retains the existing cross-staff oversight capability.
  const { data: queuedJob, error: queuedJobErr } = await db
    .from('phase4_jobs')
    .select('id, escalation_id')
    .eq('id', jobId)
    .eq('user_id', caller.userId)
    .eq('status', 'queued')
    .maybeSingle();
  if (queuedJobErr || !queuedJob) {
    console.warn('phase4-generate: job not available to caller', jobId, queuedJobErr?.message);
    return { statusCode: 409, body: 'job not claimable' };
  }
  if (typeof queuedJob.escalation_id !== 'string' || !queuedJob.escalation_id) {
    return { statusCode: 400, body: 'job contains invalid escalation data' };
  }
  const { data: targetEscalation, error: targetEscalationErr } = await db
    .from('escalations')
    .select('id, user_id')
    .eq('id', queuedJob.escalation_id)
    .maybeSingle();
  if (targetEscalationErr || !targetEscalation) return { statusCode: 404, body: 'escalation not found' };
  if (caller.role !== 'admin' && targetEscalation.user_id !== caller.userId) {
    return { statusCode: 403, body: 'not authorized for this escalation' };
  }

  const { data: claimed, error: claimErr } = await db
    .from('phase4_jobs')
    .update({ status: 'running', started_at: new Date().toISOString(), updated_at: new Date().toISOString(), stage: 'Starting generation', tokens: 0 })
    .eq('id', jobId)
    .eq('user_id', caller.userId)
    .eq('status', 'queued')
    .select();
  if (claimErr || !claimed || claimed.length === 0) {
    console.warn('phase4-generate: job not claimable', jobId, claimErr?.message);
    return { statusCode: 409, body: 'job not claimable' };
  }
  const job = claimed[0];

  const anthropic = new Anthropic({ apiKey: anthropicKey, maxRetries: 5 });
  let lastWrite = 0;
  const updateJob = async (patch, force = false) => {
    const now = Date.now();
    if (!force && now - lastWrite < 1200) return;
    lastWrite = now;
    await db.from('phase4_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', jobId);
  };
  const onTokens = (tokens) => updateJob({ tokens }, tokens === 0);

  try {
    const { data: esc, error: escErr } = await db.from('escalations').select('*').eq('id', job.escalation_id).single();
    if (escErr || !esc) throw new Error('Could not find the escalation row for this job.');

    const { data: client } = await db.from('clients').select('name, address').eq('id', esc.client_id).limit(1).single();
    const clientName = client?.name || 'Unknown Client';
    const clientAddress = client?.address || 'address on file';

    await updateJob({ stage: 'Gathering dispute history' }, true);

    // Track-specific factual gathering. Every fact handed to the model must
    // trace to real rows — the prompt explicitly forbids inventing facts,
    // so this function's job is to hand it everything it needs and nothing
    // it doesn't.
    let contextText = `Today: ${today()}\nClient: ${clientName}\nClient address: ${clientAddress}\nTarget (${esc.track === 'bureau' ? 'credit reporting agency' : 'furnisher'}): ${esc.furnisher_name}\n\n`;

    if (esc.track === 'furnisher') {
      // Phase 1 (direct-to-furnisher) letters for this furnisher.
      const { data: phase1Letters } = await db.from('letters')
        .select('id, html, mailed_date, response_outcome, response_date, phase')
        .eq('client_id', esc.client_id)
        .eq('furnisher', esc.furnisher_name)
        .ilike('phase', 'Phase 1%')
        .order('saved_at', { ascending: true });
      if (phase1Letters && phase1Letters.length > 0) {
        contextText += `PHASE 1 — DIRECT-TO-FURNISHER DISPUTE(S):\n`;
        for (const l of phase1Letters) {
          contextText += `- Mailed ${fmtDate(l.mailed_date)}. Outcome: ${l.response_outcome || 'no outcome logged'}${l.response_date ? ' (' + fmtDate(l.response_date) + ')' : ''}.\n`;
        }
      } else {
        contextText += `PHASE 1: no direct-to-furnisher letter found on file for this furnisher — flag this in keyFacts rather than assuming one existed.\n`;
      }

      // Phase 3 (bureau) letters that covered this furnisher — via the
      // escalation's own phase3_letter_id when set, else by coveredFurnishers
      // matching this furnisher on any Phase 3 row for this client.
      const { data: phase3Letters } = await db.from('letters')
        .select('id, furnisher, html, mailed_date, response_outcome, response_date, delivered_at')
        .eq('client_id', esc.client_id)
        .ilike('phase', 'Phase 3%');
      const relevantPhase3 = (phase3Letters || []).filter((l) => l.id === esc.phase3_letter_id);
      contextText += `\nPHASE 3 — BUREAU ESCALATION(S) THAT ALSO FAILED TO PRODUCE A RESULT:\n`;
      if (relevantPhase3.length > 0) {
        for (const l of relevantPhase3) {
          contextText += `- ${l.furnisher} (bureau), mailed ${fmtDate(l.mailed_date)}, delivered ${fmtDate(l.delivered_at)}. Outcome: ${l.response_outcome || 'no outcome logged'}.\n`;
        }
      } else {
        contextText += `- (none specifically linked — describe the escalation to bureaus generally based on the furnisher-level facts above)\n`;
      }
    } else {
      // bureau track: the one Phase 3 letter this escalation is about.
      const { data: p3 } = await db.from('letters')
        .select('id, furnisher, html, mailed_date, delivered_at, response_outcome, response_date')
        .eq('id', esc.phase3_letter_id)
        .limit(1).single();
      if (!p3) throw new Error('Could not find the Phase 3 (bureau) letter this escalation is about.');
      contextText += `PHASE 3 — BUREAU DISPUTE (this complaint is about the bureau's OWN reinvestigation, not the underlying furnisher):\n`;
      contextText += `- ${p3.furnisher}, mailed ${fmtDate(p3.mailed_date)}, delivered (dispute received by bureau) ${fmtDate(p3.delivered_at)}.\n`;
      contextText += `- Outcome: ${p3.response_outcome || 'no response received'}${p3.response_date ? ' on ' + fmtDate(p3.response_date) : ''}.\n`;
      contextText += `- This satisfies the §1681i(a)&(e) prerequisite (45 days elapsed, or the dispute is no longer pending) — the calling application already verified this before creating this escalation; state the actual dates above, do not re-derive eligibility.\n`;
    }

    // Underlying violation facts, when a stable tradeline identity is on
    // hand — pulls from the latest audit rather than trusting any single
    // letter's HTML to still reflect the current facts.
    if (esc.client_account_id) {
      const { data: audits } = await db.from('audits')
        .select('audit')
        .eq('client_id', esc.client_id)
        .order('saved_at', { ascending: false })
        .limit(1);
      const accounts = (audits && audits.length > 0) ? (audits[0].audit?.accounts || []) : [];
      const account = accounts.find((a) => a.clientAccountId === esc.client_account_id);
      if (account) {
        contextText += `\nUNDERLYING TRADELINE (latest audit):\nFurnisher: ${account.furnisher}\nBalance: ${account.balance}\nStatus: ${account.status}\nPrimary violation: ${account.primaryViolation || 'see violations list'}\nViolations:\n`;
        for (const v of (account.violations || [])) {
          contextText += `- ${v.field}: ${v.issue} (currently reports "${v.currentlyReports}", should report "${v.shouldReport}") — ${v.statute}\n`;
        }
      }
    }

    contextText += `\nGenerate the Phase 4 escalation narrative per your system instructions.`;

    await updateJob({ stage: 'Drafting CFPB/AG narrative' }, true);

    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'text', text: contextText }] }],
      output_config: { format: { type: 'json_schema', schema: PHASE4_SCHEMA } },
    });
    let chars = 0;
    stream.on('text', (delta) => { chars += delta.length; onTokens(Math.round(chars / 4)); });
    const msg = await stream.finalMessage();

    const u = msg.usage || {};
    console.log('[phase4-usage]', JSON.stringify({
      input: u.input_tokens || 0, output: u.output_tokens || 0,
      cache_read: u.cache_read_input_tokens || 0, cache_write: u.cache_creation_input_tokens || 0,
      stop_reason: msg.stop_reason,
    }));
    if (msg.stop_reason === 'max_tokens') {
      throw new Error('The narrative hit the output limit before finishing. Try again.');
    }
    if (msg.stop_reason === 'refusal') {
      throw new Error('The model declined this request. Check the input content and try again.');
    }

    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const result = JSON.parse(text);

    // Persist onto the escalation row so a closed tab loses nothing — same
    // contract as Phase 2's persistAnalysis-onto-the-letter-row pattern.
    await db.from('escalations').update({
      cfpb_category: result.cfpbCategory,
      cfpb_sub_issue: result.cfpbSubIssue,
      narrative: result.cfpbNarrative,
      ag_narrative: result.agNarrative,
      key_facts: result.keyFacts || [],
      recommended_attachments: result.recommendedAttachments || [],
      status: 'ready',
      updated_at: new Date().toISOString(),
    }).eq('id', job.escalation_id);

    await updateJob({ status: 'done', stage: 'Complete', result, usage: u, finished_at: new Date().toISOString() }, true);
  } catch (e) {
    console.error('phase4-generate failed:', e);
    await updateJob({ status: 'error', error: e.message || 'Generation failed', finished_at: new Date().toISOString() }, true);
  }

  return { statusCode: 200, body: 'ok' };
};
