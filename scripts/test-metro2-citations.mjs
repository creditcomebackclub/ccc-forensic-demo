#!/usr/bin/env node
// Unit tests for Metro 2 / Phase 3 citation lint.
import {
  autoFixFieldCitations,
  collectBureauFollowUpProblems,
  collectPhase3CitationProblems,
  renderMetro2FieldTable,
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
assert(has(
  collectPhase3CitationProblems('<p>Amount Past Due Equal to Current Balance (Fields 17A/21)</p>'),
  'Field 17A is Account Status'
), 'Fields 17A/21 balance-past-due mislabel blocked');
assert(has(
  collectPhase3CitationProblems('<p>The CRRG contains no provision requiring or authorizing Amount Past Due to equal Current Balance.</p>'),
  'common on collection'
), 'equal collection balance/past-due fallacy blocked');
assert(has(
  collectPhase3CitationProblems('<p>The DOFD is October 20, but the ledger shows a returned payment dated October 11.</p>'),
  'payment-return date alone'
), 'returned-payment date as DOFD proof blocked');
assert(has(
  collectPhase3CitationProblems('<p>Field 18 shows C/O for every month, including months after the reported closure; correct or delete those entries.</p>'),
  'unpaid charge-off may continue'
), 'post-closure C/O-only challenge blocked');
assert(has(
  collectPhase3CitationProblems('<p>TransUnion must confirm in writing whether the furnisher reviewed transaction-level records.</p>'),
  'procedure description'
), 'mandatory transaction-record review disclosure blocked');
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
  collectBureauFollowUpProblems('<p>Dear Sir or Madam:</p>' + cleanFollowUp),
  'generic salutation'
), 'generic follow-up salutation blocked');
assert(has(
  collectBureauFollowUpProblems('<p>Sincerely,</p>' + cleanFollowUp),
  'exact consumer signature block'
), 'courtesy follow-up closing blocked');
assert(has(
  collectBureauFollowUpProblems('<p>Enclosures: Exhibit A: Phase 1 Direct Furnisher Dispute; Exhibit B: Furnisher Response</p>'),
  'must not list'
), 'old Phase 3 enclosure packet blocked for follow-up');

// autoFixFieldCitations — deterministic single-occurrence corrections
function fixedTo(input) {
  return autoFixFieldCitations(input).html;
}
assert(fixedTo('Field 21 — Amount Past Due') === 'Field 22 — Amount Past Due', 'autofix: 21->22 swap');
assert(fixedTo('Field 22 — Current Balance') === 'Field 21 — Current Balance', 'autofix: 22->21 swap');
assert(fixedTo('Field 23 — Date of Last Payment') === 'Field 27 — Date of Last Payment', 'autofix: 23->27 swap');
assert(fixedTo('Field 27 — Original Charge-off Amount') === 'Field 23 — Original Charge-off Amount', 'autofix: 27->23 swap');
assert(fixedTo('Field 17A — Current Balance') === 'Field 21 — Current Balance', 'autofix: 17A->21 mislabel');
assert(fixedTo('Field 19 — XB') === 'Field 20 — XB', 'autofix: 19->20 CCC value');
assert(fixedTo('Field 30 — Amount Past Due') === 'Field 30 — Amount Past Due', 'autofix: unknown field left alone');
assert(fixedTo('Field 21 — Current Balance') === 'Field 21 — Current Balance', 'autofix: already-correct left alone');
assert(validateFieldCitations(fixedTo('Field 21 — Amount Past Due')).length === 0, 'autofix output re-validates clean');

// Regression: a second "Field N" citation shortly after the first must not
// get swallowed into the first match's label (would fuse into "Field19" and
// silently vanish from every downstream check).
{
  const input = 'The tradeline shows Field 21 — Amount Past Due and Field 19 — Compliance Condition Code reported together.';
  const out = fixedTo(input);
  assert(out.includes('Field 22 — Amount Past Due'), 'autofix: multi-citation fusion — first citation fixed independently');
  assert(out.includes('Field 20 — Compliance Condition Code'), 'autofix: multi-citation fusion — second citation fixed independently, not fused');
  assert(!/Field19\b/.test(out), 'autofix: multi-citation fusion — no "Field19" mangling');
  assert(validateFieldCitations(out).length === 0, 'autofix: multi-citation fusion — output re-validates clean');
}

// Regression: fixing must never drop or glue surrounding text (a dropped
// trailing space gluing the label to the next word, e.g. "of$450").
{
  const input = 'Field 21 — Amount Past Due of $450 remains disputed.';
  const out = fixedTo(input);
  assert(!/of\$/.test(out), 'autofix: no whitespace glue on a fixed citation');
}

// Regression: a field number cited more than once anywhere in the letter
// must be left untouched entirely, even for the occurrence that has a
// fixable label — otherwise a bare back-reference elsewhere ("...Field 21
// still reports...") would be stranded pointing at the now-wrong number
// while validateFieldCitations reports the (partially fixed) letter clean.
{
  const input = 'Field 21 — Amount Past Due: $1,200. Yet Field 21 still reports a nonzero amount owed. Correct Field 21 to $0.00.';
  const out = fixedTo(input);
  assert(out === input, 'autofix: multi-occurrence field number left untouched (no partial fix)');
  assert(validateFieldCitations(out).length > 0, 'autofix: multi-occurrence case still surfaces via validateFieldCitations for full retry');
}

// Regression: a truncated/abbreviated label whose first word is shared by
// TWO real, distinct fields (Account Type vs. Account Status; Terms
// Duration vs. Terms Frequency; Payment Rating vs. Payment History Profile)
// must never be guessed at — picking one silently mis-cites a real field.
{
  assert(fixedTo('Field 21 — Account') === 'Field 21 — Account', 'autofix: ambiguous head "Account" left untouched');
  assert(fixedTo('Field 21 — Terms') === 'Field 21 — Terms', 'autofix: ambiguous head "Terms" left untouched');
  assert(fixedTo('Field 21 — Payment') === 'Field 21 — Payment', 'autofix: ambiguous head "Payment" left untouched');
  const tagSplit = '<p>The tradeline reports Field 21 — Account <strong>Status</strong> code 71.</p>';
  assert(fixedTo(tagSplit) === tagSplit, 'autofix: label truncated by an inline tag into an ambiguous head is left untouched');
}

// Regression: never rewrite text that lives inside an HTML tag/attribute —
// validateFieldCitations strips tags before matching and would never see
// this, so autofix touching it would silently diverge from what's checked.
{
  const input = '<span title="Field 21 — Amount Past Due">note</span>';
  const out = fixedTo(input);
  assert(out === input, 'autofix: text inside an HTML tag attribute is never touched');
}

// Self-consistency: every row renderMetro2FieldTable() puts in front of the
// model (masterPrompt.js, phase3CitationRules.js) must, phrased as its own
// citation, pass validateFieldCitations cleanly — otherwise the prompt and
// the lint that grades its output would disagree about the ground truth.
{
  const rows = [...renderMetro2FieldTable().matchAll(/\| (\d{1,2}[AB]?) \| ([^|]+) \|/g)];
  assert(rows.length >= 20, 'field table has the expected number of rows');
  for (const m of rows) {
    const num = m[1].trim();
    const name = m[2].trim();
    assert(
      validateFieldCitations(`Field ${num} — ${name}`).length === 0,
      `field table self-consistent: Field ${num} — ${name}`
    );
  }
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll metro2 citation tests passed.');
