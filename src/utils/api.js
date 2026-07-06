import { MASTER_SYSTEM_PROMPT } from "../prompts/masterPrompt.js";
import { saveAudit, saveLetter } from "./storage.js";
import { supabase } from "./supabase";

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
  if (objMatch) { try { return JSON.parse(objMatch[0]); } catch (e) {
    console.error('JSON parse failed, first 500 chars:', objMatch[0].slice(0, 500));
  } }
  try { return JSON.parse(text.trim()); } catch (e) {}
  console.error('Full response (first 1000 chars):', text.slice(0, 1000));
  throw new Error('Could not parse JSON from response');
}

async function claudeCall(apiKey, userContent, maxTokens = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);
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

function pdfContent(base64, label, mediaType) {
  if (mediaType && (mediaType.includes('html') || mediaType.includes('text'))) {
    try {
      const decoded = atob(base64);
      return [
        { type: 'text', text: 'CREDIT REPORT CONTENT (HTML/TEXT FORMAT):\n\n' + decoded.slice(0, 200000) },
        { type: 'text', text: label },
      ];
    } catch(e) { /* fallback to pdf below */ }
  }
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

export async function runAudit(pdfBase64, fileType) {
  const apiKey = getApiKey();
  const t = today();
  const rawText = await claudeCall(apiKey, pdfContent(pdfBase64,
    `AUDIT_JSON_MODE\n\nToday is ${t}. Perform a full forensic Metro 2 and FCRA audit of the attached three-bureau credit report. Return the complete JSON object per the schema in your instructions. Identify every violation. Classify accounts A, B, or C. Rank into Batch 1 top 5 and Batch 2 remaining. Output JSON only. No prose. No code fences.\n\nIMPORTANT — MyFICO TEXT FORMAT PARSING RULES: If this report is in MyFICO plain text format, account data is presented in three columns (Equifax, TransUnion, Experian) separated by spaces. Dashes (–) mean the bureau does not report that field. For Balance fields formatted as "Balance – – $1,234" extract $1,234 as the balance. For fields showing three values like "Balance $1,200 $1,200 $1,234" extract the highest or most recent non-zero value. Never report $0 balance unless ALL three columns explicitly show $0. Account names are often split across multiple lines — reconstruct the full furnisher name from context.`,
    fileType
  ));
  const json = extractJSON(rawText);
  if (json && json.client) await saveAudit(json);
  return { audit: json };
}

export async function runTripleBureauAudit(eqBase64, expBase64, tuBase64, onProgress) {
  const apiKey = getApiKey();
  const t = today();

  const bureauPrompt = (bureau) =>
    `BUREAU_AUDIT_JSON_MODE\n\nToday is ${t}. Bureau: ${bureau}.\n\nParse this single-bureau credit report. Extract client info, score, every account, every hard inquiry, and every personal information variant (former addresses, name variants, former employers) shown in the report.\n\nFor accounts, extract: furnisher, account number (masked), type, status, balance, pastDue, lastPaymentDate, dofd, paymentHistory, remarks, Metro 2 violations (field, currentValue, expectedValue, reason), accountClassification (A/B/C).\n\nFor inquiries, extract every hard inquiry listed: furnisher name, date of inquiry, and type if stated (e.g. 'Individual', 'Joint', 'Promotional'). Do not omit any inquiry regardless of age.\n\nFor personal information, extract every former/alternate address, every name variant, and every former employer listed in the report's personal information or 'also known as' section.\n\nOutput JSON only:\n{"bureau":"${bureau}","client":{"name":"","address":"","score":0},"accounts":[{"furnisher":"","accountNumber":"","type":"","status":"","balance":0,"pastDue":0,"lastPaymentDate":"","dofd":"","paymentHistory":"","accountClassification":"A","violations":[{"field":"","currentValue":"","expectedValue":"","reason":""}]}],"inquiries":[{"furnisher":"","date":"","type":""}],"personalInfo":{"formerAddresses":[""],"nameVariants":[""],"formerEmployers":[""]}}`;

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

export async function runSingleBureauAudit(pdfBase64, bureau, fileType) {
  const apiKey = getApiKey();
  const t = today();
  const rawText = await claudeCall(apiKey, pdfContent(pdfBase64,
    `AUDIT_JSON_MODE\n\nToday is ${t}. Bureau: ${bureau} only. Perform a forensic Metro 2 and FCRA audit. No cross-bureau comparisons possible. Return complete JSON per standard schema. JSON only.`,
    fileType
  ));
  const json = extractJSON(rawText);
  if (json && json.client) await saveAudit(json);
  return { audit: json, bureau };
}

export async function generateLetterSummary(account) {
  const apiKey = getApiKey();
  const rawText = await claudeCall(apiKey, [{
    type: 'text',
    text: `Write a 2-3 sentence plain-English summary for a non-expert client explaining what is being disputed on this account and why, based on the data below. Avoid legal jargon and statute citations \u2014 explain the core problem in everyday terms (e.g. "this account shows two things that can't both be true at the same time"). End with a brief note on what we're asking the furnisher to do. Output plain text only. No markdown, no headers, no fences, no prose before or after.\n\nAccount data:\n${JSON.stringify({ furnisher: account.furnisher, status: account.status, balance: account.balance, primaryViolation: account.primaryViolation, violations: account.violations }, null, 2)}`,
  }], 1024);

  const summary = (rawText || '').trim();
  if (!summary) throw new Error('Letter summary generation returned empty content');
  return summary;
}

export async function generateLetter(account, client) {
  const apiKey = getApiKey();
  const t = today();
  const isTypeC = account && account.type === 'C';

  if (isTypeC) {
    // Type C — generate TWO letters simultaneously: FDCPA validation + furnisher dispute
    const baseData = JSON.stringify({ account, client, clientSignature: client.signatureData || null }, null, 2);
    const baseInstructions = `LETTER_HTML_MODE\n\nToday is ${t}. Use this exact date at the top of the letter.\n\nData:\n${baseData}\n\nIf clientSignature is provided embed it in the signature block. Do NOT include a "Certified Mail #" or any tracking/article number field or placeholder — state only "Sent via Certified Mail" with no number. Output complete HTML only. No prose. No fences.`;

    const [fdcpaRaw, disputeRaw] = await Promise.all([
      claudeCall(apiKey, [{
        type: 'text',
        text: baseInstructions + '\n\nGenerate ONLY the FDCPA §1692g(b) Debt Validation Demand letter. This letter demands the collector prove: (1) the amount owed, (2) the name of the original creditor, (3) proof they have the legal right to collect this debt. Cite §1692g(b) — all collection activity must cease until validation is provided. Do NOT include §1681s-2(a) furnisher dispute language in this letter. This is a standalone debt validation demand.',
      }], 16000),
      claudeCall(apiKey, [{
        type: 'text',
        text: baseInstructions + '\n\nGenerate ONLY the FCRA §1681s-2(a) Furnisher Dispute letter. This letter disputes the specific Metro 2 violations in the account data. Follow the 16-step structure. Include §1692g(b) cessation notice as a secondary demand but lead with the Metro 2 violations and FCRA demands. Do NOT make this primarily a debt validation letter.',
      }], 16000),
    ]);

    const extractHtml = (raw) => {
      const m = raw.match(/<!DOCTYPE[\s\S]*<\/html>/i) || raw.match(/<html[\s\S]*<\/html>/i);
      return m ? m[0] : raw;
    };

    const fdcpaHtml = extractHtml(fdcpaRaw);
    const disputeHtml = extractHtml(disputeRaw);

    if (!fdcpaHtml || fdcpaHtml.trim().length < 100) throw new Error('FDCPA letter generation failed — please try again');
    if (!disputeHtml || disputeHtml.trim().length < 100) throw new Error('Furnisher dispute letter generation failed — please try again');

    let summary = null;
    try { summary = await generateLetterSummary(account); } catch(e) {}

    // Save both letters with distinct phases and IDs
    await saveLetter(account, client, fdcpaHtml, summary, 'Phase 1 — FDCPA §1692g(b) Validation');
    await saveLetter(account, client, disputeHtml, summary, 'Phase 1 — Furnisher Dispute §1681s-2(a)', '__dispute');

    return { html: disputeHtml, summary };
  }

  // Type A/B — single letter
  const rawText = await claudeCall(apiKey, [{
    type: 'text',
    text: `LETTER_HTML_MODE\n\nToday is ${t}. Use this exact date at the top of the letter.\n\nGenerate the Phase 1 dispute letter HTML for this account.\n\nData:\n${JSON.stringify({ account, client, clientSignature: client.signatureData || null }, null, 2)}\n\nFollow the 16-step structure. If clientSignature is provided embed it in the signature block. Do NOT include a "Certified Mail #" or any tracking/article number field or placeholder — state only "Sent via Certified Mail" with no number. Output complete HTML only. No prose. No fences.`,
  }], 16000);

  const htmlMatch = rawText.match(/<!DOCTYPE[\s\S]*<\/html>/i) || rawText.match(/<html[\s\S]*<\/html>/i);
  const html = htmlMatch ? htmlMatch[0] : rawText;
  if (!html || html.trim().length < 100) throw new Error('Letter generation returned empty content — please try again');

  let summary = null;
  try { summary = await generateLetterSummary(account); } catch(e) { console.warn('Could not generate letter summary:', e); }

  await saveLetter(account, client, html, summary);
  return { html, summary };
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}


export async function generatePersonalInfoCleanupLetter(client) {
  const apiKey = getApiKey();
  const t = today();

  const personalInfo = (client && client.personalInfo) || {};
  const bureau = (client && client.bureau) || 'the consumer reporting agency';

  const lpoaSigned = !!(client && client.lpoaSigned);
  let signatureData = null;
  try {
    const { data: cp } = await supabase.from('client_profiles').select('signature_data').eq('full_name', client.name).limit(1);
    if (cp && cp.length > 0 && cp[0].signature_data) {
      signatureData = cp[0].signature_data;
    }
    if (!signatureData) {
      const { data: cm } = await supabase.from('clients').select('lpoa_signature_data').eq('name', client.name).limit(1);
      if (cm && cm.length > 0 && cm[0].lpoa_signature_data?.signatureUrl) {
        signatureData = cm[0].lpoa_signature_data.signatureUrl;
      }
    }
  } catch(e) { console.warn('Could not look up signature:', e); }
  const data = JSON.stringify({ client, personalInfo, bureau, lpoaSigned, clientSignature: signatureData }, null, 2);

  const instructions = `LETTER_HTML_MODE\n\nToday is ${t}. Use this exact date at the top of the letter.\n\nYou are drafting a Personal Information Accuracy Dispute addressed directly to ${bureau}, NOT to any furnisher. This is a completely separate letter type from a Metro 2 tradeline dispute — it does not dispute any account, balance, or payment history. It disputes only the accuracy of identifying information in the consumer's file.\n\nData:\n${data}\n\nLETTER REQUIREMENTS:\n1. Address the letter to the bureau's dispute department, not a furnisher.\n2. Cite 15 U.S.C. §1681e(b) — the maximum possible accuracy standard.\n3. Explain that stale former addresses, name variants, and former employers listed in personalInfo increase mixed-file risk and do not reflect the consumer's current, accurate identity.\n4. List each specific former address, name variant, and former employer provided in the data, and demand each one be removed or updated to reflect only current, verified information.\n5. Do NOT dispute any account, balance, payment history, or inquiry in this letter. This letter concerns identity information only.\n6. Demand written confirmation of the correction within 30 days.\n7. Tone: forensic and factual, consistent with the firm's standard letter voice — no goodwill language, no emotional appeals, statements and demands only.\n8. If clientSignature is provided embed it in the signature block. Do NOT include a "Certified Mail #" or tracking number placeholder — state only "Sent via Certified Mail."\n9. lpoaSigned is provided in the data. If lpoaSigned is true, include "Limited Power of Attorney" in the enclosures line. If lpoaSigned is false, do NOT list a Limited Power of Attorney as an enclosure under any circumstance — list only Government-Issued Photo ID and Proof of Current Address.\n\nOutput complete HTML only. No prose. No fences.`;

  const raw = await claudeCall(apiKey, [{ type: 'text', text: instructions }], 8000);
  const m = raw.match(/<!DOCTYPE[\s\S]*<\/html>/i) || raw.match(/<html[\s\S]*<\/html>/i);
  const html = m ? m[0] : raw;

  if (!html || html.trim().length < 100) throw new Error('Personal information cleanup letter generation failed — please try again');

  const syntheticAccount = { furnisher: bureau, id: 'personal-info-cleanup', type: null };
  await saveLetter(syntheticAccount, client, html, null, 'Personal Info Cleanup');
  return html;
}

export async function generateInquiryRemovalLetter(client, inquiries) {
  const apiKey = getApiKey();
  const t = today();

  const bureau = (client && client.bureau) || 'the consumer reporting agency';
  const eligibleInquiries = (inquiries || []).filter((i) => i.category !== 'linked_to_open_account');

  if (eligibleInquiries.length === 0) throw new Error('No eligible inquiries to dispute — all provided inquiries are linked to open accounts');

  const lpoaSigned = !!(client && client.lpoaSigned);
  let signatureData = null;
  try {
    const { data: cp } = await supabase.from('client_profiles').select('signature_data').eq('full_name', client.name).limit(1);
    if (cp && cp.length > 0 && cp[0].signature_data) {
      signatureData = cp[0].signature_data;
    }
    if (!signatureData) {
      const { data: cm } = await supabase.from('clients').select('lpoa_signature_data').eq('name', client.name).limit(1);
      if (cm && cm.length > 0 && cm[0].lpoa_signature_data?.signatureUrl) {
        signatureData = cm[0].lpoa_signature_data.signatureUrl;
      }
    }
  } catch(e) { console.warn('Could not look up signature:', e); }
  const data = JSON.stringify({ client, inquiries: eligibleInquiries, bureau, lpoaSigned, clientSignature: signatureData }, null, 2);

  const instructions = `LETTER_HTML_MODE\n\nToday is ${t}. Use this exact date at the top of the letter.\n\nYou are drafting an Inquiry Reinvestigation Demand addressed directly to ${bureau}, NOT to any furnisher. This letter disputes only the hard inquiries listed in the data below. It does not dispute any tradeline, account, balance, or payment history.\n\nData:\n${data}\n\nLETTER REQUIREMENTS:\n1. Address the letter to the bureau's dispute department.\n2. Cite 15 U.S.C. §1681i for the reinvestigation duty and 15 U.S.C. §1681b for the permissible purpose requirement every inquiry must satisfy.\n3. For each inquiry listed, state the furnisher name and date, and state that the consumer does not recognize or cannot verify a permissible purpose for this specific inquiry.\n4. Demand the bureau contact each listed subscriber to verify permissible purpose, and demand deletion of any inquiry the subscriber cannot verify within 30 days per 15 U.S.C. §1681i(a)(5)(A).\n5. Do NOT state or imply fraud or identity theft unless that is explicitly present in the provided data — the default framing is "cannot verify/does not recognize," not an accusation.\n6. Do NOT dispute any account, balance, or payment history in this letter.\n7. Demand written confirmation of the results within 30 days.\n8. Tone: forensic and factual, consistent with the firm's standard letter voice — no goodwill language, statements and demands only.\n9. If clientSignature is provided embed it in the signature block. Do NOT include a "Certified Mail #" or tracking number placeholder — state only "Sent via Certified Mail."\n10. lpoaSigned is provided in the data. If lpoaSigned is true, include "Limited Power of Attorney" in the enclosures line. If lpoaSigned is false, do NOT list a Limited Power of Attorney as an enclosure under any circumstance — list only Government-Issued Photo ID and Proof of Current Address.\n\nOutput complete HTML only. No prose. No fences.`;

  const raw = await claudeCall(apiKey, [{ type: 'text', text: instructions }], 8000);
  const m = raw.match(/<!DOCTYPE[\s\S]*<\/html>/i) || raw.match(/<html[\s\S]*<\/html>/i);
  const html = m ? m[0] : raw;

  if (!html || html.trim().length < 100) throw new Error('Inquiry removal letter generation failed — please try again');

  const syntheticAccount = { furnisher: bureau, id: 'inquiry-removal', type: null };
  await saveLetter(syntheticAccount, client, html, null, 'Inquiry Removal');
  return html;
}
