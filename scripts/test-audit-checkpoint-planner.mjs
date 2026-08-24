#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  AUDIT_CHECKPOINT_PLANNER_PROFILE,
  auditCheckpointPlanHashInput,
  auditPlannerProfileHashInput,
  measureAuditPdfPageDensity,
  normalizeAuditCheckpointPlannerProfile,
  planAdaptiveAuditCheckpointRanges,
} from '../src/utils/auditCheckpointPlanner.js';

function metric(pageNumber, {
  textChars = 2_000,
  textItems = 180,
  accountAnchors = 0,
  creditorAnchors = 0,
} = {}) {
  return { pageNumber, textChars, textItems, accountAnchors, creditorAnchors };
}

// Synthetic density fixture: the fixed windows 1-8 and 7-14 reproduce the
// problematic 58k/13-account and 63k/14-account shape without client data.
const densityFixture = Array.from({ length: 29 }, (_, index) => metric(index + 1));
for (let page = 1; page <= 6; page += 1) {
  densityFixture[page - 1] = metric(page, {
    textChars: 5_000,
    textItems: 260,
    accountAnchors: page <= 5 ? 1 : 0,
    creditorAnchors: 1,
  });
}
for (const page of [7, 8]) {
  densityFixture[page - 1] = metric(page, {
    textChars: 14_000,
    textItems: 430,
    accountAnchors: 4,
    creditorAnchors: 2,
  });
}
for (let page = 9; page <= 14; page += 1) {
  densityFixture[page - 1] = metric(page, {
    textChars: page === 14 ? 5_000 : 6_000,
    textItems: 300,
    accountAnchors: 1,
    creditorAnchors: 1,
  });
}

const sumWindow = (startPage, endPage, property) => densityFixture
  .slice(startPage - 1, endPage)
  .reduce((sum, page) => sum + page[property], 0);
assert.equal(sumWindow(1, 8, 'textChars'), 58_000);
assert.equal(sumWindow(1, 8, 'accountAnchors'), 13);
assert.equal(sumWindow(7, 14, 'textChars'), 63_000);
assert.equal(sumWindow(7, 14, 'accountAnchors'), 14);

const planned = planAdaptiveAuditCheckpointRanges(densityFixture);
const plannedAgain = planAdaptiveAuditCheckpointRanges(JSON.parse(JSON.stringify(densityFixture)));
assert.deepEqual(plannedAgain, planned, 'identical metrics must always produce the same plan');
assert.ok(planned.ranges.length > 1);
assert.equal(planned.hasSinglePageOverflow, false);

const coveredPages = new Set();
let priorEnd = 0;
for (const range of planned.ranges) {
  assert.ok(range.endPage > priorEnd, 'every checkpoint must contribute at least one new page');
  assert.equal(range.newPageStart, priorEnd + 1, 'new coverage must start immediately after prior coverage');
  assert.ok(range.overlapPages >= 0);
  assert.ok(range.overlapPages <= AUDIT_CHECKPOINT_PLANNER_PROFILE.limits.maxOverlapPages);
  assert.equal(range.exceededLimits.length, 0);
  assert.ok(range.density.textChars <= AUDIT_CHECKPOINT_PLANNER_PROFILE.limits.maxTextChars);
  assert.ok(range.density.textItems <= AUDIT_CHECKPOINT_PLANNER_PROFILE.limits.maxTextItems);
  assert.ok(range.density.accountAnchors <= AUDIT_CHECKPOINT_PLANNER_PROFILE.limits.maxAccountAnchors);
  assert.ok(range.density.creditorAnchors <= AUDIT_CHECKPOINT_PLANNER_PROFILE.limits.maxCreditorAnchors);
  assert.ok(range.density.weightedUnits <= AUDIT_CHECKPOINT_PLANNER_PROFILE.limits.maxWeightedUnits);
  for (let page = range.startPage; page <= range.endPage; page += 1) coveredPages.add(page);
  priorEnd = range.endPage;
}
assert.equal(priorEnd, densityFixture.length);
assert.deepEqual([...coveredPages].sort((a, b) => a - b), Array.from({ length: 29 }, (_, i) => i + 1));
assert.ok(planned.ranges.every((range) => range.density.accountAnchors < 13),
  'adaptive ranges must avoid the known 13-14-account windows');

