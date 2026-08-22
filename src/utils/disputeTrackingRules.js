export const TARGET_STATUS_OPTIONS = Object.freeze([
  { code: 'achieved', label: 'Target achieved' },
  { code: 'partial', label: 'Partially achieved' },
  { code: 'remains', label: 'Target remains' },
  { code: 'indeterminate', label: 'Cannot determine' },
]);

export const RESPONSE_STATUS_OPTIONS = Object.freeze([
  { code: 'deleted', label: 'Deleted' },
  { code: 'updated', label: 'Updated' },
  { code: 'verified', label: 'Verified / unchanged' },
  { code: 'no_response', label: 'No response' },
  { code: 'duplicate', label: 'Duplicate / recycled response' },
  { code: 'unreadable', label: 'Unreadable / insufficient evidence' },
]);

export const ACHIEVED_TARGET_OPTIONS = Object.freeze([
  { code: 'none', label: 'No target achieved' },
  { code: 'account_deletion', label: 'Account deleted' },
  { code: 'factual_correction', label: 'Accuracy issue fully corrected' },
  { code: 'late_payment_removal', label: 'Targeted late payment removed' },
  { code: 'consumer_statement_full_match', label: 'Full Consumer Statement reported' },
]);

export const NEXT_ACTION_LABELS = Object.freeze({
  close: 'Close this account track',
  advance: 'Advance this account only',
  switch: 'Switch this account to its next unused native law',
  hold: 'Hold for manual review',
});

// Legacy rows remain readable, but new CCC outcomes never write this mixed enum.
export const DISPUTE_RESULT_OPTIONS = Object.freeze([
  { code: 'deleted', label: 'Deleted — legacy win' },
  { code: 'verified', label: 'Verified — legacy' },
  { code: 'updated', label: 'Updated — legacy' },
  { code: 'no_response', label: 'No response — legacy' },
  { code: 'duplicate', label: 'Duplicate — legacy' },
]);

