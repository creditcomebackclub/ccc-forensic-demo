// CRUD for the escalations table (CFPB / state-AG filings) and read access
// to ag_directory. Mirrors documents.js's self-contained-module shape.
import { supabase } from './supabase';

async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

// One row per furnisher/bureau target — never per-client. Confirmed three
// independent ways during the 2026-07-26 research (CFPB's own complaint
// database keys one company per complaint_id; NCLC's consumer guide
// instructs naming one company; Florida's AG form states "Only one
// business per complaint form"). Callers must not create a single
// escalation meant to cover a client's whole file.
export async function createEscalation({ clientId, clientAccountId, phase3LetterId, track, channel, state, furnisherName }) {
  const userId = await getUserId();
  if (!clientId) throw new Error('createEscalation requires a clientId');
  if (!track || !['furnisher', 'bureau'].includes(track)) throw new Error('createEscalation requires track: "furnisher" or "bureau"');
  if (!channel || !['cfpb', 'state_ag'].includes(channel)) throw new Error('createEscalation requires channel: "cfpb" or "state_ag"');
  if (!furnisherName) throw new Error('createEscalation requires furnisherName');

  const { data, error } = await supabase
    .from('escalations')
    .insert({
      user_id: userId,
      client_id: clientId,
      client_account_id: clientAccountId || null,
      phase3_letter_id: phase3LetterId || null,
      track, channel,
      state: state || null,
      furnisher_name: furnisherName,
      status: 'draft',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateEscalation(id, patch) {
  const userId = await getUserId();
  const mapped = {};
  if ('status' in patch) mapped.status = patch.status;
  if ('cfpbCategory' in patch) mapped.cfpb_category = patch.cfpbCategory;
  if ('cfpbSubIssue' in patch) mapped.cfpb_sub_issue = patch.cfpbSubIssue;
  if ('narrative' in patch) mapped.narrative = patch.narrative;
  if ('agNarrative' in patch) mapped.ag_narrative = patch.agNarrative;
  if ('keyFacts' in patch) mapped.key_facts = patch.keyFacts;
  if ('recommendedAttachments' in patch) mapped.recommended_attachments = patch.recommendedAttachments;
  if ('attachments' in patch) mapped.attachments = patch.attachments;
  if ('state' in patch) mapped.state = patch.state;
  if ('filedAt' in patch) mapped.filed_at = patch.filedAt;
  if ('responseAt' in patch) mapped.response_at = patch.responseAt;
  mapped.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('escalations')
    .update(mapped)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listEscalationsForClient(clientId) {
  if (!clientId) return [];
  const { data, error } = await supabase
    .from('escalations')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function deleteEscalation(id) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('escalations')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

// ag_directory is staff-reference data — read-only from the app's
// perspective (staff_write/update policies exist for manual corrections
// via the Supabase dashboard, not this app's UI).
export async function getAgDirectoryForState(state) {
  if (!state) return [];
  const { data, error } = await supabase
    .from('ag_directory')
    .select('*')
    .eq('state', state.toUpperCase());
  if (error) throw error;
  return data || [];
}

export async function listAgDirectory() {
  const { data, error } = await supabase
    .from('ag_directory')
    .select('*')
    .order('state', { ascending: true });
  if (error) throw error;
  return data || [];
}
