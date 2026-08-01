/**
 * Fieldwork letter — CCC forensic logic, Fieldwork plain-text skin.
 * FIELDWORK_ANTHROPIC_API_KEY only.
 *
 * POST: { user, account, phaseId?, tone? }
 * Returns: { letter: string, mode: 'engine' }
 */
import Anthropic from '@anthropic-ai/sdk';
import { getFieldworkLetterSystemPrompt } from '../../src/prompts/fieldworkLetterPrompt.js';
import { buildFieldworkLetter } from '../../src/diy/adapters/buildFieldworkLetter.js';

const MODEL = 'claude-sonnet-5';

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
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

  const anthropicKey = process.env.FIELDWORK_ANTHROPIC_API_KEY;

  // Always have a Fieldwork-styled deterministic fallback (same look as demo)
  const fallback = buildFieldworkLetter(user, account, phaseId);

  if (!anthropicKey) {
    return json(200, {
      product: 'fieldwork',
      mode: 'local',
      usesCccKeys: false,
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
          // ensure Fieldwork display fields available too
          accountMask: account.accountMask,
          whyFurnisherFirst: account.whyFurnisherFirst,
          violations: account.violations,
        }
      : account;

    const instructions = [
      `Today is ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.`,
      `Phase: ${phaseId}.`,
      'Generate ONE plain-text Fieldwork dispute letter.',
      '',
      'Consumer (sender of record):',
      JSON.stringify(user, null, 2),
      '',
      'Account + violations:',
      JSON.stringify(accountPayload, null, 2),
    ].join('\n');

    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: getFieldworkLetterSystemPrompt(tone),
      messages: [{ role: 'user', content: instructions }],
    });

    let letter = (msg.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    // Strip accidental fences / HTML
    letter = letter.replace(/^```(?:text|plaintext)?\s*/i, '').replace(/\s*```$/i, '').trim();
    if (/<html|<table|DOCTYPE/i.test(letter) || letter.length < 200) {
      letter = fallback;
    }

    return json(200, {
      product: 'fieldwork',
      mode: 'engine',
      usesCccKeys: false,
      letter,
    });
  } catch (err) {
    console.error('fieldwork-generate-letter failed', err);
    return json(200, {
      product: 'fieldwork',
      mode: 'local-fallback',
      usesCccKeys: false,
      letter: fallback,
      warning: err.message || 'Engine failed; used Fieldwork local letter builder',
    });
  }
};
