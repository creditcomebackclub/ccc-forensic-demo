import { MASTER_SYSTEM_PROMPT } from "../prompts/masterPrompt.js";
import { saveAudit, saveLetter } from "./storage.js";

export async function runAudit(pdfBase64) {
  let apiKey = localStorage.getItem('ccc_api_key');
  if (!apiKey) {
    const key = prompt('Enter your Anthropic API key (sk-ant-...):');
    if (!key) throw new Error('API key required');
    localStorage.setItem('ccc_api_key', key);
    apiKey = key;
  }

  const today = new Date().toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'});

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 8192,
      system: MASTER_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
          },
          {
            type: 'text',
            text: 'AUDIT_JSON_MODE\n\nToday is ' + today + '. Perform a full forensic Metro 2 and FCRA audit of the attached credit report. Return the complete JSON object per the schema in your instructions. Identify every violation. Classify accounts A, B, or C. Rank into Batch 1 top 5 and Batch 2 remaining. Output JSON only. No prose. No code fences.'
          }
        ]
      }]
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'API error ' + res.status);
  }

  const data = await res.json();
  const rawText = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const json = extractJSON(rawText);
  if (!json) throw new Error('Failed to parse audit results. Raw: ' + rawText.substring(0, 500));

  try { await saveAudit(json); } catch (e) { console.warn('Audit save failed (non-fatal):', e); }

  return { audit: json };
}

export async function generateLetter(account, client) {
  const apiKey = localStorage.getItem('ccc_api_key');
  if (!apiKey) throw new Error('API key not set');

  const today = new Date().toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'});

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 8192,
      system: MASTER_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: 'LETTER_HTML_MODE\n\nToday is ' + today + '. Use this exact date at the top of the letter.\n\nGenerate the Phase 1 dispute letter HTML for this account.\n\nData:\n' + JSON.stringify({ account, client }, null, 2) + '\n\nFollow the 16-step structure. For Type C include section 1692g(b) demands. Output complete HTML only. No prose. No fences.'
      }]
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'API error ' + res.status);
  }

  const data = await res.json();
  const rawText = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const html = extractHTML(rawText);

  try { await saveLetter(account, client, html); } catch (e) { console.warn('Letter save failed (non-fatal):', e); }

  return { html };
}

function extractJSON(text) {
  const cleaned = text.trim();
  try { return JSON.parse(cleaned); } catch(e) {}
  const stripped = cleaned.replace(/^```[a-z]*\n/i, '').replace(/\n```$/i, '').trim();
  try { return JSON.parse(stripped); } catch(e) {}
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    try { return JSON.parse(cleaned.substring(first, last + 1)); } catch(e) {}
  }
  return null;
}

function extractHTML(text) {
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const lower = text.toLowerCase();
  const start = lower.indexOf('<!doctype') !== -1 ? lower.indexOf('<!doctype') : lower.indexOf('<html');
  if (start === -1) return text.trim();
  const end = lower.lastIndexOf('</html>');
  return end !== -1 ? text.substring(start, end + 7) : text.substring(start).trim();
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
