import { saveLetter } from "./storage.js";
import { supabase } from "./supabase";
import { runAuditJob } from "./auditJobs.js";
import { startRound } from './rounds.js';
import { BUREAU_LABEL, resolveActiveBureaus } from './roundTargets.js';
import { setRouteResult } from './campaigns.js';
import { getCampaignItemBureaus } from './campaignItems.js';
import { letterGenerationState } from './letterGeneration.js';
import { buildKeepOnFileIdentity } from './letterPromptData.js';
export { buildPriorRoundLeverageBlock } from './roundEvidence.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pollForLetter(id) {
  for (let i = 0; i < 160; i++) { // wait up to 8 minutes (160 * 3s)
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

const isBackgroundPollTimeout = (error) => /timed out.*background/i.test(String(error?.message || error));

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

async function dispatchLetterGeneration(ids) {
  const headers = await staffJsonHeaders();
  const results = await Promise.allSettled(ids.map(async (letterId) => {
    const response = await fetch('/.netlify/functions/generate-letter-background', {
      method: 'POST',
      headers,
      body: JSON.stringify({ letterId }),
    });
    if (!response.ok) {
      const detail = (await response.text()).trim();
      throw new Error(detail || `Generation request failed (${response.status}).`);
    }
    return letterId;
  }));
  const failed = results
    .map((result, index) => ({ result, id: ids[index] }))
    .filter(({ result }) => result.status === 'rejected');
  if (failed.length) {
    await Promise.allSettled(failed.map(({ id, result }) => supabase.from('letters')
      .update({ html: `ERROR: ${String(result.reason?.message || result.reason).slice(0, 900)}` })
      .eq('id', id).eq('html', 'GENERATING...')));
    throw new Error(`${failed.length} of ${ids.length} letter jobs could not start. The other drafts are still processing.`);
  }
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

  await dispatchLetterGeneration(ids);
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

export async function retryFailedRoundLetters({ account, client, roundId }) {
  if (!account?.clientAccountId || !client?.id || !roundId) throw new Error('The open round is missing its stable account identity.');
  const { data: failedIds, error: resetError } = await supabase.rpc('reset_unmailed_round_drafts', {
    p_round_id: roundId,
    p_failed_only: true,
  });
  if (resetError) throw resetError;

  let accepted = false;
  try {
    await dispatchLetterGeneration(failedIds || []);
    accepted = true;
    const settled = await Promise.allSettled(failedIds.map((id) => pollForLetter(id)));
    const failures = settled.filter((result) => result.status === 'rejected');
    if (failures.length) throw new Error(`${failures.length} of ${failedIds.length} retried drafts still failed validation. Refresh the round to review them.`);
    return settled.map((result, index) => ({ id: failedIds[index], ...result.value }));
  } catch (error) {
    if (!accepted) {
      try {
        await supabase.from('letters')
          .update({ html: `ERROR: ${String(error.message || error).slice(0, 900)}` })
          .in('id', failedIds)
          .eq('html', 'GENERATING...');
      } catch (_) {}
    }
    throw error;
  }
}

export async function regenerateUnmailedRoundLetters({ roundId }) {
  if (!roundId) throw new Error('Choose an open round to regenerate.');
  const { data: ids, error } = await supabase.rpc('reset_unmailed_round_drafts', {
    p_round_id: roundId,
    p_failed_only: false,
  });
  if (error) throw error;
  await dispatchLetterGeneration(ids || []);
  const settled = await Promise.allSettled((ids || []).map((id) => pollForLetter(id)));
  const failed = settled.filter((result) => result.status === 'rejected');
  if (failed.length) throw new Error(`${failed.length} of ${(ids || []).length} regenerated drafts failed validation. Review the round before mailing.`);
  return settled.map((result, index) => ({ id: ids[index], ...result.value }));
}

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
  let attemptedLetterIds = [];
  let backgroundAccepted = false;
  try {
    if (route.status === 'failed' && route.letterIds?.length) {
      const { data: failedRows, error: failedRowsError } = await supabase.from('letters')
        .select('id,html,mailed_date,lob_id,campaign_route_id')
        .in('id', route.letterIds);
      if (failedRowsError) throw failedRowsError;
      const retryIds = (failedRows || [])
        .filter((letter) => letter.campaign_route_id === route.id && letterGenerationState(letter) === 'failed' && !letter.mailed_date && !letter.lob_id)
        .map((letter) => letter.id);
      if (retryIds.length) {
        const { error: resetError } = await supabase.from('letters').update({ html: 'GENERATING...', summary: null }).in('id', retryIds);
        if (resetError) throw resetError;
        attemptedLetterIds = retryIds;
      }
    }
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
    attemptedLetterIds = ids;
    if (ids.length !== letterSpecs.length) throw new Error('The campaign route did not create every required letter placeholder.');
    const { data: storedJobs, error: storedJobsError } = await supabase.from('letters').select('id,html').in('id', ids);
    if (storedJobsError) throw storedJobsError;
    const storedById = new Map((storedJobs || []).map((letter) => [letter.id, letter]));
    const jobIndexes = ids.map((id, index) => ({ id, index, state: letterGenerationState(storedById.get(id)) }))
      .filter((entry) => entry.state === 'generating');
    if (!jobIndexes.length && ids.every((id) => letterGenerationState(storedById.get(id)) === 'ready')) {
      const results = await Promise.all(ids.map((id) => pollForLetter(id)));
      await setRouteResult(route.id, { status: 'generated', letterIds: ids, generationError: null, generatedAt: new Date().toISOString() });
      return ids.map((id, index) => ({ id, ...results[index] }));
    }
    if (!jobIndexes.length) throw new Error('The failed route has no safe letter placeholder to retry.');
    await dispatchLetterGeneration(jobIndexes.map(({ id }) => id));
    backgroundAccepted = true;
    const results = await Promise.all(ids.map((id) => pollForLetter(id)));
    await setRouteResult(route.id, { status: 'generated', letterIds: ids, generationError: null, generatedAt: new Date().toISOString() });
    return ids.map((id, index) => ({ id, ...results[index] }));
  } catch (error) {
    const message = String(error.message || error).slice(0, 1000);
    if (!backgroundAccepted && attemptedLetterIds.length) {
      try { await supabase.from('letters').update({ html: `ERROR: ${message}` }).in('id', attemptedLetterIds).eq('html', 'GENERATING...'); } catch (_) {}
    }
    await setRouteResult(route.id, { status: isBackgroundPollTimeout(error) ? 'generating' : 'failed', generationError: message }).catch(() => {});
    throw error;
  }
}

export async function generateCombinedCleanupLetter(client, inquiries, metadata = {}) {
  const personalInfo = client?.personalInfo || {};
  const hasPersonalInfo = (personalInfo.formerAddresses || []).length > 0
    || (personalInfo.nameVariants || []).length > 0
    || (personalInfo.formerEmployers || []).length > 0;
  const eligibleInquiries = (inquiries || []).filter((item) => item.category !== 'linked_to_open_account');
  if (!hasPersonalInfo && !eligibleInquiries.length) {
    throw new Error('No eligible inquiries or personal information to dispute.');
  }

  const bureau = client?.bureau || 'the consumer reporting agency';
  const generationContext = {
    kind: 'cleanup',
    personalInfo: hasPersonalInfo ? personalInfo : null,
    inquiries: eligibleInquiries,
    keepOnFile: personalInfo.keepOnFile || null,
    staffInstructions: String(metadata.customInstructions || '').slice(0, 2000),
  };
  const syntheticAccount = { furnisher: bureau, id: 'personal-info-inquiries', type: null };
  let id = metadata.existingLetterId || null;

  if (id) {
    const { data: existing, error: existingError } = await supabase.from('letters')
      .select('id,html,mailed_date,lob_id,campaign_route_id')
      .eq('id', id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing || existing.campaign_route_id !== metadata.campaignRouteId
        || existing.mailed_date || existing.lob_id || letterGenerationState(existing) !== 'failed') {
      throw new Error('The failed cleanup placeholder is not safe to retry.');
    }
    const { error: resetError } = await supabase.from('letters')
      .update({ html: 'GENERATING...', summary: null, generation_context: generationContext })
      .eq('id', id);
    if (resetError) throw resetError;
  } else {
    id = await saveLetter(syntheticAccount, client, 'GENERATING...', null, 'Personal Info & Inquiries', null, {
      ...metadata,
      generationContext,
    });
  }

  await dispatchLetterGeneration([id]);
  return id;
}

async function repairMissingCleanupPlaceholder(route) {
  if (route.status !== 'failed' || route.letterIds?.length !== 1) return route;
  const { data: existing, error: existingError } = await supabase.from('letters')
    .select('id')
    .eq('id', route.letterIds[0])
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return route;
  const { error: resetError } = await supabase.rpc('reset_orphaned_campaign_cleanup_route', {
    p_route_id: route.id,
  });
  if (resetError) throw resetError;
  return { ...route, status: 'configured', letterIds: [], approvedLetterIds: [], generationError: null };
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
    keepOnFile: buildKeepOnFileIdentity(client, basePersonal),
  };
  const inquiries = inquiryItems.map((item) => item.snapshot || {});
  try {
    const retryRoute = await repairMissingCleanupPlaceholder(route);
    const id = await generateCombinedCleanupLetter({
      ...client, bureau, personalInfo, lpoaSigned: client.lpoaSigned,
    }, inquiries, {
      campaignId: campaign.id, campaignItemId: groupedItems[0].id, campaignRouteId: route.id,
      generationStyle: route.letterStyle, targetType: 'bureau', targetBureau: route.targetBureau,
      letterKind: 'file_update', customInstructions: route.customInstructions,
      existingLetterId: retryRoute.status === 'failed' && retryRoute.letterIds?.length === 1 ? retryRoute.letterIds[0] : null,
    });
    await setRouteResult(route.id, { status: 'generating', letterIds: [id], generationError: null });
    const result = await pollForLetter(id);
    await setRouteResult(route.id, { status: 'generated', letterIds: [id], generationError: null, generatedAt: new Date().toISOString() });
    return [{ id, ...result }];
  } catch (error) {
    await setRouteResult(route.id, { status: isBackgroundPollTimeout(error) ? 'generating' : 'failed', generationError: String(error.message || error).slice(0, 1000) }).catch(() => {});
    throw error;
  }
}

export async function generateInterimLetter({ account, client, targetType, targetBureau = null, style = 'procedural_request', customInstructions = '' }) {
  if (!account || !client?.id) throw new Error('Choose an audited account for the interim letter.');
  if (!['furnisher', 'bureau'].includes(targetType)) throw new Error('Choose a furnisher or bureau recipient.');
  if (targetType === 'bureau' && !targetBureau) throw new Error('Choose the bureau recipient.');

  const target = targetType === 'bureau' ? BUREAU_LABEL[targetBureau] : account.furnisher;
  const id = await saveLetter(account, client, 'GENERATING...', null, 'Interim Letter', `__interim-${Date.now()}`, {
    letterKind: 'file_update',
    targetType,
    targetBureau: targetType === 'bureau' ? targetBureau : null,
    generationStyle: style,
    generationContext: {
      kind: 'interim',
      accountSnapshot: account,
      staffInstructions: String(customInstructions || '').slice(0, 2000),
    },
  });

  await dispatchLetterGeneration([id]);
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
