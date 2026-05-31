import { MASTER_SYSTEM_PROMPT } from "../prompts/masterPrompt.js";
import { saveAudit, saveLetter } from "./storage.js";

const AUDIT_FUNCTION_URL = '/.netlify/functions/audit';

function extractJSON(text) {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1];
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]); } catch (e) {} }
  try { return JSON.parse(text.trim()); } catch (e) {}
  throw new Error('Could not parse JSON from response');
}

async function callAuditFunction(payload) {
  const res = await fetch(AUDIT_FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, systemPrompt: MASTER_SYSTEM_PROMPT }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Audit function failed');
  return data;
}

export async function runAudit(pdfBase64) {
  const data = await callAuditFunction({ mode: 'combined', pdfBase64 });
  const json = extractJSON(data.result);
  if (json && json.client) await saveAudit(json);
  return { audit: json };
}

export async function runTripleBureauAudit(eqBase64, expBase64, tuBase64, onProgress) {
  onProgress && onProgress('Sending reports to server...', 10);
  const data = await callAuditFunction({ mode: 'individual', eqBase64, expBase64, tuBase64 });
  onProgress && onProgress('Processing complete', 95);
  const merged = extractJSON(data.result);
  if (merged && merged.client) await saveAudit(merged);
  onProgress && onProgress('Complete', 100);
  return { audit: merged, bureauData: data.bureauData };
}

export async function runSingleBureauAudit(pdfBase64, bureau) {
  const data = await callAuditFunction({ mode: 'single', pdfBase64, bureau });
  const json = extractJSON(data.result);
  if (json && json.client) await saveAudit(json);
  return { audit: json, bureau };
}

export async function generateLetter(account, client) {
  const t = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const data = await callAuditFunction({
    mode: 'letter',
    account,
    client,
    clientSignature: client.signatureData || null,
  });

  const rawText = data.result;
  const htmlMatch = rawText.match(/<!DOCTYPE[\s\S]*<\/html>/i) || rawText.match(/<html[\s\S]*<\/html>/i);
  const html = htmlMatch ? htmlMatch[0] : rawText;

  await saveLetter({
    clientName: client.name,
    furnisher: account.furnisher,
    accountId: account.accountNumber,
    phase: 'Phase 1',
    type: account.accountClassification,
    html,
    date: t,
  });

  return { html };
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
