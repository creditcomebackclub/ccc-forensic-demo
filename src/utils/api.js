import Anthropic from "@anthropic-ai/sdk";
import { MASTER_SYSTEM_PROMPT } from "../prompts/masterPrompt.js";
import { saveLetter } from "./storage.js";
import { supabase } from "./supabase";
import { runAuditJob } from "./auditJobs.js";

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
    throw new Error('No Anthropic API key set - letter generation needs one. Add it in Settings (gear icon, bottom of the sidebar). Audits are unaffected; they run server-side.');
  }
  return apiKey;
}

function getClient() {
  return new Anthropic({
    apiKey: getApiKey(),
    // Letters only - audits run server-side and never touch this client
    dangerouslyAllowBrowser: true,
    // 429s retry automatically honoring the server's retry-after — replaces
    // the old fixed 60-second sleeps between bureau calls
    maxRetries: 5,
  });
}

// The master prompt is identical on every call — one cache breakpoint means
// every call after the first reads it at ~10% of the input price
const SYSTEM = [{ type: 'text', text: MASTER_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];

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

const today = () => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

// ---------------------------------------------------------------------------
// Audits run SERVER-SIDE (netlify/functions/audit-run-background.mjs) — the
// browser uploads files, creates an audit_jobs row, and polls for progress.
// No Anthropic key is used or stored client-side for audits. The wrappers
// below keep the call signatures App.jsx uses.
// ---------------------------------------------------------------------------

export async function runAudit(file, onProgress) {
  return runAuditJob({ mode: 'combined', files: [{ file }] }, onProgress);
}

export async function runTripleBureauAudit(files, onProgress) {
  return runAuditJob({
    mode: 'individual',
    files: [
      { file: files.equifax, bureau: 'Equifax' },
      { file: files.experian, bureau: 'Experian' },
      { file: files.transunion, bureau: 'TransUnion' },
    ],
  }, onProgress);
}

export async function runSingleBureauAudit(file, bureau, onProgress) {
  return runAuditJob({ mode: 'single', files: [{ file, bureau }] }, onProgress);
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
