// Counts client-uploaded furnisher responses that haven't been run through
// Phase 2 analysis yet — drives the sidebar action-item badge. "Unanalyzed"
// reuses the phase2_analyzed_at signal ResponseAnalyzer already persists, so
// this needs no new schema: a letter with a response file in storage but no
// phase2_analyzed_at is an action item.
import { supabase } from './supabase';
import { CONVERTED_PREFIX } from './responseFiles';

export async function countUnanalyzedResponses() {
  const { data: letters } = await supabase
    .from('letters')
    .select('id, client_name')
    .is('phase2_analyzed_at', null);
  if (!letters || !letters.length) return 0;

  const lettersByClient = new Map();
  for (const l of letters) {
    if (!lettersByClient.has(l.client_name)) lettersByClient.set(l.client_name, new Set());
    lettersByClient.get(l.client_name).add(l.id);
  }

  const { data: profiles } = await supabase
    .from('client_profiles')
    .select('user_id, full_name')
    .in('full_name', [...lettersByClient.keys()]);
  if (!profiles || !profiles.length) return 0;

  let count = 0;
  for (const p of profiles) {
    const letterIds = lettersByClient.get(p.full_name);
    if (!letterIds || !letterIds.size || !p.user_id) continue;

    const { data: folders } = await supabase.storage.from('responses').list(p.user_id, { limit: 100 });
    if (!folders) continue;

    for (const folder of folders) {
      if (!letterIds.has(folder.name)) continue;
      const { data: files } = await supabase.storage.from('responses').list(p.user_id + '/' + folder.name, { limit: 50 });
      const visible = (files || []).filter((f) => !f.name.startsWith(CONVERTED_PREFIX));
      if (visible.length > 0) count += 1; // one action item per response, not per page
    }
  }
  return count;
}
