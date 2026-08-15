import { supabase } from './supabase.js';
import { buildCampaignItems, getCampaignItemBureaus } from './campaignItems.js';
import { generationErrorMessage, letterGenerationState } from './letterGeneration.js';
import { getSettings } from './settings.js';
import { validatePacketSpec } from './campaignBlueprint.js';
export { buildCampaignItems } from './campaignItems.js';

export const CAMPAIGN_STAGES = [
  'select_disputes', 'configure_letters', 'letter_review', 'mailing',
  'awaiting_responses', 'response_review',
];


function normalizeCampaign(row) {
  return row ? {
    id: row.id, userId: row.user_id, clientId: row.client_id, auditId: row.audit_id,
    roundNumber: row.round_number, stage: row.stage, builderMode: row.builder_mode,
    packetVersion: Number(row.packet_version || 1),
    openedAt: row.opened_at, closedAt: row.closed_at,
  } : null;
}

function normalizeItem(row) {
  return {
    id: row.id, campaignId: row.campaign_id, kind: row.item_kind, sourceKey: row.source_key,
    clientAccountId: row.client_account_id, label: row.label, snapshot: row.snapshot || {},
    routeReview: row.route_review || {}, selectionState: row.selection_state, sortOrder: row.sort_order,
  };
}

function normalizeRoute(row) {
  return {
    id: row.id, campaignId: row.campaign_id, itemId: row.item_id, targetType: row.target_type,
    targetBureau: row.target_bureau, letterStyle: row.letter_style,
    disputeBasis: row.dispute_basis || null, recipientKey: row.recipient_key || null,
    customInstructions: row.custom_instructions || '', status: row.status,
    disputeRoundId: row.dispute_round_id, letterIds: row.letter_ids || [],
    itemIds: row.item_ids?.length ? row.item_ids : [row.item_id],
    approvedLetterIds: row.approved_letter_ids || [], generationError: row.generation_error || null,
  };
}

function normalizeCoverage(row) {
  return {
    id: row.id, letterId: row.letter_id, campaignId: row.campaign_id,
    campaignRouteId: row.campaign_route_id, campaignItemId: row.campaign_item_id,
    clientAccountId: row.client_account_id, disputeRoundId: row.dispute_round_id,
    coverageOrder: row.coverage_order, mailStatus: row.mail_status,
    trackingStatus: row.tracking_status, responseStatus: row.response_status,
    expectedRecipient: row.expected_recipient || {},
  };
}

export async function getCampaignWorkspace(clientId) {
  const { data: campaigns, error } = await supabase.from('client_campaigns').select('*')
    .eq('client_id', clientId).in('stage', CAMPAIGN_STAGES).order('round_number', { ascending: false }).limit(1);
  if (error) {
    if (/client_campaigns/i.test(error.message || '')) return { campaign: null, items: [], routes: [], letters: [], coverage: [] };
    throw error;
  }
  const campaign = normalizeCampaign(campaigns?.[0]);
  if (!campaign) return { campaign: null, items: [], routes: [], letters: [], coverage: [] };
  const [itemsRes, routesRes, lettersRes, coverageRes] = await Promise.all([
    supabase.from('campaign_items').select('*').eq('campaign_id', campaign.id).order('sort_order'),
    supabase.from('campaign_letter_routes').select('*').eq('campaign_id', campaign.id).order('created_at'),
    supabase.from('letters').select('*').eq('campaign_id', campaign.id).order('saved_at'),
    supabase.from('letter_account_coverage').select('*').eq('campaign_id', campaign.id).order('coverage_order'),
  ]);
  if (itemsRes.error) throw itemsRes.error;
  if (routesRes.error) throw routesRes.error;
  if (lettersRes.error) throw lettersRes.error;
  if (coverageRes.error && !/letter_account_coverage/i.test(coverageRes.error.message || '')) throw coverageRes.error;
  const letters = lettersRes.data || [];
  const letterById = new Map(letters.map((letter) => [letter.id, letter]));
  const routes = (routesRes.data || []).map(normalizeRoute);
  const reconciliations = [];
  for (const route of routes) {
    if (!route.letterIds.length) continue;
    const routeLetters = route.letterIds.map((id) => letterById.get(id)).filter(Boolean);
    if (routeLetters.length !== route.letterIds.length) continue;
    const states = routeLetters.map(letterGenerationState);
    if (states.every((state) => state === 'ready') && route.status !== 'generated') {
      route.status = 'generated';
      route.generationError = null;
      reconciliations.push(setRouteResult(route.id, { status: 'generated', generationError: null, generatedAt: new Date().toISOString() }));
    } else if (!states.includes('generating') && states.includes('failed') && route.status !== 'failed') {
      const failedLetter = routeLetters.find((letter) => letterGenerationState(letter) === 'failed');
      route.status = 'failed';
      route.generationError = generationErrorMessage(failedLetter);
      reconciliations.push(setRouteResult(route.id, { status: 'failed', generationError: route.generationError }));
    }
  }
  if (reconciliations.length) await Promise.all(reconciliations);
  return {
    campaign,
    items: (itemsRes.data || []).map(normalizeItem),
    routes,
    letters,
    coverage: (coverageRes.data || []).map(normalizeCoverage),
  };
}

