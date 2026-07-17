import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { MASTER_SYSTEM_PROMPT } from '../../src/prompts/masterPrompt.js';

const MODEL = 'claude-sonnet-5';
const SYSTEM = MASTER_SYSTEM_PROMPT;

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
      const html = htmlMatch ? htmlMatch[0] : rawText;

      if (!html || html.trim().length < 100) throw new Error('Generated letter is empty or too short');

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
