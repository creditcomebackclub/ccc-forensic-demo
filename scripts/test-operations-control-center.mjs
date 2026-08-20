import assert from 'node:assert/strict';
import { operationArea, summarizeOperations } from '../src/utils/operationsSummary.js';

const items = [
  { source: 'audit_job', severity: 'critical' },
  { source: 'phase2_job', severity: 'warning' },
  { source: 'phase4_job', severity: 'critical' },
  { source: 'response_evidence', severity: 'critical' },
  { source: 'mail_submission', severity: 'critical' },
  { source: 'recovery_blueprint', severity: 'warning' },
  { source: 'onboarding', severity: 'warning' },
];

assert.deepEqual(summarizeOperations(items), {
  total: 7,
  critical: 4,
  warning: 3,
  audit: 1,
  response: 3,
  mail: 1,
  delivery: 1,
  onboarding: 1,
});

assert.equal(operationArea('audit_job'), 'Audits');
assert.equal(operationArea('phase2_job'), 'Responses');
assert.equal(operationArea('phase4_job'), 'Responses');
assert.equal(operationArea('response_evidence'), 'Responses');
assert.equal(operationArea('mail_submission'), 'Mailing');
assert.equal(operationArea('recovery_blueprint'), 'Blueprints');
assert.equal(operationArea('onboarding'), 'Onboarding');
assert.equal(operationArea('future_source'), 'Other');

console.log('operations control center tests passed');
