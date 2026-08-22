import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CCC_METHOD_VERSION,
  COMBO_SPLIT_RULE_PROVENANCE,
  concreteTemplateStep,
  transitionDisputeState,
} from '../src/utils/disputeState.js';

const track = (overrides = {}) => ({
  methodVersion: CCC_METHOD_VERSION,
  accountKind: 'collection',
  nativeFlow: 'collection',
  currentFlow: 'collection',
  currentRound: 1,
  pathRole: 'standard',
  status: 'active',
  cycle: 1,
  revision: 0,
  usedNativeRounds: {},
  ...overrides,
});

assert.deepEqual(concreteTemplateStep('combo', 5), { flow: 'accuracy', round: 5 });
assert.deepEqual(concreteTemplateStep('combo', 7), { flow: 'accuracy', round: 7 });
assert.deepEqual(concreteTemplateStep('late_pay', 2), { flow: 'consent', round: 2 });
assert.deepEqual(concreteTemplateStep('repo', 1), { flow: 'collection', round: 1 });
assert.deepEqual(concreteTemplateStep('repo', 2), { flow: 'collection', round: 2 });
assert.deepEqual(concreteTemplateStep('repo', 3), { flow: 'collection', round: 6 });

const original = track();
const collectionR2 = transitionDisputeState(original, { outcome: 'remains' });
assert.equal(collectionR2.currentRound, 2);
assert.equal(collectionR2.revision, 1);
assert.deepEqual(collectionR2.usedNativeRounds.collection, [1]);
assert.equal(original.currentRound, 1, 'pure transition must not mutate its input');
const snakeCaseState = transitionDisputeState({
  method_version: CCC_METHOD_VERSION,
  account_kind: 'collection',
  native_flow: 'collection',
  current_flow: 'collection',
  current_round: 1,
  path_role: 'standard',
  status: 'active',
  cycle: 1,
  revision: 0,
  used_native_rounds: {},
}, { outcome: 'remains' });
assert.equal(snakeCaseState.currentRound, 2);
assert.equal('current_round' in snakeCaseState, false, 'pure state output must not retain stale DB-shaped fields');

const collectionRestart = transitionDisputeState(track({ currentRound: 10, cycle: 3 }), { outcome: 'remains' });
assert.equal(collectionRestart.status, 'review_required');
assert.equal(collectionRestart.currentFlow, 'collection');
assert.equal(collectionRestart.currentRound, 10);
assert.equal(collectionRestart.cycle, 3);
assert.equal(collectionRestart.reviewCode, 'collection_end_cycle_unconfirmed');

const comboRestart = transitionDisputeState(track({
  nativeFlow: 'accuracy', currentFlow: 'combo', currentRound: 12, cycle: 2,
}), { outcome: 'remains' });
assert.equal(comboRestart.status, 'review_required');
assert.equal(comboRestart.currentFlow, 'combo');
assert.equal(comboRestart.currentRound, 12);
assert.equal(comboRestart.cycle, 2);
assert.equal(comboRestart.reviewCode, 'combo_end_cycle_unconfirmed');

const accuracySwitch = transitionDisputeState(track({
  accountKind: 'charge_off', nativeFlow: 'accuracy', currentFlow: 'accuracy', currentRound: 12,
}), { outcome: 'remains' });
assert.equal(accuracySwitch.status, 'review_required');
assert.equal(accuracySwitch.currentFlow, 'accuracy');
assert.equal(accuracySwitch.currentRound, 12);
assert.equal(accuracySwitch.reviewCode, 'accuracy_end_cycle_unconfirmed');

const lateR2 = transitionDisputeState(track({
  accountKind: 'late_payment', nativeFlow: 'late_pay', currentFlow: 'late_pay', currentRound: 1,
}), { outcome: 'remains' });
assert.equal(lateR2.currentFlow, 'late_pay');
assert.equal(lateR2.currentRound, 2);
assert.deepEqual(lateR2.template, { flow: 'consent', round: 2 });
const lateSwitch = transitionDisputeState({ ...lateR2 }, { outcome: 'remains' });
assert.equal(lateSwitch.currentFlow, 'accuracy');
assert.equal(lateSwitch.currentRound, 1);

const consentCollection = transitionDisputeState(track({
  nativeFlow: 'consent', currentFlow: 'consent', currentRound: 3,
}), { outcome: 'remains' });
assert.equal(consentCollection.currentFlow, 'collection');
assert.equal(consentCollection.currentRound, 1);
for (const accountKind of ['charge_off', 'late_payment']) {
  const switched = transitionDisputeState(track({
    accountKind, nativeFlow: 'consent', currentFlow: 'consent', currentRound: 3,
  }), { outcome: 'remains' });
  assert.equal(switched.currentFlow, 'accuracy');
  assert.equal(switched.currentRound, 1);
}
const unknownConsent = transitionDisputeState(track({
  accountKind: 'student_loan', nativeFlow: 'consent', currentFlow: 'consent', currentRound: 3,
}), { outcome: 'remains' });
assert.equal(unknownConsent.status, 'review_required');
assert.equal(unknownConsent.reviewCode, 'consent_account_kind_unconfirmed');

