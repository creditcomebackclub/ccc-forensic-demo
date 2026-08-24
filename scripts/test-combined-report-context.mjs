#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import {
  assertCombinedCheckpointAttribution,
  mapExtractionPageRefs,
} from '../src/utils/deterministicAudit.js';
import {
  COMBINED_FIXED_COLUMN_CONTEXT_COLUMNS,
  COMBINED_FIXED_COLUMN_CONTEXT_POLICY,
  detectFixedThreeBureauColumnLegend,
  planAdaptiveAuditCheckpointRanges,
} from '../src/utils/auditCheckpointPlanner.js';
import { extractPdfPages } from '../src/utils/pdfPageChunks.js';
import { combinedExtractionPrompt } from '../src/prompts/extractionPrompts.js';

const account = (page = 2) => ({
  accountIdentityEvidencePage: page,
  reportedTypeEvidencePage: page,
  statusTextEvidencePage: page,
  consumerDisputeIndicatorEvidencePage: null,
  remarksEvidencePage: page,
  fields: [{ state: 'PRESENT', page }],
});

const report = (bureau = 'transunion', page = 2) => ({
  bureau,
  bureauEvidencePage: 1,
  reportSectionStart: false,
  reportSectionStartEvidencePage: null,
  reportDateEvidencePage: 1,
  client: {
    nameEvidencePage: null,
    addressEvidencePage: null,
    scoreEvidencePage: null,
  },
  personalInfo: {
    dateOfBirthEvidencePage: null,
    phoneEvidencePage: null,
    currentAddressEvidencePage: null,
    formerAddressEvidence: [],
    nameVariantEvidence: [],
    formerEmployerEvidence: [],
  },
  accounts: [account(page)],
  inquiries: [],
});

// The provider attachment can prepend exact source page 1 and retain a
// non-contiguous, deterministic local-to-source page map.
const source = await PDFDocument.create();
source.addPage([601, 701]);
source.addPage([602, 702]);
source.addPage([603, 703]);
source.addPage([604, 704]);
const sourceBytes = await source.save();
const assembled = await extractPdfPages(sourceBytes, { pageNumbers: [1, 3, 4] });
assert.deepEqual(assembled.sourcePageMap, [1, 3, 4]);
assert.equal(assembled.totalPages, 4);
const assembledPdf = await PDFDocument.load(assembled.bytes);
assert.equal(assembledPdf.getPageCount(), 3);
assert.deepEqual(assembledPdf.getPages().map((page) => page.getWidth()), [601, 603, 604]);
await assert.rejects(
  () => extractPdfPages(sourceBytes, { pageNumbers: [1, 1] }),
  /cannot contain duplicate pages/i,
);

const bureauItem = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });
const fixedGridItems = [
  bureauItem('TransUnion®', 464, 588),
  bureauItem('EQUIFAX', 495, 588),
  bureauItem('Experian', 518, 588),
  ...Array.from({ length: 14 }, (_, index) => {
    const y = 520 - (index * 30);
    return [
      bureauItem(`left-${index}`, 135, y),
      bureauItem(`middle-${index}`, 281, y),
      bureauItem(`right-${index}`, 427, y),
    ];
  }).flat(),
];
const fixedLegend = detectFixedThreeBureauColumnLegend({ items: fixedGridItems });
assert.equal(fixedLegend.matched, true);
assert.equal(fixedLegend.policy, COMBINED_FIXED_COLUMN_CONTEXT_POLICY);
assert.equal(fixedLegend.gridBandCount, 14);
assert.equal(fixedLegend.reportFamilySignature, true);
assert.deepEqual(fixedLegend.columns, COMBINED_FIXED_COLUMN_CONTEXT_COLUMNS,
  'the persisted policy binds the source-derived left-to-right bureau order');
