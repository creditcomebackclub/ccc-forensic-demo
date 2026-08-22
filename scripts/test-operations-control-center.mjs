import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { operationArea, summarizeOperations } from '../src/utils/operationsSummary.js';

const items = [
  { source: 'audit_job', severity: 'critical' },
  { source: 'classification_review', severity: 'warning' },
  { source: 'r1_tracks', severity: 'critical' },
  { source: 'letter_snapshot', severity: 'critical' },
  { source: 'template_review', severity: 'warning' },
  { source: 'mail_submission', severity: 'critical' },
  { source: 'mail_method', severity: 'critical' },
  { source: 'course_outcome', severity: 'warning' },
  { source: 'account_track_state', severity: 'critical' },
  { source: 'recovery_blueprint', severity: 'warning' },
  { source: 'onboarding', severity: 'warning' },
  { source: 'service_authorization', severity: 'critical' },
];

assert.deepEqual(summarizeOperations(items), {
  total: 12,
  critical: 7,
  warning: 5,
  audit: 1,
  classification: 2,
  letter: 2,
  mail: 2,
  outcome: 2,
  delivery: 1,
  onboarding: 2,
});

assert.equal(operationArea('audit_job'), 'Audits');
assert.equal(operationArea('classification_review'), 'Classification');
assert.equal(operationArea('r1_tracks'), 'Classification');
assert.equal(operationArea('letter_snapshot'), 'Letters');
assert.equal(operationArea('template_review'), 'Letters');
assert.equal(operationArea('mail_submission'), 'Mailing');
assert.equal(operationArea('mail_method'), 'Mailing');
assert.equal(operationArea('course_outcome'), 'Outcomes');
assert.equal(operationArea('account_track_state'), 'Outcomes');
assert.equal(operationArea('recovery_blueprint'), 'Blueprints');
assert.equal(operationArea('onboarding'), 'Onboarding');
assert.equal(operationArea('service_authorization'), 'Onboarding');
assert.equal(operationArea('phase2_job'), 'Other', 'retired phase jobs are not active operations doctrine');
assert.equal(operationArea('phase4_job'), 'Other', 'retired phase jobs are not active operations doctrine');
assert.equal(operationArea('future_source'), 'Other');

