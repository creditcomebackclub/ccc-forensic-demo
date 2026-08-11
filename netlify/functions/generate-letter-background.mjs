import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { assertMapFullySourced, autoFixFieldCitations, validateFieldCitations } from '../../src/constants/metro2Fields.js';
import { generatedLetterValidationError } from '../../src/utils/letterGeneration.js';
import { hasInjectedSignature, injectSignatureImage } from '../../src/utils/signatureInjection.js';
import { LETTER_CONTENT_SCHEMA, renderStructuredLetter } from '../../src/utils/structuredLetter.js';
import { requireStaff } from './_requireAuth.cjs';
import { buildStoredLetterContext } from './_letterContext.mjs';
import { loadCanonicalClientSignature } from './_letterSignature.mjs';
import {
  assertCompletedMessage,
  CLAUDE_CLIENT_OPTIONS,
  CLAUDE_MODEL,
  logClaudeCall,
  preflightTokenCount,
  usageFromMessage,
} from './_claudeRuntime.mjs';

assertMapFullySourced();

const LETTER_EFFORT = 'medium';
const LETTER_MAX_TOKENS = 24000;
const LETTER_PROMPT_VERSION = 'structured-letter-v1';
const MAX_FIELD_ATTEMPTS = 3;

async function updateCampaignRoute(db, routeId) {
  if (!routeId) return;
  const { data: route } = await db.from('campaign_letter_routes').select('letter_ids').eq('id', routeId).maybeSingle();
  const ids = route?.letter_ids || [];
  if (!ids.length) return;
  const { data: rows } = await db.from('letters').select('html').in('id', ids);
  if ((rows || []).some((row) => String(row.html || '').startsWith('ERROR:'))) {
    await db.from('campaign_letter_routes').update({ status: 'failed', generation_error: 'One or more letter drafts failed validation.', updated_at: new Date().toISOString() }).eq('id', routeId);
  } else if ((rows || []).length === ids.length && rows.every((row) => row.html && row.html !== 'GENERATING...')) {
    await db.from('campaign_letter_routes').update({ status: 'generated', generation_error: null, generated_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', routeId);
  }
}

async function runStructuredCall({ anthropic, db, caller, letter, system, messages, attempt }) {
  const params = {
    model: CLAUDE_MODEL,
    max_tokens: LETTER_MAX_TOKENS,
    system,
    messages,
    output_config: {
      effort: LETTER_EFFORT,
      format: { type: 'json_schema', schema: LETTER_CONTENT_SCHEMA },
    },
  };
  await preflightTokenCount(anthropic, params, { operation: 'Letter generation' });
  const startedAt = new Date();
  try {
    const stream = anthropic.messages.stream(params);
    const message = assertCompletedMessage(await stream.finalMessage(), 'Letter generation');
    const usage = usageFromMessage(message);
    await logClaudeCall(db, {
      userId: letter.user_id,
      operation: 'letter.generate',
      entityType: 'letter',
      entityId: letter.id,
      model: CLAUDE_MODEL,
      effort: LETTER_EFFORT,
      promptVersion: LETTER_PROMPT_VERSION,
      attempt,
      status: 'completed',
      startedAt,
      requestId: message._request_id,
      usage,
      stopReason: message.stop_reason,
    });
    const text = message.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
    return { parsed: JSON.parse(text), rawText: text };
  } catch (error) {
    await logClaudeCall(db, {
      userId: letter.user_id || caller.userId,
      operation: 'letter.generate',
      entityType: 'letter',
      entityId: letter.id,
      model: CLAUDE_MODEL,
      effort: LETTER_EFFORT,
      promptVersion: LETTER_PROMPT_VERSION,
      attempt,
      status: 'error',
      startedAt,
      errorType: error.name,
      errorMessage: error.message,
    });
    throw error;
  }
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let caller;
  try {
    caller = await requireStaff(event);
  } catch (error) {
    if (error?.statusCode) return error;
    return { statusCode: 500, body: 'authentication failed' };
  }

  let letterId;
  try {
    let bodyText = event.body || '{}';
    if (event.isBase64Encoded) bodyText = Buffer.from(bodyText, 'base64').toString('utf8');
    letterId = JSON.parse(bodyText).letterId;
  } catch (_) {}
  if (typeof letterId !== 'string' || !letterId || letterId.length > 500) {
    return { statusCode: 400, body: 'Exactly one letterId is required' };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!supabaseUrl || !serviceKey || !anthropicKey) return { statusCode: 500, body: 'Server misconfigured' };
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false }, realtime: { transport: ws } });

  const { data: letter, error: letterError } = await db.from('letters').select('*').eq('id', letterId).maybeSingle();
  if (letterError) return { statusCode: 500, body: 'Could not validate letter' };
  if (!letter) return { statusCode: 404, body: 'Letter not found' };
  if (caller.role !== 'admin' && letter.user_id !== caller.userId) return { statusCode: 403, body: 'Not authorized for this letter' };
  if (letter.html !== 'GENERATING...') return { statusCode: 409, body: 'Letter is not awaiting generation' };
  if (letter.mailed_date || letter.lob_id || letter.tracking_number) return { statusCode: 409, body: 'A mailed letter cannot be regenerated' };

  const anthropic = new Anthropic({ apiKey: anthropicKey, ...CLAUDE_CLIENT_OPTIONS });
  try {
    const context = await buildStoredLetterContext(db, letter);
    const signature = await loadCanonicalClientSignature(db, letter, context.client);
    const conversation = [...context.messages];
    let content;
    let html;

    for (let attempt = 1; attempt <= MAX_FIELD_ATTEMPTS; attempt += 1) {
      const result = await runStructuredCall({ anthropic, db, caller, letter, system: context.system, messages: conversation, attempt });
      content = result.parsed;
      html = renderStructuredLetter({ content, client: context.client, account: context.account, letter, enclosures: context.enclosures });
      html = autoFixFieldCitations(html).html;
      const fieldProblems = validateFieldCitations(html);
      if (!fieldProblems.length) break;
      if (attempt === MAX_FIELD_ATTEMPTS) throw new Error(`Metro 2 field citation check failed: ${fieldProblems.join(' | ')}`);
      conversation.push({ role: 'assistant', content: result.rawText });
      conversation.push({
        role: 'user',
        content: `Correct every Metro 2 citation problem below and return the complete structured content object again. Do not change supported facts or add new claims.\n- ${fieldProblems.join('\n- ')}`,
      });
    }

    html = injectSignatureImage(html, signature.dataUrl, signature.printedName);
    if (!hasInjectedSignature(html, signature.dataUrl)) throw new Error('The client signature block could not be populated.');
    const structureError = generatedLetterValidationError(html, { requireSections: true });
    if (structureError) throw new Error(structureError);

    const { data: saved, error: saveError } = await db.from('letters')
      .update({ html, summary: content.summary, saved_at: new Date().toISOString() })
      .eq('id', letter.id)
      .eq('html', 'GENERATING...')
      .is('mailed_date', null)
      .is('lob_id', null)
      .select('id');
    if (saveError || !saved?.length) throw saveError || new Error('The draft changed before generation completed. Nothing was overwritten.');

    await updateCampaignRoute(db, letter.campaign_route_id);
    if (letter.round_id) {
      try {
        const emailModule = await import('./_roundEmail.cjs');
        const queueRoundEvent = emailModule.queueRoundEvent || emailModule.default?.queueRoundEvent;
        await queueRoundEvent?.({ roundId: letter.round_id, eventType: 'next_round_prepared', requireAllGenerated: true });
      } catch (emailError) {
        console.warn('Round prepared email was not queued:', emailError.message);
      }
    }
  } catch (error) {
    console.error(`Failed to generate letter ${letter.id}:`, error);
    await db.from('letters').update({ html: `ERROR: ${String(error.message || error).slice(0, 900)}` })
      .eq('id', letter.id).eq('html', 'GENERATING...');
    await updateCampaignRoute(db, letter.campaign_route_id);
  }

  return { statusCode: 202, body: 'Accepted' };
};