const repoR2 = transitionDisputeState(track({
  accountKind: 'repossession', nativeFlow: 'repo', currentFlow: 'repo', currentRound: 1, pathRole: 'repo_primary',
}), { outcome: 'remains' });
assert.equal(repoR2.currentRound, 2);
assert.deepEqual(repoR2.template, { flow: 'collection', round: 2 });
const repoR3 = transitionDisputeState({ ...repoR2 }, { outcome: 'remains' });
assert.equal(repoR3.currentRound, 3);
assert.deepEqual(repoR3.template, { flow: 'collection', round: 6 });
const repoJoin = transitionDisputeState({ ...repoR3 }, { outcome: 'remains', accuracyJoinRound: 8 });
assert.equal(repoJoin.currentFlow, 'accuracy');
assert.equal(repoJoin.currentRound, 8);
const repoNoJoin = transitionDisputeState({ ...repoR3 }, { outcome: 'remains' });
assert.equal(repoNoJoin.currentRound, 1, 'Repo defaults to Accuracy R1 when no compatible bureau Accuracy track exists');
const repoCompanion = transitionDisputeState(track({
  nativeFlow: 'collection', currentFlow: 'repo', currentRound: 3, pathRole: 'repo_companion',
}), { outcome: 'remains' });
assert.equal(repoCompanion.currentFlow, 'collection');
assert.equal(repoCompanion.currentRound, 4);

const comboCollectionSurvivor = transitionDisputeState(track({
  nativeFlow: 'collection',
  currentFlow: 'combo',
  currentRound: 7,
  usedNativeRounds: { accuracy: [1, 2, 3, 4, 5, 6], collection: [1, 2, 3, 4] },
}), { outcome: 'combo_side_deleted', deletedSide: 'accuracy' });
assert.equal(comboCollectionSurvivor.currentFlow, 'collection');
assert.equal(comboCollectionSurvivor.currentRound, 5, 'after Combo R7, Collection resumes at its next unused R5 law');
assert.equal(comboCollectionSurvivor.ruleProvenance, COMBO_SPLIT_RULE_PROVENANCE);

const comboAccuracySurvivor = transitionDisputeState(track({
  accountKind: 'charge_off',
  nativeFlow: 'accuracy',
  currentFlow: 'combo',
  currentRound: 7,
  usedNativeRounds: { accuracy: [1, 2, 3, 4, 5, 6], collection: [1, 2, 3, 4] },
}), { outcome: 'combo_side_deleted', deletedSide: 'collection' });
assert.equal(comboAccuracySurvivor.currentFlow, 'accuracy');
assert.equal(comboAccuracySurvivor.currentRound, 8);

const exhaustedCombo = transitionDisputeState(track({
  nativeFlow: 'accuracy',
  currentFlow: 'combo',
  currentRound: 12,
  usedNativeRounds: { accuracy: Array.from({ length: 12 }, (_, index) => index + 1) },
}), { outcome: 'combo_side_deleted', deletedSide: 'collection' });
assert.equal(exhaustedCombo.status, 'review_required', 'ambiguous/exhausted Combo history must fail closed');
assert.equal(exhaustedCombo.reviewCode, 'combo_native_history_exhausted_or_invalid');

for (const terminalOutcome of ['deleted', 'resolved']) {
  const terminal = transitionDisputeState(track(), { outcome: terminalOutcome });
  assert.equal(terminal.status, terminalOutcome);
  assert.throws(() => transitionDisputeState(terminal, { outcome: 'remains' }), /Terminal CCC track/);
}

const pendingDirect = transitionDisputeState(track({
  accountKind: 'collection', nativeFlow: 'direct', currentFlow: 'direct', currentRound: 1, status: 'pending',
}), { outcome: 'remains' });
assert.equal(pendingDirect.status, 'review_required');
assert.equal(pendingDirect.reviewCode, 'activation_required');
const activeDirect = transitionDisputeState(track({
  accountKind: 'collection', nativeFlow: 'direct', currentFlow: 'direct', currentRound: 1,
}), { outcome: 'remains' });
assert.equal(activeDirect.status, 'review_required');
assert.equal(activeDirect.reviewCode, 'direct_extension_unconfirmed');

const migration = readFileSync(
  new URL('../supabase/migrations/20260820220000_ccc_account_tracks.sql', import.meta.url),
  'utf8',
);
const endCycleMigration = readFileSync(
  new URL('../supabase/migrations/20260820340000_fail_closed_end_cycle_transitions.sql', import.meta.url),
  'utf8',
);
const initializeBody = migration.slice(
  migration.indexOf('create or replace function public.initialize_ccc_account_tracks'),
  migration.indexOf('create or replace function public.activate_ccc_direct_account_track'),
);