assert.equal(detectFixedThreeBureauColumnLegend({
  items: fixedGridItems.filter((item) => !/transunion|equifax/i.test(item.str)),
}).matched, false, 'a sequential one-bureau first page must not become a global legend');
assert.equal(detectFixedThreeBureauColumnLegend({ items: [
  bureauItem('TransUnion', 70, 700),
  bureauItem('Equifax', 280, 620),
  bureauItem('Experian', 500, 540),
] }).matched, false, 'bureau words without a repeated three-column grid must not become a fixed-column legend');
assert.equal(detectFixedThreeBureauColumnLegend({ items: [
  bureauItem('TransUnion', 464, 588),
  bureauItem('Equifax', 495, 588),
  bureauItem('Experian', 518, 588),
  ...Array.from({ length: 8 }, (_, index) => {
    const y = 520 - (index * 18);
    return [
      bureauItem(`summary-left-${index}`, 135, y),
      bureauItem(`summary-middle-${index}`, 281, y),
      bureauItem(`summary-right-${index}`, 427, y),
    ];
  }).flat(),
] }).matched, false, 'bureau navigation plus a generic three-column summary is not a fixed report family');
assert.equal(detectFixedThreeBureauColumnLegend({ items: [
  bureauItem('TransUnion', 135, 588),
  bureauItem('Equifax', 281, 588),
  bureauItem('Experian', 427, 588),
  ...fixedGridItems.slice(3),
] }).matched, false, 'generic column headings are not the SmartCredit fixed-layout signature');
assert.equal(detectFixedThreeBureauColumnLegend({ items: [
  bureauItem('TransUnion', 464, 400),
  bureauItem('Equifax', 495, 400),
  bureauItem('Experian', 518, 400),
  ...Array.from({ length: 14 }, (_, index) => {
    const y = 360 - (index * 25);
    return [
      bureauItem(`lower-left-${index}`, 135, y),
      bureauItem(`lower-middle-${index}`, 281, y),
      bureauItem(`lower-right-${index}`, 427, y),
    ];
  }).flat(),
] }).matched, false, 'a lower-page bureau row must not impersonate the upper SmartCredit navigation');

const extraction = { reports: [report('transunion', 2)] };
assert.equal(assertCombinedCheckpointAttribution(extraction, {
  contextLocalPages: [1],
}), extraction);
const mapped = mapExtractionPageRefs(extraction, [1, 7, 8]);
assert.equal(mapped.reports[0].bureauEvidencePage, 1);
assert.equal(mapped.reports[0].reportDateEvidencePage, 1);
assert.equal(mapped.reports[0].accounts[0].accountIdentityEvidencePage, 7);
assert.equal(mapped.reports[0].accounts[0].fields[0].page, 7);
assert.equal(extraction.reports[0].accounts[0].accountIdentityEvidencePage, 2,
  'source mapping must not mutate the provider output');

assert.throws(
  () => assertCombinedCheckpointAttribution({ reports: [report(null, 2)] }, {
    contextLocalPages: [1],
  }),
  /without a source-bound bureau identity/i,
);
assert.throws(
  () => assertCombinedCheckpointAttribution({ reports: [report('equifax', 1)] }, {
    contextLocalPages: [1],
  }),
  /context-only page data as substantive evidence/i,
);
assert.throws(
  () => assertCombinedCheckpointAttribution({
    reports: [
      report('experian', 2),
      { ...report('experian', 3), accounts: [account(3)] },
    ],
  }, { contextLocalPages: [1] }),
  /more than one experian report object/i,
);
assert.throws(
  () => assertCombinedCheckpointAttribution({ reports: [{
    ...report('transunion', 2),
    reportSectionStart: true,
    reportSectionStartEvidencePage: 1,
  }] }, { contextLocalPages: [1] }),
  /context-only bureau legend/i,
);
assert.throws(
  () => assertCombinedCheckpointAttribution({ reports: [{
    ...report('transunion', 2),
    reportDate: '2026-08-24',
    reportDateEvidencePage: 1,
  }] }, { contextLocalPages: [1] }),
  /cannot be claimed as report-date evidence/i,
);
assert.throws(
  () => mapExtractionPageRefs(extraction, [1]),
  /outside the provider attachment map/i,
);

