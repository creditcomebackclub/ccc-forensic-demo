#!/usr/bin/env node
// Unit tests for Metro 2 / Phase 3 citation lint.
import {
  collectBureauFollowUpProblems,
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
assert(has(validateFieldCitations('Field 23 — Date of Last Payment'), 'Field 27'), 'Field 23/27 swap');
assert(has(validateFieldCitations('Field 23 — Last Payment Date'), 'Field 27'), 'Field 23 last-payment alias');
assert(has(validateFieldCitations('Field 23 — Date of Last Activity'), 'not a verified'), 'non-canonical Date of Last Activity');

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
assert(validateFieldCitations('Field 23 — Original Charge-off Amount').length === 0, 'correct Field 23');
assert(validateFieldCitations('Field 27 — Date of Last Payment').length === 0, 'correct Field 27');

// Statute lint
assert(has(collectPhase3CitationProblems('<p>under 15 U.S.C. §1681s-2(a)(3)</p>'), '1681s-2(a)'), 'statute (a) blocked');
assert(
  collectPhase3CitationProblems('<p>Compliance Condition Code XB (Metro 2 Field 20) under §1681s-2(b)</p>').length === 0,
  'clean Phase 3 phrasing passes collectPhase3CitationProblems'
);

// Substantive production-safety lint
assert(has(
  collectPhase3CitationProblems('<p>A charged-off account with a current balance is a logical impossibility.</p>'),
  'Status 97'
), 'charge-off balance fallacy blocked');
assert(has(
  collectPhase3CitationProblems('<p>Charge-off means the debt was deemed uncollectible and written off for tax purposes.</p>'),
  'Status 97'
), 'tax-writeoff fallacy blocked');
assert(has(
  collectPhase3CitationProblems('<p>Field 18 must show the entire payment history since the account was opened.</p>'),
  'rolling 24-month'
), 'Field 18 lifetime demand blocked');
assert(has(
  collectPhase3CitationProblems('<p>TransUnion must produce the Universal Data Form and all source records.</p>'),
  'procedure'
), 'mandatory UDF production blocked');
assert(has(
  collectPhase3CitationProblems('<p>Under Johnson v. MBNA, the bureau reinvestigation was unreasonable.</p>'),
  'furnisher investigation'
), 'Johnson CRA-duty misuse blocked');
assert(
  collectPhase3CitationProblems('<p>Status 64 reports paid in full, while Field 21 — Current Balance is $900.</p>').length === 0,
  'supported paid charge-off balance conflict passes'
);
assert(
  collectPhase3CitationProblems('<p>Status 97 may report an unpaid balance; the specific amount remains disputed.</p>').length === 0,
  'accurate status-97 phrasing passes'
);

// Follow-up enclosure contract
const cleanFollowUp = `<p>Disputed information must be reinvestigated under §1681i.</p>
<p>Enclosures: Exhibit A: Prior Phase 3 CRA Dispute Letter (dated July 1, 2026);
Exhibit B: TransUnion Investigation Results (dated July 31, 2026);
Exhibit C: Limited Power of Attorney.</p>`;
assert(collectBureauFollowUpProblems(cleanFollowUp).length === 0, 'clean follow-up enclosure contract passes');
assert(has(
  collectBureauFollowUpProblems('<p>Enclosures: Exhibit A: Phase 1 Direct Furnisher Dispute; Exhibit B: Furnisher Response</p>'),
  'must not list'
), 'old Phase 3 enclosure packet blocked for follow-up');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll metro2 citation tests passed.');