assert.match(migration, /create table if not exists public\.ccc_account_tracks/i);
assert.match(migration, /create table if not exists public\.ccc_account_track_events/i);
assert.match(migration, /where track_scope = 'cra'/i, 'CRA uniqueness must be account/bureau/method scoped');
assert.match(migration, /\(user_id, client_account_id, bureau_code, method_version\)/i);
assert.match(migration, /where track_scope = 'direct'/i, 'Direct must have a separate account/method uniqueness boundary');
assert.match(migration, /unique \(track_id, to_revision\)/i, 'each track revision must have exactly one immutable history event');
assert.match(migration, /before update or delete on public\.ccc_account_track_events/i);
assert.match(migration, /CCC account-track events are immutable/i);

assert.match(migration, /profile\.role in \('admin', 'auditor'\)/i);
assert.match(migration, /profile\.role = 'admin' or ccc_account_tracks\.user_id = auth\.uid\(\)/i, 'auditors must be tenant-isolated');
assert.match(migration, /revoke all on table public\.ccc_account_tracks from anon, authenticated/i);
assert.match(migration, /grant select on public\.ccc_account_tracks, public\.ccc_account_track_events/i);
assert.doesNotMatch(migration, /grant (insert|update|delete).*ccc_account_tracks.*authenticated/i, 'browser clients cannot write state directly');

assert.match(initializeBody, /current_flow, current_round/i);
assert.match(initializeBody, /v_current_flow, 1/i, 'fresh classifications must start logical R1');
assert.match(initializeBody, /revision, used_native_rounds/i);
assert.match(initializeBody, /'active', 1, 0/i, 'fresh CRA state starts cycle 1 revision 0');
assert.doesNotMatch(initializeBody, /public\.letters|public\.dispute_rounds|legacy/i, 'initialization must never infer progress from old letters/rounds');
assert.match(initializeBody, /v_native_flow = 'collection' and v_has_repo/i);
assert.match(initializeBody, /v_current_flow := 'combo'/i);
assert.match(initializeBody, /v_current_flow := 'repo'; v_path_role := 'repo_primary'/i);
assert.match(initializeBody, /v_current_flow := 'repo'; v_path_role := 'repo_companion'/i);

assert.match(migration, /where id=p_track_id for update/i, 'transitions must row-lock');
assert.match(migration, /v_track\.revision is distinct from p_expected_revision/i, 'transitions must enforce null-safe optimistic revision');
assert.match(migration, /errcode='40001'/i);
assert.match(migration, /source letter does not prove this track''s exact mailed logical step/i);
assert.match(migration, /v_role is null or v_role not in \('admin','auditor'\)/i, 'missing roles must fail closed');
assert.match(migration, /v_letter\.client_id is distinct from v_track\.client_id/i, 'nullable recipient identity checks must fail closed');
assert.match(migration, /v_letter\.target_type is distinct from 'bureau'/i, 'CRA evidence requires an explicit bureau recipient type');
assert.match(migration, /v_letter\.target_bureau is distinct from v_bureau_slug/i);
assert.match(migration, /v_letter\.dispute_bureau_code is distinct from v_track\.bureau_code/i, 'recipient and dispute bureau must agree');
assert.match(migration, /v_letter\.dispute_flow_code is distinct from v_expected_template->>'flow'/i, 'letters must store the concrete template flow');
assert.match(migration, /v_letter\.dispute_round_number is distinct from \(v_expected_template->>'round'\)::integer/i, 'letters must store the concrete template round');
assert.match(migration, /ccc_concrete_template_step\(v_initial_flow,1\)/i, 'Repo activation must resolve logical Repo R1 to physical Collection R1');
assert.match(migration, /unique \(track_id, to_revision\)/i);
assert.match(migration, /applied_law_coverage/i);
assert.match(migration, /owner_confirmed_next_unused_native_v1_2026_08_20/i);
assert.match(migration, /\('ccc_skool_2026_v1', 7, 'accuracy', 7/i);
assert.doesNotMatch(migration, /\('ccc_skool_2026_v1', 7, 'collection'/i, 'Combo R7 must not falsely consume Collection R5-R7');
assert.match(migration, /generate_series\(1, v_max\)/i, 'Combo split finds the next unused native law');

assert.match(migration, /track_scope = 'direct' and bureau_code is null/i);
assert.match(migration, /after_collection_r1_sent/i);
assert.match(migration, /activate_ccc_direct_account_track/i);
assert.match(migration, /mailed bureau Collection R1 letter for this exact account is required/i);
assert.match(migration, /direct_extension_unconfirmed/i, 'unconfirmed Direct advancement must fail closed');
assert.match(endCycleMigration, /collection_end_cycle_unconfirmed/);
assert.match(endCycleMigration, /combo_end_cycle_unconfirmed/);
assert.match(endCycleMigration, /accuracy_end_cycle_unconfirmed/);
assert.doesNotMatch(endCycleMigration, /collection_restart|combo_restart|accuracy_to_consent/);

console.log('CCC account-state pure and schema regression tests passed.');
