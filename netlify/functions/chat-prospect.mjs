import { Anthropic } from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = createClient(supabaseUrl, serviceKey);

const SYSTEM_PROMPT = `
You are the AI Prospect Assistant for Credit Comeback Club (CCC). 
Your goal is to answer questions about credit repair, explain CCC's forensic audit methodology, and capture lead information (Name, Email, Phone number).

CCC METHODOLOGY:
- Instead of just sending generic dispute letters (which bureaus ignore), CCC performs a Forensic Audit.
- CCC uses software to cross-reference credit reports and find exact Metro 2 compliance violations.
- CCC drafts highly factual, forensic letters that demand reinvestigation of these specific errors.
- Pricing is typically discussed during the consultation, but CCC operates on a pay-for-performance or affordable monthly model.

YOUR DIRECTIVES:
1. Be extremely polite, professional, and concise. Keep responses under 3 paragraphs.
2. If the user asks about the process, explain the forensic audit approach briefly.
3. If the user seems interested, ask for their Name and Email address so we can follow up or book a consultation.
4. DO NOT promise specific score increases. State that we focus on removing inaccurate, unverifiable, or obsolete information.
5. If the user provides their name, email, or phone, acknowledge it and say a team member will reach out soon.
`;

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { history } = JSON.parse(event.body);

    if (!history || !Array.isArray(history)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'History array required' }) };
    }

    const messages = history.filter(m => m.role === 'user' || m.role === 'assistant');

    // Create message with Anthropic
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: messages.map(m => ({
        role: m.role,
        content: m.text
      }))
    });

    const reply = response.content[0].text;

    // Check if the user might have provided contact info in the last message
    const lastUserMsg = messages[messages.length - 1];
    if (lastUserMsg && lastUserMsg.role === 'user') {
      const txt = lastUserMsg.text.toLowerCase();
      // Simple heuristic for email/phone capture
      if (txt.includes('@') || txt.match(/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/)) {
        // Save to leads table asynchronously (fire and forget)
        db.from('leads').insert({
          chat_summary: `Captured info: ${lastUserMsg.text}\nFull Chat Length: ${messages.length}`,
          status: 'new'
        }).then(({ error }) => {
          if (error) console.error('Error saving lead:', error);
        });
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply })
    };

  } catch (error) {
    console.error('Prospect Chat Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process chat' })
    };
  }
};
