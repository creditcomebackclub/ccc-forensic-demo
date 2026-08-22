import { supabase } from './supabase.js';

export {
  ACHIEVED_TARGET_OPTIONS,
  DISPUTE_RESULT_OPTIONS,
  NEXT_ACTION_LABELS,
  RESPONSE_STATUS_OPTIONS,
  TARGET_STATUS_OPTIONS,
  accountsForTrackedLetter,
  classifyR7StatementMatch,
  consumerStatementEvidenceForLetter,
  deriveCourseOutcome,
  disputeAccountKey,
  eligibleAchievedTargets,
  evidenceAccountForSnapshot,
  evidenceAccountPresentForSnapshot,
  evidenceCommentForSnapshot,
  hasCourseTrackSnapshots,
  isCompleteDeterministicEvidenceAudit,
  isPostMailEvidenceAudit,
  isR7ConsumerStatementStep,
  letterIsWin,
  normalizeCourseStatementText,
} from './disputeTrackingRules.js';

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export async function listTrackedDisputeLetters({ limit = 250 } = {}) {
  const { data, error } = await supabase
    .from('letters')
    .select('id,user_id,client_id,client_name,furnisher,covered_furnishers,mailed_date,delivered_at,dispute_template_id,dispute_template_name,dispute_template_version_label,dispute_template_family_key,dispute_flow_code,dispute_round_number,dispute_bureau_code,dispute_account_snapshot,ccc_account_track_snapshots,dispute_editable_sections,dispute_letter_results(*)')
    .not('dispute_template_id', 'is', null)
    .not('mailed_date', 'is', null)
    .order('mailed_date', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) throw error;
  const letters = data || [];
  if (!letters.length) return letters;

  const letterIds = letters.map((letter) => letter.id);
  const clientIds = unique(letters.map((letter) => letter.client_id));
  const [submissionsResult, batchesResult, auditsResult] = await Promise.all([
    supabase
      .from('mail_submissions')
      .select('letter_id,user_id,created_at,submitted_at,consumer_statement_text,consumer_statement_sha256,consumer_statement_captured_at')
      .in('letter_id', letterIds),
    supabase
      .from('ccc_outcome_batches')
      .select('*')
      .in('letter_id', letterIds),
    clientIds.length
      ? supabase
        .from('audits')
        .select('id,user_id,client_id,report_date,saved_at,audit')
        .in('client_id', clientIds)
        .order('saved_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (submissionsResult.error) throw submissionsResult.error;
  if (batchesResult.error) throw batchesResult.error;
  if (auditsResult.error) throw auditsResult.error;

  const submissionByLetter = new Map((submissionsResult.data || []).map((row) => [`${row.user_id}:${row.letter_id}`, row]));
  const batchByLetter = new Map((batchesResult.data || []).map((row) => [`${row.user_id}:${row.letter_id}`, row]));
  const auditsByOwnerClient = new Map();
  for (const audit of auditsResult.data || []) {
    const key = `${audit.user_id}:${audit.client_id}`;
    if (!auditsByOwnerClient.has(key)) auditsByOwnerClient.set(key, []);
    auditsByOwnerClient.get(key).push(audit);
  }

  return letters.map((letter) => {
    const key = `${letter.user_id}:${letter.id}`;
    return {
      ...letter,
      mailSubmission: submissionByLetter.get(key) || null,
      outcomeBatch: batchByLetter.get(key) || null,
      evidenceAudits: auditsByOwnerClient.get(`${letter.user_id}:${letter.client_id}`) || [],
    };
  });
}

export async function saveDisputeOutcomeBatch({ letter, evidenceAuditId, outcomes }) {
  if (!letter?.id || !letter?.user_id || !evidenceAuditId) {
    throw new Error('The exact mailed letter owner, letter, and post-mail report update are required.');
  }
  if (!Array.isArray(outcomes) || outcomes.length === 0) throw new Error('Review every covered account before saving this letter.');
  const payload = outcomes.map((outcome) => ({
    trackId: outcome.trackId,
    expectedRevision: outcome.expectedRevision,
    targetStatus: outcome.targetStatus,
    responseStatus: outcome.responseStatus,
    achievedTarget: outcome.achievedTarget || 'none',
    notes: String(outcome.notes || '').trim() || null,
  }));
  const { data, error } = await supabase.rpc('record_ccc_outcome_batch', {
    p_letter_user_id: letter.user_id,
    p_letter_id: letter.id,
    p_evidence_audit_id: evidenceAuditId,
    p_outcomes: payload,
  });
  if (error) throw error;
  return data;
}
