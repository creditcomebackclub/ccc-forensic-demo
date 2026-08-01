/**
 * Fieldwork audit — CCC forensic engine, Fieldwork UI output.
 * Uses FIELDWORK_ANTHROPIC_API_KEY only (never ANTHROPIC_API_KEY).
 *
 * POST JSON: { base64, mediaType?, fileName?, mode? }
 * Returns: { audit: FieldworkAudit, mode: 'engine' }
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

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

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

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const anthropicKey = process.env.FIELDWORK_ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return json(503, {
      error: 'FIELDWORK_ANTHROPIC_API_KEY not configured',
      mode: 'demo',
    });
  }

  let payload;
  try {
    let raw = event.body || '{}';
    if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
    payload = JSON.parse(raw);
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const base64 = payload.base64;
  if (!base64 || typeof base64 !== 'string') {
    return json(400, { error: 'base64 report required' });
  }

  // Rough size guard (~11MB base64 ≈ 8MB binary)
  if (base64.length > 12_000_000) {
    return json(413, { error: 'Report too large for Fieldwork audit pass' });
  }

  const mediaType = payload.mediaType || 'application/pdf';
  const mode = payload.mode === 'single' ? 'single' : 'combined';
  const bureau = payload.bureau || 'Experian';
  const fileName = payload.fileName || 'credit-report.pdf';
  const t = todayLong();

  try {
    const anthropic = new Anthropic({
      apiKey: anthropicKey,
      maxRetries: 2,
      timeout: 8 * 60 * 1000,
    });

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

    const cccAudit = assertAuditOutput(parseAuditJSON(text));
    applyDofdDirectionalGuard(cccAudit.accounts);
    applyCollectionBalanceGuard(cccAudit.accounts);

    const audit = adaptCccAuditToFieldwork(cccAudit, {
      reportSource: fileName,
      generatedAt: new Date().toISOString(),
    });

    return json(200, {
      product: 'fieldwork',
      isolated: true,
      mode: 'engine',
      audit,
    });
  } catch (err) {
    console.error('fieldwork-audit-run failed', err);
    return json(500, {
      error: err.message || 'Audit failed',
      mode: 'engine',
    });
  }
};
