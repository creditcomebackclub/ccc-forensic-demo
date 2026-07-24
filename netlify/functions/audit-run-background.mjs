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
import { MASTER_SYSTEM_PROMPT } from '../../src/prompts/masterPrompt.js';
import { AUDIT_SCHEMA, BUREAU_SCHEMA, ACCOUNT_ENRICHMENT_SCHEMA } from '../../src/utils/auditSchemas.js';
import {
  buildReportContent, combinedAuditPrompt, singleBureauAuditPrompt,
  bureauParsePrompt, mergeAuditPrompt, accountEnrichmentPrompt, todayLong,
} from '../../src/utils/auditPrompts.js';

const MODEL = 'claude-sonnet-5';
const SYSTEM = [{ type: 'text', text: MASTER_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];

// Sonnet 5 intro pricing (per MTok) — valid through 2026-08-31
const PRICE = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };

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

export const handler = async (event) => {
  let jobId = null;
  try { jobId = JSON.parse(event.body || '{}').jobId; } catch (e) { /* handled below */ }
  if (!jobId) return { statusCode: 400, body: 'jobId required' };

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

  // Atomic claim — only proceeds if the row exists and is still 'queued'.
  // Job rows can only be created by authenticated auditors (RLS), so this is
  // also the gate that stops anonymous calls from burning API credits.
  const { data: claimed, error: claimErr } = await db
    .from('audit_jobs')
    .update({ status: 'running', started_at: new Date().toISOString(), updated_at: new Date().toISOString(), stage: 'Starting analysis', pct: null, tokens: 0 })
    .eq('id', jobId)
    .eq('status', 'queued')
    .select();
  if (claimErr || !claimed || claimed.length === 0) {
    console.warn('audit-run: job not claimable', jobId, claimErr?.message);
    return { statusCode: 409, body: 'job not claimable' };
  }
  const job = claimed[0];

  const anthropic = new Anthropic({ apiKey: anthropicKey, maxRetries: 5 });
  const usageLog = [];
  let lastWrite = 0;

  const updateJob = async (patch, force = false) => {
    const now = Date.now();
    if (!force && now - lastWrite < 1200) return; // throttle progress writes
    lastWrite = now;
    await db.from('audit_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', jobId);
  };

  const progress = (stage, pct) => (tokens) =>
    updateJob({ stage, pct, tokens: tokens || 0 }, tokens === 0);

  async function claudeCall(userContent, { maxTokens = 64000, schema = null, onTokens = null } = {}) {
    const params = {
      model: MODEL,
      max_tokens: maxTokens,
      system: SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    };
    if (schema) params.output_config = { format: { type: 'json_schema', schema } };

    const stream = anthropic.messages.stream(params);
    if (onTokens) {
      let chars = 0;
      stream.on('text', (delta) => {
        chars += delta.length;
        onTokens(Math.round(chars / 4)); // ~4 chars/token readout
      });
    }
    const msg = await stream.finalMessage();

    const u = msg.usage || {};
    usageLog.push({
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      cache_read: u.cache_read_input_tokens || 0,
      cache_write: u.cache_creation_input_tokens || 0,
      est_cost_usd: Math.round(usdFor(u) * 10000) / 10000,
      stop_reason: msg.stop_reason,
    });
    console.log('[audit-usage]', JSON.stringify(usageLog[usageLog.length - 1]));

    if (msg.stop_reason === 'max_tokens') {
      throw new Error('The analysis hit the output limit before finishing — the report may be too large for one pass. Try Individual mode with one file per bureau.');
    }
    if (msg.stop_reason === 'refusal') {
      throw new Error('The model declined this request. Check the report content and try again.');
    }
    return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  }

  async function downloadBase64(path) {
    const { data, error } = await db.storage.from('documents').download(path);
    if (error || !data) throw new Error('Could not read uploaded report (' + (error?.message || 'missing file') + ')');
    return Buffer.from(await data.arrayBuffer()).toString('base64');
  }

  // Mirrors client-side saveAudit(): starting-score auto-populate, audits
  // upsert (same slug__date id), and the lead-row upsert — attributed to the
  // job's user so the audit lands in their records even if the tab closed.
  async function saveAuditAs(userId, audit) {
    const clientName = (audit && audit.client && audit.client.name) || 'Unknown Client';
    const clientAddress = (audit && audit.client && audit.client.address) || null;
    const reportDate = (audit && audit.client && audit.client.reportDate) || todayISO();

    try {
      const scores = audit.scores || (audit.client && audit.client.scores);
      if (clientName && scores) {
        const { data: existing } = await db.from('clients')
          .select('score_eq_start,score_exp_start,score_tu_start,date_of_birth,phone')
          .eq('name', clientName).eq('user_id', userId).limit(1);
        const hasScores = existing && existing.length > 0 && (existing[0].score_eq_start || existing[0].score_exp_start || existing[0].score_tu_start);
        if (!hasScores) {
          const eq = scores.equifax || scores.eq || null;
          const exp = scores.experian || scores.exp || null;
          const tu = scores.transunion || scores.tu || null;
          if (eq || exp || tu) {
            const isNewRow = !existing || existing.length === 0;
            await db.from('clients').upsert({
              user_id: userId, name: clientName,
              score_eq_start: eq ? parseInt(eq) : null,
              score_exp_start: exp ? parseInt(exp) : null,
              score_tu_start: tu ? parseInt(tu) : null,
              ...(isNewRow ? { status: 'lead' } : {}),
            }, { onConflict: 'user_id,name' });
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
            await db.from('clients').update(profilePatch).eq('user_id', userId).eq('name', clientName);
            console.log('[audit] auto-populated profile fields:', Object.keys(profilePatch).join(', '));
          }
        }
      }
    } catch (e) { console.warn('score/profile auto-populate failed:', e.message); }

    const { error } = await db.from('audits').upsert({
      id: slug(clientName) + '__' + reportDate,
      user_id: userId,
      created_by: userId,
      client_name: clientName,
      client_address: clientAddress,
      report_date: reportDate,
      saved_at: new Date().toISOString(),
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
  }

  const filePaths = (job.files || []).map((f) => f.path);
  try {
    const t = todayLong();
    const files = job.files || [];
    let audit;

    if (job.mode === 'combined' || job.mode === 'single') {
      const f = files[0];
      if (!f) throw new Error('No report file attached to this job.');
      const stage = job.mode === 'single' ? 'Analyzing ' + (f.bureau || 'bureau') + ' report' : 'Analyzing 3-bureau report';
      await progress(stage, null)(0);
      const b64 = await downloadBase64(f.path);
      const prompt = job.mode === 'single' ? singleBureauAuditPrompt(t, f.bureau) : combinedAuditPrompt(t);
      const raw = await claudeCall(buildReportContent(b64, prompt, f.type), {
        schema: AUDIT_SCHEMA, onTokens: progress(stage, null),
      });
      audit = parseAuditJSON(raw);
    } else if (job.mode === 'individual') {
      const byBureau = {};
      for (const f of files) byBureau[(f.bureau || '').toLowerCase()] = f;
      const parsed = {};
      const stages = [
        ['equifax', 'Analyzing Equifax report', 5],
        ['experian', 'Analyzing Experian report', 30],
        ['transunion', 'Analyzing TransUnion report', 55],
      ];
      for (const [key, stage, pct] of stages) {
        const f = byBureau[key];
        if (!f) throw new Error('Missing ' + key + ' file on this job.');
        await progress(stage, pct)(0);
        const b64 = await downloadBase64(f.path);
        const bureauName = key === 'equifax' ? 'Equifax' : key === 'experian' ? 'Experian' : 'TransUnion';
        const raw = await claudeCall(buildReportContent(b64, bureauParsePrompt(t, bureauName), f.type), {
          schema: BUREAU_SCHEMA, onTokens: progress(stage, pct),
        });
        parsed[key] = parseAuditJSON(raw);
      }
      await progress('Cross-bureau reconciliation & ranking', 80)(0);
      const mergeRaw = await claudeCall(
        [{ type: 'text', text: mergeAuditPrompt(t, parsed.equifax, parsed.experian, parsed.transunion) }],
        { schema: AUDIT_SCHEMA, onTokens: progress('Cross-bureau reconciliation & ranking', 80) },
      );
      audit = parseAuditJSON(mergeRaw);
      if (audit && audit.client) {
        audit.client.scores = audit.client.scores || {};
        if (parsed.equifax?.client?.score) audit.client.scores.equifax = parsed.equifax.client.score;
        if (parsed.experian?.client?.score) audit.client.scores.experian = parsed.experian.client.score;
        if (parsed.transunion?.client?.score) audit.client.scores.transunion = parsed.transunion.client.score;
      }
    } else {
      throw new Error('Unknown audit mode: ' + job.mode);
    }

    if (!audit || !audit.client) throw new Error('Audit produced no client data.');

    // violationsByType is no longer part of the model's structured output
    // (removed to fix the compiled-grammar-too-large 400 that was breaking
    // every audit run) — it's pure duplication of accounts[].violations
    // grouped by field and counted, so it's computed here instead. Same
    // shape AuditResults.jsx already expects; that component needs no change.
    audit.violationsByType = computeViolationsByType(audit.accounts);

    // Retention Build 1a diff-engine fields (payment rating, DOFD, remarks,
    // dispute flag) — didn't fit in AUDIT_SCHEMA's single call, so this is a
    // second, small follow-up call scoped to just those 4 fields per
    // already-identified account. Best-effort: any failure here is caught
    // and swallowed — the audit above is already valid and saved regardless,
    // exactly as if these 4 fields had never been reintroduced.
    await progress('Enriching account details', 90)(0);
    try {
      const enrichmentContent = [];
      for (const f of files) {
        const b64 = await downloadBase64(f.path);
        enrichmentContent.push(buildReportContent(b64, '', f.type)[0]);
      }
      enrichmentContent.push({ type: 'text', text: accountEnrichmentPrompt(t, audit.accounts) });

      const enrichRaw = await claudeCall(enrichmentContent, {
        schema: ACCOUNT_ENRICHMENT_SCHEMA, maxTokens: 4000, onTokens: progress('Enriching account details', 90),
      });
      const enrichment = parseAuditJSON(enrichRaw);
      const byId = new Map((enrichment?.accounts || []).map((e) => [e.id, e]));
      for (const acct of audit.accounts || []) {
        const e = byId.get(acct.id);
        acct.paymentRating = e ? e.paymentRating : null;
        acct.dateOfFirstDelinquency = e ? e.dateOfFirstDelinquency : null;
        acct.remarks = e ? e.remarks : null;
        acct.disputeFlag = e ? !!e.disputeFlag : false;
      }
    } catch (e) {
      console.warn('[audit-enrichment] failed (non-fatal, audit continues without these fields):', e.message);
    }

    await saveAuditAs(job.user_id, audit);

    // Retention Build 1b/1d — fire-and-forget, never awaited and never
    // allowed to affect this job's success. This is the ONLY place that
    // actually needs to trigger it: the client-side saveAudit() in
    // src/utils/storage.js has the same trigger, but nothing in the browser
    // calls that function anymore (the real upload flow is this background
    // job) — so without this, progress-narrative-background.mjs would never
    // fire in production. progress-narrative-background.mjs's own internal
    // check no-ops if this client has fewer than 2 audits, so it's safe to
    // call unconditionally after every save.
    (async () => {
      try {
        const clientName = (audit && audit.client && audit.client.name) || null;
        if (!clientName) return;
        const base = process.env.URL || process.env.DEPLOY_URL || 'https://ccc-forensic-demo.netlify.app';
        await fetch(base + '/.netlify/functions/progress-narrative-background', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + supabaseKey },
          body: JSON.stringify({ clientName, userId: job.user_id }),
        });
      } catch (e) {
        console.warn('[audit] progress-narrative trigger failed (non-fatal):', e.message);
      }
    })();

    const totals = usageLog.reduce((s, u) => ({
      input: s.input + u.input, output: s.output + u.output,
      cache_read: s.cache_read + u.cache_read, cache_write: s.cache_write + u.cache_write,
      est_cost_usd: Math.round((s.est_cost_usd + u.est_cost_usd) * 10000) / 10000,
    }), { input: 0, output: 0, cache_read: 0, cache_write: 0, est_cost_usd: 0 });

    await updateJob({
      status: 'done', stage: 'Complete', pct: 100, result: audit,
      usage: { calls: usageLog, totals }, finished_at: new Date().toISOString(),
    }, true);
  } catch (e) {
    console.error('audit-run failed:', e);
    await updateJob({
      status: 'error', error: e.message || 'Audit failed',
      usage: usageLog.length ? { calls: usageLog } : null,
      finished_at: new Date().toISOString(),
    }, true);
  } finally {
    // Uploaded report files are transient — remove them either way
    if (filePaths.length) {
      await db.storage.from('documents').remove(filePaths).catch(() => {});
    }
  }

  return { statusCode: 200, body: 'ok' };
};
