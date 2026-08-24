// Deterministic, source-agnostic checkpoint planning for credit-report PDFs.
//
// PDF.js text is used only to estimate extraction density. It is never audit
// evidence and never replaces the immutable source PDF/page ranges supplied to
// the provider. Callers can SHA-256 the exported canonical hash-input strings
// when binding a plan to a source manifest.

export const AUDIT_CHECKPOINT_PLANNER_PROFILE = Object.freeze({
  plannerVersion: 'adaptive-density-v2-combined-context',
  metricVersion: 'pdfjs-text-density-v1',
  limits: Object.freeze({
    maxPages: 12,
    maxTextChars: 30_000,
    // The compact extraction contract cuts the repeated account-field output
    // by more than 60%. These caps are calibrated for that contract—not the
    // retired verbose provider payload—so a normal 3B does not regress into a
    // dozen tiny, expensive calls.
    maxTextItems: 1_400,
    // The compact contract supports a bounded rollout candidate above the old
    // 12-anchor ceiling, while staying below the unbenchmarked 19-21-account
    // ranges that a more aggressive three-call plan would create. Provider
    // golden evaluation remains the release gate for this higher ceiling.
    maxAccountAnchors: 16,
    maxCreditorAnchors: 50,
    maxWeightedUnits: 95_000,
    // Account/section anchors normally make one overlap page sufficient. Two
    // pages are available only as the bounded fallback when the immediately
    // preceding page has no identity anchor to carry into the next range.
    maxOverlapPages: 2,
  }),
  weights: Object.freeze({
    textChars: 1,
    textItems: 8,
    // Compact fixed-position tuples make account output substantially smaller
    // while the original verbose schema is restored and revalidated locally.
    accountAnchors: 1_100,
    creditorAnchors: 160,
  }),
  readability: Object.freeze({
    minDocumentTextChars: 80,
    minTextBearingPageChars: 20,
    minTextBearingPageRatio: 0.2,
  }),
  fallback: Object.freeze({
    strategy: 'fixed_page_windows',
    maxPages: 8,
    overlapPages: 2,
  }),
});

export const COMBINED_FIXED_COLUMN_CONTEXT_POLICY = 'combined-visible-column-context-v1';
export const COMBINED_FIXED_COLUMN_CONTEXT_COLUMNS = Object.freeze([
  Object.freeze({ position: 'left', bureau: 'transunion' }),
  Object.freeze({ position: 'center', bureau: 'equifax' }),
  Object.freeze({ position: 'right', bureau: 'experian' }),
]);
const THREE_BUREAU_LABELS = Object.freeze(['equifax', 'experian', 'transunion']);

export function resolveFrozenCombinedContextPolicy(checkpoint) {
  if (checkpoint?.context_policy_state === 'matched'
      && checkpoint?.context_policy === COMBINED_FIXED_COLUMN_CONTEXT_POLICY
      && Number(checkpoint?.context_source_page) === 1) {
    return {
      matched: true,
      policy: COMBINED_FIXED_COLUMN_CONTEXT_POLICY,
      contextSourcePage: 1,
      detectionStatus: 'matched',
      inferredFromInputSha256: false,
    };
  }
  if (checkpoint?.context_policy_state === 'proven_no_match'
      && checkpoint?.context_policy == null && checkpoint?.context_source_page == null) {
    return {
      matched: false,
      policy: null,
      contextSourcePage: null,
      detectionStatus: 'proven_no_match',
      inferredFromInputSha256: false,
    };
  }
  // Null-state rows predate the strengthened, persisted detector contract.
  // Their input digest cannot prove which detector version selected the plan,
  // so every such combined plan is retired instead of being inferred.
  return null;
}

const METRIC_KEYS = Object.freeze([
  'textChars',
  'textItems',
  'accountAnchors',
  'creditorAnchors',
]);
const LIMIT_KEYS = Object.freeze([
  'maxPages',
  'maxTextChars',
  'maxTextItems',
  'maxAccountAnchors',
  'maxCreditorAnchors',
  'maxWeightedUnits',
]);
const LIMIT_KEY_SET = new Set(LIMIT_KEYS);
const FALLBACK_REASONS = new Set(['image_only_or_unreadable', 'pdfjs_failure']);
const MAX_SUPPORTED_OVERLAP_PAGES = 2;

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return number;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return number;
}

