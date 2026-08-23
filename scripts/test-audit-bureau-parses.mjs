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

const cohortA = 'a'.repeat(64);
const cohortB = 'b'.repeat(64);
const row = (id, bureau, cohortKey = cohortA, createdAt = '2026-08-22T12:00:00.000Z') => ({
  id, bureau, cohort_key: cohortKey, created_at: createdAt, updated_at: createdAt,
});

const summary = summarizeBureauParses([
  { ...row('eq-a', 'equifax'), page_count: 66 },
  { ...row('exp-a', 'Experian'), page_count: 119 },
]);
assert(summary.ready.length === 2, 'two ready');
assert(summary.missing.includes('transunion'), 'tu missing');
assert(!summary.canMerge, 'cannot merge yet');

const ready = summarizeBureauParses([
  row('eq-new', 'equifax', cohortA, '2026-08-22T13:00:00.000Z'),
  row('exp-a', 'experian'),
  row('tu-a', 'transunion'),
]);
assert(ready.canMerge, 'can merge with three');
assert(ready.ready.length === 3, 'three ready');
assert(ready.mergeSelection.parseIds.join(',') === 'eq-new,exp-a,tu-a', 'merge binds exact parse ids in bureau order');

const duplicateVersion = summarizeBureauParses([
  row('eq-new', 'equifax', cohortA, '2026-08-22T13:00:00.000Z'),
  row('exp-a', 'experian'),
  row('tu-a', 'transunion'),
  row('eq-old', 'equifax'),
]);
assert(!duplicateVersion.canMerge, 'a same-date bureau rerun blocks automatic mixed-cycle merge');
assert(duplicateVersion.ambiguousVersionCount === 1, 'duplicate staged versions are surfaced explicitly');

const mixed = summarizeBureauParses([
  row('eq-a', 'equifax', cohortA),
  row('exp-b', 'experian', cohortB),
  row('tu-a', 'transunion', cohortA),
]);
assert(!mixed.canMerge, 'different cohort keys never form a merge-ready 3B');
assert(mixed.ready.length === 2, 'best coherent cohort remains visible without borrowing another cohort');

const newestPartial = summarizeBureauParses([
  row('eq-old', 'equifax', cohortA, '2026-08-20T12:00:00.000Z'),
  row('exp-old', 'experian', cohortA, '2026-08-20T12:00:00.000Z'),
  row('tu-old', 'transunion', cohortA, '2026-08-20T12:00:00.000Z'),
  { ...row('eq-new-date', 'equifax', cohortB, '2026-08-22T12:00:00.000Z'), report_date: '2026-08-22' },
]);
assert(!newestPartial.canMerge, 'newer partial cohort is never hidden behind an older complete cohort');
assert(newestPartial.cohortKey === cohortB, 'newest staged cohort is the visible selection');
assert(newestPartial.reportDate === '2026-08-22', 'visible staged cohort exposes its report date');

const legacy = summarizeBureauParses([{ id: 'legacy', bureau: 'equifax', cohort_key: null }]);
assert(legacy.incompatibleLegacyCount === 1, 'legacy unbound staging is visible but ineligible for merge');

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll bureau-parse helper assertions passed');
