import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dateAfterDays, nextTemplateVersionLabel } from '../src/utils/disputeTemplateSelection.js';
import {
  accountsForTrackedLetter,
  classifyR7StatementMatch,
  consumerStatementEvidenceForLetter,
  deriveCourseOutcome,
  disputeAccountKey,
  eligibleAchievedTargets,
  evidenceAccountForSnapshot,
  evidenceAccountPresentForSnapshot,
  evidenceCommentForSnapshot,
  isCompleteDeterministicEvidenceAudit,
  isPostMailEvidenceAudit,
  isR7ConsumerStatementStep,
  letterIsWin,
  normalizeCourseStatementText,
} from '../src/utils/disputeTrackingRules.js';

assert.equal(nextTemplateVersionLabel('v1'), 'v2');
assert.equal(nextTemplateVersionLabel('V12'), 'v13');
assert.equal(nextTemplateVersionLabel('quarterly-rewrite'), 'v2');
assert.equal(dateAfterDays('2026-08-20', 49), '2026-10-08');

assert.equal(disputeAccountKey({ clientAccountId: 'account-uuid' }), 'client-account:account-uuid');
assert.equal(disputeAccountKey({ accountId: 'A-19' }), 'account:A-19');
assert.equal(disputeAccountKey({ furnisher: 'Acme Recovery LLC' }), 'furnisher:acme-recovery-llc');

const trackSnapshot = {
  trackId: '11111111-1111-4111-8111-111111111111',
  revision: 2,
  clientAccountId: '22222222-2222-4222-8222-222222222222',
  nativeFlow: 'accuracy',
  logicalFlow: 'accuracy',
  logicalRound: 7,
  concreteFlow: 'accuracy',
  concreteRound: 7,
  trackScope: 'cra',
  bureauCode: 'TU',
};
assert.deepEqual(accountsForTrackedLetter({
  ccc_account_track_snapshots: [trackSnapshot],
  dispute_account_snapshot: [{ clientAccountId: trackSnapshot.clientAccountId, furnisher: 'Bank One' }],
}), [{
  clientAccountId: trackSnapshot.clientAccountId,
  furnisher: 'Bank One',
  accountKey: `client-account:${trackSnapshot.clientAccountId}`,
  trackSnapshot,
}]);
assert.deepEqual(
  accountsForTrackedLetter({ covered_furnishers: ['Collector One', 'Collector Two'] }).map((item) => item.accountKey),
  ['furnisher:collector-one', 'furnisher:collector-two'],
);

assert.deepEqual(consumerStatementEvidenceForLetter({
  dispute_flow_code: 'accuracy',
  mailSubmission: {
    consumer_statement_text: 'Exact mailed statement.',
    consumer_statement_sha256: 'a'.repeat(64),
    consumer_statement_captured_at: '2026-08-20T12:00:00Z',
  },
  dispute_editable_sections: { consumer_statement: 'Older draft.' },
}), {
  text: 'Exact mailed statement.',
  source: 'mailed',
  sha256: 'a'.repeat(64),
  capturedAt: '2026-08-20T12:00:00Z',
});
assert.equal(consumerStatementEvidenceForLetter({
  dispute_flow_code: 'direct',
  dispute_editable_sections: { consumer_statement: 'Must never be used.' },
}), null);

assert.equal(normalizeCourseStatementText(' Paid—more!\nHousing '), 'paid more housing');
assert.equal(classifyR7StatementMatch('Job denied; paid more.', 'JOB DENIED — paid more!'), 'full');
assert.equal(classifyR7StatementMatch('Job denied; paid more.', 'Account information disputed by consumer'), 'generic');
assert.equal(classifyR7StatementMatch('Job denied; paid more.', ''), 'missing');
assert.equal(classifyR7StatementMatch('Job denied; paid more.', 'Job denied only'), 'partial');
assert.equal(isR7ConsumerStatementStep(trackSnapshot), true);

const evidenceAudit = {
  audit: {
    accounts: [{
      clientAccountId: trackSnapshot.clientAccountId,
      bureaus: ['TU'],
      remarks: 'Fallback should not win while exact variant exists.',
      extractedByBureau: { transunion: { remarks: 'Exact mailed statement.' } },
    }],
  },
};
assert.equal(evidenceAccountForSnapshot(evidenceAudit, trackSnapshot)?.clientAccountId, trackSnapshot.clientAccountId);
assert.equal(evidenceAccountPresentForSnapshot(evidenceAudit, trackSnapshot), true);
assert.equal(evidenceAccountPresentForSnapshot(evidenceAudit, { ...trackSnapshot, bureauCode: 'EQ' }), false, 'an account on another bureau is absent from this exact bureau track');
assert.equal(evidenceCommentForSnapshot(evidenceAudit, trackSnapshot), 'Exact mailed statement.');

