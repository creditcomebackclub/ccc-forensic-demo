/**
 * Shared Fieldwork audit engine (Anthropic → Fieldwork UI model).
 */
import Anthropic from '@anthropic-ai/sdk';
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

export async function runFieldworkAuditEngine({
  base64,
  mediaType = 'application/pdf',
  fileName = 'credit-report.pdf',
  mode = 'combined',
  bureau = 'Experian',
  onProgress,
}) {
  const anthropicKey = process.env.FIELDWORK_ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    const err = new Error('FIELDWORK_ANTHROPIC_API_KEY not configured');
    err.statusCode = 503;
    throw err;
  }

  const t = todayLong();
  const anthropic = new Anthropic({
    apiKey: anthropicKey,
    maxRetries: 2,
    timeout: 8 * 60 * 1000,
  });

  if (onProgress) await onProgress('Reading report with Claude…');

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

  if (onProgress) await onProgress('Adapting findings for Fieldwork…');

  const cccAudit = assertAuditOutput(parseAuditJSON(text));
  applyDofdDirectionalGuard(cccAudit.accounts);
  applyCollectionBalanceGuard(cccAudit.accounts);

  return adaptCccAuditToFieldwork(cccAudit, {
    reportSource: fileName,
    generatedAt: new Date().toISOString(),
  });
}

export function isNetlifyLocalDev() {
  return process.env.NETLIFY_DEV === 'true'
    || process.env.CONTEXT === 'dev'
    || process.env.NETLIFY_LOCAL === 'true'
    || !process.env.URL;
}
