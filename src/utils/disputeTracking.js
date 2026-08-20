import { supabase } from './supabase.js';
import { DISPUTE_RESULT_OPTIONS, disputeAccountKey } from './disputeTrackingRules.js';
export { DISPUTE_RESULT_OPTIONS, accountsForTrackedLetter, disputeAccountKey } from './disputeTrackingRules.js';

export async function listTrackedDisputeLetters({ limit = 250 } = {}) {
  const { data, error } = await supabase
    .from('letters')
    .select('id,client_id,client_name,furnisher,covered_furnishers,mailed_date,delivered_at,dispute_template_id,dispute_template_name,dispute_template_version_label,dispute_template_family_key,dispute_flow_code,dispute_round_number,dispute_bureau_code,dispute_account_snapshot,dispute_letter_results(*)')
    .not('dispute_template_id', 'is', null)
    .not('mailed_date', 'is', null)
    .order('mailed_date', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) throw error;
  return data || [];
}

export async function saveDisputeLetterResult({ letter, account, resultCode, resultDate, notes }) {
  if (!letter?.id || !resultCode || !resultDate) throw new Error('Letter, result, and result date are required.');
  if (!DISPUTE_RESULT_OPTIONS.some((option) => option.code === resultCode)) throw new Error('Unknown dispute result.');
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = auth?.user?.id;
  if (!userId) throw new Error('Not signed in.');

  const row = {
    letter_id: letter.id,
    client_id: letter.client_id || null,
    client_account_id: account.clientAccountId || null,
    account_key: disputeAccountKey(account),
    furnisher: String(account.furnisher || letter.furnisher || 'Unknown furnisher').trim(),
    bureau_code: letter.dispute_bureau_code || null,
    result_code: resultCode,
    result_date: resultDate,
    notes: String(notes || '').trim() || null,
    recorded_by: userId,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('dispute_letter_results')
    .upsert(row, { onConflict: 'letter_id,account_key' })
    .select()
    .single();
  if (error) throw error;
  return data;
}