export function disputeAccountKey(account = {}) {
  if (account.accountKey) return String(account.accountKey);
  if (account.clientAccountId) return `client-account:${account.clientAccountId}`;
  if (account.accountId) return `account:${account.accountId}`;
  const furnisher = String(account.furnisher || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `furnisher:${furnisher || 'unknown'}`;
}

function canonicalAccountId(account = {}) {
  return account.clientAccountId || account.client_account_id || null;
}

export function hasCourseTrackSnapshots(letter = {}) {
  return Array.isArray(letter.ccc_account_track_snapshots) && letter.ccc_account_track_snapshots.length > 0;
}

export function accountsForTrackedLetter(letter = {}) {
  const accountSnapshots = Array.isArray(letter.dispute_account_snapshot) ? letter.dispute_account_snapshot : [];
  if (hasCourseTrackSnapshots(letter)) {
    const byAccountId = new Map(accountSnapshots
      .map((account) => [canonicalAccountId(account), account])
      .filter(([accountId]) => accountId));
    return letter.ccc_account_track_snapshots.map((trackSnapshot) => {
      const account = byAccountId.get(trackSnapshot.clientAccountId) || {};
      return {
        ...account,
        clientAccountId: trackSnapshot.clientAccountId,
        accountKey: `client-account:${trackSnapshot.clientAccountId}`,
        trackSnapshot,
      };
    });
  }
  if (accountSnapshots.length) return accountSnapshots.map((account) => ({ ...account, accountKey: disputeAccountKey(account) }));
  const furnishers = Array.isArray(letter.covered_furnishers) && letter.covered_furnishers.length
    ? letter.covered_furnishers
    : [letter.furnisher].filter(Boolean);
  return furnishers.map((furnisher) => ({ furnisher, accountKey: disputeAccountKey({ furnisher }) }));
}

export function consumerStatementEvidenceForLetter(letter = {}) {
  if (String(letter.dispute_flow_code || '').toLowerCase() === 'direct') return null;
  const mailed = String(letter.mailSubmission?.consumer_statement_text || '').trim();
  if (mailed) {
    return {
      text: mailed,
      source: 'mailed',
      sha256: letter.mailSubmission?.consumer_statement_sha256 || null,
      capturedAt: letter.mailSubmission?.consumer_statement_captured_at || null,
    };
  }
  const draft = String(letter.dispute_editable_sections?.consumer_statement || '').trim();
  if (!draft) return null;
  return { text: draft, source: 'draft', sha256: null, capturedAt: null };
}

export function isR7ConsumerStatementStep(snapshot = {}) {
  return snapshot.concreteFlow === 'accuracy' && Number(snapshot.concreteRound) === 7;
}

export function normalizeCourseStatementText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const GENERIC_REPORT_COMMENTS = new Set([
  'account information disputed by consumer',
  'consumer disputes account information',
  'consumer disputes this account information',
  'consumer disputes after resolution',
  'disputed by consumer',
  'consumer statement',
  'meets fcra requirements',
]);

export function classifyR7StatementMatch(mailedStatement, currentReportComment) {
  const statement = normalizeCourseStatementText(mailedStatement);
  const comment = normalizeCourseStatementText(currentReportComment);
  if (!comment) return 'missing';
  if (statement && (comment === statement || comment.includes(statement))) return 'full';
  if (GENERIC_REPORT_COMMENTS.has(comment)) return 'generic';
  return 'partial';
}

function bureauObjectKey(code) {
  return { EQ: 'equifax', EXP: 'experian', TU: 'transunion' }[code] || null;
}

export function evidenceAccountForSnapshot(auditRecord, snapshot = {}) {
  const accounts = auditRecord?.audit?.accounts;
  if (!Array.isArray(accounts)) return null;
  return accounts.find((account) => canonicalAccountId(account) === snapshot.clientAccountId) || null;
}

export function evidenceAccountPresentForSnapshot(auditRecord, snapshot = {}) {
  const account = evidenceAccountForSnapshot(auditRecord, snapshot);
  if (!account) return false;
  if (snapshot.trackScope === 'direct') return true;
  const key = bureauObjectKey(snapshot.bureauCode);
  const variants = account.extractedByBureau;
  if (variants && typeof variants === 'object' && !Array.isArray(variants)
    && (variants[key] || variants[snapshot.bureauCode] || variants[String(snapshot.bureauCode || '').toLowerCase()])) return true;
  return Array.isArray(account.bureaus) && account.bureaus.includes(snapshot.bureauCode);
}

export function evidenceCommentForSnapshot(auditRecord, snapshot = {}) {
  const account = evidenceAccountForSnapshot(auditRecord, snapshot);
  if (!account || snapshot.trackScope !== 'cra') return '';
  const key = bureauObjectKey(snapshot.bureauCode);
  const bureauVariant = account.extractedByBureau?.[key]
    || account.extractedByBureau?.[snapshot.bureauCode]
    || account.extractedByBureau?.[String(snapshot.bureauCode || '').toLowerCase()];
  const exact = bureauVariant?.remarks || bureauVariant?.specialComment;
  if (exact) return String(exact).trim();
  const bureaus = Array.isArray(account.bureaus) ? account.bureaus : [];
  return bureaus.length === 1 && bureaus[0] === snapshot.bureauCode
    ? String(account.remarks || account.specialComment || '').trim()
    : '';
}

export function eligibleAchievedTargets(snapshot = {}) {
  const codes = ['account_deletion'];
  if (snapshot.nativeFlow === 'accuracy' || snapshot.logicalFlow === 'accuracy') codes.push('factual_correction');
  // After Late Pay R2 survives, the logical track switches to Accuracy and
  // targets the whole account. Native provenance must not preserve the old
  // late-mark-only success option after that switch.
  if (snapshot.logicalFlow === 'late_pay') codes.push('late_payment_removal');
  if (isR7ConsumerStatementStep(snapshot)) codes.push('consumer_statement_full_match');
  return ACHIEVED_TARGET_OPTIONS.filter((option) => option.code === 'none' || codes.includes(option.code));
}

export function deriveCourseOutcome({
  snapshot = {},
  targetStatus,
  achievedTarget = 'none',
  r7Match = null,
  oppositeSideFullyAchieved = false,
} = {}) {
  if (targetStatus === 'achieved') {
    return {
      nextAction: 'close',
      transitionOutcome: achievedTarget === 'account_deletion' ? 'deleted' : 'resolved',
    };
  }
  if (targetStatus === 'indeterminate' || (isR7ConsumerStatementStep(snapshot) && r7Match === 'partial')) {
    return { nextAction: 'hold', transitionOutcome: null };
  }
  if (snapshot.logicalFlow === 'combo' && oppositeSideFullyAchieved) {
    return { nextAction: 'switch', transitionOutcome: 'combo_side_deleted' };
  }
  return { nextAction: 'advance', transitionOutcome: 'remains' };
}

export function letterIsWin(results = []) {
  return results.some((result) => result?.target_status === 'achieved' || result?.targetStatus === 'achieved');
}

export function isCompleteDeterministicEvidenceAudit(auditRecord) {
  const audit = auditRecord?.audit;
  const coverage = audit?.reportCoverage;
  if (!audit || audit.evaluationMode !== 'deterministic'
    || audit.schemaVersion !== 'deterministic-audit-v4'
    || !Array.isArray(audit.accounts) || audit.accounts.length === 0
    || !coverage || coverage.complete !== true
    || !Array.isArray(coverage.missing) || coverage.missing.length !== 0
    || !Array.isArray(coverage.duplicates) || coverage.duplicates.length !== 0) return false;
  return ['EQ', 'EXP', 'TU'].every((code) => Number(coverage.counts?.[code]) === 1);
}

export function isPostMailEvidenceAudit(letter, auditRecord) {
  if (!auditRecord || auditRecord.user_id !== letter.user_id || auditRecord.client_id !== letter.client_id
    || !isCompleteDeterministicEvidenceAudit(auditRecord)) return false;
  const savedAt = Date.parse(auditRecord.saved_at || '');
  const mailedAt = Date.parse(letter.mailSubmission?.submitted_at || '');
  return Number.isFinite(savedAt) && Number.isFinite(mailedAt) && savedAt > mailedAt;
}