export async function createCampaignFromAudit(client, auditRecord) {
  if (!client?.id || !auditRecord?.id) throw new Error('A client and saved audit are required.');
  let items = buildCampaignItems(auditRecord);
  if (!items.length) throw new Error('The latest audit has no linked dispute items.');
  const accountIds = items.map((item) => item.client_account_id).filter(Boolean);
  const carryState = new Map();
  if (accountIds.length) {
    const { data: assessments, error: assessmentError } = await supabase
      .from('response_evidence_account_assessment')
      .select('client_account_id,next_action,reviewed_at')
      .in('client_account_id', accountIds).eq('review_status', 'reviewed')
      .order('reviewed_at', { ascending: false });
    if (assessmentError && !/response_evidence_account_assessment/i.test(assessmentError.message || '')) throw assessmentError;
    for (const row of assessments || []) if (!carryState.has(row.client_account_id)) carryState.set(row.client_account_id, row.next_action);
    // A paid/corrected/resolved account is absent from the next Blueprint even
    // when the new audit still contains the historical tradeline. Unresolved
    // accounts are carried below after the new campaign exists.
    items = items.filter((item) => !item.client_account_id || carryState.get(item.client_account_id) !== 'resolved');
  }
  if (!items.length) throw new Error('The latest audit has no unresolved or newly eligible campaign items.');
  const { data, error } = await supabase.rpc('create_client_campaign', {
    p_client_id: client.id, p_audit_id: auditRecord.id, p_items: items,
  });
  if (error) throw error;
  const unresolvedIds = items.filter((item) => ['next_round', 'escalate'].includes(carryState.get(item.client_account_id)))
    .map((item) => item.client_account_id);
  const documentIds = items.filter((item) => carryState.get(item.client_account_id) === 'needs_documents')
    .map((item) => item.client_account_id);
  if (unresolvedIds.length || documentIds.length) {
    const { data: newItems, error: newItemsError } = await supabase.from('campaign_items')
      .select('id,client_account_id').eq('campaign_id', data.id).not('client_account_id', 'is', null);
    if (newItemsError) throw newItemsError;
    const selectedIds = (newItems || []).filter((item) => unresolvedIds.includes(item.client_account_id)).map((item) => item.id);
    const laterIds = (newItems || []).filter((item) => documentIds.includes(item.client_account_id)).map((item) => item.id);
    if (selectedIds.length) await updateCampaignItemStates(data.id, selectedIds, 'selected');
    if (laterIds.length) await updateCampaignItemStates(data.id, laterIds, 'later');
  }
  const settings = await getSettings();
  if (!settings.disputes?.consolidatedPacketsEnabled) return normalizeCampaign(data);
  const { data: updated, error: updateError } = await supabase.from('client_campaigns')
    .update({ packet_version: 2, updated_at: new Date().toISOString() })
    .eq('id', data.id).select('*').single();
  if (updateError) throw new Error(`The campaign was created in legacy mode because packet mode could not be enabled: ${updateError.message}`);
  return normalizeCampaign(updated);
}

export async function updateCampaignItemState(campaignId, itemId, selectionState) {
  return updateCampaignItemStates(campaignId, [itemId], selectionState);
}

