import Anthropic from '@anthropic-ai/sdk';
import { MASTER_SYSTEM_PROMPT } from '../../src/prompts/masterPrompt.js';

const MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS_AUDIT = 8192;
const MAX_TOKENS_LETTER = 8192;

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return resp(405, { error: 'Method not allowed' });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return resp(500, { error: 'ANTHROPIC_API_KEY not configured' });
  }
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return resp(400, { error: 'Invalid JSON body' });
  }
  const { mode, pdfBase64, account, client } = body;
  if (!mode) return resp(400, { error: 'Missing mode' });
  const anthropic = new Anthropic({ apiKey });
  try {
    if (mode === 'audit') {
      if (!pdfBase64) return resp(400, { error: 'pdfBase64 required' });
      return await runAudit(anthropic, pdfBase64);
    } else if (mode === 'letter') {
      if (!account || !client) return resp(400, { error: 'account and client required' });
      return await runLetter(anthropic, account, client);
    } else {
      return resp(400, { error: `Unknown mode: ${mode}` });
    }
  } catch (err) {
    console.error('Claude API error:', err);
    return resp(500, { error: 'Claude API request failed', detail: err.message || String(err) });
  }
};

async function runAudit(anthropic, pdfBase64) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS_AUDIT,
    system: MASTER_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: '<MODE>AUDIT_JSON</MODE>\n\nPerform a full forensic Metro 2 / FCRA audit of the attached credit report.\n\nReturn the complete JSON object per the AUDIT_JSON schema. Identify EVERY violation pattern. Classify accounts A/B/C. Rank into Round 1 Batch 1 (top 5) and Round 1 Batch 2.\n\nOutput JSON only. No prose. No code fences.' }
      ]
    }]
  });
  const rawText = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const json = extractJSON(rawText);
  if (!json) return resp(500, { error: 'Failed to parse audit JSON', raw: rawText.substring(0, 2000) });
  return resp(200, { audit: json, usage: response.usage });
}

async function runLetter(anthropic, account, client) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS_LETTER,
    system: MASTER_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `<MODE>LETTER_HTML</MODE>\n\nGenerate the Phase 1 dispute letter HTML for this account.\n\nClient and account data:\n${JSON.stringify({ account, client }, null, 2)}\n\nFollow the 16-step letter structure exactly. For Type C accounts include §1692g(b) demands.\n\nOutput complete HTML document only. No prose. No markdown fences.`
    }]
  });
  const rawText = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const html = extractHTML(rawText);
  return resp(200, { html, usage: response.usage });
}

function extractJSON(text) {
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    try { return JSON.parse(text.substring(first, last + 1)); } catch {}
  }
  return null;
}

function extractHTML(text) {
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = text.toLowerCase().indexOf('<!doctype') !== -1 ? text.toLowerCase().indexOf('<!doctype') : text.toLowerCase().indexOf('<html');
  if (start === -1) return text.trim();
  const end = text.toLowerCase().lastIndexOf('</html>');
  if (end !== -1) return text.substring(start, end + 7);
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
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}