// A tradeline may begin with its identity on one page and continue with fields
// on the next. An identity anchor on the boundary permits one-page overlap;
// without one, the planner must use its bounded two-page fallback so the prior
// page remains available to the provider.
const boundaryProfile = {
  limits: {
    maxPages: 4,
    maxTextChars: 100_000,
    maxTextItems: 10_000,
    maxAccountAnchors: 100,
    maxCreditorAnchors: 100,
    maxWeightedUnits: 1_000_000,
    maxOverlapPages: 2,
  },
};
const multiPageTradeline = Array.from({ length: 8 }, (_, index) => metric(index + 1));
multiPageTradeline[2] = metric(3, { accountAnchors: 1 });
const multiPageTradelinePlan = planAdaptiveAuditCheckpointRanges(multiPageTradeline, {
  profile: boundaryProfile,
});
assert.deepEqual(
  multiPageTradelinePlan.ranges.slice(0, 2).map(({ startPage, endPage, overlapPages }) => (
    [startPage, endPage, overlapPages]
  )),
  [[1, 4, 0], [3, 6, 2]],
  'a continuation boundary without its own anchor must carry the prior identity page',
);
assert.equal(multiPageTradelinePlan.ranges[1].density.accountAnchors, 1,
  'the continuation range must retain the tradeline identity anchor');

const anchoredTradelineBoundary = Array.from({ length: 8 }, (_, index) => metric(index + 1));
anchoredTradelineBoundary[3] = metric(4, { accountAnchors: 1 });
const anchoredTradelinePlan = planAdaptiveAuditCheckpointRanges(anchoredTradelineBoundary, {
  profile: boundaryProfile,
});
assert.deepEqual(
  anchoredTradelinePlan.ranges.slice(0, 2).map(({ startPage, endPage, overlapPages }) => (
    [startPage, endPage, overlapPages]
  )),
  [[1, 4, 0], [4, 7, 1]],
  'an account identity anchor on the boundary should avoid the two-page overlap tax',
);

const anchoredInquiryBoundary = Array.from({ length: 8 }, (_, index) => metric(index + 1));
anchoredInquiryBoundary[3] = metric(4, { creditorAnchors: 1 });
const anchoredInquiryPlan = planAdaptiveAuditCheckpointRanges(anchoredInquiryBoundary, {
  profile: boundaryProfile,
});
assert.equal(anchoredInquiryPlan.ranges[1].startPage, 4);
assert.equal(anchoredInquiryPlan.ranges[1].overlapPages, 1,
  'creditor section anchors should be treated as safe identity boundaries');

// An anonymized metric-only regression captured from the 29-page report that
// exposed the serial timeout/cost failure. It contains no report text or
// identity data. The compact rollout must stay at five primary calls (rather
// than the retired five serial calls plus recursive timeout splits), with the
// first three eligible to run in one bounded provider batch.
const production29PageMetrics = [
  [1100,106,0,0],[2037,234,3,1],[1583,212,0,2],[829,84,1,0],[1783,209,3,1],
  [2125,231,0,3],[2412,283,3,0],[2046,214,3,3],[2380,281,0,1],[2296,252,3,2],
  [2266,233,3,3],[2032,277,0,1],[839,90,1,2],[759,79,1,1],[799,88,1,1],
  [769,89,1,1],[759,77,1,1],[772,88,0,1],[772,88,1,0],[787,90,1,1],
  [1010,74,0,3],[1077,67,0,11],[988,67,0,9],[1548,99,3,9],[3000,279,6,0],
  [1980,189,5,0],[1258,96,4,0],[2568,167,6,0],[1334,46,0,0],
].map(([textChars, textItems, accountAnchors, creditorAnchors], index) => ({
  pageNumber: index + 1, textChars, textItems, accountAnchors, creditorAnchors,
}));
const production29Plan = planAdaptiveAuditCheckpointRanges(production29PageMetrics);
assert.deepEqual(
  production29Plan.ranges.map(({ startPage, endPage }) => [startPage, endPage]),
  [[1, 7], [7, 11], [11, 22], [22, 26], [26, 29]],
  '29-page regression must remain a five-call compact plan',
);
assert.deepEqual(
  production29Plan.ranges.map(({ overlapPages }) => overlapPages),
  [0, 1, 1, 1, 1],
  'the calibrated 29-page plan must use identity anchors instead of blanket two-page overlap',
);
for (const range of production29Plan.ranges.slice(1)) {
  const boundaryMetric = production29PageMetrics[range.startPage - 1];
  assert.ok(boundaryMetric.accountAnchors > 0 || boundaryMetric.creditorAnchors > 0,
    `range starting on page ${range.startPage} must retain an account or section identity anchor`);
}
assert.ok(production29Plan.ranges.every((range) => range.density.textItems <= 1_400));
assert.ok(production29Plan.ranges.every((range) => range.density.accountAnchors <= 16));