const completePostMailAudit = {
  user_id: 'firm-1',
  client_id: 'client-1',
  saved_at: '2026-08-21T12:00:00Z',
  audit: {
    evaluationMode: 'deterministic',
    schemaVersion: 'deterministic-audit-v4',
    accounts: [{ clientAccountId: trackSnapshot.clientAccountId }],
    reportCoverage: { complete: true, missing: [], duplicates: [], counts: { EQ: 1, EXP: 1, TU: 1 } },
  },
};
assert.equal(isCompleteDeterministicEvidenceAudit(completePostMailAudit), true);
assert.equal(isPostMailEvidenceAudit({
  user_id: 'firm-1', client_id: 'client-1',
  mailSubmission: { created_at: '2026-08-20T10:00:00Z', submitted_at: '2026-08-20T12:00:00Z' },
}, completePostMailAudit), true);
assert.equal(isPostMailEvidenceAudit({
  user_id: 'firm-1', client_id: 'client-1',
  mailSubmission: { created_at: '2026-08-19T10:00:00Z', submitted_at: '2026-08-22T12:00:00Z' },
}, completePostMailAudit), false, 'draft-created time cannot make pre-acceptance evidence eligible');
assert.equal(isPostMailEvidenceAudit({
  user_id: 'firm-1', client_id: 'client-1', mailSubmission: { submitted_at: '2026-08-20T12:00:00Z' },
}, { ...completePostMailAudit, audit: { ...completePostMailAudit.audit, schemaVersion: 'deterministic-audit-v3' } }), false);

assert.deepEqual(deriveCourseOutcome({
  snapshot: trackSnapshot,
  targetStatus: 'achieved',
  achievedTarget: 'factual_correction',
}), { nextAction: 'close', transitionOutcome: 'resolved' });
assert.deepEqual(deriveCourseOutcome({
  snapshot: trackSnapshot,
  targetStatus: 'partial',
  achievedTarget: 'none',
  r7Match: 'partial',
}), { nextAction: 'hold', transitionOutcome: null });
assert.deepEqual(deriveCourseOutcome({
  snapshot: { ...trackSnapshot, logicalFlow: 'combo', nativeFlow: 'collection', concreteRound: 8 },
  targetStatus: 'remains',
  oppositeSideFullyAchieved: true,
}), { nextAction: 'switch', transitionOutcome: 'combo_side_deleted' });
assert.deepEqual(deriveCourseOutcome({
  snapshot: { ...trackSnapshot, logicalFlow: 'late_pay', nativeFlow: 'late_pay', concreteRound: 2 },
  targetStatus: 'remains',
}), { nextAction: 'advance', transitionOutcome: 'remains' });
assert.equal(letterIsWin([{ target_status: 'remains' }, { target_status: 'achieved' }]), true);
assert.equal(letterIsWin([{ target_status: 'partial' }, { target_status: 'remains' }]), false);
assert.deepEqual(
  eligibleAchievedTargets(trackSnapshot).map((option) => option.code),
  ['none', 'account_deletion', 'factual_correction', 'consumer_statement_full_match'],
);
const latePaySnapshot = {
  ...trackSnapshot,
  nativeFlow: 'late_pay',
  logicalFlow: 'late_pay',
  logicalRound: 2,
  concreteFlow: 'consent',
  concreteRound: 2,
};
assert.deepEqual(
  eligibleAchievedTargets(latePaySnapshot).map((option) => option.code),
  ['none', 'account_deletion', 'late_payment_removal'],
);
assert.deepEqual(
  eligibleAchievedTargets({ ...latePaySnapshot, logicalFlow: 'accuracy', concreteFlow: 'accuracy', concreteRound: 1 }).map((option) => option.code),
  ['none', 'account_deletion', 'factual_correction'],
  'Late Pay provenance cannot keep the late-only target after the track switches to Accuracy',
);

const legacyMigration = readFileSync(new URL('../supabase/migrations/20260820130000_dispute_template_tracking.sql', import.meta.url), 'utf8');
const rotationMigration = readFileSync(new URL('../supabase/migrations/20260820210000_seven_week_template_rotation.sql', import.meta.url), 'utf8');
const stateMigration = readFileSync(new URL('../supabase/migrations/20260820220000_ccc_account_tracks.sql', import.meta.url), 'utf8');
const snapshotMigration = readFileSync(new URL('../supabase/migrations/20260820230000_ccc_letter_track_snapshots.sql', import.meta.url), 'utf8');
const outcomeMigration = readFileSync(new URL('../supabase/migrations/20260820240000_course_outcome_tracking.sql', import.meta.url), 'utf8');