const prompt = combinedExtractionPrompt({
  startPage: 7,
  endPage: 11,
  totalPages: 29,
  chunkCount: 5,
  index: 1,
}, { contextLocalPage: 1, dataLocalPages: [2, 3, 4, 5, 6] });
assert.match(prompt, /context-only, source-derived bureau-column legend from original source page 1/i);
assert.match(prompt, /left-to-right bureau-column layout/i);
assert.match(prompt, /Do not extract client\/profile values, accounts, inquiries/i);
assert.match(prompt, /Only bureauEvidencePage may cite the context page/i);
assert.match(prompt, /reportSectionStart must be false/i);
assert.match(prompt, /DATA LOCAL PAGES 2, 3, 4, 5, 6/);

// Context density/page count participates in every non-page-1 range rather
// than silently pushing a calibrated provider request over its cap.
const metrics = Array.from({ length: 5 }, (_, index) => ({
  pageNumber: index + 1,
  textChars: 100,
  textItems: 300,
  accountAnchors: 1,
  creditorAnchors: 0,
}));
const plan = planAdaptiveAuditCheckpointRanges(metrics, {
  contextPageMetric: metrics[0],
  profile: {
    limits: {
      maxPages: 3,
      maxTextChars: 10_000,
      maxTextItems: 900,
      maxAccountAnchors: 10,
      maxCreditorAnchors: 10,
      maxWeightedUnits: 100_000,
      maxOverlapPages: 1,
    },
  },
});
assert.equal(plan.ranges[0].contextSourcePage, null);
for (const range of plan.ranges.slice(1)) {
  assert.equal(range.contextSourcePage, 1);
  assert.ok(range.providerPageCount <= 3);
  assert.ok(range.density.textItems <= 900);
}

const worker = readFileSync(new URL('../netlify/functions/audit-run-background.mjs', import.meta.url), 'utf8');
const netlifyConfig = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
assert.match(worker, /detectCombinedPdfContextPolicy/);
assert.match(worker, /COMBINED_FIXED_COLUMN_CONTEXT_POLICY/);
assert.match(worker, /ccc_retire_incompatible_combined_audit_job/);
assert.match(worker, /extractPdfPages\(report\.bytes, \{ pageNumbers: sourcePageMap \}\)/);
assert.match(worker, /contextOnlyPageLegends: contextLocalPages\.map/);
assert.match(worker, /context_legend_native_required/);
assert.match(worker, /context_legend_supplement_violation/);
assert.match(worker, /combinedExtractionPrompt\(input\.chunk, \{[\s\S]*contextLocalPage:[\s\S]*dataLocalPages:/);
assert.match(worker, /assertCombinedCheckpointAttribution\(parsed/);
assert.match(worker, /mapExtractionPageRefs\(parsed, input\.chunk\.sourcePageMap\)/);
assert.match(worker, /pdfJsLoader: auditPdfJsLoader/);
assert.match(worker, /globalThis\.DOMMatrix \|\|= DOMMatrix/);
assert.match(worker, /globalThis\.ImageData \|\|= ImageData/);
assert.match(worker, /globalThis\.Path2D \|\|= Path2D/);
assert.match(worker, /import\('pdfjs-dist\/legacy\/build\/pdf\.mjs'\)/);
assert.match(worker, /maxPages: contextSourcePage === COMBINED_CONTEXT_SOURCE_PAGE[\s\S]*COMBINED_SOURCE_PDF_DATA_PAGES/);
assert.match(netlifyConfig, /\[functions\][\s\S]*external_node_modules = \["@napi-rs\/canvas", "pdfjs-dist"\]/);

console.log('Combined-report source-context assertions passed.');