function finiteRatio(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`${label} must be between 0 and 1.`);
  }
  return number;
}

function finiteWeight(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
  return number;
}

export function normalizeAuditCheckpointPlannerProfile(overrides = {}) {
  const base = AUDIT_CHECKPOINT_PLANNER_PROFILE;
  const limits = { ...base.limits, ...(overrides.limits || {}) };
  const weights = { ...base.weights, ...(overrides.weights || {}) };
  const readability = { ...base.readability, ...(overrides.readability || {}) };
  const fallback = { ...base.fallback, ...(overrides.fallback || {}) };

  const normalized = {
    plannerVersion: String(overrides.plannerVersion || base.plannerVersion),
    metricVersion: String(overrides.metricVersion || base.metricVersion),
    limits: {
      maxPages: positiveInteger(limits.maxPages, 'limits.maxPages'),
      maxTextChars: positiveInteger(limits.maxTextChars, 'limits.maxTextChars'),
      maxTextItems: positiveInteger(limits.maxTextItems, 'limits.maxTextItems'),
      maxAccountAnchors: positiveInteger(limits.maxAccountAnchors, 'limits.maxAccountAnchors'),
      maxCreditorAnchors: positiveInteger(limits.maxCreditorAnchors, 'limits.maxCreditorAnchors'),
      maxWeightedUnits: positiveInteger(limits.maxWeightedUnits, 'limits.maxWeightedUnits'),
      maxOverlapPages: nonNegativeInteger(limits.maxOverlapPages, 'limits.maxOverlapPages'),
    },
    weights: {
      textChars: finiteWeight(weights.textChars, 'weights.textChars'),
      textItems: finiteWeight(weights.textItems, 'weights.textItems'),
      accountAnchors: finiteWeight(weights.accountAnchors, 'weights.accountAnchors'),
      creditorAnchors: finiteWeight(weights.creditorAnchors, 'weights.creditorAnchors'),
    },
    readability: {
      minDocumentTextChars: nonNegativeInteger(
        readability.minDocumentTextChars,
        'readability.minDocumentTextChars',
      ),
      minTextBearingPageChars: nonNegativeInteger(
        readability.minTextBearingPageChars,
        'readability.minTextBearingPageChars',
      ),
      minTextBearingPageRatio: finiteRatio(
        readability.minTextBearingPageRatio,
        'readability.minTextBearingPageRatio',
      ),
    },
    fallback: {
      strategy: String(fallback.strategy || base.fallback.strategy),
      maxPages: positiveInteger(fallback.maxPages, 'fallback.maxPages'),
      overlapPages: nonNegativeInteger(fallback.overlapPages, 'fallback.overlapPages'),
    },
  };

  if (!normalized.plannerVersion || !normalized.metricVersion) {
    throw new Error('Planner and metric versions are required.');
  }
  // Versions and strategy are code-owned identifiers, not caller-controlled
  // labels. Keeping them closed prevents identity/error text from entering a
  // plan hash that is designed to contain no PII.
  if (normalized.plannerVersion !== base.plannerVersion
    || normalized.metricVersion !== base.metricVersion) {
    throw new Error('Unsupported audit checkpoint planner or metric version.');
  }
  if (normalized.fallback.strategy !== base.fallback.strategy) {
    throw new Error('Unsupported audit checkpoint fallback strategy.');
  }
  if (normalized.limits.maxOverlapPages > MAX_SUPPORTED_OVERLAP_PAGES
    || normalized.fallback.overlapPages > MAX_SUPPORTED_OVERLAP_PAGES) {
    throw new Error(`Checkpoint overlap cannot exceed ${MAX_SUPPORTED_OVERLAP_PAGES} pages.`);
  }
  if (normalized.limits.maxOverlapPages >= normalized.limits.maxPages) {
    throw new Error('limits.maxOverlapPages must be smaller than limits.maxPages.');
  }
  if (normalized.fallback.overlapPages >= normalized.fallback.maxPages) {
    throw new Error('fallback.overlapPages must be smaller than fallback.maxPages.');
  }
  return normalized;
}

