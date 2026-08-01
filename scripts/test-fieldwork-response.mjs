/**
 * Smoke test: demo response analysis + phase2 follow-up letter builder.
 */
import { DEMO_RESPONSE_ANALYSIS } from '../src/diy/adapters/demoResponseAnalysis.js';
import { buildFieldworkLetter } from '../src/diy/adapters/buildFieldworkLetter.js';
import { DEMO_AUDIT, DEMO_USER } from '../src/diy/demoData.js';

const account = DEMO_AUDIT.accounts[0];
const html = buildFieldworkLetter(DEMO_USER, account, 'phase2', DEMO_RESPONSE_ANALYSIS);

const checks = [
  ['has doctype/html wrapper or body', /<!DOCTYPE html>|<body/i.test(html)],
  ['follow-up RE line', /Follow-up Direct Furnisher Dispute/i.test(html)],
  ['Johnson cite', /Johnson v\. MBNA/i.test(html)],
  ['phase2 enclosures', /Furnisher response/i.test(html) && /Prior dispute letter/i.test(html)],
  ['id-table', /id-table/i.test(html)],
  ['talking points in analysis', DEMO_RESPONSE_ANALYSIS.talkingPoints.length >= 4],
  ['classification', DEMO_RESPONSE_ANALYSIS.classification === 'FORM_LETTER'],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`ok: ${name}`);
  else {
    console.error(`FAIL: ${name}`);
    failed += 1;
  }
}

if (failed) process.exit(1);
console.log('All fieldwork response tests passed.');
