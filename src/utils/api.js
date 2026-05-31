import { MASTER_SYSTEM_PROMPT } from "../prompts/masterPrompt.js";
import { saveAudit, saveLetter } from "./storage.js";

function getApiKey() {
  let apiKey = localStorage.getItem('ccc_api_key');
  if (!apiKey) {
    const key = prompt('Enter your Anthropic API key (sk-ant-...):');
    if (!key) throw new Error('API key required');
    localStorage.setItem('ccc_api_key', key);
    apiKey = key;
  }
  return apiKey;
}

function extractJSON(text) {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1];
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]); } catch (e) {} }
  try { return JSON.parse(text.trim()); } catch (e) {}
  throw new Error('Could not parse JSON from response');
}

async function claudeCall(apiKey, userContent, maxTokens = 8192) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
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
        max_tokens: maxTokens,
        system: MASTER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || 'API error ' + res.status);
    }
    const data = await res.json();
    return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  } finally {
    clearTimeout(timeout);
  }
}

function pdfContent(base64, label) {
  return [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
    { type: 'text', text: label },
  ];
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const today = () => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

function trimBureau(data) {
  if (!data) return null;
  return {
    bureau: data.bureau,
    client: data.client,
    accounts: (data.accounts || []).map((a) => ({
      furnisher: a.furnisher,
      accountNumber: a.accountNumber,
      status: a.status,
      balance: a.balance,
      pastDue: a.pastDue,
      lastPaymentDate: a.lastPaymentDate,
      dofd: a.dofd,
      paymentHistory: a.paymentHistory,
      accountClassification: a.accountClassification,
      violations: a.violations,
    })),
  };
}

export async function runAudit(pdfBase64) {
  const apiKey = getApiKey();
  const t = today();
  const rawText = await claudeCall(apiKey, pdfContent(pdfBase64,
    `AUDIT_JSON_MODE\n\nToday is ${t}. Perform a full forensic Metro 2 and FCRA audit of the attached three-bureau credit report. Return the complete JSON object per the schema in your instructions. Identify every violation. Classify accounts A, B, or C. Rank into Batch 1 top 5 and Batch 2 remaining. Output JSON only. No prose. No code fences.`
  ));
  const json = extractJSON(rawText);
  if (json && json.client) await saveAudit(json);
  return { audit: json };
}

export async function runTripleBureauAudit(eqBase64, expBase64, tuBase64, onProgress) {
  const apiKey = getApiKey();
  const t = today();

  const bureauPrompt = (bureau) =>
    `BUREAU_AUDIT_JSON_MODE\n\nToday is ${t}. Bureau: ${bureau}.\n\nParse this single-bureau credit report. Extract client info, score, and every account with: furnisher, account number (masked), type, status, balance, pastDue, lastPaymentDate, dofd, paymentHistory, remarks, Metro 2 violations (field, currentValue, expectedValue, reason), accountClassification (A/B/C).\n\nOutput JSON only:\n{"bureau":"${bureau}","client":{"name":"","address":"","score":0},"accounts":[{"furnisher":"","accountNumber":"","type":"","status":"","balance":0,"pastDue":0,"lastPaymentDate":"","dofd":"","paymentHistory":"","accountClassification":"A","violations":[{"field":"","currentValue":"","expectedValue":"","reason":""}]}]}`;

  onProgress && onProgress('Analyzing Equifax report...', 10);
  const eqText = await claudeCall(apiKey, pdfContent(eqBase64, bureauPrompt('Equifax')));
  const eqData = extractJSON(eqText);

  onProgress && onProgress('Waiting 60 seconds (rate limit)...', 25);
  await sleep(60000);

  onProgress && onProgress('Analyzing Experian report...', 35);
  const expText = await claudeCall(apiKey, pdfContent(expBase64, bureauPrompt('Experian')));
  const expData = extractJSON(expText);

  onProgress && onProgress('Waiting 60 seconds (rate limit)...', 50);
  await sleep(60000);

  onProgress && onProgress('Analyzing TransUnion report...', 60);
  const tuText = await claudeCall(apiKey, pdfContent(tuBase64, bureauPrompt('TransUnion')));
  const tuData = extractJSON(tuText);

  onProgress && onProgress('Waiting 60 seconds (rate limit)...', 75);
  await sleep(60000);

  onProgress && onProgress('Computing cross-bureau violations...', 80);
  const mergePrompt = `MERGE_AUDIT_JSON_MODE\n\nToday is ${t}.\n\nMerge these three bureau reports into a unified forensic audit. Match accounts across bureaus. Identify cross-bureau violations. Classify each account A/B/C. Rank top 5 as Batch 1, rest as Batch 2. Return complete audit JSON.\n\nData:\n${JSON.stringify({ equifax: trimBureau(eqData), experian: trimBureau(expData), transunion: trimBureau(tuData) }, null, 2)}\n\nJSON only.`;

  const mergeText = await claudeCall(apiKey, [{ type: 'text', text: mergePrompt }], 8192);
  const merged = extractJSON(mergeText);

  if (merged && merged.client) {
    merged.client.scores = merged.client.scores || {};
    if (eqData?.client?.score) merged.client.scores.equifax = eqData.client.score;
    if (expData?.client?.score) merged.client.scores.experian = expData.client.score;
    if (tuData?.client?.score) merged.client.scores.transunion = tuData.client.score;
    await saveAudit(merged);
  }

  onProgress && onProgress('Complete', 100);
  return { audit: merged, bureauData: { equifax: eqData, experian: expData, transunion: tuData } };
}

export async function runSingleBureauAudit(pdfBase64, bureau) {
  const apiKey = getApiKey();
  const t = today();
  const rawText = await claudeCall(apiKey, pdfContent(pdfBase64,
    `AUDIT_JSON_MODE\n\nToday is ${t}. Bureau: ${bureau} only. Perform a forensic Metro 2 and FCRA audit. No cross-bureau comparisons possible. Return complete JSON per standard schema. JSON only.`
  ));
  const json = extractJSON(rawText);
  if (json && json.client) await saveAudit(json);
  return { audit: json, bureau };
}

export async function generateLetter(account, client) {
  const apiKey = getApiKey();
  const t = today();
  const rawText = await claudeCall(apiKey, [{
    type: 'text',
    text: `LETTER_HTML_MODE\n\nToday is ${t}. Use this exact date at the top of the letter.\n\nGenerate the Phase 1 dispute letter HTML for this account.\n\nData:\n${JSON.stringify({ account, client, clientSignature: client.signatureData || null }, null, 2)}\n\nFollow the 16-step structure. For Type C include section 1692g(b) demands. If clientSignature is provided embed it in the signature block. Output complete HTML only. No prose. No fences.`,
  }], 16000);

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
