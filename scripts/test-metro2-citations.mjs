#!/usr/bin/env node
// Unit tests for Metro 2 / Phase 3 citation lint.
import {
  collectPhase3CitationProblems,
  validateFieldCitations,
} from '../src/constants/metro2Fields.js';

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else {
    console.log('ok:', msg);
  }
}

function has(problems, substr) {
  return problems.some((p) => p.includes(substr));
}

// Historical shipped failures
assert(has(validateFieldCitations('Field 30 — Amount Past Due'), 'not a Metro 2'), 'unknown Field 30');
assert(has(validateFieldCitations('Field 4 — Date Opened'), 'not a Metro 2'), 'unknown Field 4');
assert(has(validateFieldCitations('Field 19 — Compliance Condition Code'), 'Field 20'), 'Field 19 mislabeled as CCC');
assert(has(validateFieldCitations('Field 19 — Compliance Condition Code XB'), 'XA/XB/XC'), 'Field 19 — CCC XB');
assert(has(validateFieldCitations('Field 21 — Amount Past Due'), 'Current Balance'), 'Field 21/22 swap');
assert(has(validateFieldCitations('Field 22 — Current Balance'), 'Amount Past Due'), 'Field 22/21 swap');

// Bare CCC-on-19 forms that used to slip through
assert(has(validateFieldCitations('Field 19 — XB'), 'XA/XB/XC'), 'bare Field 19 — XB');
assert(has(validateFieldCitations('Field 19—XB'), 'XA/XB/XC'), 'Field 19—XB no spaces');
assert(has(validateFieldCitations('Field 19 (XB)'), 'XA/XB/XC'), 'Field 19 (XB)');
assert(has(validateFieldCitations('Field 19 — XB/XC'), 'XA/XB/XC'), 'Field 19 — XB/XC');

// Correct phrases must pass
assert(validateFieldCitations('Compliance Condition Code XB (Metro 2 Field 20)').length === 0, 'correct Field 20 XB phrasing');
assert(validateFieldCitations('Field 19 — Special Comment AU').length === 0, 'correct Field 19 Special Comment');
assert(validateFieldCitations('Field 20 — Compliance Condition Code').length === 0, 'correct Field 20 name');
assert(validateFieldCitations('Field 21 — Current Balance').length === 0, 'correct Field 21');
assert(validateFieldCitations('Field 22 — Amount Past Due').length === 0, 'correct Field 22');

// Statute lint
assert(has(collectPhase3CitationProblems('<p>under 15 U.S.C. §1681s-2(a)(3)</p>'), '1681s-2(a)'), 'statute (a) blocked');
assert(
  collectPhase3CitationProblems('<p>Compliance Condition Code XB (Metro 2 Field 20) under §1681s-2(b)</p>').length === 0,
  'clean Phase 3 phrasing passes collectPhase3CitationProblems'
);

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll metro2 citation tests passed.');
