import { saveLetter } from "./storage.js";
import { supabase } from "./supabase";
import { runAuditJob } from "./auditJobs.js";
import { resolveSignatureViewUrl } from "./storagePaths.js";
import { startRound } from './rounds.js';
import { BUREAU_LABEL, resolveActiveBureaus } from './roundTargets.js';
import { buildPriorRoundLeverageBlock } from './roundEvidence.js';
import { setRouteResult } from './campaigns.js';
import { getCampaignItemBureaus } from './campaignItems.js';
export { buildPriorRoundLeverageBlock } from './roundEvidence.js';

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

// Letter generation is a staff-only, paid server operation. The endpoint
// verifies the role itself; this only forwards the current Supabase session
// so the established staff UI can authenticate that request.
async function staffJsonHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not signed in.');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

// ---------------------------------------------------------------------------
// Audits and Phase 2 run SERVER-SIDE
// Letters now ALSO run SERVER-SIDE. The client inserts a placeholder 'GENERATING...'
// and polls the database until the Netlify background function completes it.
// ---------------------------------------------------------------------------

export async function runAudit(file, onProgress, clientSelection) {
  return runAuditJob({ mode: 'combined', files: [{ file }], clientSelection }, onProgress);
}

export async function runTripleBureauAudit(files, onProgress, clientSelection) {
  return runAuditJob({
    mode: 'individual',
    files: [
      { file: files.equifax, bureau: 'Equifax' },
      { file: files.experian, bureau: 'Experian' },
      { file: files.transunion, bureau: 'TransUnion' },
    ],
    clientSelection,
  }, onProgress);
}

export async function runSingleBureauAudit(file, bureau, onProgress, clientSelection) {
  return runAuditJob({ mode: 'single', files: [{ file, bureau }], clientSelection }, onProgress);
}

export async function runMergeBureauAudits(clientSelection, onProgress) {
  return runAuditJob({ mode: 'merge', files: [], clientSelection }, onProgress);
}

