import { supabase } from './supabase.js';
import { buildCampaignItems, getCampaignItemBureaus } from './campaignItems.js';
export { buildCampaignItems } from './campaignItems.js';

export const CAMPAIGN_STAGES = [
  'select_disputes', 'configure_letters', 'letter_review', 'mailing',
  'awaiting_responses', 'response_review',
];


function normalizeCampaign(row) {
  return row ? {
    id: row.id, userId: row.user_id, clientId: row.client_id, auditId: row.audit_id,
    roundNumber: row.round_number, stage: row.stage, builderMode: row.builder_mode,
    openedAt: row.opened_at, closedAt: row.closed_at,
  } : null;
}

function normalizeItem(row) {
  return {
    id: row.id, campaignId: row.campaign_id, kind: row.item_kind, sourceKey: row.source_key,
    clientAccountId: row.client_account_id, label: row.label, snapshot: row.snapshot || {},
    selectionState: row.selection_state, sortOrder: row.sort_order,
  };
}

function normalizeRoute(row) {
  return {
    id: row.id, campaignId: row.campaign_id, itemId: row.item_id, targetType: row.target_type,
    targetBureau: row.target_bureau, letterStyle: row.letter_style,
    customInstructions: row.custom_instructions || '', status: row.status,
    disputeRoundId: row.dispute_round_id, letterIds: row.letter_ids || [],
    itemIds: row.item_ids?.length ? row.item_ids : [row.item_id],
    approvedLetterIds: row.approved_letter_ids || [], generationError: row.generation_error || null,
  };
}

export async function getCampaignWorkspace(clientId) {
  const { data: campaigns, error } = await supabase.from('client_campaigns').select('*')
    .eq('client_id', clientId).in('stage', CAMPAIGN_STAGES).order('round_number', { ascending: false }).limit(1);
  if (error) {
    if (/client_campaigns/i.test(error.message || '')) return { campaign: null, items: [], routes: [], letters: [] };
    throw error;
  }
  const campaign = normalizeCampaign(campaigns?.[0]);
  if (!campaign) return { campaign: null, items: [], routes: [], letters: [] };
  const [itemsRes, routesRes, lettersRes] = await Promise.all([
    supabase.from('campaign_items').select('*').eq('campaign_id', campaign.id).order('sort_order'),
    supabase.from('campaign_letter_routes').select('*').eq('campaign_id', campaign.id).order('created_at'),
    supabase.from('letters').select('*').eq('campaign_id', campaign.id).order('saved_at'),
  ]);
  if (itemsRes.error) throw itemsRes.error;
  if (routesRes.error) throw routesRes.error;
  if (lettersRes.error) throw lettersRes.error;
  return {
    campaign,
    items: (itemsRes.data || []).map(normalizeItem),
    routes: (routesRes.data || []).map(normalizeRoute),
    letters: lettersRes.data || [],
  };
}

export async function createCampaignFromAudit(client, auditRecord) {
  if (!client?.id || !auditRecord?.id) throw new Error('A client and saved audit are required.');
  const items = buildCampaignItems(auditRecord);
  if (!items.length) throw new Error('The latest audit has no linked dispute items.');
  const { data, error } = await supabase.rpc('create_client_campaign', {
    p_client_id: client.id, p_audit_id: auditRecord.id, p_items: items,
  });
  if (error) throw error;
  return normalizeCampaign(data);
}

export async function updateCampaignItemState(itemId, selectionState) {
  return updateCampaignItemStates([itemId], selectionState);
}

export async function updateCampaignItemStates(itemIds, selectionState) {
  if (!['candidate', 'selected', 'later'].includes(selectionState)) throw new Error('Invalid dispute selection state.');
  const ids = [...new Set((itemIds || []).filter(Boolean))];
  if (!ids.length) return;
  const { error } = await supabase.from('campaign_items')
    .update({ selection_state: selectionState, updated_at: new Date().toISOString() })
    .in('id', ids);
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
    } else if (groupedItems.length !== 1 || item.kind !== 'account') {
      throw new Error('Account disputes must use one account per route.');
    }
    return {
      campaign_id: campaign.id, item_id: item.id, user_id: userId, client_id: campaign.clientId,
      item_ids: itemIds,
      target_type: spec.targetType, target_bureau: spec.targetBureau || null,
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
  const { data: letters, error } = await supabase.from('letters')
    .select('id,round_number,target_type,target_bureau,html,summary,phase,date,saved_at')
    .eq('client_account_id', clientAccountId).not('round_id', 'is', null).not('mailed_date', 'is', null)
    .order('round_number', { ascending: false });
  if (error) throw error;
  const ids = (letters || []).map((letter) => letter.id);
  if (!ids.length) return [];
  const { data: evidence, error: evidenceError } = await supabase.from('response_evidence')
    .select('id,letter_id,response_kind,evidence_kind,analysis,review_status,analysis_status,received_at')
    .in('letter_id', ids).eq('analysis_status', 'analyzed').neq('review_status', 'not_reviewed');
  if (evidenceError) throw evidenceError;
  const byLetter = new Map((letters || []).map((letter) => [letter.id, letter]));
  return (evidence || []).map((item, index) => ({
    sourceLetterId: item.letter_id, responseEvidenceId: item.id, sourceOrder: index,
    letter: byLetter.get(item.letter_id), evidence: item,
  })).filter((item) => item.letter);
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