export function auditPlannerProfileHashInput(profile = AUDIT_CHECKPOINT_PLANNER_PROFILE) {
  return canonicalJson(normalizeAuditCheckpointPlannerProfile(profile));
}

function fallbackDescriptor(reason, profile, totalPages = null) {
  return {
    required: true,
    reason,
    strategy: profile.fallback.strategy,
    maxPages: profile.fallback.maxPages,
    overlapPages: profile.fallback.overlapPages,
    totalPages: Number.isInteger(Number(totalPages)) && Number(totalPages) > 0
      ? Number(totalPages)
      : null,
    plannerVersion: profile.plannerVersion,
    metricVersion: profile.metricVersion,
  };
}

function emptyTotals() {
  return {
    textChars: 0,
    textItems: 0,
    accountAnchors: 0,
    creditorAnchors: 0,
    textBearingPages: 0,
  };
}

function normalizeText(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function normalizedBureauLabel(value) {
  const compact = normalizeText(value).toLowerCase().replace(/[^a-z]/gu, '');
  return THREE_BUREAU_LABELS.includes(compact) ? compact : null;
}

/**
 * Detect a first page that visibly contains all three bureau labels and a
 * repeated three-column data grid. This deliberately rejects sequential 3B
 * exports whose first page names one bureau (or merely mentions all three in
 * prose), so page 1 is never reused as a global attribution key without
 * source-derived fixed-column evidence.
 */
export function detectFixedThreeBureauColumnLegend(textContent, {
  pageWidth = 612,
  pageHeight = 792,
  minimumGridBands = 12,
} = {}) {
  const bureauAnchors = [];
  const horizontalBands = new Map();
  for (const item of textContent?.items || []) {
    const bureau = normalizedBureauLabel(item?.str);
    const x = Number(item?.transform?.[4]);
    const y = Number(item?.transform?.[5]);
    if (bureau && Number.isFinite(x) && Number.isFinite(y)) {
      bureauAnchors.push({ bureau, x, y });
    }
    if (!normalizeText(item?.str) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const band = Math.round(y / 3);
    if (!horizontalBands.has(band)) horizontalBands.set(band, []);
    horizontalBands.get(band).push(x);
  }

  const width = Number(pageWidth);
  const height = Number(pageHeight);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return {
      matched: false,
      policy: null,
      contextSourcePage: null,
      gridBandCount: 0,
      reportFamilySignature: false,
    };
  }
  const zones = [
    [width * 0.16, width * 0.38],
    [width * 0.38, width * 0.62],
    [width * 0.62, width * 0.86],
  ];
  const qualifyingGridBands = [...horizontalBands.entries()].filter(([, xValues]) => (
    zones.every(([minX, maxX]) => xValues.some((x) => x >= minX && x < maxX))
  ));
  const gridBandCount = qualifyingGridBands.length;
  const gridYValues = qualifyingGridBands.map(([band]) => band * 3).sort((a, b) => a - b);
  const gridYSpan = gridYValues.length > 1 ? gridYValues.at(-1) - gridYValues[0] : 0;

  // SmartCredit's fixed-column export has a distinctive first-page signature:
  // its three bureau navigation labels sit together, in this exact order, in
  // the upper-right area, while the report body repeats three aligned data
  // columns over most of the page. A generic page that merely mentions all
  // bureaus and contains a small three-column summary must not qualify.
  const legendBands = new Map();
  for (const anchor of bureauAnchors) {
    const band = Math.round(anchor.y / 3);
    if (!legendBands.has(band)) legendBands.set(band, []);
    legendBands.get(band).push(anchor);
  }
  const matchingLegend = [...legendBands.values()].find((anchors) => {
    const byBureau = new Map(anchors.map((anchor) => [anchor.bureau, anchor]));
    if (!THREE_BUREAU_LABELS.every((bureau) => byBureau.has(bureau))) return false;
    const ordered = ['transunion', 'equifax', 'experian'].map((bureau) => byBureau.get(bureau));
    const xValues = ordered.map((anchor) => anchor.x);
    const yValues = ordered.map((anchor) => anchor.y);
    const xSpan = Math.max(...xValues) - Math.min(...xValues);
    return xValues[0] < xValues[1]
      && xValues[1] < xValues[2]
      && Math.min(...xValues) >= width * 0.70
      && Math.max(...xValues) <= width * 0.90
      && xSpan >= width * 0.06
      && xSpan <= width * 0.14
      && Math.min(...yValues) >= height * 0.68
      && Math.max(...yValues) - Math.min(...yValues) <= 3;
  });
  const gridMostlyBelowLegend = matchingLegend
    ? gridYValues.filter((y) => y < Math.min(...matchingLegend.map((anchor) => anchor.y)) - 12).length
      >= Math.ceil(gridBandCount * 0.8)
    : false;
  const reportFamilySignature = Boolean(matchingLegend)
    && gridBandCount >= minimumGridBands
    && gridYSpan >= height * 0.40
    && gridMostlyBelowLegend;
  const matched = reportFamilySignature;
  return {
    matched,
    policy: matched ? COMBINED_FIXED_COLUMN_CONTEXT_POLICY : null,
    contextSourcePage: matched ? 1 : null,
    columns: matched
      ? COMBINED_FIXED_COLUMN_CONTEXT_COLUMNS.map((column) => ({ ...column }))
      : [],
    gridBandCount,
    reportFamilySignature,
  };
}

function safePdfContextDetectionError(error) {
  const clean = (value, limit) => String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit) || null;
  return {
    name: clean(error?.name || error?.constructor?.name, 80),
    code: clean(error?.code, 80),
    message: clean(error?.message, 320),
  };
}

