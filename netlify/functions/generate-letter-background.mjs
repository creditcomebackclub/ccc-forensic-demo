import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { getLetterSystemPrompt } from '../../src/prompts/letterPrompt.js';
import { validateFieldCitations, autoFixFieldCitations, assertMapFullySourced } from '../../src/constants/metro2Fields.js';
import { generatedLetterValidationError } from '../../src/utils/letterGeneration.js';
import { hasInjectedSignature, injectSignatureImage } from '../../src/utils/signatureInjection.js';
import { requireStaff } from './_requireAuth.cjs';

// Provenance guard (2026-07-24): fails fast at cold start if any Metro 2
// entry lacks a source citation, so an unsourced field number can never be
// in play when a letter is generated.
assertMapFullySourced();

const MODEL = 'claude-sonnet-5';
const MAX_JOBS_PER_REQUEST = 3;
const MAX_INSTRUCTION_CHARS = 120000;
const MAX_LETTER_TOKENS = 12000;

function validLetterJob(job) {
  return !!job
    && typeof job.id === 'string'
    && job.id.length > 0
    && job.id.length <= 255
    && typeof job.instructions === 'string'
    && job.instructions.trim().length > 0
    && job.instructions.length <= MAX_INSTRUCTION_CHARS;
}

async function loadClientSignature(supabase, letter) {
  if (!letter?.client_id) throw new Error('The letter has no client identity for signature injection');
  const { data: clientRow, error: clientError } = await supabase.from('clients')
    .select('id,user_id,name,lpoa_signature_data')
    .eq('id', letter.client_id)
    .maybeSingle();
  if (clientError) throw clientError;
  if (!clientRow || clientRow.user_id !== letter.user_id) throw new Error('The letter client could not be verified for signature injection');

  const { data: profileRows, error: profileError } = await supabase.from('client_profiles')
    .select('signature_data')
    .eq('client_id', letter.client_id)
    .limit(1);
  if (profileError) throw profileError;
  const profileSignature = String(profileRows?.[0]?.signature_data || '');
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(profileSignature)) {
    return { dataUrl: profileSignature, printedName: clientRow.name };
  }

  const signatureRecord = clientRow.lpoa_signature_data || {};
  if (signatureRecord.signaturePath) {
    const bucket = signatureRecord.storageBucket || 'documents';
    const { data: signatureFile, error: signatureError } = await supabase.storage.from(bucket).download(signatureRecord.signaturePath);
    if (signatureError || !signatureFile) throw signatureError || new Error('Stored client signature could not be downloaded');
    const bytes = Buffer.from(await signatureFile.arrayBuffer());
    const mime = signatureFile.type || 'image/png';
    return { dataUrl: `data:${mime};base64,${bytes.toString('base64')}`, printedName: clientRow.name };
  }
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(String(signatureRecord.signatureUrl || ''))) {
    return { dataUrl: signatureRecord.signatureUrl, printedName: clientRow.name };
  }
  throw new Error('The client has no stored signature for this letter');
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let caller;
  try {
    caller = await requireStaff(event);
  } catch (e) {
    if (e && e.statusCode) return e;
    console.error('generate-letter: could not authenticate caller', e);
    return { statusCode: 500, body: 'authentication failed' };
  }

  let payload = null;
  try {
    let bodyText = event.body || '{}';
    if (event.isBase64Encoded) bodyText = Buffer.from(bodyText, 'base64').toString('utf-8');
    payload = JSON.parse(bodyText);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON payload' };
  }

  if (!payload || !Array.isArray(payload.jobs)) {
    return { statusCode: 400, body: 'Valid JSON with jobs array required' };
  }
  if (!payload.jobs.length || payload.jobs.length > MAX_JOBS_PER_REQUEST || !payload.jobs.every(validLetterJob)) {
    return { statusCode: 400, body: 'One to three valid letter jobs are required' };
  }
  const jobIds = payload.jobs.map((job) => job.id);
  if (new Set(jobIds).size !== jobIds.length) {
    return { statusCode: 400, body: 'Letter job IDs must be unique' };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !serviceKey || !anthropicKey) {
    console.error('Missing required environment variables');
    return { statusCode: 500, body: 'Server misconfigured' };
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  });

  // The browser may send only IDs and prompt input, never authority to write
  // arbitrary letters. Resolve every row first and require ownership for an
  // auditor (admins retain their existing oversight access) before the
  // service-role client reads settings or calls Anthropic.
  const { data: letters, error: lettersErr } = await supabase
    .from('letters')
    .select('id, user_id, client_id, html, target_type, target_bureau, dispute_basis, round_id, round_number')
    .in('id', jobIds);
  if (lettersErr) {
    console.error('generate-letter: could not validate letter ownership', lettersErr);
    return { statusCode: 500, body: 'Could not validate letter jobs' };
  }
  const lettersById = new Map((letters || []).map((letter) => [letter.id, letter]));
  for (const job of payload.jobs) {
    const letter = lettersById.get(job.id);
    if (!letter) return { statusCode: 404, body: 'Letter job not found' };
    if (caller.role !== 'admin' && letter.user_id !== caller.userId) {
      return { statusCode: 403, body: 'Not authorized for this letter' };
    }
    // Generation is only allowed for a placeholder just created by the
    // staff workflow. This prevents an authenticated request from replacing
    // an existing saved, mailed, or replied-to letter.
    if (letter.html !== 'GENERATING...') {
      return { statusCode: 409, body: 'Letter is not awaiting generation' };
    }
  }

  // Settings' "Default Aggressiveness" previously had zero effect on letter
  // generation — the API call always used one hardcoded prompt regardless
  // of what was selected. Fetch the real setting and pick the matching
  // prompt variant (letterPrompt.js) so it actually changes the letter.
  let aggressiveness = 'Aggressive';
  try {
    const { data: settingsFile } = await supabase.storage.from('client-docs').download('admin/settings.json');
    if (settingsFile) {
      const parsed = JSON.parse(await settingsFile.text());
      if (parsed?.disputes?.defaultAggressiveness) aggressiveness = parsed.disputes.defaultAggressiveness;
    }
  } catch (e) {
    console.warn('Could not load dispute aggressiveness setting, defaulting to Aggressive:', e.message);
  }
  const client = new Anthropic({ apiKey: anthropicKey, maxRetries: 5 });

  for (const job of payload.jobs) {
    try {
      const storedLetter = lettersById.get(job.id);
      const targetType = storedLetter?.target_type || job.targetType || 'furnisher';
      if (!['furnisher', 'bureau'].includes(targetType)) throw new Error('Stored letter has no valid target type');
      if (targetType === 'bureau' && !storedLetter?.target_bureau) throw new Error('Stored bureau letter has no explicit recipient');
      const SYSTEM = [{
        type: 'text',
        text: getLetterSystemPrompt(aggressiveness, targetType, storedLetter?.dispute_basis || null),
        cache_control: { type: 'ephemeral' },
      }];
      // 1. Generate Letter HTML, self-correcting up to 2 times if the Metro
      // 2 field-citation lint fails below. A blind user-triggered "Retry"
      // regenerates from scratch and hits similar transposition mistakes at
      // a similar rate (Field 21/22, 23/27 swaps were the most common
      // repeat failure); feeding the exact citation errors back to the
      // model in the same conversation lets it fix just those instead.
      const MAX_FIELD_CITATION_ATTEMPTS = 3;
      const conversation = [{ role: 'user', content: job.instructions }];
      let html = null;
      for (let attempt = 1; attempt <= MAX_FIELD_CITATION_ATTEMPTS; attempt++) {
        const msg = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_LETTER_TOKENS,
          system: SYSTEM,
          messages: conversation,
        });
        if (msg.stop_reason === 'max_tokens') {
          throw new Error('Generated letter exceeded the output limit before it finished. Nothing incomplete was saved.');
        }
        if (msg.stop_reason && msg.stop_reason !== 'end_turn') {
          throw new Error(`Generated letter did not finish cleanly (${msg.stop_reason})`);
        }
        const rawText = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
        const htmlMatch = rawText.match(/<!DOCTYPE[\s\S]*<\/html>/i) || rawText.match(/<html[\s\S]*<\/html>/i);
        const candidateHtml = htmlMatch ? htmlMatch[0] : null;

        if (!candidateHtml || candidateHtml.trim().length < 100) throw new Error('Generated letter is empty or too short');
        const structureError = generatedLetterValidationError(candidateHtml, { requireSections: true });
        if (structureError) throw new Error(structureError);

        // Most citation mistakes are a transposed field NUMBER against a
        // correctly-written label ("Field 21 — Amount Past Due") — that's
        // mechanically correctable without asking the model again. Fix what
        // can be fixed deterministically first; only what's left (an
        // invalid field number, or a label autoFixFieldCitations couldn't
        // confidently resolve) goes to the conversational retry below.
        const { html: autoFixedHtml } = autoFixFieldCitations(candidateHtml);

        // No unsourced or misattributed Metro 2 field number may reach a
        // generated letter. Real letters shipped citing "Field 30 — Amount
        // Past Due", "Field 4 — Date Opened" and "Field 19 — Compliance
        // Condition Code"; this catches it before output instead.
        const fieldProblems = validateFieldCitations(autoFixedHtml);
        if (!fieldProblems.length) { html = autoFixedHtml; break; }

        if (attempt === MAX_FIELD_CITATION_ATTEMPTS) {
          throw new Error('Metro 2 field citation check failed: ' + fieldProblems.join(' | '));
        }

        conversation.push({ role: 'assistant', content: rawText });
        conversation.push({
          role: 'user',
          content: 'The letter you just drafted cites the wrong Metro 2 field number for one or more items:\n\n'
            + fieldProblems.join('\n')
            + '\n\nRewrite the complete letter with the field numbers corrected. Do not change anything else. Output the full corrected HTML document.',
        });
      }

      // Enforce date-before-sender-address deterministically. The prompt
      // (letterPrompt.js's class allowlist + api.js's explicit "date leads"
      // instruction) has twice failed to reliably stop the model putting
      // the sender's address block before the date-line — confirmed live
      // on regenerated Personal Info & Inquiries letters (2026-07-29). A
      // wording fix isn't reliable enough for something this mechanical;
      // fix it in code instead of hoping a third prompt phrasing works.
      // Swaps via placeholder tokens so everything else in the document
      // (blank lines, the recipient block, etc.) stays exactly where it
      // was — only these two elements' positions trade places.
      {
        const extractDiv = (className) => {
          const re = new RegExp("<div\\s+class=['\"]" + className + "['\"][^>]*>[\\s\\S]*?<\\/div>", 'i');
          const m = html.match(re);
          return m ? m[0] : null;
        };
        const dateDiv = extractDiv('date-line');
        const senderDiv = extractDiv('sender-block');
        if (dateDiv && senderDiv) {
          const dateIdx = html.indexOf(dateDiv);
          const senderIdx = html.indexOf(senderDiv);
          if (senderIdx < dateIdx) {
            const DATE_TOKEN = '__DATE_LINE_SWAP__';
            const SENDER_TOKEN = '__SENDER_BLOCK_SWAP__';
            html = html.replace(senderDiv, SENDER_TOKEN).replace(dateDiv, DATE_TOKEN);
            html = html.replace(SENDER_TOKEN, dateDiv).replace(DATE_TOKEN, senderDiv);
          }
        }
      }

      // Inject standard letter CSS server-side to save AI tokens and prevent truncation
      const baseCss = `
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; line-height: 1.5; margin: 0; padding: 1in; max-width: 8.5in; color: #333333; word-wrap: break-word; }
        .date-line { margin-bottom: 20px; }
        .sender-block { margin-bottom: 20px; line-height: 1.3; }
        .recipient-block { margin-bottom: 20px; line-height: 1.3; }
        .re-line { font-weight: bold; margin-bottom: 20px; }
        .section-header { background-color: #1B2A4A; color: #ffffff; font-weight: bold; padding: 6px 10px; margin-top: 20px; margin-bottom: 10px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
        .id-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; table-layout: fixed; word-wrap: break-word; }
        .id-table td { padding: 8px 12px; border: 1px solid #E5E7EB; font-size: 13px; }
        .id-table td.label { font-weight: bold; background-color: #F9FAFB; width: 30%; }
        .list-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; table-layout: fixed; word-wrap: break-word; }
        .list-table th, .list-table td { padding: 8px 12px; border: 1px solid #E5E7EB; font-size: 13px; text-align: left; }
        .list-table th { background-color: #1B2A4A; color: #ffffff; font-weight: bold; }
        .demands-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; table-layout: fixed; word-wrap: break-word; }
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

      if (html.includes('</head>')) {
        html = html.replace('</head>', `<meta charset="UTF-8"><style>${baseCss}</style></head>`);
      } else if (html.includes('<head>')) {
        html = html.replace('<head>', `<head><meta charset="UTF-8"><style>${baseCss}</style>`);
      } else if (html.includes('<body>')) {
        html = html.replace('<body>', `<head><meta charset="UTF-8"><style>${baseCss}</style></head><body>`);
      } else {
        // Fallback for raw text without tags
        html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${baseCss}</style></head><body>${html}</body></html>`;
      }

      // The model never receives or echoes signature bytes. Resolve the
      // canonical private signature with service-role access and inject it
      // only after a complete document passes structural validation.
      const clientSignature = await loadClientSignature(supabase, storedLetter);
      html = injectSignatureImage(html, clientSignature.dataUrl, clientSignature.printedName);
      if (!hasInjectedSignature(html, clientSignature.dataUrl)) {
        throw new Error('The client signature block could not be populated');
      }
      const finalStructureError = generatedLetterValidationError(html, { requireSections: true });
      if (finalStructureError) throw new Error(finalStructureError);

      // 2. Generate Summary if needed
      let summary = null;
      if (job.generateSummary && job.account) {
        try {
          const summaryRecipient = targetType === 'bureau'
            ? (storedLetter?.target_bureau || 'the selected credit bureau')
            : (job.account.furnisher || 'the furnisher');
          const sumMsg = await client.messages.create({
            model: MODEL,
            max_tokens: 1024,
            system: SYSTEM,
            messages: [{
              role: 'user',
              content: `Write a 2-3 sentence plain-English summary for a non-expert client explaining what is being disputed on this account and why, based on the data below. Avoid legal jargon and statute citations — explain the core problem in everyday terms (e.g. "this account shows two things that can't both be true at the same time"). End with a brief note on what we're asking ${summaryRecipient} to do. Output plain text only. No markdown, no headers, no fences, no prose before or after.\n\nAccount data:\n${JSON.stringify({ furnisher: job.account.furnisher, targetType, targetBureau: storedLetter?.target_bureau || null, status: job.account.status, balance: job.account.balance, primaryViolation: job.account.primaryViolation, violations: job.account.violations }, null, 2)}`
            }]
          });
          const rawSum = sumMsg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
          summary = (rawSum || '').trim();
        } catch(e) {
          console.error(`Summary generation failed for ${job.id}:`, e);
        }
      }

      // 3. Update Database
      const updateData = { html };
      if (summary) updateData.summary = summary;
      
      const { error } = await supabase.from('letters').update(updateData).eq('id', job.id);
      if (error) throw new Error(`Failed to update generated letter: ${error.message}`);
      
    } catch (e) {
      console.error(`Failed to generate letter for job ${job.id}:`, e);
      // Mark as failed in DB so frontend stops polling
      await supabase.from('letters').update({ html: 'ERROR: ' + e.message }).eq('id', job.id);
    }
  }

  const roundIds = [...new Set((letters || []).map((letter) => letter.round_id).filter(Boolean))];
  if (roundIds.length) {
    try {
      const roundEmailModule = await import('./_roundEmail.cjs');
      const queueRoundEvent = roundEmailModule.queueRoundEvent || roundEmailModule.default?.queueRoundEvent;
      for (const roundId of roundIds) {
        await queueRoundEvent?.({ roundId, eventType: 'next_round_prepared', requireAllGenerated: true });
      }
    } catch (emailError) {
      console.error('Round prepared milestone email failed (letters remain saved):', emailError.message);
    }
  }
  
  return { statusCode: 202, body: 'Accepted' };
};