const migration = readFileSync(new URL('../supabase/migrations/20260820290000_new_method_operations.sql', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/components/OperationsPage.jsx', import.meta.url), 'utf8');
const classificationValidator = migration.slice(
  migration.indexOf('create or replace function public.ccc_operations_classification_review_valid'),
  migration.indexOf('revoke all on function public.ccc_operations_classification_review_valid'),
);
const letterValidator = migration.slice(
  migration.indexOf('create or replace function public.ccc_operations_letter_snapshot_valid'),
  migration.indexOf('revoke all on function public.ccc_operations_letter_snapshot_valid'),
);

assert.match(migration, /ccc_has_service_authorization\(p_client_id\)/, 'readiness calls the authoritative service-authorization helper');
assert.match(migration, /ccc_operations_deterministic_audit_valid/, 'malformed historical audit JSON cannot break the queue or pass readiness');
assert.match(migration, /ccc_operations_classification_review_valid/, 'classification evidence fails closed through a dedicated validator');
assert.doesNotMatch(classificationValidator, /v_latest_audit_id|newest[\s\S]*p_audit_id/i,
  'a later outcome report must not invalidate the immutable R1 source audit');
assert.match(classificationValidator, /exact supplied audit[\s\S]*Later 3B[\s\S]*outcome evidence/i,
  'classification validation remains exact while preserving the initialized lifecycle source');
assert.match(classificationValidator, /v_snapshot_account->'routingFacts' is distinct from v_audit_account->'routingFacts'/,
  'the hashed snapshot must contain the exact current source routing facts');
assert.match(classificationValidator, /ccc_canonical_bureau_array\(v_snapshot_account->'bureaus'\)[\s\S]*ccc_canonical_bureau_array\(v_audit_account->'bureaus'\)/,
  'snapshot and source bureau scopes are compared canonically');
assert.match(classificationValidator, /v_expected_route_count <> pg_catalog\.jsonb_array_length\(v_review->'routes'\)/,
  'reviewed routes must cover every non-excluded source account and bureau exactly once');
assert.match(classificationValidator, /latePaymentStatus'[\s\S]*'confirmed'[\s\S]*latePaymentBand'[\s\S]*two_or_fewer[\s\S]*latePaymentCount/,
  'late-payment routes retain the initializer’s bureau-specific non-zero fact gate');
assert.match(classificationValidator, /account\.id = coalesce\([\s\S]*\)::uuid[\s\S]*account\.client_id = p_client_id[\s\S]*account\.needs_review/,
  'every frozen audit identity must still resolve to the exact reconciliation-safe client account');
assert.match(migration, /ccc_operations_r1_tracks_valid/, 'every confirmed account and bureau must have immutable R1 evidence');
assert.match(migration, /fresh_classification_r1/, 'R1 certification uses the exact initialization event');
assert.match(migration, /ccc_operations_letter_snapshot_valid/, 'letter readiness validates the exact state/template snapshot');
assert.match(letterValidator, /v_letter\.target_type is distinct from 'bureau'[\s\S]*when 'EQ' then 'equifax'[\s\S]*when 'EXP' then 'experian'[\s\S]*when 'TU' then 'transunion'[\s\S]*v_letter\.dispute_bureau_code is distinct from snapshot\.value->>'bureauCode'/,
  'a CRA letter is bound to the exact physical bureau recipient slug and code');
assert.match(letterValidator, /v_letter\.target_type is distinct from 'furnisher'[\s\S]*v_letter\.target_bureau is not null[\s\S]*v_letter\.dispute_bureau_code is not null/,
  'a Direct letter is bound to a furnisher recipient with both bureau fields null');
assert.match(letterValidator, /v_template\.bureau_code[\s\S]*'ALL'[\s\S]*v_letter\.dispute_bureau_code[\s\S]*v_template\.bureau_code is distinct from 'ALL'/,
  'template bureau scope must include the exact CRA bureau and Direct must remain bureau-independent');
assert.match(migration, /mail_service = 'usps_first_class'/, 'First Class is the active CCC mailing doctrine');
assert.match(migration, /Historical mail submission failed/, 'legacy mail failures are not mislabeled as CCC First Class');
assert.match(migration, /submission\.submitted_at is not null[\s\S]*audit_row\.saved_at > submission\.submitted_at/,
  'outcome review starts only from a complete report saved after actual Lob acceptance');
assert.match(migration, /track_source[\s\S]*source_audit_id[\s\S]*lifecycle_audit[\s\S]*Later 3B[\s\S]*outcome evidence/,
  'readiness binds active work to its immutable R1 source while later 3Bs remain outcome evidence');
assert.match(migration, /not exists \([\s\S]*existing_track[\s\S]*track_scope = 'cra'[\s\S]*classification_review_valid/,
  'clients with initialized CRA tracks are not sent back through a fresh-R1 classification queue');
assert.match(migration, /order by letter\.saved_at desc, letter\.id desc/,
  'a completed old letter cannot hide the latest pending physical letter');
assert.match(migration, /lifecycle_letter_candidate[\s\S]*order by letter\.saved_at desc, letter\.id desc[\s\S]*from lifecycle_letter_candidate letter[\s\S]*ccc_operations_letter_snapshot_valid/,
  'readiness selects the latest physical letter before validating it');
assert.match(migration, /This check does not certify other bureau or flow letters/,
  'a single valid letter is not presented as complete multi-letter campaign coverage');
assert.match(migration, /public\.ccc_outcome_batches/, 'course win/fail batches are the outcome authority');
assert.match(migration, /public\.ccc_outcome_result_events/, 'next account state is proven from atomic outcome events');
assert.doesNotMatch(migration, /from public\.phase2_jobs|from public\.phase4_jobs|from public\.response_evidence/i, 'legacy response/phase jobs remain historical and leave the active queue');
assert.match(page, /Consent · Accuracy · Collection lifecycle/);
assert.match(page, /Latest-letter lifecycle check/);
assert.match(page, /Multi-letter bureau and flow coverage is evaluated letter by letter/);
assert.doesNotMatch(page, /Golden-client|Phase 1|Phase 2|Phase 3|Phase 4|Setup\s*&\s*Spike/i);

console.log('operations control center tests passed');
