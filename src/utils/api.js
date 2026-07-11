import Anthropic from "@anthropic-ai/sdk";
import { MASTER_SYSTEM_PROMPT } from "../prompts/masterPrompt.js";
import { AUDIT_SCHEMA, BUREAU_SCHEMA } from "./auditSchemas.js";
import { saveAudit, saveLetter } from "./storage.js";
import { supabase } from "./supabase";
import { MAX_REPORT_CHARS, decodeBase64Utf8, htmlToText } from "./reportText.js";

const MODEL = 'claude-sonnet-5';

function getApiKey() {
  // Settings modal stores under 'anthropic_api_key'; 'ccc_api_key' is the
  // legacy location the old prompt() flow wrote to — migrate it forward
  let apiKey = localStorage.getItem('anthropic_api_key');
  if (!apiKey) {
    const legacy = localStorage.getItem('ccc_api_key');
    if (legacy) {
      localStorage.setItem('anthropic_api_key', legacy);
      apiKey = legacy;
    }
  }
  if (!apiKey) {
    throw new Error('No Anthropic API key set. Add your key in Settings (gear icon, bottom of the sidebar) and try again.');
  }
  return apiKey;
}

function getClient() {
  return new Anthropic({
    apiKey: getApiKey(),
    // Internal tool: each auditor supplies their own key via Settings
    dangerouslyAllowBrowser: true,
    // 429s retry automatically honoring the server's retry-after — replaces
    // the old fixed 60-second sleeps between bureau calls
    maxRetries: 5,
  });
}

