#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  assertFollowUpEnclosureContract,
  buildFollowUpEnclosurePlan,
  extractHtmlBody,
  extractHtmlStyles,
  getFollowUpSourceIds,
  isPhase3FollowUpLetter,
  validateFollowUpSourceRelationships,
} from '../src/utils/followUpEnclosures.js';

const historical = {
  id: 'follow-up-1',
  phase: 'Phase 3 — TransUnion (Follow-up)',
  sourcePhase3LetterId: 'phase3-1',
  sourceBureauResponseEvidenceId: 'response-1',
};

assert.equal(isPhase3FollowUpLetter({ phase: 'Phase 3 — TransUnion' }), false);
assert.equal(isPhase3FollowUpLetter(historical), true);
assert.deepEqual(getFollowUpSourceIds(historical), {
  sourcePhase3LetterId: 'phase3-1',
  sourceBureauResponseEvidenceId: 'response-1',
}, 'historical source identity remains readable');

for (const operation of [
  () => assertFollowUpEnclosureContract(historical),
  () => validateFollowUpSourceRelationships({ followUp: historical }),
  () => buildFollowUpEnclosurePlan(historical),
]) {
  assert.throws(operation, /read-only.*CCC Consent \/ Accuracy \/ Collection/i,
    'every former packet-construction entry point fails closed');
}

const historicHtml = '<!doctype html><html><head><style>.section{color:navy}</style></head><body><p>Prior letter</p></body></html>';
assert.equal(extractHtmlBody(historicHtml), '<p>Prior letter</p>');
assert.match(extractHtmlStyles(historicHtml), /.section\{color:navy\}/);

console.log('Historical follow-up records remain readable and all legacy packet builders are retired.');
