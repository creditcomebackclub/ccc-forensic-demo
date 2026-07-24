import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { getLetterSystemPrompt } from '../../src/prompts/letterPrompt.js';

const MODEL = 'claude-sonnet-5';

export const handler = async (event) => {
  let payload = null;
  try {
    let bodyText = event.body || '{}';
    if (event.isBase64Encoded) bodyText = Buffer.from(bodyText, 'base64').toString('utf-8');
    payload = JSON.parse(bodyText);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON payload' };
  }

  if (!payload || !payload.jobs || !Array.isArray(payload.jobs)) {
    return { statusCode: 400, body: 'Valid JSON with jobs array required' };
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

  // Debug immediately before Anthropic!
  if (payload.jobs && payload.jobs[0]) {
    await supabase.from('letters').update({ html: 'DEBUG: Supabase client created successfully' }).eq('id', payload.jobs[0].id);
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
  const SYSTEM = [{ type: 'text', text: getLetterSystemPrompt(aggressiveness), cache_control: { type: 'ephemeral' } }];

  const client = new Anthropic({ apiKey: anthropicKey, maxRetries: 5 });

  for (const job of payload.jobs) {
    try {
      await supabase.from('letters').update({ html: 'DEBUG: Function started in loop' }).eq('id', job.id);
      
      // 1. Generate Letter HTML
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM,
        messages: [{ role: 'user', content: job.instructions }],
      });
      const rawText = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const htmlMatch = rawText.match(/<!DOCTYPE[\s\S]*<\/html>/i) || rawText.match(/<html[\s\S]*<\/html>/i);
      let html = htmlMatch ? htmlMatch[0] : rawText;

      if (!html || html.trim().length < 100) throw new Error('Generated letter is empty or too short');

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

      // 2. Generate Summary if needed
      let summary = null;
      if (job.generateSummary && job.account) {
        try {
          const sumMsg = await client.messages.create({
            model: MODEL,
            max_tokens: 1024,
            system: SYSTEM,
            messages: [{
              role: 'user',
              content: `Write a 2-3 sentence plain-English summary for a non-expert client explaining what is being disputed on this account and why, based on the data below. Avoid legal jargon and statute citations — explain the core problem in everyday terms (e.g. "this account shows two things that can't both be true at the same time"). End with a brief note on what we're asking the furnisher to do. Output plain text only. No markdown, no headers, no fences, no prose before or after.\n\nAccount data:\n${JSON.stringify({ furnisher: job.account.furnisher, status: job.account.status, balance: job.account.balance, primaryViolation: job.account.primaryViolation, violations: job.account.violations }, null, 2)}`
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
      if (error) console.error(`Failed to update letter ${job.id} in DB:`, error);
      
    } catch (e) {
      console.error(`Failed to generate letter for job ${job.id}:`, e);
      // Mark as failed in DB so frontend stops polling
      await supabase.from('letters').update({ html: 'ERROR: ' + e.message }).eq('id', job.id);
    }
  }
  
  return { statusCode: 202, body: 'Accepted' };
};