async function loadPriorSources(sources = []) {
  if (!sources.length) return [];
  const letterIds = [...new Set(sources.map((item) => item.sourceLetterId).filter(Boolean))];
  const evidenceIds = [...new Set(sources.map((item) => item.responseEvidenceId).filter(Boolean))];
  const [{ data: letters, error: letterError }, evidenceResult] = await Promise.all([
    supabase.from('letters').select('id,target_type,target_bureau,html,summary,phase,date,saved_at').in('id', letterIds),
    evidenceIds.length
      ? supabase.from('response_evidence').select('id,letter_id,response_kind,evidence_kind,analysis,review_status,received_at').in('id', evidenceIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (letterError) throw new Error('Could not load prior letters: ' + letterError.message);
  if (evidenceResult.error) throw new Error('Could not load prior response evidence: ' + evidenceResult.error.message);
  const byLetter = new Map((letters || []).map((row) => [row.id, row]));
  const byEvidence = new Map((evidenceResult.data || []).map((row) => [row.id, row]));
  return sources.map((source, index) => {
    const letter = byLetter.get(source.sourceLetterId);
    const evidence = source.responseEvidenceId ? byEvidence.get(source.responseEvidenceId) : null;
    if (!letter) throw new Error('A selected prior letter is no longer available.');
    if (source.responseEvidenceId && (!evidence || evidence.letter_id !== letter.id)) {
      throw new Error('Selected prior evidence does not belong to the selected prior letter.');
    }
    return { ...source, sourceOrder: source.sourceOrder ?? index, letter, evidence };
  });
}

/**
 * Explicit-target round generator. The atomic RPC creates every placeholder;
 * the background generator can then retry individual failed siblings safely.
 */
export async function generateRoundLetter({
  account,
  client,
  targetType,
  selectedBureaus = [],
  priorSources = [],
}) {
  if (!account?.clientAccountId) throw new Error('This account must be reconciled to a stable identity before starting a round.');
  if (!client?.id) throw new Error('A stable client ID is required before starting a round.');
  if (!['furnisher', 'bureau'].includes(targetType)) throw new Error('Choose furnisher or bureau before generating.');

  let bureaus = [];
  if (targetType === 'bureau') {
    const resolved = await resolveActiveBureaus({
      clientId: client.id,
      clientName: client.name,
      clientAccountId: account.clientAccountId,
      accountId: account.accountNumberMasked || account.id,
      furnisher: account.furnisher,
    });
    const active = new Set(resolved.activeBureaus);
    bureaus = [...new Set(selectedBureaus.map((value) => String(value).toLowerCase()))];
    if (!bureaus.length) throw new Error('Confirm at least one reporting bureau.');
    if (bureaus.some((bureau) => !active.has(bureau))) {
      throw new Error('A selected bureau is not proven active for this account on the latest audit.');
    }
  }

  const isTypeC = account.type === 'C';
  const letterSpecs = targetType === 'bureau'
    ? bureaus.map((targetBureau) => ({
      furnisher: account.furnisher,
      account_id: account.accountNumberMasked || account.id || '',
      type: account.type || null,
      target_bureau: targetBureau,
      dispute_basis: null,
    }))
    : isTypeC
      ? [
        { furnisher: account.furnisher, account_id: account.accountNumberMasked || account.id || '', type: account.type, dispute_basis: 'FDCPA' },
        { furnisher: account.furnisher, account_id: account.accountNumberMasked || account.id || '', type: account.type, dispute_basis: 'FCRA_DIRECT' },
      ]
      : [{ furnisher: account.furnisher, account_id: account.accountNumberMasked || account.id || '', type: account.type || null, dispute_basis: 'FCRA_DIRECT' }];

  const loadedSources = await loadPriorSources(priorSources);
  const sourcePayload = loadedSources.map((source) => ({
    source_letter_id: source.sourceLetterId,
    response_evidence_id: source.responseEvidenceId || null,
    apply_to_bureau: source.applyToBureau || null,
    source_order: source.sourceOrder,
  }));
  const started = await startRound({
    clientAccountId: account.clientAccountId,
    targetType,
    letters: letterSpecs,
    sources: sourcePayload,
  });
  const ids = started?.letter_ids || [];
  if (ids.length !== letterSpecs.length) throw new Error('The round was created without every required letter placeholder.');

  const priorBlocks = loadedSources.map((source) => buildPriorRoundLeverageBlock({
    priorTargetType: source.letter.target_type || 'furnisher',
    nextTargetType: targetType,
    priorLetterHtml: source.letter.html,
    priorLetterSummary: source.letter.summary,
    priorResponseClassification: source.evidence?.analysis?.classification,
    priorResponseSummary: source.evidence?.analysis?.summary,
  })).join('\n\n---\n\n');
  const t = today();
  const baseData = JSON.stringify({
    account,
    client,
    roundNumber: started.round_number,
    targetType,
    clientSignature: client.signatureData || null,
  }, null, 2);
  const jobs = ids.map((id, index) => {
    const spec = letterSpecs[index];
    const target = targetType === 'bureau' ? BUREAU_LABEL[spec.target_bureau] : account.furnisher;
    let purpose;
    if (spec.dispute_basis === 'FDCPA') {
      purpose = 'Generate ONLY the standalone FDCPA §1692g(b) Debt Validation Demand. Do not include an FCRA direct dispute in this sibling letter.';
    } else if (targetType === 'bureau') {
      purpose = `Generate ONLY one CRA dispute addressed to ${target}. Apply §1681i framing and never generate an FDCPA validation letter.`;
    } else {
      purpose = 'Generate ONLY the FCRA/Regulation V direct furnisher dispute. Use the established 16-step structure.';
    }
    return {
      id,
      account,
      targetType,
      generateSummary: true,
      instructions: `LETTER_HTML_MODE\n\nToday is ${t}. Use this exact date.\nRound: ${started.round_number}\nExplicit recipient: ${target}\n\n${purpose}\n\nData:\n${baseData}\n\n${priorBlocks || 'This is Round 1; there is no prior-round evidence.'}\n\nOutput complete HTML only. No prose or fences. Do not include a tracking-number placeholder.`,
    };
  });

  const response = await fetch('/.netlify/functions/generate-letter-background', {
    method: 'POST',
    headers: await staffJsonHeaders(),
    body: JSON.stringify({ jobs }),
  });
  if (!response.ok) throw new Error('The round exists, but letter generation could not start. Retry the failed round before mailing.');
  const results = await Promise.all(ids.map((id) => pollForLetter(id)));
  return {
    roundId: started.round_id,
    roundNumber: started.round_number,
    letterIds: ids,
    letters: results.map((result, index) => ({
      ...result,
      id: ids[index],
      targetType,
      targetBureau: letterSpecs[index].target_bureau || null,
      roundNumber: started.round_number,
    })),
  };
}

const CAMPAIGN_STYLE_INSTRUCTIONS = {
  forensic: 'Use the established forensic strategy selected by the audit findings. Preserve every supported Metro 2/FCRA issue and omit unsupported claims.',
  metro2_accuracy: 'Emphasize the supported Metro 2 data-integrity conflicts and the recipient-specific FCRA duties. Do not add generic credit-repair language.',
  direct_furnisher: 'Use the established direct-furnisher dispute strategy and the existing 16-step structure.',
  debt_validation: 'Generate the standalone FDCPA debt-validation sibling only when the stored dispute basis is FDCPA.',
  procedural_request: 'Focus on the documented investigation procedure and exact unresolved evidence without asserting a right to documents the statute does not require.',
  custom: 'Follow the staff strategy below only where it remains supported by the frozen audit and evidence. Never invent a fact, violation, or citation.',
};

export async function generateCampaignAccountRoute({ route, item, campaign, client, priorSources = [] }) {
  const account = item?.snapshot || {};
  if (!item?.clientAccountId || !campaign?.id || !route?.id) throw new Error('The campaign route is missing its linked account identity.');
  const targetType = route.targetType;
  if (!['furnisher', 'bureau'].includes(targetType)) throw new Error('This route is not an account dispute route.');
  const isTypeC = account.type === 'C';
  const letterSpecs = targetType === 'bureau'
    ? [{ furnisher: account.furnisher, account_id: account.accountNumberMasked || account.id || '', type: account.type || null, target_bureau: route.targetBureau, dispute_basis: null }]
    : isTypeC
      ? [
        { furnisher: account.furnisher, account_id: account.accountNumberMasked || account.id || '', type: account.type, dispute_basis: 'FDCPA' },
        { furnisher: account.furnisher, account_id: account.accountNumberMasked || account.id || '', type: account.type, dispute_basis: 'FCRA_DIRECT' },
      ]
      : [{ furnisher: account.furnisher, account_id: account.accountNumberMasked || account.id || '', type: account.type || null, dispute_basis: 'FCRA_DIRECT' }];
  try {
    const loadedSources = await loadPriorSources(priorSources);
    const sourcePayload = loadedSources.map((source) => ({
      source_letter_id: source.sourceLetterId, response_evidence_id: source.responseEvidenceId,
      apply_to_bureau: route.targetBureau || null, source_order: source.sourceOrder || 0,
    }));
    const { data: started, error } = await supabase.rpc('start_campaign_route', {
      p_route_id: route.id, p_letters: letterSpecs, p_sources: sourcePayload,
    });
    if (error) throw error;
    const ids = started?.letter_ids || [];
    if (ids.length !== letterSpecs.length) throw new Error('The campaign route did not create every required letter placeholder.');
    const priorBlocks = loadedSources.map((source) => buildPriorRoundLeverageBlock({
      priorTargetType: source.letter.target_type || 'furnisher', nextTargetType: targetType,
      priorLetterHtml: source.letter.html, priorLetterSummary: source.letter.summary,
      priorResponseClassification: source.evidence?.analysis?.classification,
      priorResponseSummary: source.evidence?.analysis?.summary,
    })).join('\n\n---\n\n');
    const styleInstruction = CAMPAIGN_STYLE_INSTRUCTIONS[route.letterStyle] || CAMPAIGN_STYLE_INSTRUCTIONS.forensic;
    const customInstruction = route.customInstructions ? `\nStaff strategy: ${route.customInstructions}` : '';
    const baseData = JSON.stringify({ account, client, roundNumber: campaign.roundNumber, targetType, clientSignature: client.signatureData || null }, null, 2);
    const jobs = ids.map((id, index) => {
      const spec = letterSpecs[index];
      const target = targetType === 'bureau' ? BUREAU_LABEL[route.targetBureau] : account.furnisher;
      const purpose = spec.dispute_basis === 'FDCPA'
        ? 'Generate ONLY the standalone FDCPA §1692g(b) Debt Validation Demand. Do not include an FCRA direct dispute in this sibling letter.'
        : targetType === 'bureau'
          ? `Generate ONLY one CRA dispute addressed to ${target}. Apply §1681i framing and never generate an FDCPA validation letter.`
          : 'Generate ONLY the FCRA/Regulation V direct furnisher dispute. Use the established 16-step structure.';
      return {
        id, account, targetType, generateSummary: true,
        instructions: `LETTER_HTML_MODE\n\nToday is ${today()}. Use this exact date.\nClient campaign round: ${campaign.roundNumber}\nExplicit recipient: ${target}\n\n${purpose}\n\nStrategy: ${styleInstruction}${customInstruction}\n\nFrozen audit data:\n${baseData}\n\n${priorBlocks || 'This account has no reviewed prior-round evidence; use only the frozen audit findings.'}\n\nOutput complete HTML only. No prose or fences. Do not include a tracking-number placeholder.`,
      };
    });
    const response = await fetch('/.netlify/functions/generate-letter-background', {
      method: 'POST', headers: await staffJsonHeaders(), body: JSON.stringify({ jobs }),
    });
    if (!response.ok) throw new Error('The route exists, but Claude letter generation could not start.');
    const results = await Promise.all(ids.map((id) => pollForLetter(id)));
    await setRouteResult(route.id, { status: 'generated', letterIds: ids, generationError: null, generatedAt: new Date().toISOString() });
    return ids.map((id, index) => ({ id, ...results[index] }));
  } catch (error) {
    await setRouteResult(route.id, { status: 'failed', generationError: String(error.message || error).slice(0, 1000) }).catch(() => {});
    throw error;
  }
}

export async function generateCombinedCleanupLetter(client, inquiries, metadata = {}) {
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
  let profileAddress = null;
  try {
    // client.id preferred — full_name alone can pull another same-named
    // client's signature into a mailed cleanup letter.
    const cpQuery = client.id
      ? supabase.from('client_profiles').select('signature_data').eq('client_id', client.id).limit(1)
      : supabase.from('client_profiles').select('signature_data').eq('full_name', client.name).limit(1);
    const { data: cp } = await cpQuery;
    if (cp && cp.length > 0 && cp[0].signature_data) {
      signatureData = cp[0].signature_data;
    }
    // Always fetch the clients table: it holds the profile-tab address (the
    // permanent address of record set by staff) AND the fallback LPOA signature.
    const clientIdFilter = client.id
      ? supabase.from('clients').select('lpoa_signature_data,address').eq('id', client.id).limit(1)
      : supabase.from('clients').select('lpoa_signature_data,address').eq('name', client.name).limit(1);
    const { data: cm } = await clientIdFilter;
    if (cm && cm.length > 0) {
      if (!signatureData && cm[0].lpoa_signature_data) {
        signatureData = await resolveSignatureViewUrl(supabase, cm[0].lpoa_signature_data);
      }
      // Profile-tab address wins over any address extracted from the credit
      // report — this is the permanent address of record for the letter header.
      if (cm[0].address) {
        profileAddress = cm[0].address;
      }
    }
  } catch(e) { console.warn('Could not look up signature or address:', e); }

  // Merge the profile address into the client object so the AI generates the
  // letter header with the correct sender address of record.
  const clientWithAddress = profileAddress
    ? { ...client, address: profileAddress }
    : client;
  
  const data = JSON.stringify({ client: clientWithAddress, personalInfo: hasPersonalInfo ? personalInfo : undefined, inquiries: hasInquiries ? eligibleInquiries : undefined, bureau, lpoaSigned, clientSignature: signatureData, staffStrategy: metadata.customInstructions || undefined }, null, 2);
  
  const instructions = `LETTER_HTML_MODE\n\nToday is ${t}. Use this exact date at the top of the letter.\n\nYou are drafting a Personal Information & Inquiry Reinvestigation Demand addressed directly to ${bureau}, NOT to any furnisher. This letter disputes both the accuracy of identifying information in the consumer's file AND unverified hard inquiries. It does NOT dispute any tradeline, account balance, or payment history.\n\nData:\n${data}\n\nLETTER REQUIREMENTS:\n1. Address the letter to the bureau's dispute department.\n2. Cite 15 U.S.C. §1681e(b) for the maximum possible accuracy standard regarding the personal information (if any is provided).\n3. Cite 15 U.S.C. §1681i for the reinvestigation duty and 15 U.S.C. §1681b for the permissible purpose requirement for each inquiry listed (if any are provided).\n4. For personal info: List each specific former address, name variant, and former employer provided in personalInfo.formerAddresses / personalInfo.nameVariants / personalInfo.formerEmployers, and demand each one be removed. These lists already EXCLUDE the items the consumer wants to keep. If personalInfo.keepOnFile is present, affirm the consumer's correct name as keepOnFile.name (and correct current employer as keepOnFile.employer when non-null) and state that only that identifying information should remain. Do NOT demand removal of keepOnFile.name or keepOnFile.employer.\n5. For inquiries: For each inquiry listed, state the furnisher name and date, and state that the consumer does not recognize or cannot verify a permissible purpose for this specific inquiry. Demand the bureau contact each listed subscriber to verify permissible purpose, and demand deletion of any inquiry the subscriber cannot verify within 30 days per 15 U.S.C. §1681i(a)(5)(A).\n6. Do NOT state or imply fraud or identity theft unless that is explicitly present in the provided data.\n7. Do NOT dispute any account, balance, or payment history in this letter.\n8. Demand written confirmation of the results within 30 days.\n9. Tone: forensic and factual, consistent with the firm's standard letter voice — no goodwill language, statements and demands only.\n10. ALWAYS include a signature block at the bottom of the letter. Print the consumer's full name. If \`clientSignature\` is provided in the data, embed it using an <img> tag above the printed name with a style like \`max-height: 60px;\`. If \`clientSignature\` is null, simply leave a few blank lines above the printed name for a physical signature. Do NOT include a "Certified Mail #" or tracking number placeholder — state only "Sent via Certified Mail."\n11. ALWAYS include an "Enclosures:" section below the signature block listing ONLY: "Government-Issued Photo ID" and "Proof of Current Address (Bank Statement)". Do NOT include a Limited Power of Attorney — this letter type does not require it.\n12. MANDATORY IDENTITY TABLE: Immediately after the introductory paragraph(s) and before any disputed-information sections, output a 2-column summary table with class='id-table'. This table MUST always be present for every bureau and MUST contain exactly these rows in order: "Consumer Name" (use personalInfo.keepOnFile.name when present, otherwise client.name), "Date of Birth on File" (use client.dateOfBirth if provided, otherwise omit this row only), "Current Verified Address" (use client.address — this is the permanent verified address of record, NOT any former address), "Bureau" (use the bureau name), "Report Date" (use the report date from the audit data if available, otherwise use today's date). Do NOT skip this table for any bureau.\n13. LETTER HEADER ORDER: At the very top of the letter, in this exact order: (1) today's date, (2) the consumer's full name and current verified address (client.address) as the return/sender address block, (3) the bureau's dispute-department address block. Do NOT put the sender address before the date — the date leads. The sender address must match the "Current Verified Address" row in the id-table. Use keepOnFile.name (when present) as the printed consumer name in the sender block.\n14. CRITICAL CONCISENESS RULE: Do NOT generate a separate 'STATUTORY OBLIGATIONS' or 'LEGAL BASIS' table or section. Incorporate all legal citations directly inline in the brief introductory paragraphs. Do NOT generate any CSS, <style> block, or inline style attributes. Output plain HTML using these exact classes: class='id-table', class='list-table', class='demands-table', class='signature-block', class='enclosures', class='mail-notation'. This is required to prevent the API output from truncating.\n\nOutput complete HTML only. No prose. No fences.`;

  const syntheticAccount = { furnisher: bureau, id: 'personal-info-inquiries', type: null };
  const id = await saveLetter(syntheticAccount, client, 'GENERATING...', null, 'Personal Info & Inquiries', null, metadata);
  
  const res = await fetch('/.netlify/functions/generate-letter-background', {
    method: 'POST',
    headers: await staffJsonHeaders(),
    body: JSON.stringify({
      jobs: [{ id, account: null, generateSummary: false, instructions }]
    })
  });
  if (!res.ok) throw new Error('Could not start letter generation on the server. Please try again.');

  // Fire-and-forget
  return id;
}

export async function generateCampaignCleanupRoute({ route, items, campaign, client }) {
  if (route.targetType !== 'bureau' || !route.targetBureau) throw new Error('Personal information and inquiry routes require a bureau recipient.');
  const bureau = BUREAU_LABEL[route.targetBureau];
  const groupedItems = [...new Map((items || []).filter(Boolean).map((item) => [item.id, item])).values()];
  if (!groupedItems.length) throw new Error(`No selected cleanup findings are available for ${bureau}.`);
  if (groupedItems.some((item) => !['personal_info', 'inquiry'].includes(item.kind))) {
    throw new Error('A cleanup route can contain only personal information and inquiries.');
  }
  if (groupedItems.some((item) => !getCampaignItemBureaus(item).includes(route.targetBureau))) {
    throw new Error(`A selected cleanup finding does not belong on the ${bureau} report.`);
  }

  const personalItems = groupedItems.filter((item) => item.kind === 'personal_info');
  const inquiryItems = groupedItems.filter((item) => item.kind === 'inquiry');
  const basePersonal = personalItems.find((item) => item.snapshot?.personalInfo)?.snapshot?.personalInfo || {};
  const valuesFor = (category) => [...new Set(personalItems
    .filter((item) => item.snapshot?.category === category)
    .map((item) => item.snapshot?.value)
    .filter(Boolean))];
  const personalInfo = {
    formerAddresses: valuesFor('former_address'),
    nameVariants: valuesFor('name_variant'),
    formerEmployers: valuesFor('former_employer'),
    keepOnFile: basePersonal.keepOnFile || { name: client.name, employer: null },
  };
  const inquiries = inquiryItems.map((item) => item.snapshot || {});
  try {
    const id = await generateCombinedCleanupLetter({
      ...client, bureau, personalInfo, lpoaSigned: client.lpoaSigned,
    }, inquiries, {
      campaignId: campaign.id, campaignItemId: groupedItems[0].id, campaignRouteId: route.id,
      generationStyle: route.letterStyle, targetType: 'bureau', targetBureau: route.targetBureau,
      letterKind: 'file_update', customInstructions: route.customInstructions,
    });
    await setRouteResult(route.id, { status: 'generating', letterIds: [id], generationError: null });
    const result = await pollForLetter(id);
    await setRouteResult(route.id, { status: 'generated', letterIds: [id], generationError: null, generatedAt: new Date().toISOString() });
    return [{ id, ...result }];
  } catch (error) {
    await setRouteResult(route.id, { status: 'failed', generationError: String(error.message || error).slice(0, 1000) }).catch(() => {});
    throw error;
  }
}

export async function generateInterimLetter({ account, client, targetType, targetBureau = null, style = 'procedural_request', customInstructions = '' }) {
  if (!account || !client?.id) throw new Error('Choose an audited account for the interim letter.');
  if (!['furnisher', 'bureau'].includes(targetType)) throw new Error('Choose a furnisher or bureau recipient.');
  if (targetType === 'bureau' && !targetBureau) throw new Error('Choose the bureau recipient.');
  const target = targetType === 'bureau' ? BUREAU_LABEL[targetBureau] : account.furnisher;
  const metadata = {
    letterKind: 'file_update', targetType, targetBureau: targetType === 'bureau' ? targetBureau : null,
    generationStyle: style,
  };
  const id = await saveLetter(account, client, 'GENERATING...', null, 'Interim Letter', `__interim-${Date.now()}`, metadata);
  const styleInstruction = CAMPAIGN_STYLE_INSTRUCTIONS[style] || CAMPAIGN_STYLE_INSTRUCTIONS.procedural_request;
  const instructions = `LETTER_HTML_MODE\n\nToday is ${today()}. Use this exact date.\n\nDraft a standalone interim letter addressed to ${target}. This is an intentional file-update letter between structured campaign rounds. It must not claim that a new campaign round has started, alter a stored deadline, or describe itself as a response that has not actually been received.\n\nStrategy: ${styleInstruction}${customInstructions ? `\nStaff instructions: ${customInstructions}` : ''}\n\nUse only the supported frozen account data and client information below. Preserve the established forensic voice and recipient-specific FCRA/Metro 2 framing. Never invent a fact, response, investigation, violation, or enclosure.\n\n${JSON.stringify({ account, client, targetType, targetBureau, clientSignature: client.signatureData || null }, null, 2)}\n\nOutput complete HTML only. No prose or fences. Do not include a tracking-number placeholder.`;
  const response = await fetch('/.netlify/functions/generate-letter-background', {
    method: 'POST', headers: await staffJsonHeaders(),
    body: JSON.stringify({ jobs: [{ id, account, targetType, generateSummary: true, instructions }] }),
  });
  if (!response.ok) throw new Error('Could not start the interim Claude letter generation.');
  const result = await pollForLetter(id);
  return { id, ...result, furnisher: target, targetType, targetBureau, phase: 'Interim Letter' };
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