// The master prompt is identical on every call — one cache breakpoint means
// every call after the first reads it at ~10% of the input price
const SYSTEM = [{ type: 'text', text: MASTER_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];

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

async function claudeCall(userContent, { maxTokens = 64000, schema = null, onTokens = null } = {}) {
  const client = getClient();
  const params = {
    model: MODEL,
    max_tokens: maxTokens,
    system: SYSTEM,
    messages: [{ role: 'user', content: userContent }],
  };
  // Structured outputs: the API guarantees the response is valid JSON
  // matching the schema — no more parse failures after a long run
  if (schema) params.output_config = { format: { type: 'json_schema', schema } };

  const stream = client.messages.stream(params);
  if (onTokens) {
    let chars = 0;
    stream.on('text', (delta) => {
      chars += delta.length;
      // ~4 chars/token is close enough for a live progress readout
      onTokens(Math.round(chars / 4));
    });
  }
  const msg = await stream.finalMessage();

  // Cost visibility: every call logs real token usage + estimated cost.
  // Sonnet 5 intro pricing ($2/M in, $10/M out, cache reads $0.20/M,
  // cache writes $2.50/M) — valid through 2026-08-31.
  try {
    const u = msg.usage || {};
    const cost = ((u.input_tokens || 0) * 2 + (u.output_tokens || 0) * 10
      + (u.cache_read_input_tokens || 0) * 0.2 + (u.cache_creation_input_tokens || 0) * 2.5) / 1e6;
    console.log('[audit-usage]', JSON.stringify({
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      cache_read: u.cache_read_input_tokens || 0,
      cache_write: u.cache_creation_input_tokens || 0,
      est_cost_usd: Math.round(cost * 10000) / 10000,
      stop_reason: msg.stop_reason,
    }));
  } catch (e) { /* logging only */ }

  if (msg.stop_reason === 'max_tokens') {
    throw new Error('The analysis hit the output limit before finishing — the report may be too large for one pass. Try Individual mode with one file per bureau.');
  }
  if (msg.stop_reason === 'refusal') {
    throw new Error('The model declined this request. Check the report content and try again.');
  }
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

function parseAuditJSON(rawText) {
  // Structured outputs guarantee valid JSON; extractJSON stays as a belt-and-
  // suspenders fallback for any edge case
  try { return JSON.parse(rawText); } catch (e) { return extractJSON(rawText); }
}

function pdfContent(base64, label, mediaType) {
  if (mediaType && (mediaType.includes('html') || mediaType.includes('text'))) {
    let text = null;
    try {
      text = decodeBase64Utf8(base64);
      if (mediaType.includes('html')) text = htmlToText(text);
    } catch (e) {
      text = null; /* undecodable — fall back to the PDF path below */
    }
    if (text !== null) {
      // Never truncate silently — a clipped report yields a confident audit
      // that's simply missing the later accounts and inquiries
      if (text.length > MAX_REPORT_CHARS) {
        throw new Error(
          'This report is still ' + Math.round(text.length / 1000) + 'k characters of text after cleanup — too large to audit in one pass (limit '
          + Math.round(MAX_REPORT_CHARS / 1000) + 'k). Split it into per-bureau files and use Individual mode, or export a smaller report.'
        );
      }
      return [
        { type: 'text', text: 'CREDIT REPORT CONTENT (HTML/TEXT FORMAT):\n\n' + text },
        { type: 'text', text: label },
      ];
    }
  }
  return [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
    { type: 'text', text: label },
  ];
}

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

export async function runAudit(pdfBase64, fileType, onProgress) {
  const t = today();
  onProgress && onProgress({ stage: 'Analyzing 3-bureau report', pct: null, tokens: 0 });
  const rawText = await claudeCall(pdfContent(pdfBase64,
    `AUDIT_JSON_MODE\n\nToday is ${t}. Perform a full forensic Metro 2 and FCRA audit of the attached three-bureau credit report. Return the complete JSON object per the schema in your instructions. Identify every violation. Classify accounts A, B, or C. Rank into Batch 1 top 5 and Batch 2 remaining. Output JSON only. No prose. No code fences.\n\nIMPORTANT — MyFICO TEXT FORMAT PARSING RULES: If this report is in MyFICO plain text format, account data is presented in three columns (Equifax, TransUnion, Experian) separated by spaces. Dashes (–) mean the bureau does not report that field. For Balance fields formatted as "Balance – – $1,234" extract $1,234 as the balance. For fields showing three values like "Balance $1,200 $1,200 $1,234" extract the highest or most recent non-zero value. Never report $0 balance unless ALL three columns explicitly show $0. Account names are often split across multiple lines — reconstruct the full furnisher name from context.`,
    fileType
  ), {
    schema: AUDIT_SCHEMA,
    onTokens: (tokens) => onProgress && onProgress({ stage: 'Analyzing 3-bureau report', pct: null, tokens }),
  });
  const json = parseAuditJSON(rawText);
  if (json && json.client) await saveAudit(json);
  return { audit: json };
}

export async function runTripleBureauAudit(eqBase64, expBase64, tuBase64, onProgress, fileTypes) {
  const t = today();
  const types = fileTypes || {};
  const report = (stage, pct) => (tokens) => onProgress && onProgress({ stage, pct, tokens: tokens || 0 });

  const bureauPrompt = (bureau) =>
    `BUREAU_AUDIT_JSON_MODE\n\nToday is ${t}. Bureau: ${bureau}.\n\nParse this single-bureau credit report. Extract client info, score, every account, every hard inquiry, and every personal information variant (former addresses, name variants, former employers) shown in the report.\n\nFor accounts, extract: furnisher, account number (masked), type, status, balance, pastDue, lastPaymentDate, dofd, paymentHistory, remarks, Metro 2 violations (field, currentValue, expectedValue, reason), accountClassification (A/B/C).\n\nFor inquiries, extract every hard inquiry listed: furnisher name, date of inquiry, and type if stated (e.g. 'Individual', 'Joint', 'Promotional'). Do not omit any inquiry regardless of age.\n\nFor personal information, extract every former/alternate address, every name variant, and every former employer listed in the report's personal information or 'also known as' section.\n\nOutput JSON only:\n{"bureau":"${bureau}","client":{"name":"","address":"","score":0},"accounts":[{"furnisher":"","accountNumber":"","type":"","status":"","balance":0,"pastDue":0,"lastPaymentDate":"","dofd":"","paymentHistory":"","accountClassification":"A","violations":[{"field":"","currentValue":"","expectedValue":"","reason":""}]}],"inquiries":[{"furnisher":"","date":"","type":""}],"personalInfo":{"formerAddresses":[""],"nameVariants":[""],"formerEmployers":[""]}}`;

  // No fixed sleeps between calls — the SDK retries 429s automatically using
  // the server's retry-after header, so we only ever wait when actually limited.
  // Sequential order also means calls 2-4 read the cached system prompt.
  report('Analyzing Equifax report', 5)(0);
  const eqText = await claudeCall(pdfContent(eqBase64, bureauPrompt('Equifax'), types.equifax),
    { schema: BUREAU_SCHEMA, onTokens: report('Analyzing Equifax report', 5) });
  const eqData = parseAuditJSON(eqText);

  report('Analyzing Experian report', 30)(0);
  const expText = await claudeCall(pdfContent(expBase64, bureauPrompt('Experian'), types.experian),
    { schema: BUREAU_SCHEMA, onTokens: report('Analyzing Experian report', 30) });
  const expData = parseAuditJSON(expText);

  report('Analyzing TransUnion report', 55)(0);
  const tuText = await claudeCall(pdfContent(tuBase64, bureauPrompt('TransUnion'), types.transunion),
    { schema: BUREAU_SCHEMA, onTokens: report('Analyzing TransUnion report', 55) });
  const tuData = parseAuditJSON(tuText);

  report('Cross-bureau reconciliation & ranking', 80)(0);
  const mergePrompt = `MERGE_AUDIT_JSON_MODE\n\nToday is ${t}.\n\nMerge these three bureau reports into a unified forensic audit. Match accounts across bureaus. Identify cross-bureau violations. Classify each account A/B/C. Rank top 5 as Batch 1, rest as Batch 2. Return complete audit JSON.\n\nData:\n${JSON.stringify({ equifax: trimBureau(eqData), experian: trimBureau(expData), transunion: trimBureau(tuData) }, null, 2)}\n\nJSON only.`;

  const mergeText = await claudeCall([{ type: 'text', text: mergePrompt }],
    { schema: AUDIT_SCHEMA, maxTokens: 32000, onTokens: report('Cross-bureau reconciliation & ranking', 80) });
  const merged = parseAuditJSON(mergeText);

  if (merged && merged.client) {
    merged.client.scores = merged.client.scores || {};
    if (eqData?.client?.score) merged.client.scores.equifax = eqData.client.score;
    if (expData?.client?.score) merged.client.scores.experian = expData.client.score;
    if (tuData?.client?.score) merged.client.scores.transunion = tuData.client.score;
    await saveAudit(merged);
  }

  onProgress && onProgress({ stage: 'Complete', pct: 100, tokens: 0 });
  return { audit: merged, bureauData: { equifax: eqData, experian: expData, transunion: tuData } };
}

export async function runSingleBureauAudit(pdfBase64, bureau, fileType, onProgress) {
  const t = today();
  onProgress && onProgress({ stage: 'Analyzing ' + bureau + ' report', pct: null, tokens: 0 });
  const rawText = await claudeCall(pdfContent(pdfBase64,
    `AUDIT_JSON_MODE\n\nToday is ${t}. Bureau: ${bureau} only. Perform a forensic Metro 2 and FCRA audit. No cross-bureau comparisons possible. Return complete JSON per standard schema. JSON only.`,
    fileType
  ), {
    schema: AUDIT_SCHEMA,
    onTokens: (tokens) => onProgress && onProgress({ stage: 'Analyzing ' + bureau + ' report', pct: null, tokens }),
  });
  const json = parseAuditJSON(rawText);
  if (json && json.client) await saveAudit(json);
  return { audit: json, bureau };
}

export async function generateLetterSummary(account) {
  const rawText = await claudeCall([{
    type: 'text',
    text: `Write a 2-3 sentence plain-English summary for a non-expert client explaining what is being disputed on this account and why, based on the data below. Avoid legal jargon and statute citations \u2014 explain the core problem in everyday terms (e.g. "this account shows two things that can't both be true at the same time"). End with a brief note on what we're asking the furnisher to do. Output plain text only. No markdown, no headers, no fences, no prose before or after.\n\nAccount data:\n${JSON.stringify({ furnisher: account.furnisher, status: account.status, balance: account.balance, primaryViolation: account.primaryViolation, violations: account.violations }, null, 2)}`,
  }], { maxTokens: 1024 });

  const summary = (rawText || '').trim();
  if (!summary) throw new Error('Letter summary generation returned empty content');
  return summary;
}

export async function generateLetter(account, client) {
  const t = today();
  const isTypeC = account && account.type === 'C';

  if (isTypeC) {
    // Type C — generate TWO letters simultaneously: FDCPA validation + furnisher dispute
    const baseData = JSON.stringify({ account, client, clientSignature: client.signatureData || null }, null, 2);
    const baseInstructions = `LETTER_HTML_MODE\n\nToday is ${t}. Use this exact date at the top of the letter.\n\nData:\n${baseData}\n\nIf clientSignature is provided embed it in the signature block. Do NOT include a "Certified Mail #" or any tracking/article number field or placeholder — state only "Sent via Certified Mail" with no number. Output complete HTML only. No prose. No fences.`;

    const [fdcpaRaw, disputeRaw] = await Promise.all([
      claudeCall([{
        type: 'text',
        text: baseInstructions + '\n\nGenerate ONLY the FDCPA §1692g(b) Debt Validation Demand letter. This letter demands the collector prove: (1) the amount owed, (2) the name of the original creditor, (3) proof they have the legal right to collect this debt. Cite §1692g(b) — all collection activity must cease until validation is provided. Do NOT include §1681s-2(a) furnisher dispute language in this letter. This is a standalone debt validation demand.',
      }], { maxTokens: 16000 }),
      claudeCall([{
        type: 'text',
        text: baseInstructions + '\n\nGenerate ONLY the FCRA §1681s-2(a) Furnisher Dispute letter. This letter disputes the specific Metro 2 violations in the account data. Follow the 16-step structure. Include §1692g(b) cessation notice as a secondary demand but lead with the Metro 2 violations and FCRA demands. Do NOT make this primarily a debt validation letter.',
      }], { maxTokens: 16000 }),
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
  const rawText = await claudeCall([{
    type: 'text',
    text: `LETTER_HTML_MODE\n\nToday is ${t}. Use this exact date at the top of the letter.\n\nGenerate the Phase 1 dispute letter HTML for this account.\n\nData:\n${JSON.stringify({ account, client, clientSignature: client.signatureData || null }, null, 2)}\n\nFollow the 16-step structure. If clientSignature is provided embed it in the signature block. Do NOT include a "Certified Mail #" or any tracking/article number field or placeholder — state only "Sent via Certified Mail" with no number. Output complete HTML only. No prose. No fences.`,
  }], { maxTokens: 16000 });

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

  const raw = await claudeCall([{ type: 'text', text: instructions }], { maxTokens: 8000 });
  const m = raw.match(/<!DOCTYPE[\s\S]*<\/html>/i) || raw.match(/<html[\s\S]*<\/html>/i);
  const html = m ? m[0] : raw;

  if (!html || html.trim().length < 100) throw new Error('Personal information cleanup letter generation failed — please try again');

  const syntheticAccount = { furnisher: bureau, id: 'personal-info-cleanup', type: null };
  await saveLetter(syntheticAccount, client, html, null, 'Personal Info Cleanup');
  return html;
}

export async function generateInquiryRemovalLetter(client, inquiries) {
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

  const raw = await claudeCall([{ type: 'text', text: instructions }], { maxTokens: 8000 });
  const m = raw.match(/<!DOCTYPE[\s\S]*<\/html>/i) || raw.match(/<html[\s\S]*<\/html>/i);
  const html = m ? m[0] : raw;

  if (!html || html.trim().length < 100) throw new Error('Inquiry removal letter generation failed — please try again');

  const syntheticAccount = { furnisher: bureau, id: 'inquiry-removal', type: null };
  await saveLetter(syntheticAccount, client, html, null, 'Inquiry Removal');
  return html;
}
