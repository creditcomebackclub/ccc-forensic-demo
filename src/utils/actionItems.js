import { supabase } from './supabase';

// Global staff navigation must not recursively list every `responses` storage
// folder just to paint a badge. New uploads live in response_evidence; the
// database queue below also includes only the two durable legacy signals
// available before that table existed. The selected client's Documents tab
// retains its legacy folder discovery flow for staff reconciliation.
const ACTION_PAGE_SIZE = 250;
const MAX_ACTION_PAGES = 100;

function emptyStats() {
  return { count: 0, clientNames: new Set(), clientIds: new Set(), truncated: false };
}

function addItemTargets(items, clientNames, clientIds) {
  for (const item of items) {
    if (item.client_name) clientNames.add(item.client_name);
    if (item.client_id) clientIds.add(item.client_id);
  }
}

// Compatibility only for a database that has not received the durable queue
// migration yet. It intentionally does *not* crawl raw storage folders:
// doing that globally becomes an N+1 request storm as the client base grows.
async function fallbackPersistedLegacySignals() {
  const { data, error, count } = await supabase
    .from('letters')
    .select('id,client_id,client_name', { count: 'exact' })
    .is('phase2_analyzed_at', null)
    .or('response_file_url.not.is.null,response_outcome.eq.received')
    .order('saved_at', { ascending: false })
    .limit(500);
  if (error) throw error;

  const clientNames = new Set();
  const clientIds = new Set();
  addItemTargets(data || [], clientNames, clientIds);
  return {
    count: Number(count || (data || []).length),
    clientNames,
    clientIds,
    truncated: (data || []).length < Number(count || 0),
  };
}

// Returns both the action-item count and stable client IDs for navigation.
// Names remain as a narrowly scoped legacy fallback until every historical
// letter is backfilled with client_id; callers must prefer clientIds.
export async function getUnanalyzedResponseStats() {
  const clientNames = new Set();
  const clientIds = new Set();
  let cursor = null;
  let pages = 0;
  let totalCount = 0;

  try {
    do {
      const { data, error } = await supabase.rpc('list_response_action_items', {
        p_limit: ACTION_PAGE_SIZE + 1,
        p_cursor_created_at: cursor?.createdAt || null,
        p_cursor_key: cursor?.sortKey || null,
      });
      if (error) throw error;

      const rows = data || [];
      const page = rows.slice(0, ACTION_PAGE_SIZE);
      if (page.length) {
        totalCount = Number(page[0].total_count || totalCount);
        addItemTargets(page, clientNames, clientIds);
      }
      const last = page[page.length - 1];
      cursor = rows.length > ACTION_PAGE_SIZE && last
        ? { createdAt: last.created_at, sortKey: last.sort_key }
        : null;
      pages += 1;
    } while (cursor && pages < MAX_ACTION_PAGES);

    return {
      count: totalCount,
      clientNames,
      clientIds,
      truncated: !!cursor,
    };
  } catch (error) {
    // Preview/older databases can temporarily be missing the RPC while the
    // UI bundle is ahead of the migration. Preserve the durable legacy
    // signals, but never fall back to a global Storage crawl.
    console.warn('Response action queue unavailable; using persisted legacy signals only:', error.message || error);
    try {
      return await fallbackPersistedLegacySignals();
    } catch (fallbackError) {
      console.warn('Could not load response action items:', fallbackError.message || fallbackError);
      return emptyStats();
    }
  }
}

export async function countUnanalyzedResponses() {
  return (await getUnanalyzedResponseStats()).count;
}

export async function getNewLeadsCount() {
  const { count } = await supabase
    .from('clients')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'lead')
    .is('lead_viewed_at', null);
  return count || 0;
}
