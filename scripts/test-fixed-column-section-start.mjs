#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  FIXED_COLUMN_SECTION_START_NORMALIZATION_VERSION,
  normalizeFixedColumnSectionStarts,
} from '../src/utils/combinedFixedColumnSectionStarts.js';

const bureaus = ['transunion', 'equifax', 'experian'];

function reports(anchorBureaus = []) {
  return bureaus.map((bureau) => ({
    bureau,
    bureauEvidencePage: 1,
    reportSectionStart: anchorBureaus.includes(bureau),
    reportSectionStartEvidencePage: anchorBureaus.includes(bureau) ? 1 : null,
    accounts: [],
    inquiries: [],
  }));
}

function checkpoint({ start = 1, end = 7, anchors = ['transunion'], key = `cp-${start}` } = {}) {
  const output = { reports: reports(anchors) };
  return {
    id: key,
    checkpoint_key: key,
    kind: 'combined_chunk',
    status: 'done',
    start_page: start,
    end_page: end,
    total_pages: 29,
    source_index: 0,
    source_path: 'audit-jobs/source.pdf',
    source_sha256: 'a'.repeat(64),
    context_policy_state: 'matched',
    context_policy: 'combined-visible-column-context-v1',
    context_source_page: 1,
    input_sha256: `input-${key}`,
    output_sha256: `output-${key}`,
    verified_input_sha256: `input-${key}`,
    verified_output_sha256: `output-${key}`,
    output,
    usage: { input_provenance: {
      inputPolicy: 'combined-visible-column-context-v1',
      sourcePageMap: start === 1
        ? Array.from({ length: end }, (_, index) => index + 1)
        : [1, ...Array.from({ length: end - start + 1 }, (_, index) => start + index)],
      contextLocalPages: start === 1 ? [] : [1],
    } },
  };
}

const base = [
  checkpoint(),
  checkpoint({ start: 7, end: 11, anchors: [], key: 'cp-7' }),
];
const original = structuredClone(base);
const digestOptions = {
  outputSha256For: (output) => {
    const row = base.find((candidate) => candidate.output === output);
    return row?.verified_output_sha256 || 'not-the-saved-output';
  },
  inputSha256For: (row) => row.verified_input_sha256,
};
const normalized = normalizeFixedColumnSectionStarts(base, digestOptions);
assert.deepEqual(base, original, 'normalization must never mutate saved checkpoint output');
assert.equal(normalized.parts[0].reports.every((report) => report.reportSectionStart === true), true);
assert.equal(normalized.parts[0].reports.every(
  (report) => report.reportSectionStartEvidencePage === 1,
), true);
assert.equal(normalized.parts[1].reports.every((report) => report.reportSectionStart === false), true);
assert.equal(normalized.normalization.version, FIXED_COLUMN_SECTION_START_NORMALIZATION_VERSION);
assert.deepEqual(normalized.normalization.changes.map((change) => change.bureau), ['equifax', 'experian']);
assert.equal(normalized.normalization.originalOutputSha256, 'output-cp-1');

const allAnchored = structuredClone(base);
allAnchored[0].output.reports = reports(bureaus);
allAnchored[0].output_sha256 = 'output-all';
allAnchored[0].verified_output_sha256 = 'output-all';
const noOp = normalizeFixedColumnSectionStarts(allAnchored, {
  outputSha256For: (output) => {
    const row = allAnchored.find((candidate) => candidate.output === output);
    return row?.verified_output_sha256 || 'bad-output';
  },
  inputSha256For: (row) => row.verified_input_sha256,
});
assert.equal(noOp.normalization, null, 'already-complete section starts are a no-op');

function expectFailure(mutator, pattern) {
  const fixture = structuredClone(base);
  mutator(fixture);
  assert.throws(() => normalizeFixedColumnSectionStarts(fixture, {
    outputSha256For: (output) => {
      const index = fixture.findIndex((row) => row.output === output);
      return index >= 0 ? fixture[index].verified_output_sha256 : 'bad-output';
    },
    inputSha256For: (row) => row.verified_input_sha256,
  }), pattern);
}

expectFailure((rows) => { rows[0].context_policy_state = 'proven_no_match'; }, /exact persisted matched policy/i);
expectFailure((rows) => { rows[0].start_page = 2; }, /page map|page-1 data checkpoint/i);
expectFailure((rows) => { rows[0].output.reports.pop(); }, /exactly three bureau reports/i);
expectFailure((rows) => { rows[0].output.reports[1].bureau = 'transunion'; }, /duplicate bureau/i);
expectFailure((rows) => {
  rows[0].output.reports.forEach((report) => {
    report.reportSectionStart = false;
    report.reportSectionStartEvidencePage = null;
  });
}, /No visible page-1 report section anchor/i);
expectFailure((rows) => {
  rows[1].output.reports[0].reportSectionStart = true;
  rows[1].output.reports[0].reportSectionStartEvidencePage = 2;
}, /anchored to source page 1|another report section start/i);
expectFailure((rows) => {
  rows[1].output.reports[0].reportSectionStartEvidencePage = 1;
}, /continuation cannot retain section-start evidence/i);
expectFailure((rows) => { rows[0].output_sha256 = 'tampered'; }, /immutable digest/i);
expectFailure((rows) => { rows[0].input_sha256 = 'tampered'; }, /source-bound digest/i);

console.log('Fixed-column section-start normalization assertions passed.');