const normalizedA = normalizeAuditCheckpointPlannerProfile({
  weights: { accountAnchors: 3_200 },
  limits: { maxPages: 12 },
});
const normalizedB = normalizeAuditCheckpointPlannerProfile({
  limits: { maxPages: 12 },
  weights: { accountAnchors: 3_200 },
});
assert.deepEqual(normalizedA, normalizedB);
assert.equal(auditPlannerProfileHashInput(normalizedA), auditPlannerProfileHashInput(normalizedB));
assert.throws(
  () => normalizeAuditCheckpointPlannerProfile({ limits: { maxOverlapPages: 3 } }),
  /cannot exceed 2 pages/i,
  'caller overrides must not expand the bounded-overlap contract',
);
assert.throws(
  () => normalizeAuditCheckpointPlannerProfile({ plannerVersion: 'private-error-detail' }),
  /unsupported audit checkpoint planner or metric version/i,
  'code-owned version fields must not become arbitrary hash-payload labels',
);

const sourceSha256 = 'a'.repeat(64);
const hashInputA = auditCheckpointPlanHashInput({
  sourceSha256,
  pageMetrics: densityFixture,
  plan: planned,
});
const hashInputB = auditCheckpointPlanHashInput({
  plan: plannedAgain,
  pageMetrics: JSON.parse(JSON.stringify(densityFixture)),
  sourceSha256: sourceSha256.toUpperCase(),
});
assert.equal(hashInputA, hashInputB);
assert.equal(createHash('sha256').update(hashInputA).digest('hex').length, 64);
assert.doesNotMatch(hashInputA, /client|filename|createdAt|timestamp/i,
  'plan hash input must contain no identity, filename, or clock data');

const planWithUnknownLimit = JSON.parse(JSON.stringify(planned));
planWithUnknownLimit.ranges[0].exceededLimits = ['private-error-detail'];
assert.throws(
  () => auditCheckpointPlanHashInput({
    sourceSha256,
    pageMetrics: densityFixture,
    plan: planWithUnknownLimit,
  }),
  /unsupported exceeded-limit identifier/i,
  'arbitrary error text must not enter the stable plan hash input',
);

const planWithUnboundedOverlap = JSON.parse(JSON.stringify(planned));
planWithUnboundedOverlap.ranges[0].overlapPages = 11;
assert.throws(
  () => auditCheckpointPlanHashInput({
    sourceSha256,
    pageMetrics: densityFixture,
    plan: planWithUnboundedOverlap,
  }),
  /cannot exceed 2 pages/i,
  'hash serialization must independently enforce the bounded-overlap contract',
);

const fallbackHashInput = auditCheckpointPlanHashInput({
  sourceSha256,
  pageMetrics: [],
  fallback: {
    required: true,
    reason: 'pdfjs_failure',
    strategy: 'fixed_page_windows',
    maxPages: 8,
    overlapPages: 2,
    totalPages: 3,
  },
});
assert.doesNotMatch(fallbackHashInput, /private-error-detail/i);
assert.throws(
  () => auditCheckpointPlanHashInput({
    sourceSha256,
    pageMetrics: [],
    fallback: {
      required: true,
      reason: 'private-error-detail',
      strategy: 'fixed_page_windows',
      maxPages: 8,
      overlapPages: 2,
      totalPages: 3,
    },
  }),
  /unsupported checkpoint fallback reason/i,
);

