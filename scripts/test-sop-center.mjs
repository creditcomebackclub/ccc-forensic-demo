import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  FLOW_LETTER_ROUNDS,
  FLOW_SEQUENCES,
} from '../src/utils/disputeFlow.js';
import {
  CCC_METHOD_VERSION,
  CONCRETE_TEMPLATE_ALIASES,
} from '../src/utils/disputeState.js';
import { DISPUTE_SCREENSHOT_POLICIES } from '../src/utils/disputeScreenshots.js';
import {
  CCC_SOP_CONTROL,
  CCC_SOP_FLOW_LADDERS,
  CCC_SOP_MODULES,
  CCC_SOP_PENDING_DECISIONS,
  CCC_SOP_SCREENSHOT_POLICY_ROWS,
  CCC_SOP_SOURCES,
  CCC_SOP_SOURCE_TIERS,
  CCC_SOP_TEMPLATE_ALIASES,
  searchSopModules,
  sopSourceById,
} from '../src/utils/sopContent.js';

const component = fs.readFileSync(new URL('../src/components/MethodologyPage.jsx', import.meta.url), 'utf8');
const moduleIds = CCC_SOP_MODULES.map((module) => module.id);

assert.equal(CCC_SOP_CONTROL.methodVersion, CCC_METHOD_VERSION);
assert.match(CCC_SOP_CONTROL.id, /^CCC-SOP-/);
assert.match(CCC_SOP_CONTROL.version, /^\d{4}\.\d{2}\.\d{2}\.\d+$/);
assert.equal(new Set(moduleIds).size, moduleIds.length, 'SOP module ids must be unique');

for (const required of [
  'governance',
  'lead-to-client',
  'agreement-onboarding',
  'deterministic-3b',
  'r1-classification',
  'flows-switches',
  'template-library',
  'letter-writing-ai',
  'evidence-documents',
  'mailing',
  'outcomes',
  'operations',
  'privacy-security',
  'checklists',
  'pending-decisions',
]) {
  assert.ok(moduleIds.includes(required), `missing required SOP module: ${required}`);
}

assert.deepEqual(CCC_SOP_SOURCE_TIERS.map((tier) => tier.rank), [1, 2, 3, 4]);
assert.match(CCC_SOP_SOURCE_TIERS[0].label, /Skool flow documents and original course letters/);
assert.match(CCC_SOP_SOURCE_TIERS[1].label, /Explicit CCC owner policies/);
assert.match(CCC_SOP_SOURCE_TIERS[2].label, /Supplemental books/);
assert.match(CCC_SOP_SOURCE_TIERS[3].label, /templates and application code/);
assert.equal(new Set(CCC_SOP_SOURCES.map((item) => item.id)).size, CCC_SOP_SOURCES.length, 'source ids must be unique');
for (const sourceId of ['COURSE-FLOW-ACCURACY', 'COURSE-FLOW-COLLECTION', 'COURSE-FLOW-COMBO', 'COURSE-FLOW-CONSENT']) {
  assert.match(sopSourceById(sourceId)?.sha256 || '', /^[a-f0-9]{64}$/, `${sourceId} must be fingerprinted to the reviewed course file`);
}
for (const module of CCC_SOP_MODULES) {
  assert.ok(module.sourceIds.length > 0, `${module.id} must cite a source`);
  for (const sourceId of module.sourceIds) assert.ok(sopSourceById(sourceId), `${module.id} cites unknown source ${sourceId}`);
}

for (const ladder of CCC_SOP_FLOW_LADDERS) {
  assert.deepEqual(
    ladder.rounds.map((item) => item.law),
    FLOW_SEQUENCES[ladder.flow].slice(0, FLOW_LETTER_ROUNDS[ladder.flow]),
    `${ladder.flow} training ladder must derive from the live flow constant`,
  );
  assert.equal(ladder.switchInstruction, FLOW_SEQUENCES[ladder.flow][FLOW_LETTER_ROUNDS[ladder.flow]] || null);
}
assert.deepEqual(
  Object.fromEntries(CCC_SOP_TEMPLATE_ALIASES.map((item) => [item.logical, item.physical])),
  Object.fromEntries(Object.entries(CONCRETE_TEMPLATE_ALIASES).map(([key, value]) => [key, `${value.flow}:${value.round}`])),
);
assert.deepEqual(
  Object.fromEntries(CCC_SOP_SCREENSHOT_POLICY_ROWS.map(([code, label, requirement]) => [code, { label, required: /Required when/.test(requirement) }])),
  Object.fromEntries(Object.entries(DISPUTE_SCREENSHOT_POLICIES).map(([code, policy]) => [code, { label: policy.label, required: policy.required }])),
);

const aiModule = CCC_SOP_MODULES.find((module) => module.id === 'letter-writing-ai');
const aiText = JSON.stringify(aiModule);
assert.match(aiText, /Claude Sonnet 5/);
assert.match(aiText, /highlights inside the Damages field/);
assert.match(aiText, /Original and Suggested replacement/);
assert.match(aiText, /Use rewrite or Keep original/);
assert.match(aiText, /never classifies R1/);
assert.match(aiText, /rewrites the fixed template body/);

assert.deepEqual(
  CCC_SOP_PENDING_DECISIONS.map((item) => item.id),
  ['PENDING-DIRECT-ELIGIBILITY', 'PENDING-END-OF-LADDER', 'PENDING-SOLO-MEANING'],
);
const pendingText = JSON.stringify(CCC_SOP_PENDING_DECISIONS);
assert.match(pendingText, /Automatic Direct routing stays off/);
assert.match(pendingText, /restart policy/i);
assert.match(pendingText, /Accuracy Solo/);
assert.match(pendingText, /clarification pending/i);

assert.deepEqual(searchSopModules('Claude damages').map((module) => module.id), ['letter-writing-ai']);
assert.ok(searchSopModules('weekly checklist').some((module) => module.id === 'checklists'));
assert.ok(searchSopModules('proof address screenshots').some((module) => module.id === 'evidence-documents'));
assert.equal(searchSopModules('term-that-does-not-exist').length, 0);

assert.match(component, /CCC Methodology &amp; SOP Center/);
assert.match(component, /type="search"/);
assert.match(component, /searchSopModules/);
assert.match(component, /SourceCitations/);
assert.doesNotMatch(component, /certification|quiz|training_progress|role gate/i, 'Phase 1 must not add LMS or access-gating behavior');

console.log('CCC Methodology & SOP Center contract tests passed.');
