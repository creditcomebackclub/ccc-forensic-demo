import assert from 'node:assert/strict';
import { buildPriorRoundLeverageBlock } from '../src/utils/roundEvidence.js';
import { plainTextToSafeHtml, resolveEmailMergeFields } from '../src/utils/emailMergeFields.js';
import { letterStatus, responseDeadline, responseWindowDays } from '../src/utils/responseWindow.js';
import { PHASE2_SCHEMA } from '../src/utils/auditSchemas.js';
import { getLetterSystemPrompt } from '../src/prompts/letterPrompt.js';

function ok(name, fn) {
  fn();
  console.log('ok:', name);
}

ok('new furnisher and bureau rounds both default to 30 days', () => {
  assert.equal(responseWindowDays('furnisher'), 30);
  assert.equal(responseWindowDays('bureau'), 30);
});

ok('one documented extension adds exactly 15 days', () => {
  assert.equal(responseWindowDays({ target_type: 'bureau', response_window_extension_days: 15 }), 45);
});

ok('legacy bureau rows retain their frozen 45-day window', () => {
  assert.equal(responseWindowDays({ phase: 'Phase 3 — Equifax' }), 45);
  assert.equal(responseWindowDays({ phase: 'Phase 1' }), 30);
});

ok('stored due date is authoritative', () => {
  const due = responseDeadline({ delivered_at: '2026-01-01T00:00:00Z', response_due_at: '2026-03-15T00:00:00Z' });
  assert.equal(due.toISOString().slice(0, 10), '2026-03-15');
});

ok('closed window status is deterministic', () => {
  const status = letterStatus({ mailed_date: '2026-01-01', response_due_at: '2026-01-31T00:00:00Z' }, new Date('2026-02-01T00:00:00Z'));
  assert.equal(status.code, 'window_closed');
});

ok('all four prior-round target transitions are supported', () => {
  for (const priorTargetType of ['furnisher', 'bureau']) {
    for (const nextTargetType of ['furnisher', 'bureau']) {
      const block = buildPriorRoundLeverageBlock({ priorTargetType, nextTargetType, priorLetterHtml: '<html></html>' });
      assert.match(block, new RegExp(`${priorTargetType}->${nextTargetType}`));
    }
  }
});

ok('response-analysis schema cannot draft letters', () => {
  assert.equal(Object.hasOwn(PHASE2_SCHEMA.properties, 'letters'), false);
  assert.equal(Object.hasOwn(PHASE2_SCHEMA.properties, 'letterHtml'), false);
});

ok('Type-C sibling prompts keep FDCPA and FCRA duties separate', () => {
  const fdcpa = getLetterSystemPrompt('Aggressive', 'furnisher', 'FDCPA');
  const fcra = getLetterSystemPrompt('Aggressive', 'furnisher', 'FCRA_DIRECT');
  assert.match(fdcpa, /standalone FDCPA debt-validation letter/i);
  assert.match(fdcpa, /Do not cite §1681s-2\(a\)/i);
  assert.match(fcra, /Do NOT include §1692g\(b\)/i);
});

ok('bureau prompt excludes FDCPA validation', () => {
  const bureau = getLetterSystemPrompt('Aggressive', 'bureau', null);
  assert.match(bureau, /Never include an FDCPA validation letter addressed to a CRA/i);
});

ok('known email merge fields render', () => {
  assert.equal(resolveEmailMergeFields('Round {{ round.number }} for {{ client.name }}', { client: { name: 'Alex' }, round: { roundNumber: 2 } }), 'Round 2 for Alex');
});

ok('unknown email merge fields fail closed', () => {
  assert.throws(() => resolveEmailMergeFields('{{ client.ssn }}', {}), /Unknown email merge field/);
});

ok('plain text HTML escapes active content', () => {
  const escaped = plainTextToSafeHtml('<script>alert(1)</script>', (value) => value.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  assert.doesNotMatch(escaped, /<script>/);
  assert.match(escaped, /&lt;script&gt;/);
});

console.log('\nAll adaptive-round utility assertions passed.');
