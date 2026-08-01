/**
 * Fieldwork letter — CCC forensic logic, Fieldwork HTML (id tables, unique skin).
 * FIELDWORK_ANTHROPIC_API_KEY only.
 */
import Anthropic from '@anthropic-ai/sdk';
import { getFieldworkLetterSystemPrompt } from '../../src/prompts/fieldworkLetterPrompt.js';
import { buildFieldworkLetter } from '../../src/diy/adapters/buildFieldworkLetter.js';
import {
  FIELDWORK_LETTER_CSS,
  wrapFieldworkLetterHtml,
  isFieldworkLetterHtml,
} from '../../src/diy/adapters/fieldworkLetterCss.js';

const MODEL = 'claude-sonnet-5';

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function injectFieldworkCss(html) {
  if (!html) return html;
  let out = html.trim();
  // Strip any model-supplied style blocks — we own the skin
  out = out.replace(/<style[\s\S]*?<\/style>/gi, '');
  if (out.includes('</head>')) {
    out = out.replace('</head>', `<style>${FIELDWORK_LETTER_CSS}</style></head>`);
  } else if (out.includes('<body>')) {
    out = out.replace('<body>', `<head><meta charset="UTF-8"><style>${FIELDWORK_LETTER_CSS}</style></head><body>`);
  } else if (isFieldworkLetterHtml(out) || /<table/i.test(out)) {
    out = wrapFieldworkLetterHtml(out);
  } else {
    // Plain text from model → keep deterministic Fieldwork builder instead
    return null;
  }
  return out;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let payload;
  try {
    let raw = event.body || '{}';
    if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
    payload = JSON.parse(raw);
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const { user, account, phaseId = 'phase1', tone = 'Standard' } = payload || {};
  if (!user?.name || !account?.furnisher || !Array.isArray(account.violations)) {
    return json(400, { error: 'user + account with violations required' });
  }

  const fallback = buildFieldworkLetter(user, account, phaseId);
  const anthropicKey = process.env.FIELDWORK_ANTHROPIC_API_KEY;

  if (!anthropicKey) {
    return json(200, {
      product: 'fieldwork',
      mode: 'local',
      format: 'html',
      letter: fallback,
    });
  }

  try {
    const anthropic = new Anthropic({
      apiKey: anthropicKey,
      maxRetries: 2,
      timeout: 3 * 60 * 1000,
    });

    const accountPayload = account.cccRaw
      ? {
          ...account.cccRaw,
          accountMask: account.accountMask,
          whyFurnisherFirst: account.whyFurnisherFirst,
          violations: account.violations,
          typeLabel: account.typeLabel,
          bureaus: account.bureaus,
        }
      : account;

    const instructions = [
      `Today is ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.`,
      `Phase: ${phaseId}.`,
      'Generate ONE Fieldwork HTML dispute letter with id-table, list-table, and demands-table.',
      '',
      'Consumer (sender of record):',
      JSON.stringify(user, null, 2),
      '',
      'Account + violations:',
      JSON.stringify(accountPayload, null, 2),
    ].join('\n');

    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 10000,
      system: getFieldworkLetterSystemPrompt(tone),
      messages: [{ role: 'user', content: instructions }],
    });

    let letter = (msg.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    letter = letter.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim();
    letter = injectFieldworkCss(letter);

    if (!letter || letter.length < 400 || !/id-table/i.test(letter)) {
      letter = fallback;
    }

    return json(200, {
      product: 'fieldwork',
      mode: letter === fallback ? 'local-fallback' : 'engine',
      format: 'html',
      letter,
    });
  } catch (err) {
    console.error('fieldwork-generate-letter failed', err);
    return json(200, {
      product: 'fieldwork',
      mode: 'local-fallback',
      format: 'html',
      letter: fallback,
      warning: err.message || 'Engine failed; used Fieldwork HTML builder',
    });
  }
};