assert.match(rotationMigration, /review_due_on = published_on \+ 49/, 'the course wording-review cycle is seven weeks');
assert.match(rotationMigration, /never rewrites or retires a version automatically/i);
assert.doesNotMatch(legacyMigration, /cfpb/i, 'CCC tracking must not reintroduce CFPB timing');
assert.match(snapshotMigration, /accountKind[\s\S]*nativeFlow[\s\S]*logicalFlow[\s\S]*concreteFlow/, 'letter snapshots freeze classification and both logical/concrete coordinates');
assert.match(stateMigration, /late_pay_to_accuracy/, 'a remaining Late Pay target after R2 switches to Accuracy R1');

assert.match(outcomeMigration, /create table if not exists public\.ccc_outcome_batches/i);
assert.match(outcomeMigration, /create table if not exists public\.ccc_outcome_result_events/i);
assert.match(outcomeMigration, /foreign key \(user_id, evidence_audit_id\) references public\.audits\(user_id, id\)/i, 'report evidence uses the composite tenant/audit identity');
assert.match(outcomeMigration, /unique \(user_id, letter_id\)/i, 'one reviewed batch owns one exact mailed letter');
assert.match(outcomeMigration, /target_status in \('achieved', 'partial', 'remains', 'indeterminate'\)/i);
assert.match(outcomeMigration, /response_status in \('deleted', 'updated', 'verified', 'no_response', 'duplicate', 'unreadable'\)/i);
assert.match(outcomeMigration, /achieved_target in \([\s\S]*account_deletion[\s\S]*factual_correction[\s\S]*late_payment_removal[\s\S]*consumer_statement_full_match/i);
assert.match(outcomeMigration, /next_action in \('close', 'advance', 'switch', 'hold'\)/i);
assert.match(outcomeMigration, /alter column result_code drop not null/i, 'new outcomes do not reuse the old mixed enum');
assert.match(outcomeMigration, /drop policy if exists "staff_insert_dispute_letter_results"/i);
assert.match(outcomeMigration, /revoke insert, update, delete on public\.dispute_letter_results from anon, authenticated/i);
assert.match(outcomeMigration, /security definer/i);
assert.match(outcomeMigration, /auth\.uid\(\)/i);
assert.match(outcomeMigration, /ccc_letter_track_snapshots_valid\(v_letter\.ccc_account_track_snapshots\)/i);
assert.match(outcomeMigration, /jsonb_array_length\(v_letter\.ccc_account_track_snapshots\) <> jsonb_array_length\(p_outcomes\)/i);
assert.match(outcomeMigration, /v_track\.revision is distinct from \(v_snapshot->>'revision'\)::integer/i);
assert.match(outcomeMigration, /v_evidence\.saved_at <= v_submission\.submitted_at/i, 'evidence must be saved after exact accepted mail submission');
assert.match(outcomeMigration, /deterministic-audit-v4/i, 'partial, legacy, and test audits cannot advance immutable account state');
assert.match(outcomeMigration, /reportCoverage[\s\S]*counts[\s\S]*'EQ'[\s\S]*'EXP'[\s\S]*'TU'/i, 'outcome evidence requires exact three-bureau coverage');
assert.match(outcomeMigration, /ccc_r7_statement_match/i);
assert.match(outcomeMigration, /v_r7_match = 'partial'[\s\S]*manual hold/i);
assert.match(outcomeMigration, /v_r7_match in \('missing','generic'\)/i);
assert.match(outcomeMigration, /transition_ccc_account_track\(/i, 'state transition occurs inside the atomic batch RPC');
assert.match(outcomeMigration, /v_opposite_achieved[\s\S]*combo_side_deleted/i, 'Combo splits only from whole-side account outcomes');
assert.match(outcomeMigration, /v_track\.current_flow is distinct from 'late_pay'/i, 'Late Pay-only success cannot close a post-switch Accuracy track');
assert.match(outcomeMigration, /count\(distinct scored\.id\).*scored\.won/i, 'performance counts distinct winning letters, not deleted account rows');
assert.match(outcomeMigration, /prevent_ccc_outcome_evidence_rewrite/i);
assert.match(outcomeMigration, /before update or delete on public\.ccc_outcome_result_events/i);

const tracker = readFileSync(new URL('../src/components/DisputeOutcomeTracker.jsx', import.meta.url), 'utf8');
assert.match(tracker, /Letter wins/);
assert.match(tracker, /Reviewed non-wins/);
assert.match(tracker, /Account-specific next action/);
assert.match(tracker, /Record entire letter/);
assert.match(tracker, /Exact post-mail report update/);
assert.match(tracker, /Current report comment/);
assert.match(tracker, /Captured from mailed packet/);
assert.match(tracker, /every remaining account followed its own next action/i);

console.log('Atomic course outcome tracking and seven-week template rules passed.');
