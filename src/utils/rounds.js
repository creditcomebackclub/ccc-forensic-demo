import { supabase } from './supabase.js';

function unwrap(data, error, fallback) {
  if (error) throw new Error(error.message || fallback);
  return data;
}

async function queueRoundEmail(roundId, eventType) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return;
  const response = await fetch('/.netlify/functions/round-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action: 'queue_event', roundId, eventType }),
  });
  if (!response.ok) throw new Error('Round status saved, but its client email could not be queued.');
}

export async function getRoundsForAccount(clientAccountId) {
  const { data, error } = await supabase
    .from('dispute_round_summary')
    .select('*')
    .eq('client_account_id', clientAccountId)
    .order('round_number', { ascending: true });
  return unwrap(data || [], error, 'Could not load dispute rounds.');
}

export async function getLatestRound(clientAccountId) {
  const { data, error } = await supabase
    .from('dispute_round_summary')
    .select('*')
    .eq('client_account_id', clientAccountId)
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  return unwrap(data || null, error, 'Could not load the latest dispute round.');
}

export async function startRound({ clientAccountId, targetType, letters, sources = [] }) {
  const { data, error } = await supabase.rpc('start_dispute_round', {
    p_client_account_id: clientAccountId,
    p_target_type: targetType,
    p_letters: letters,
    p_sources: sources,
  });
  return unwrap(data, error, 'Could not start the dispute round.');
}

export async function closeRound(roundId, disposition, notes = null) {
  const { data, error } = await supabase.rpc('close_dispute_round', {
    p_round_id: roundId,
    p_disposition: disposition,
    p_notes: notes,
  });
  const round = unwrap(data, error, 'Could not close the dispute round.');
  const eventType = disposition === 'resolved' ? 'round_resolved' : disposition === 'escalate' ? 'escalation_ready' : null;
  if (eventType) {
    try { await queueRoundEmail(roundId, eventType); }
    catch (emailError) { console.error(emailError); }
  }
  return round;
}

export async function reopenRound(roundId) {
  const { data, error } = await supabase.rpc('reopen_dispute_round', { p_round_id: roundId });
  return unwrap(data, error, 'Could not reopen the dispute round.');
}

export async function cancelRound(roundId, reason) {
  const { data, error } = await supabase.rpc('cancel_dispute_round', { p_round_id: roundId, p_reason: reason });
  return unwrap(data, error, 'Could not cancel the dispute round.');
}

export async function extendLetterDeadline(letterId, reason) {
  const { data, error } = await supabase.rpc('extend_letter_deadline', { p_letter_id: letterId, p_reason: reason });
  return unwrap(data, error, 'Could not extend the response deadline.');
}

export async function markRoundClosePrompted(roundId) {
  const { data, error } = await supabase.rpc('mark_round_close_prompted', { p_round_id: roundId });
  return unwrap(data, error, 'Could not save the round prompt state.');
}

export async function reviewRoundLetter({ letterId, responseEvidenceId, reviewStatus, nextAction, notes = null }) {
  const { data, error } = await supabase.rpc('review_round_letter', {
    p_letter_id: letterId,
    p_response_evidence_id: responseEvidenceId,
    p_review_status: reviewStatus,
    p_next_action: nextAction,
    p_notes: notes,
  });
  const letter = unwrap(data, error, 'Could not save the round review.');
  if (nextAction === 'needs_documents' && letter?.round_id) {
    try { await queueRoundEmail(letter.round_id, 'documents_needed'); }
    catch (emailError) { console.error(emailError); }
  }
  return letter;
}