export async function detectCombinedPdfContextPolicy(pdfBytes, {
  pdfJsLoader = defaultPdfJsLoader,
} = {}) {
  let document = null;
  try {
    const pdfJs = await pdfJsLoader();
    if (!pdfJs || typeof pdfJs.getDocument !== 'function') {
      throw new Error('PDF.js loader did not provide getDocument.');
    }
    document = await pdfJs.getDocument({
      data: pdfBytesForPdfJs(pdfBytes),
      disableWorker: true,
      useSystemFonts: true,
      verbosity: 0,
    }).promise;
    const page = await document.getPage(1);
    try {
      const detection = detectFixedThreeBureauColumnLegend(await page.getTextContent(), {
        pageWidth: page.getViewport({ scale: 1 }).width,
        pageHeight: page.getViewport({ scale: 1 }).height,
      });
      return {
        ...detection,
        detectionStatus: detection.matched ? 'matched' : 'proven_no_match',
        detectionErrorCode: null,
      };
    } finally {
      page.cleanup?.();
    }
  } catch (error) {
    // A parser/layout failure is unknown—not proof that the fixed-column
    // legend is absent. Callers must retry or reuse a frozen saved policy.
    return {
      matched: null,
      policy: null,
      contextSourcePage: null,
      gridBandCount: null,
      reportFamilySignature: null,
      detectionStatus: 'detection_error',
      detectionErrorCode: 'pdf_context_detection_failed',
      detectionErrorDetail: safePdfContextDetectionError(error),
    };
  } finally {
    try { await document?.destroy?.(); } catch { /* layout detection cleanup is best-effort */ }
  }
}

function pageMetric(pageNumber, textContent) {
  const items = (textContent?.items || [])
    .map((item) => normalizeText(item?.str))
    .filter(Boolean);
  const lowered = items.map((item) => item.toLowerCase());
  return {
    pageNumber,
    textChars: items.join(' ').length,
    textItems: items.length,
    // Exact item equality avoids treating overview prose containing the same
    // words as a tradeline/inquiry-card anchor.
    accountAnchors: lowered.filter((item) => item === 'account details').length,
    creditorAnchors: lowered.filter((item) => item === 'creditor information').length,
  };
}

function pdfBytesForPdfJs(pdfBytes) {
  if (pdfBytes instanceof ArrayBuffer) return new Uint8Array(pdfBytes.slice(0));
  if (ArrayBuffer.isView(pdfBytes)) {
    return Uint8Array.from(new Uint8Array(pdfBytes.buffer, pdfBytes.byteOffset, pdfBytes.byteLength));
  }
  throw new Error('PDF bytes must be an ArrayBuffer or typed array.');
}

async function defaultPdfJsLoader() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

/**
 * Measure deterministic per-page text density. Failures return a bounded
 * fallback descriptor rather than leaking PDF/parser details or guessing.
 */