export async function updateCampaignItemStates(campaignId, itemIds, selectionState) {
  if (!['candidate', 'selected', 'later'].includes(selectionState)) throw new Error('Invalid dispute selection state.');
  if (!campaignId) throw new Error('A campaign is required to revise dispute selections.');
  const ids = [...new Set((itemIds || []).filter(Boolean))];
  if (!ids.length) return;
  const { error } = await supabase.rpc('revise_client_campaign_selection', {
    p_campaign_id: campaignId,
    p_item_ids: ids,
    p_selection_state: selectionState,
  });
  if (error) throw error;
}

export async function updateCampaign(campaignId, patch) {
  const mapped = { updated_at: new Date().toISOString() };
  if ('stage' in patch) mapped.stage = patch.stage;
  if ('builderMode' in patch) mapped.builder_mode = patch.builderMode;
  if ('closedAt' in patch) mapped.closed_at = patch.closedAt;
  const { error } = await supabase.from('client_campaigns').update(mapped).eq('id', campaignId);
  if (error) throw error;
}

export async function reviewCampaignItemEligibility(itemId, { fdcpaEligible, notes }) {
  const { data, error } = await supabase.rpc('review_campaign_item_eligibility', {
    p_item_id: itemId,
    p_fdcpa_eligible: Boolean(fdcpaEligible),
    p_notes: String(notes || '').trim() || null,
  });
  if (error) throw error;
  return data;
}

export async function replaceConfiguredRoutes(campaign, items, routeSpecs) {
  const { data: existing, error: existingError } = await supabase.from('campaign_letter_routes').select('id,letter_ids').eq('campaign_id', campaign.id);
  if (existingError) throw existingError;
  const locked = (existing || []).filter((route) => (route.letter_ids || []).length);
  if (locked.length) throw new Error('Generated routes cannot be reconfigured. Cancel the unmailed round instead.');
  if ((existing || []).length) {
    const { error: deleteError } = await supabase.from('campaign_letter_routes').delete().in('id', existing.map((route) => route.id));
    if (deleteError) throw deleteError;
  }
  const userId = campaign.userId;
  const byId = new Map(items.map((item) => [item.id, item]));
  const rows = routeSpecs.map((spec) => {
    const itemIds = [...new Set((spec.itemIds?.length ? spec.itemIds : [spec.itemId]).filter(Boolean))];
    const item = byId.get(spec.itemId || itemIds[0]);
    if (!item) throw new Error('A configured route references an unavailable dispute item.');
    if (!itemIds.length || itemIds.some((id) => !byId.has(id))) throw new Error('A grouped route contains an unavailable dispute item.');
    const groupedItems = itemIds.map((id) => byId.get(id));
    if (groupedItems.some((groupedItem) => groupedItem.selectionState !== 'selected')) throw new Error('Only items selected for this round can be routed.');
    const cleanup = groupedItems.every((groupedItem) => ['personal_info', 'inquiry'].includes(groupedItem.kind));
    if (cleanup) {
      if (spec.targetType !== 'bureau' || !spec.targetBureau) throw new Error('Cleanup findings require a bureau route.');
      if (groupedItems.some((groupedItem) => !getCampaignItemBureaus(groupedItem).includes(spec.targetBureau))) throw new Error('A cleanup route contains a finding that is not reported by its target bureau.');
    } else if (campaign.packetVersion === 2) {
      const validated = validatePacketSpec({ ...spec, itemIds }, byId);
      if (spec.recipientKey && spec.recipientKey !== validated.recipientKey) {
        throw new Error('The packet recipient no longer matches the reviewed Blueprint. Refresh the Blueprint before saving.');
      }
    } else if (groupedItems.length !== 1 || item.kind !== 'account') {
      throw new Error('Legacy campaigns must use one account per route.');
    }
    return {
      campaign_id: campaign.id, item_id: item.id, user_id: userId, client_id: campaign.clientId,
      item_ids: itemIds,
      target_type: spec.targetType, target_bureau: spec.targetBureau || null,
      dispute_basis: spec.disputeBasis || null,
      recipient_key: spec.recipientKey || null,
      letter_style: spec.letterStyle || 'forensic', custom_instructions: String(spec.customInstructions || '').trim() || null,
    };
  });
  if (!rows.length) throw new Error('Configure at least one letter route.');
  const { error: insertError } = await supabase.from('campaign_letter_routes').insert(rows);
  if (insertError) throw insertError;
  await updateCampaign(campaign.id, { stage: 'configure_letters' });
}