// A single source page cannot be split further. Preserve coverage and flag the
// explicit overflow rather than looping or silently dropping the page.
const oversized = planAdaptiveAuditCheckpointRanges([
  metric(1, { textChars: 99_000, textItems: 9_000, accountAnchors: 30 }),
  metric(2),
]);
assert.equal(oversized.ranges[0].startPage, 1);
assert.equal(oversized.ranges[0].endPage, 1);
assert.ok(oversized.ranges[0].exceededLimits.includes('maxTextChars'));
assert.equal(oversized.hasSinglePageOverflow, true);
assert.equal(oversized.ranges.at(-1).endPage, 2);

assert.throws(
  () => planAdaptiveAuditCheckpointRanges([metric(2)]),
  /contiguous, ordered, and start at page 1/i,
);
assert.throws(
  () => auditCheckpointPlanHashInput({ sourceSha256: 'not-a-digest', pageMetrics: densityFixture, plan: planned }),
  /valid source SHA-256/i,
);

function fakePdfJs(pageLines, { onDestroy = null } = {}) {
  return async () => ({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: pageLines.length,
        getPage: async (pageNumber) => ({
          getTextContent: async () => ({
            items: pageLines[pageNumber - 1].map((str) => ({ str })),
          }),
          cleanup: () => {},
        }),
        destroy: async () => { onDestroy?.(); },
      }),
    }),
  });
}

const measurementPages = [
  ['Account details', 'Account details', 'Creditor information', 'Account details appear in overview prose only'],
  ['Synthetic report continuation with readable text.'],
];
const measured = await measureAuditPdfPageDensity(new Uint8Array([1]), {
  pdfJsLoader: fakePdfJs(measurementPages),
  profile: {
    readability: {
      minDocumentTextChars: 1,
      minTextBearingPageChars: 1,
      minTextBearingPageRatio: 0,
    },
  },
});
assert.equal(measured.status, 'measured');
assert.equal(measured.totalPages, 2);
assert.equal(measured.pages[0].accountAnchors, 2,
  'only exact text items count as account anchors');
assert.equal(measured.pages[0].creditorAnchors, 1);
assert.ok(measured.pages[0].textChars > 0);
assert.ok(measured.pages[0].textItems >= 4);

const blankMeasurement = await measureAuditPdfPageDensity(new Uint8Array([1]), {
  pdfJsLoader: fakePdfJs([[], [], []]),
});
assert.equal(blankMeasurement.status, 'fallback');
assert.equal(blankMeasurement.totalPages, 3);
assert.deepEqual(blankMeasurement.pages.map((page) => page.textChars), [0, 0, 0]);
assert.equal(blankMeasurement.fallback.reason, 'image_only_or_unreadable');
assert.equal(blankMeasurement.fallback.strategy, 'fixed_page_windows');
assert.equal(blankMeasurement.fallback.maxPages, 8);
assert.equal(blankMeasurement.fallback.overlapPages, 2);

const failedMeasurement = await measureAuditPdfPageDensity(new Uint8Array([1, 2, 3]), {
  pdfJsLoader: async () => { throw new Error('private parser detail must never escape'); },
});
assert.equal(failedMeasurement.status, 'fallback');
assert.equal(failedMeasurement.totalPages, null);
assert.equal(failedMeasurement.fallback.reason, 'pdfjs_failure');
assert.doesNotMatch(JSON.stringify(failedMeasurement), /private parser detail/i);

let destroyedAfterPageFailure = false;
const pageFailureMeasurement = await measureAuditPdfPageDensity(new Uint8Array([1]), {
  pdfJsLoader: async () => ({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 5,
        getPage: async () => { throw new Error('synthetic page extraction failure'); },
        destroy: async () => { destroyedAfterPageFailure = true; },
      }),
    }),
  }),
});
assert.equal(pageFailureMeasurement.status, 'fallback');
assert.equal(pageFailureMeasurement.totalPages, 5,
  'a failure after opening the PDF must retain the known page count for fixed-window fallback');
assert.equal(pageFailureMeasurement.fallback.totalPages, 5);
assert.deepEqual(pageFailureMeasurement.pages, [],
  'partial metrics must never be mistaken for complete source coverage');
assert.equal(destroyedAfterPageFailure, true);
assert.doesNotMatch(JSON.stringify(pageFailureMeasurement), /synthetic page extraction failure/i);

console.log('Adaptive audit checkpoint planner assertions passed.');
