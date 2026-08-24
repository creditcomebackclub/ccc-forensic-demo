import { COMBINED_FIXED_COLUMN_CONTEXT_POLICY } from './auditCheckpointPlanner.js';

export const FIXED_COLUMN_SECTION_START_NORMALIZATION_VERSION =
  'combined-fixed-column-section-start-v1';

const BUREAUS = Object.freeze(['equifax', 'experian', 'transunion']);

function bureauKey(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'eq' || key === 'equifax') return 'equifax';
  if (key === 'exp' || key === 'experian') return 'experian';
  if (key === 'tu' || key === 'transunion') return 'transunion';
  return null;
}

function exactSourcePageMap(checkpoint) {
  const start = Number(checkpoint?.start_page);
  const end = Number(checkpoint?.end_page);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    throw new Error('Fixed-column checkpoint page range is invalid.');
  }
  const dataPages = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  return start === 1 ? dataPages : [1, ...dataPages];
}

function exactContextLocalPages(checkpoint) {
  return Number(checkpoint?.start_page) === 1 ? [] : [1];
}

function sameNumbers(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => Number(value) === right[index]);
}

function reportsByBureau(checkpoint) {
  const reports = checkpoint?.output?.reports;
  if (!Array.isArray(reports) || reports.length !== BUREAUS.length) {
    throw new Error('Each fixed-column checkpoint must contain exactly three bureau reports.');
  }
  const byBureau = new Map();
  for (const report of reports) {
    const bureau = bureauKey(report?.bureau);
    if (!bureau || byBureau.has(bureau)) {
      throw new Error('A fixed-column checkpoint contains a missing or duplicate bureau report.');
    }
    if (typeof report?.reportSectionStart !== 'boolean') {
      throw new Error('A fixed-column checkpoint has an invalid report-section-start state.');
    }
    const evidencePage = report?.reportSectionStartEvidencePage;
    if (report.reportSectionStart === true && Number(evidencePage) !== 1) {
      throw new Error('A fixed-column report section start must be visibly anchored to source page 1.');
    }
    if (report.reportSectionStart === false && evidencePage != null) {
      throw new Error('A fixed-column continuation cannot retain section-start evidence.');
    }
    byBureau.set(bureau, report);
  }
  if (!BUREAUS.every((bureau) => byBureau.has(bureau))) {
    throw new Error('A fixed-column checkpoint is missing one of the three bureaus.');
  }
  return byBureau;
}

/**
 * SmartCredit's fixed-column export has one visible page-1 report header for
 * three bureau columns. Provider output can therefore mark only one bureau as
 * the section start even though the strict, persisted layout detector proved
 * that all three columns begin there. This function makes that structural
 * normalization on cloned merge inputs only; saved checkpoint JSON and its
 * immutable digest are never changed.
 */
export function normalizeFixedColumnSectionStarts(checkpoints, {
  outputSha256For,
  inputSha256For,
} = {}) {
  if (!Array.isArray(checkpoints) || !checkpoints.length) {
    throw new Error('Fixed-column finalization requires completed checkpoints.');
  }
  if (typeof outputSha256For !== 'function' || typeof inputSha256For !== 'function') {
    throw new Error('Fixed-column finalization requires immutable digest verifiers.');
  }

  const sourceBindings = new Set();
  const firstCheckpoints = [];
  let existingPageOneAnchors = 0;

  for (const checkpoint of checkpoints) {
    if (checkpoint?.status !== 'done' || checkpoint?.kind !== 'combined_chunk') {
      throw new Error('Fixed-column normalization accepts only completed combined checkpoints.');
    }
    if (checkpoint.context_policy_state !== 'matched'
        || checkpoint.context_policy !== COMBINED_FIXED_COLUMN_CONTEXT_POLICY
        || Number(checkpoint.context_source_page) !== 1) {
      throw new Error('Fixed-column checkpoint policy is not the exact persisted matched policy.');
    }
    if (checkpoint.output_sha256 !== outputSha256For(checkpoint.output)) {
      throw new Error('Fixed-column checkpoint output no longer matches its immutable digest.');
    }
    if (checkpoint.input_sha256 !== inputSha256For(checkpoint)) {
      throw new Error('Fixed-column checkpoint input no longer matches its source-bound digest.');
    }
    sourceBindings.add([
      Number(checkpoint.source_index),
      String(checkpoint.source_path || ''),
      String(checkpoint.source_sha256 || ''),
    ].join('::'));

    const input = checkpoint?.usage?.input_provenance;
    const expectedMap = exactSourcePageMap(checkpoint);
    const expectedContextPages = exactContextLocalPages(checkpoint);
    if (input?.inputPolicy !== COMBINED_FIXED_COLUMN_CONTEXT_POLICY
        || !sameNumbers(input?.sourcePageMap, expectedMap)
        || !sameNumbers(input?.contextLocalPages, expectedContextPages)) {
      throw new Error('Fixed-column checkpoint provenance does not match its exact page map.');
    }

    const byBureau = reportsByBureau(checkpoint);
    if (Number(checkpoint.start_page) === 1) {
      firstCheckpoints.push({ checkpoint, byBureau });
      for (const bureau of BUREAUS) {
        if (Number(byBureau.get(bureau)?.bureauEvidencePage) !== 1) {
          throw new Error('The page-1 fixed-column report lacks visible bureau evidence.');
        }
        if (byBureau.get(bureau)?.reportSectionStart === true) existingPageOneAnchors += 1;
      }
    } else {
      for (const bureau of BUREAUS) {
        if (byBureau.get(bureau)?.reportSectionStart === true) {
          throw new Error('A continuation checkpoint cannot introduce another report section start.');
        }
      }
    }
  }

  if (sourceBindings.size !== 1) {
    throw new Error('Fixed-column normalization requires exactly one immutable source.');
  }
  if (firstCheckpoints.length !== 1) {
    throw new Error('Fixed-column normalization requires exactly one page-1 data checkpoint.');
  }
  if (existingPageOneAnchors < 1) {
    throw new Error('No visible page-1 report section anchor was extracted from the source.');
  }

  const clonedParts = checkpoints.map((checkpoint) => structuredClone(checkpoint.output));
  const firstIndex = checkpoints.indexOf(firstCheckpoints[0].checkpoint);
  const changedBureaus = [];
  for (const report of clonedParts[firstIndex].reports) {
    const bureau = bureauKey(report.bureau);
    if (report.reportSectionStart === false) {
      report.reportSectionStart = true;
      report.reportSectionStartEvidencePage = 1;
      changedBureaus.push(bureau);
    }
  }
  changedBureaus.sort();

  return {
    parts: clonedParts,
    normalization: changedBureaus.length ? {
      version: FIXED_COLUMN_SECTION_START_NORMALIZATION_VERSION,
      policy: COMBINED_FIXED_COLUMN_CONTEXT_POLICY,
      sourcePage: 1,
      firstCheckpointKey: String(firstCheckpoints[0].checkpoint.checkpoint_key || ''),
      originalOutputSha256: String(firstCheckpoints[0].checkpoint.output_sha256 || ''),
      changes: changedBureaus.map((bureau) => ({
        bureau,
        fields: ['reportSectionStart', 'reportSectionStartEvidencePage'],
      })),
    } : null,
  };
}
