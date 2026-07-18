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

export async function generateCombinedCleanupLetter(client, inquiries) {
  const t = today();
  const personalInfo = (client && client.personalInfo) || {};
  const hasPersonalInfo = (personalInfo.formerAddresses || []).length > 0 ||
                          (personalInfo.nameVariants || []).length > 0 ||
                          (personalInfo.formerEmployers || []).length > 0;
  const eligibleInquiries = (inquiries || []).filter((i) => i.category !== 'linked_to_open_account');
  const hasInquiries = eligibleInquiries.length > 0;

  if (!hasPersonalInfo && !hasInquiries) {
    throw new Error('No eligible inquiries or personal information to dispute.');
  }

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
  
  const data = JSON.stringify({ client, personalInfo: hasPersonalInfo ? personalInfo : undefined, inquiries: hasInquiries ? eligibleInquiries : undefined, bureau, lpoaSigned, clientSignature: signatureData }, null, 2);
  
  const instructions = `LETTER_HTML_MODE\n\nToday is ${t}. Use this exact date at the top of the letter.\n\nYou are drafting a Personal Information & Inquiry Reinvestigation Demand addressed directly to ${bureau}, NOT to any furnisher. This letter disputes both the accuracy of identifying information in the consumer's file AND unverified hard inquiries. It does NOT dispute any tradeline, account balance, or payment history.\n\nData:\n${data}\n\nLETTER REQUIREMENTS:\n1. Address the letter to the bureau's dispute department.\n2. Cite 15 U.S.C. §1681e(b) for the maximum possible accuracy standard regarding the personal information (if any is provided).\n3. Cite 15 U.S.C. §1681i for the reinvestigation duty and 15 U.S.C. §1681b for the permissible purpose requirement for each inquiry listed (if any are provided).\n4. For personal info: List each specific former address, name variant, and former employer provided in the data, and demand each one be removed or updated to reflect only current, verified information.\n5. For inquiries: For each inquiry listed, state the furnisher name and date, and state that the consumer does not recognize or cannot verify a permissible purpose for this specific inquiry. Demand the bureau contact each listed subscriber to verify permissible purpose, and demand deletion of any inquiry the subscriber cannot verify within 30 days per 15 U.S.C. §1681i(a)(5)(A).\n6. Do NOT state or imply fraud or identity theft unless that is explicitly present in the provided data.\n7. Do NOT dispute any account, balance, or payment history in this letter.\n8. Demand written confirmation of the results within 30 days.\n9. Tone: forensic and factual, consistent with the firm's standard letter voice — no goodwill language, statements and demands only.\n10. ALWAYS include a signature block at the bottom of the letter. Print the consumer's full name. If \`clientSignature\` is provided in the data, embed it using an <img> tag above the printed name with a style like \`max-height: 60px;\`. If \`clientSignature\` is null, simply leave a few blank lines above the printed name for a physical signature. Do NOT include a "Certified Mail #" or tracking number placeholder — state only "Sent via Certified Mail."\n11. ALWAYS include an "Enclosures:" section below the signature block. If \`lpoaSigned\` is true, list: "Limited Power of Attorney", "Government-Issued Photo ID", and "Proof of Current Address (Bank Statement)". If \`lpoaSigned\` is false, list ONLY: "Government-Issued Photo ID" and "Proof of Current Address (Bank Statement)".\n12. CRITICAL CONCISENESS RULE: Do NOT generate a separate 'STATUTORY OBLIGATIONS' or 'LEGAL BASIS' table or section. Incorporate all legal citations directly inline in the brief introductory paragraphs. Do NOT generate any CSS, <style> block, or inline style attributes. Output plain HTML using these exact classes: class='id-table', class='list-table', class='demands-table', class='signature-block', class='enclosures', class='mail-notation'. This is required to prevent the API output from truncating.\n\nOutput complete HTML only. No prose. No fences.`;

  const syntheticAccount = { furnisher: bureau, id: 'personal-info-inquiries', type: null };
  const id = await saveLetter(syntheticAccount, client, 'GENERATING...', null, 'Personal Info & Inquiries');
  
  const res = await fetch('/.netlify/functions/generate-letter-background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobs: [{ id, account: null, generateSummary: false, instructions }]
    })
  });
  if (!res.ok) throw new Error('Could not start letter generation on the server. Please try again.');

  // Fire-and-forget
  return 'GENERATING...';
}

export async function getReturnReceiptUrl(lobId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch('/.netlify/functions/get-return-receipt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`
    },
    body: JSON.stringify({ lobId })
  });
  
  if (res.status === 404) return null;
  if (!res.ok) {
    let msg = 'Failed to fetch return receipt';
    try { const body = await res.json(); msg = body.error || msg; } catch(e) {}
    throw new Error(msg);
  }
  
  const data = await res.json();
  return data.return_receipt_url;
}