export async function measureAuditPdfPageDensity(pdfBytes, {
  profile: profileOverrides = AUDIT_CHECKPOINT_PLANNER_PROFILE,
  pdfJsLoader = defaultPdfJsLoader,
} = {}) {
  const profile = normalizeAuditCheckpointPlannerProfile(profileOverrides);
  let document = null;
  let knownTotalPages = null;
  try {
    const pdfJs = await pdfJsLoader();
    if (!pdfJs || typeof pdfJs.getDocument !== 'function') {
      throw new Error('PDF.js loader did not provide getDocument.');
    }
    const loadingTask = pdfJs.getDocument({
      data: pdfBytesForPdfJs(pdfBytes),
      disableWorker: true,
      useSystemFonts: true,
      verbosity: 0,
    });
    document = await loadingTask.promise;
    const totalPages = positiveInteger(document?.numPages, 'PDF page count');
    knownTotalPages = totalPages;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      pages.push(pageMetric(pageNumber, await page.getTextContent()));
      page.cleanup?.();
    }

    const totals = pages.reduce((sum, page) => {
      for (const key of METRIC_KEYS) sum[key] += page[key];
      if (page.textChars >= profile.readability.minTextBearingPageChars) {
        sum.textBearingPages += 1;
      }
      return sum;
    }, emptyTotals());
    const textBearingRatio = totalPages ? totals.textBearingPages / totalPages : 0;
    const insufficientText = totals.textChars < profile.readability.minDocumentTextChars
      || textBearingRatio < profile.readability.minTextBearingPageRatio;

    return {
      status: insufficientText ? 'fallback' : 'measured',
      plannerVersion: profile.plannerVersion,
      metricVersion: profile.metricVersion,
      totalPages,
      pages,
      totals: { ...totals, textBearingRatio },
      fallback: insufficientText
        ? fallbackDescriptor('image_only_or_unreadable', profile, totalPages)
        : null,
    };
  } catch {
    return {
      status: 'fallback',
      plannerVersion: profile.plannerVersion,
      metricVersion: profile.metricVersion,
      totalPages: knownTotalPages,
      pages: [],
      totals: { ...emptyTotals(), textBearingRatio: 0 },
      fallback: fallbackDescriptor('pdfjs_failure', profile, knownTotalPages),
    };
  } finally {
    try { await document?.destroy?.(); } catch { /* measurement cleanup is best-effort */ }
  }
}

function normalizedMetrics(pageMetrics) {
  if (!Array.isArray(pageMetrics) || !pageMetrics.length) {
    throw new Error('At least one page metric is required.');
  }
  return pageMetrics.map((metric, index) => {
    const pageNumber = positiveInteger(metric?.pageNumber, `pageMetrics[${index}].pageNumber`);
    if (pageNumber !== index + 1) {
      throw new Error('Page metrics must be contiguous, ordered, and start at page 1.');
    }
    return {
      pageNumber,
      textChars: nonNegativeInteger(metric?.textChars, `pageMetrics[${index}].textChars`),
      textItems: nonNegativeInteger(metric?.textItems, `pageMetrics[${index}].textItems`),
      accountAnchors: nonNegativeInteger(metric?.accountAnchors, `pageMetrics[${index}].accountAnchors`),
      creditorAnchors: nonNegativeInteger(metric?.creditorAnchors, `pageMetrics[${index}].creditorAnchors`),
    };
  });
}

function pageWeightedUnits(metric, weights) {
  return Math.round(
    metric.textChars * weights.textChars
    + metric.textItems * weights.textItems
    + metric.accountAnchors * weights.accountAnchors
    + metric.creditorAnchors * weights.creditorAnchors,
  );
}

function aggregateMetrics(metrics, startIndex, endIndex, weights) {
  const aggregate = {
    textChars: 0,
    textItems: 0,
    accountAnchors: 0,
    creditorAnchors: 0,
    weightedUnits: 0,
  };
  for (let index = startIndex; index <= endIndex; index += 1) {
    const metric = metrics[index];
    for (const key of METRIC_KEYS) aggregate[key] += metric[key];
    aggregate.weightedUnits += pageWeightedUnits(metric, weights);
  }
  return aggregate;
}

