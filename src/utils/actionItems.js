// Counts client-uploaded furnisher responses that haven't been run through
// Phase 2 analysis yet — drives the sidebar action-item badge. "Unanalyzed"
// reuses the phase2_analyzed_at signal ResponseAnalyzer already persists, so
// this needs no new schema: a letter with a response file in storage but no
// phase2_analyzed_at is an action item.
import { supabase } from './supabase';
import { CONVERTED_PREFIX } from './responseFiles';

// Returns both the badge count and the set of client names that have at
// least one unanalyzed response, so the sidebar badge can link straight to
// the clients that actually need attention instead of just the count.
export async function getUnanalyzedResponseStats() {
  const empty = { count: 0, clientNames: new Set() };
  const { data: allLetters } = await supabase
    .from('letters')
    .select('id, client_name, furnisher, phase, phase2_analyzed_at');
  if (!allLetters || !allLetters.length) return empty;

  // Only consider letters unanalyzed if they have no phase2_analyzed_at AND
  // there isn't already a Phase 3 letter for this furnisher (which means the
  // user manually skipped Phase 2 analysis and generated Phase 3 directly).
  const letters = allLetters.filter(l => 
    l.phase2_analyzed_at === null && 
    !allLetters.some(pl => pl.client_name === l.client_name && pl.furnisher === l.furnisher && pl.phase?.startsWith('Phase 3'))
  );
  
  if (!letters.length) return empty;

  const lettersByClient = new Map();
  for (const l of letters) {
    if (!lettersByClient.has(l.client_name)) lettersByClient.set(l.client_name, new Set());
    lettersByClient.get(l.client_name).add(l.id);
  }

  const { data: profiles } = await supabase
    .from('client_profiles')
    .select('user_id, full_name')
    .in('full_name', [...lettersByClient.keys()]);
  if (!profiles || !profiles.length) return empty;

  let count = 0;
  const clientNames = new Set();
  for (const p of profiles) {
    const letterIds = lettersByClient.get(p.full_name);
    if (!letterIds || !letterIds.size || !p.user_id) continue;

    const { data: folders } = await supabase.storage.from('responses').list(p.user_id, { limit: 100 });
    if (!folders) continue;

    for (const folder of folders) {
      if (!letterIds.has(folder.name)) continue;
      const { data: files } = await supabase.storage.from('responses').list(p.user_id + '/' + folder.name, { limit: 50 });
      const visible = (files || []).filter((f) => !f.name.startsWith(CONVERTED_PREFIX));
      if (visible.length > 0) { 
        count += 1; 
        clientNames.add(p.full_name); 
        console.error(`🔴 UNANALYZED RESPONSE FOUND FOR ${p.full_name}:\n- Letter ID: ${folder.name}\n- Raw Files: ${visible.map(f => f.name).join(', ')}`);
      }
    }
  }
  return { count, clientNames };
}

export async function countUnanalyzedResponses() {
  return (await getUnanalyzedResponseStats()).count;
}

export async function getNewLeadsCount() {
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('clients')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'lead')
    .gte('lead_created_at', fortyEightHoursAgo);
  return count || 0;
}
