import { saveLetter } from "./storage.js";
import { supabase } from "./supabase";
import { runAuditJob } from "./auditJobs.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pollForLetter(id) {
  for (let i = 0; i < 60; i++) { // wait up to 3 minutes (60 * 3s)
    await sleep(3000);
    const { data, error } = await supabase
      .from('letters')
      .select('html,summary')
      .eq('id', id)
      .neq('html', Math.random().toString()) // Cache buster to prevent aggressive browser caching
      .single();
    if (error && error.code !== 'PGRST116') { // Ignore row not found, might take a second to write
      console.error(error);
    }
    if (data && data.html && data.html !== 'GENERATING...') {
      if (data.html.startsWith('ERROR: ')) {
        throw new Error(data.html.replace('ERROR: ', ''));
      }
      return data;
    }
  }
  throw new Error('Letter generation timed out. It may still be processing in the background.');
}

const today = () => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

// ---------------------------------------------------------------------------
// Audits and Phase 2 run SERVER-SIDE
// Letters now ALSO run SERVER-SIDE. The client inserts a placeholder 'GENERATING...'
// and polls the database until the Netlify background function completes it.
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

export async function generateLetter(account, client) {
  const t = today();
  const isTypeC = account && account.type === 'C';
  const baseData = JSON.stringify({ account, client, clientSignature: client.signatureData || null }, null, 2);

  if (isTypeC) {
    const baseInstructions = `LETTER_HTML_MODE\n\nToday is ${t}. Use this exact date at the top of the letter.\n\nData:\n${baseData}\n\nIf clientSignature is provided embed it in the signature block. Do NOT include a "Certified Mail #" or any tracking/article number field or placeholder — state only "Sent via Certified Mail" with no number. Output complete HTML only. No prose. No fences.`;

    const fdcpaId = await saveLetter(account, client, 'GENERATING...', null, 'Phase 1 — FDCPA §1692g(b) Validation');
    const disputeId = await saveLetter(account, client, 'GENERATING...', null, 'Phase 1 — Furnisher Dispute §1681s-2(a)', '__dispute');

    const res = await fetch('/.netlify/functions/generate-letter-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobs: [
          {
            id: fdcpaId,
            account,
            generateSummary: true,
            instructions: baseInstructions + '\n\nGenerate ONLY the FDCPA §1692g(b) Debt Validation Demand letter. This letter demands the collector prove: (1) the amount owed, (2) the name of the original creditor, (3) proof they have the legal right to collect this debt. Cite §1692g(b) — all collection activity must cease until validation is provided. Do NOT include §1681s-2(a) furnisher dispute language in this letter. This is a standalone debt validation demand.'
          },
          {
            id: disputeId,
            account,
            generateSummary: false,
            instructions: baseInstructions + '\n\nGenerate ONLY the FCRA §1681s-2(a) Furnisher Dispute letter. This letter disputes the specific Metro 2 violations in the account data. Follow the 16-step structure. Include §1692g(b) cessation notice as a secondary demand but lead with the Metro 2 violations and FCRA demands. Do NOT make this primarily a debt validation letter.'
          }
        ]
      })
    });
    if (!res.ok) throw new Error('Could not start letter generation on the server. Please try again.');

    const [fdcpaRes, disputeRes] = await Promise.all([
      pollForLetter(fdcpaId),
      pollForLetter(disputeId)
    ]);

    return { html: disputeRes.html, summary: fdcpaRes.summary };
  }

  const instructions = `LETTER_HTML_MODE\n\nToday is ${t}. Use this exact date at the top of the letter.\n\nGenerate the Phase 1 dispute letter HTML for this account.\n\nData:\n${JSON.stringify({ account, client, clientSignature: client.signatureData || null }, null, 2)}\n\nFollow the 16-step structure. If clientSignature is provided embed it in the signature block. Do NOT include a "Certified Mail #" or any tracking/article number field or placeholder — state only "Sent via Certified Mail" with no number. Output complete HTML only. No prose. No fences.`;
  
  const id = await saveLetter(account, client, 'GENERATING...', null);
  const res = await fetch('/.netlify/functions/generate-letter-background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobs: [{ id, account, generateSummary: true, instructions }]
    })
  });
  if (!res.ok) throw new Error('Could not start letter generation on the server. Please try again.');

  return await pollForLetter(id);
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

  const syntheticAccount = { furnisher: bureau, id: 'personal-info-cleanup', type: null };
  const id = await saveLetter(syntheticAccount, client, 'GENERATING...', null, 'Personal Info Cleanup');
  
  const res = await fetch('/.netlify/functions/generate-letter-background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobs: [{ id, account: null, generateSummary: false, instructions }]
    })
  });
  if (!res.ok) throw new Error('Could not start letter generation on the server. Please try again.');

  const pollRes = await pollForLetter(id);
  return pollRes.html;
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

  const syntheticAccount = { furnisher: bureau, id: 'inquiry-removal', type: null };
  const id = await saveLetter(syntheticAccount, client, 'GENERATING...', null, 'Inquiry Removal');
  
  const res = await fetch('/.netlify/functions/generate-letter-background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobs: [{ id, account: null, generateSummary: false, instructions }]
    })
  });
  if (!res.ok) throw new Error('Could not start letter generation on the server. Please try again.');

  const pollRes = await pollForLetter(id);
  return pollRes.html;
}
