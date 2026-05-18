// netlify/functions/audit.js
// Serverless function that proxies Claude API calls.
// API key lives in Netlify env vars — never exposed to browser.

import Anthropic from '@anthropic-ai/sdk';
import { MASTER_SYSTEM_PROMPT } from '../../src/prompts/masterPrompt.js';

// Model selection — see https://docs.claude.com for current options
// claude-opus-4-7 = highest quality (recommended for forensic work)
// claude-sonnet-4-6 = faster, ~5x cheaper, still very capable
// claude-haiku-4-5-20251001 = fastest, cheapest, lower quality
const MODEL = 'claude-opus-4-7';
const MAX_TOKENS_AUDIT = 8192;
const MAX_TOKENS_LETTER = 8192;

export const handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return resp(405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return resp(500, { error: 'ANTHROPIC_API_KEY not configured in Netlify environment variables' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return resp(400, { error: 'Invalid JSON body' });
  }

  const { mode, pdfBase64, account, client } = body;

  if (!mode) {
    return resp(400, { error: 'Missing mode (must be "audit" or "letter")' });
  }

  const anthropic = new Anthropic({ apiKey });

  try {
    if (mode === 'audit') {
      if (!pdfBase64) {
        return resp(400, { error: 'pdfBase64 required for audit mode' });
      }
      return await runAudit(anthropic, pdfBase64);
    } else if (mode === 'letter') {
      if (!account || !client) {
        return resp(400, { error: 'account and client required for letter mode' });
      }
      return await runLetter(anthropic, account, client);
    } else {
      return resp(400, { error: `Unknown mode: ${mode}` });
    }
  } catch (err) {
    console.error('Claude API error:', err);
    return resp(500, {
      error: 'Claude API request failed',
      detail: err.message || String(err),
    });
  }
};

// ── Audit: parse PDF, return structured JSON ─────────────────────────────
async function runAudit(anthropic, pdfBase64) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS_AUDIT,
    system: MASTER_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64,
            },
          },
          {
            type: 'text',
            text: `<MODE>AUDIT_JSON</MODE>

Perform a full forensic Metro 2 / FCRA audit of the attached credit report.

Return the complete JSON object per the AUDIT_JSON schema. Identify EVERY violation pattern from Section 3 of your instructions. Classify accounts A/B/C. Rank into Round 1 Batch 1 (top 5 by balance × violation strength) and Round 1 Batch 2.

Output JSON only. No prose. No code fences.`,
          },
        ],
      },
    ],
  });

  const rawText = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const json = extractJSON(rawText);
  if (!json) {
    return resp(500, {
      error: 'Failed to parse structured audit JSON from Claude response',
      raw: rawText.substring(0, 2000),
    });
  }

  return resp(200, { audit: json, usage: response.usage });
}

// ── Letter: generate HTML letter for a single account ────────────────────
async function runLetter(anthropic, account, client) {
  const accountBlock = JSON.stringify({ account, client }, null, 2);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS_LETTER,
    system: MASTER_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `<MODE>LETTER_HTML</MODE>

Generate the Phase 1 dispute letter HTML for this account.

Client and account data:
${accountBlock}

Follow the 16-step letter structure exactly. Use the verified furnisher address from the CCC Master Creditor List (Section 12 of your instructions) when available. For Type C accounts, include §1692g(b) FDCPA validation demands alongside §1681s-2(a) demands.

Output complete HTML document only. No prose. No markdown fences.`,
      },
    ],
  });

  const rawText = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const html = extractHTML(rawText);

  return resp(200, { html, usage: response.usage });
}

// ── Helpers ──────────────────────────────────────────────────────────────
function extractJSON(text) {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {}

  // Strip code fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }

  // Find first { to last }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.substring(firstBrace, lastBrace + 1));
    } catch {}
  }

  return null;
}

function extractHTML(text) {
  // Strip code fences if present
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  // Find <!doctype or <html
  const docTypeIdx = text.toLowerCase().indexOf('<!doctype');
  const htmlIdx = text.toLowerCase().indexOf('<html');
  const start = docTypeIdx !== -1 ? docTypeIdx : htmlIdx;
  if (start === -1) return text.trim();

  const endIdx = text.toLowerCase().lastIndexOf('</html>');
  if (endIdx !== -1) return text.substring(start, endIdx + 7);

  return text.substring(start).trim();
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function resp(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
    body: JSON.stringify(body),
  };
}
