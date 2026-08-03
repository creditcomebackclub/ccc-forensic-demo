#!/usr/bin/env node
import {
  normalizeBureauKey,
  summarizeBureauParses,
  bureauDisplayName,
} from '../src/utils/auditBureauParses.js';

let failed = 0;
function assert(condition, message) {
  if (!condition) {
    failed += 1;
    console.error('FAIL:', message);
  } else {
    console.log('ok:', message);
  }
}

assert(normalizeBureauKey('Equifax') === 'equifax', 'normalize Equifax');
assert(normalizeBureauKey('EXP') === 'experian', 'normalize EXP');
assert(bureauDisplayName('transunion') === 'TransUnion', 'display TransUnion');

const summary = summarizeBureauParses([
  { bureau: 'equifax', page_count: 66 },
  { bureau: 'Experian', page_count: 119 },
]);
assert(summary.ready.length === 2, 'two ready');
assert(summary.missing.includes('transunion'), 'tu missing');
assert(!summary.canMerge, 'cannot merge yet');

const ready = summarizeBureauParses([
  { bureau: 'equifax' },
  { bureau: 'experian' },
  { bureau: 'transunion' },
  { bureau: 'equifax' }, // duplicate ignored
]);
assert(ready.canMerge, 'can merge with three');
assert(ready.ready.length === 3, 'three ready');

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll bureau-parse helper assertions passed');