function exceededLimits(aggregate, pageCount, limits) {
  const exceeded = [];
  if (pageCount > limits.maxPages) exceeded.push('maxPages');
  if (aggregate.textChars > limits.maxTextChars) exceeded.push('maxTextChars');
  if (aggregate.textItems > limits.maxTextItems) exceeded.push('maxTextItems');
  if (aggregate.accountAnchors > limits.maxAccountAnchors) exceeded.push('maxAccountAnchors');
  if (aggregate.creditorAnchors > limits.maxCreditorAnchors) exceeded.push('maxCreditorAnchors');
  if (aggregate.weightedUnits > limits.maxWeightedUnits) exceeded.push('maxWeightedUnits');
  return exceeded;
}

function hasIdentityAnchor(metric) {
  return metric.accountAnchors > 0 || metric.creditorAnchors > 0;
}

/**
 * Prefer a single overlap page when that page contains the account/inquiry
 * identity anchor needed to interpret the fields that follow it. If the
 * boundary page has no known anchor, retain the bounded two-page fallback so
 * a multi-page block whose identity began on the prior page stays intact.
 */
function overlapPagesForBoundary(metrics, firstUncoveredIndex, maxOverlapPages) {
  if (firstUncoveredIndex <= 0 || maxOverlapPages <= 0) return 0;
  if (hasIdentityAnchor(metrics[firstUncoveredIndex - 1])) {
    return Math.min(1, maxOverlapPages, firstUncoveredIndex);
  }
  return Math.min(2, maxOverlapPages, firstUncoveredIndex);
}

/**
 * Deterministically form density-bounded ranges. Overlap is a maximum: when
 * carrying every requested overlap page would consume a whole checkpoint, the
 * planner reduces overlap so every range contributes at least one new page.
 */
export function planAdaptiveAuditCheckpointRanges(pageMetrics, {
  profile: profileOverrides = AUDIT_CHECKPOINT_PLANNER_PROFILE,
  contextPageMetric = null,
} = {}) {
  const profile = normalizeAuditCheckpointPlannerProfile(profileOverrides);
  const metrics = normalizedMetrics(pageMetrics);
  const contextMetric = contextPageMetric
    ? normalizedMetrics([{ ...contextPageMetric, pageNumber: 1 }])[0]
    : null;
  const ranges = [];
  let firstUncoveredIndex = 0;

  const aggregateRange = (startIndex, endIndex) => {
    const aggregate = aggregateMetrics(metrics, startIndex, endIndex, profile.weights);
    const usesContext = Boolean(contextMetric && startIndex > 0);
    if (usesContext) {
      for (const key of METRIC_KEYS) aggregate[key] += contextMetric[key];
      aggregate.weightedUnits += pageWeightedUnits(contextMetric, profile.weights);
    }
    return {
      aggregate,
      usesContext,
      providerPageCount: endIndex - startIndex + 1 + (usesContext ? 1 : 0),
    };
  };

  while (firstUncoveredIndex < metrics.length) {
    const boundaryOverlapPages = overlapPagesForBoundary(
      metrics,
      firstUncoveredIndex,
      profile.limits.maxOverlapPages,
    );
    let startIndex = Math.max(0, firstUncoveredIndex - boundaryOverlapPages);

    // An overlap-only checkpoint would make no progress. Drop the oldest
    // overlap page(s) until the first new page fits, preserving as much overlap
    // as the same density limits safely allow.
    while (startIndex < firstUncoveredIndex) {
      const seed = aggregateRange(startIndex, firstUncoveredIndex);
      if (!exceededLimits(seed.aggregate, seed.providerPageCount, profile.limits).length) break;
      startIndex += 1;
    }

    let endIndex = firstUncoveredIndex;
    let rangeMetrics = aggregateRange(startIndex, endIndex);
    while (endIndex + 1 < metrics.length) {
      const candidate = aggregateRange(startIndex, endIndex + 1);
      if (exceededLimits(candidate.aggregate, candidate.providerPageCount, profile.limits).length) break;
      endIndex += 1;
      rangeMetrics = candidate;
    }

    ranges.push({
      index: ranges.length,
      startPage: startIndex + 1,
      endPage: endIndex + 1,
      newPageStart: firstUncoveredIndex + 1,
      totalPages: metrics.length,
      overlapPages: firstUncoveredIndex - startIndex,
      contextSourcePage: rangeMetrics.usesContext ? 1 : null,
      providerPageCount: rangeMetrics.providerPageCount,
      density: rangeMetrics.aggregate,
      exceededLimits: exceededLimits(
        rangeMetrics.aggregate,
        rangeMetrics.providerPageCount,
        profile.limits,
      ),
    });
    firstUncoveredIndex = endIndex + 1;
  }

  const chunkCount = ranges.length;
  for (const range of ranges) range.chunkCount = chunkCount;
  return {
    status: 'planned',
    plannerVersion: profile.plannerVersion,
    metricVersion: profile.metricVersion,
    totalPages: metrics.length,
    ranges,
    hasSinglePageOverflow: ranges.some((range) => range.exceededLimits.length > 0),
  };
}