export async function getReviewedPriorSources(clientAccountId) {
  if (!clientAccountId) return [];
  const { data: coverage, error: coverageError } = await supabase.from('letter_account_coverage')
    .select('letter_id').eq('client_account_id', clientAccountId);
  if (coverageError && !/letter_account_coverage/i.test(coverageError.message || '')) throw coverageError;
  const coveredLetterIds = (coverage || []).map((row) => row.letter_id);
  const { data: anchored, error } = await supabase.from('letters')
    .select('id,round_number,target_type,target_bureau,html,summary,phase,date,saved_at,packet_version')
    .eq('client_account_id', clientAccountId).not('round_id', 'is', null).not('mailed_date', 'is', null)
    .order('round_number', { ascending: false });
  if (error) throw error;
  let covered = [];
  if (coveredLetterIds.length) {
    const { data, error: coveredError } = await supabase.from('letters')
      .select('id,round_number,target_type,target_bureau,html,summary,phase,date,saved_at,packet_version')
      .in('id', coveredLetterIds).not('mailed_date', 'is', null);
    if (coveredError) throw coveredError;
    covered = data || [];
  }
  const letters = [...new Map([...(anchored || []), ...covered].map((letter) => [letter.id, letter])).values()];
  const ids = letters.map((letter) => letter.id);
  if (!ids.length) return [];
  const { data: evidence, error: evidenceError } = await supabase.from('response_evidence')
    .select('id,letter_id,response_kind,evidence_kind,analysis,review_status,analysis_status,received_at')
    .in('letter_id', ids).eq('analysis_status', 'analyzed').neq('review_status', 'not_reviewed');
  if (evidenceError) throw evidenceError;
  const byLetter = new Map((letters || []).map((letter) => [letter.id, letter]));
  const packetEvidenceIds = (evidence || [])
    .filter((item) => Number(byLetter.get(item.letter_id)?.packet_version || 1) === 2)
    .map((item) => item.id);
  const followUpPacketEvidenceIds = new Set();
  if (packetEvidenceIds.length) {
    const { data: assessments, error: assessmentError } = await supabase
      .from('response_evidence_account_assessment')
      .select('response_evidence_id')
      .eq('client_account_id', clientAccountId)
      .eq('review_status', 'reviewed')
      .in('next_action', ['next_round', 'escalate'])
      .in('response_evidence_id', packetEvidenceIds);
    if (assessmentError) throw assessmentError;
    for (const assessment of assessments || []) followUpPacketEvidenceIds.add(assessment.response_evidence_id);
  }
  return (evidence || []).map((item, index) => ({
    sourceLetterId: item.letter_id, responseEvidenceId: item.id, sourceOrder: index,
    letter: byLetter.get(item.letter_id), evidence: item,
  })).filter((item) => item.letter && (
    Number(item.letter.packet_version || 1) !== 2 || followUpPacketEvidenceIds.has(item.responseEvidenceId)
  ));
}

export async function setRouteResult(routeId, patch) {
  const mapped = { updated_at: new Date().toISOString() };
  if ('status' in patch) mapped.status = patch.status;
  if ('letterIds' in patch) mapped.letter_ids = patch.letterIds;
  if ('approvedLetterIds' in patch) mapped.approved_letter_ids = patch.approvedLetterIds;
  if ('generationError' in patch) mapped.generation_error = patch.generationError;
  if ('generatedAt' in patch) mapped.generated_at = patch.generatedAt;
  const { error } = await supabase.from('campaign_letter_routes').update(mapped).eq('id', routeId);
  if (error) throw error;
}

export async function approveCampaignLetter(route, letterId, approved) {
  const next = approved
    ? [...new Set([...(route.approvedLetterIds || []), letterId])]
    : (route.approvedLetterIds || []).filter((id) => id !== letterId);
  const { data: { user } } = await supabase.auth.getUser();
  const [letterResult] = await Promise.all([
    supabase.from('letters').update({
      draft_approved_at: approved ? new Date().toISOString() : null,
      draft_approved_by: approved ? user?.id || null : null,
    }).eq('id', letterId),
    setRouteResult(route.id, { approvedLetterIds: next }),
  ]);
  if (letterResult.error) throw letterResult.error;
  return next;
}
