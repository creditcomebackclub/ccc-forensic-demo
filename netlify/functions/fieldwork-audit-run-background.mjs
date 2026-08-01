/**
 * Fieldwork live audit — Netlify BACKGROUND function (up to 15 min).
 * Sync fieldwork-audit-run only enqueues; this does the Anthropic work.
 *
 * POST JSON: { jobId, base64, mediaType?, fileName?, mode? }
 * Writes result into fieldwork_audit_jobs (service role).
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { MASTER_SYSTEM_PROMPT } from '../../src/prompts/masterPrompt.js';
import { AUDIT_SCHEMA } from '../../src/utils/auditSchemas.js';
import {
  buildReportContent,
  combinedAuditPrompt,
  singleBureauAuditPrompt,
  todayLong,
} from '../../src/utils/auditPrompts.js';
import {
  applyDofdDirectionalGuard,
  applyCollectionBalanceGuard,
} from './_fieldworkGuards.mjs';
import { adaptCccAuditToFieldwork } from '../../src/diy/adapters/auditAdapter.js';

const AUDIT_MODEL = 'claude-sonnet-5';
const SYSTEM = [{ type: 'text', text: MASTER_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];

function parseAuditJSON(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch { /* fall through */ }
  }
  const obj = text.match(/\{[\s\S]*\}/);
  if (obj) {
    try { return JSON.parse(obj[0]); } catch { /* fall through */ }
  }
  throw new Error('Could not parse JSON from audit response');
}

function assertAuditOutput(audit) {
  if (!audit || typeof audit !== 'object' || !Array.isArray(audit.accounts)) {
    throw new Error('Audit returned invalid JSON');
  }
  return audit;
}

function fwAdmin() {
  const url = process.env.FIELDWORK_SUPABASE_URL;
  const key = process.env.FIELDWORK_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('FIELDWORK_SUPABASE_* service credentials missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function patchJob(admin, jobId, patch) {
  const { error } = await admin
    .from('fieldwork_audit_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) throw error;
}

export const handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let payload;
  try {
    let raw = event.body || '{}';
    if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
    payload = JSON.parse(raw);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const jobId = payload.jobId;
  const base64 = payload.base64;
  if (!jobId || !base64) {
    return { statusCode: 400, body: 'jobId and base64 required' };
  }

  const anthropicKey = process.env.FIELDWORK_ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return { statusCode: 503, body: 'FIELDWORK_ANTHROPIC_API_KEY not configured' };
  }

  const admin = fwAdmin();
  const mediaType = payload.mediaType || 'application/pdf';
  const mode = payload.mode === 'single' ? 'single' : 'combined';
  const bureau = payload.bureau || 'Experian';
  const fileName = payload.fileName || 'credit-report.pdf';
  const t = todayLong();

  try {
    await patchJob(admin, jobId, { status: 'running', progress: 'Starting forensic audit…', error: null });

    const anthropic = new Anthropic({
      apiKey: anthropicKey,
      maxRetries: 2,
      timeout: 8 * 60 * 1000,
    });

    await patchJob(admin, jobId, { progress: 'Reading report with Claude…' });

    const prompt = mode === 'single'
      ? singleBureauAuditPrompt(t, bureau)
      : combinedAuditPrompt(t);

    const content = buildReportContent(base64, prompt, mediaType);
    const stream = anthropic.messages.stream({
      model: AUDIT_MODEL,
      max_tokens: 64000,
      system: SYSTEM,
      messages: [{ role: 'user', content }],
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: AUDIT_SCHEMA },
      },
    });

    const final = await stream.finalMessage();
    const text = (final.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    await patchJob(admin, jobId, { progress: 'Adapting findings for Fieldwork…' });

    const cccAudit = assertAuditOutput(parseAuditJSON(text));
    applyDofdDirectionalGuard(cccAudit.accounts);
    applyCollectionBalanceGuard(cccAudit.accounts);

    const audit = adaptCccAuditToFieldwork(cccAudit, {
      reportSource: fileName,
      generatedAt: new Date().toISOString(),
    });

    await patchJob(admin, jobId, {
      status: 'done',
      progress: 'Audit complete',
      result_json: audit,
      error: null,
    });

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('fieldwork-audit-run-background failed', err);
    try {
      await patchJob(admin, jobId, {
        status: 'error',
        progress: null,
        error: err.message || 'Audit failed',
      });
    } catch (patchErr) {
      console.error('failed to patch job error state', patchErr);
    }
    return { statusCode: 500, body: err.message || 'Audit failed' };
  }
};