/**
 * Stable, PII-free input for a caller-owned SHA-256 plan binding. The original
 * source digest remains mandatory; filenames, client identity, and timestamps
 * are deliberately excluded.
 */
export function auditCheckpointPlanHashInput({
  sourceSha256,
  profile: profileOverrides = AUDIT_CHECKPOINT_PLANNER_PROFILE,
  pageMetrics,
  plan,
  fallback = null,
} = {}) {
  const digest = String(sourceSha256 || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('A valid source SHA-256 is required.');
  const profile = normalizeAuditCheckpointPlannerProfile(profileOverrides);
  const metrics = pageMetrics?.length ? normalizedMetrics(pageMetrics) : [];
  const stableRanges = (plan?.ranges || []).map((range) => {
    const overlapPages = nonNegativeInteger(range.overlapPages, 'range.overlapPages');
    if (overlapPages > MAX_SUPPORTED_OVERLAP_PAGES) {
      throw new Error(`Checkpoint overlap cannot exceed ${MAX_SUPPORTED_OVERLAP_PAGES} pages.`);
    }
    return {
      startPage: positiveInteger(range.startPage, 'range.startPage'),
      endPage: positiveInteger(range.endPage, 'range.endPage'),
      newPageStart: positiveInteger(range.newPageStart, 'range.newPageStart'),
      overlapPages,
      contextSourcePage: range.contextSourcePage == null
        ? null
        : positiveInteger(range.contextSourcePage, 'range.contextSourcePage'),
      providerPageCount: positiveInteger(
        range.providerPageCount || (Number(range.endPage) - Number(range.startPage) + 1),
        'range.providerPageCount',
      ),
      density: Object.fromEntries([
        ...METRIC_KEYS,
        'weightedUnits',
      ].map((key) => [key, nonNegativeInteger(range.density?.[key], `range.density.${key}`)])),
      exceededLimits: [...new Set((range.exceededLimits || []).map((value) => {
        const key = String(value);
        if (!LIMIT_KEY_SET.has(key)) throw new Error('Unsupported exceeded-limit identifier.');
        return key;
      }))].sort(),
    };
  });
  const stableFallback = fallback ? (() => {
    const reason = String(fallback.reason || '');
    const strategy = String(fallback.strategy || '');
    if (!FALLBACK_REASONS.has(reason)) throw new Error('Unsupported checkpoint fallback reason.');
    if (strategy !== profile.fallback.strategy) throw new Error('Unsupported checkpoint fallback strategy.');
    return {
      required: fallback.required === true,
      reason,
      strategy,
      maxPages: positiveInteger(fallback.maxPages, 'fallback.maxPages'),
      overlapPages: nonNegativeInteger(fallback.overlapPages, 'fallback.overlapPages'),
      totalPages: fallback.totalPages == null ? null : positiveInteger(fallback.totalPages, 'fallback.totalPages'),
    };
  })() : null;
  if (stableFallback?.overlapPages > MAX_SUPPORTED_OVERLAP_PAGES) {
    throw new Error(`Checkpoint overlap cannot exceed ${MAX_SUPPORTED_OVERLAP_PAGES} pages.`);
  }
  return canonicalJson({
    sourceSha256: digest,
    profile,
    pageMetrics: metrics,
    ranges: stableRanges,
    fallback: stableFallback,
  });
}
