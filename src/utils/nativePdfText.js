// Deterministic native-text extraction for credit-report PDFs.
//
// This module never logs document text. It turns PDF.js text items into a
// compact, page-tagged layout where each visual row retains its top-down y
// coordinate and each separated cell retains its x coordinate. Callers may
// send `compactText` to an extraction model only when `status === 'eligible'`.

export const NATIVE_PDF_TEXT_FORMAT = 'ccc-pdf-layout-v1';
export const NATIVE_PDF_CONTEXT_LEGEND_FORMAT = 'ccc-source-derived-bureau-column-legend-v1';

export const NATIVE_PDF_TEXT_ELIGIBILITY = Object.freeze({
  minPageTextChars: 200,
  minPageTextItems: 10,
  minPageLineCount: 5,
  minPageAlphanumericRatio: 0.45,
  maxResidualRotationDegrees: 1,
  geometryOverflowTolerancePoints: 2,
  maxGeometryOverflowCharacterRatio: 0.005,
  maxDuplicateCharacterRatio: 0.02,
  maxOverlappingCharacterRatio: 0.02,
  maxPaintedImagePageRatio: 0.2,
  maxVisionSupplementPages: 3,
  maxSerializedPayloadChars: 60_000,
  estimatedCharactersPerToken: 2.5,
  maxEstimatedTokens: 24_000,
});

export const NATIVE_PDF_TEXT_REASON_CODES = Object.freeze([
  'page_text_chars_below_minimum',
  'page_text_items_below_minimum',
  'page_line_count_below_minimum',
  'page_alphanumeric_ratio_below_minimum',
  'invalid_text_geometry',
  'non_ltr_text',
  'rotated_text',
  'text_bbox_outside_page',
  'text_geometry_overflow',
  'bad_text_glyph',
  'duplicate_text_layer',
  'overlapping_text_cells',
  'invisible_or_clip_only_text',
  'painted_image_too_large',
  'vision_supplement_limit_exceeded',
  'unmeasurable_operator_geometry',
  'serialized_payload_too_large',
  'estimated_token_count_too_large',
  'page_count_mismatch',
  'pdf_lib_failure',
  'pdfjs_failure',
]);

export const NATIVE_PDF_TEXT_FALLBACK_CODES = Object.freeze([
  'image_only_or_unreadable',
  'payload_limit_exceeded',
  'page_count_mismatch',
  'pdf_lib_failure',
  'pdfjs_failure',
]);

const REASON_CODE_SET = new Set(NATIVE_PDF_TEXT_REASON_CODES);
const FALLBACK_CODE_SET = new Set(NATIVE_PDF_TEXT_FALLBACK_CODES);

const FORMAT_LEGEND = [
  `[[${NATIVE_PDF_TEXT_FORMAT};pt;top-left;rows=y|x:text]]`,
  'Each row starts with y; each following x:text segment is a visual cell.',
].join('\n');

const CONTEXT_COLUMN_POSITIONS = Object.freeze(['left', 'center', 'right']);
const CONTEXT_COLUMN_BUREAU_ORDER = Object.freeze(['transunion', 'equifax', 'experian']);

function normalizedContextOnlyPageLegends(value) {
  if (!Array.isArray(value)) {
    throw new Error('Native PDF context-only page legends are invalid.');
  }
  const pages = new Map();
  for (const entry of value) {
    const pageNumber = Number(entry?.pageNumber);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pages.has(pageNumber)) {
      throw new Error('Native PDF context-only page binding is invalid.');
    }
    if (!Array.isArray(entry?.columns) || entry.columns.length !== 3) {
      throw new Error('Native PDF context-only bureau columns are invalid.');
    }
    const columns = entry.columns.map((column, index) => ({
      position: String(column?.position || '').trim().toLowerCase(),
      bureau: String(column?.bureau || '').trim().toLowerCase(),
      index,
    }));
    if (columns.some((column, index) => (
      column.position !== CONTEXT_COLUMN_POSITIONS[index]
      || column.bureau !== CONTEXT_COLUMN_BUREAU_ORDER[index]
    ))) {
      throw new Error('Native PDF context-only bureau-column order is invalid.');
    }
    pages.set(pageNumber, { pageNumber, columns });
  }
  return pages;
}

function contextOnlyCompactPage(page, totalPages, contextLegend) {
  const pageTag = `[[PAGE ${page.pageNumber}/${totalPages};${page.width}x${page.height};r${page.rotation}]]`;
  const y = roundCoordinate(page.height / 2);
  const xPositions = [page.width / 6, page.width / 2, page.width * (5 / 6)];
  const row = [
    String(y),
    ...contextLegend.columns.map((column, index) => (
      `${roundCoordinate(xPositions[index])}:${column.position.toUpperCase()} COLUMN=${column.bureau.toUpperCase()}`
    )),
  ].join('|');
  return [
    pageTag,
    `[[CONTEXT_ONLY;${NATIVE_PDF_CONTEXT_LEGEND_FORMAT}]]`,
    row,
  ].join('\n');
}

function copyPdfBytes(pdfBytes) {
  if (pdfBytes instanceof ArrayBuffer) return new Uint8Array(pdfBytes.slice(0));
  if (ArrayBuffer.isView(pdfBytes)) {
    return Uint8Array.from(new Uint8Array(
      pdfBytes.buffer,
      pdfBytes.byteOffset,
      pdfBytes.byteLength,
    ));
  }
  throw new Error('PDF bytes must be an ArrayBuffer or typed array.');
}

async function defaultPdfJsLoader() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

async function defaultPdfLibLoader() {
  return import('pdf-lib');
}

function normalizeItemText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function countBadGlyphs(value) {
  const text = String(value ?? '');
  let badGlyphs = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        const codePoint = ((code - 0xd800) * 0x400) + (next - 0xdc00) + 0x10000;
        if ((codePoint >= 0xf0000 && codePoint <= 0xffffd)
          || (codePoint >= 0x100000 && codePoint <= 0x10fffd)) {
          badGlyphs += 1;
        }
        index += 1;
      } else {
        badGlyphs += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      badGlyphs += 1;
      continue;
    }
    if (code === 0xfffd
      || (code >= 0xe000 && code <= 0xf8ff)
      || code < 0x20
      || (code >= 0x7f && code <= 0x9f)) {
      badGlyphs += 1;
    }
  }
  return badGlyphs;
}

function countAlphanumericCharacters(value) {
  return (String(value || '').match(/[\p{L}\p{N}]/gu) || []).length;
}

function roundCoordinate(value) {
  // Whole PDF points are precise enough to separate credit-report columns and
  // materially reduce repeated coordinate tokens on dense 3B reports.
  const rounded = Math.round(Number(value));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function median(values) {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2) return ordered[middle];
  return (ordered[middle - 1] + ordered[middle]) / 2;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function escapeCompactText(value) {
  return value.replace(/\\/gu, '\\\\').replace(/\|/gu, '\\|');
}

function normalizedAngleDegrees(value) {
  const angle = Number(value);
  return ((((angle + 180) % 360) + 360) % 360) - 180;
}

function textItemGeometry(item, index, viewport, pdfJs) {
  const text = normalizeItemText(item?.str);
  if (!text) return null;

  const base = {
    index,
    text,
    characterCount: text.length,
    alphanumericCharacters: countAlphanumericCharacters(text),
    badGlyphs: countBadGlyphs(item?.str),
    ltr: item?.dir === 'ltr',
    validGeometry: false,
  };
  if (!Array.isArray(item?.transform)
    || item.transform.length < 6
    || item.transform.slice(0, 6).some((value) => !Number.isFinite(Number(value)))) {
    return base;
  }
  const rawWidth = Number(item.width);
  const rawHeight = Number(item.height);
  if (!Number.isFinite(rawWidth) || rawWidth < 0
    || !Number.isFinite(rawHeight) || rawHeight < 0) {
    return base;
  }

  const transform = pdfJs.Util.transform(viewport.transform, item.transform);
  if (!Array.isArray(transform)
    || transform.length < 6
    || transform.slice(0, 6).some((value) => !Number.isFinite(Number(value)))) {
    return base;
  }
  const x = Number(transform[4]);
  const y = Number(transform[5]);

  const transformedHeight = Math.hypot(Number(transform[2]), Number(transform[3]));
  const itemHeight = Math.abs(rawHeight * Number(viewport.scale || 1));
  const height = transformedHeight || itemHeight || 1;
  const width = Math.abs(rawWidth * Number(viewport.scale || 1));
  const baselineMagnitude = Math.hypot(Number(transform[0]), Number(transform[1]));
  if (![x, y, height, width, baselineMagnitude].every(Number.isFinite)
    || height <= 0 || baselineMagnitude <= 0) {
    return base;
  }

  const left = x;
  const right = x + width;
  const top = y - height;
  const bottom = y;
  const entirelyOutside = right <= 0
    || left >= viewport.width
    || bottom <= 0
    || top >= viewport.height;
  const tolerance = NATIVE_PDF_TEXT_ELIGIBILITY.geometryOverflowTolerancePoints;
  const exceedsPageBounds = left < -tolerance
    || right > viewport.width + tolerance
    || top < -tolerance
    || bottom > viewport.height + tolerance;
  const residualRotationDegrees = Math.abs(normalizedAngleDegrees(
    Math.atan2(Number(transform[1]), Number(transform[0])) * (180 / Math.PI),
  ));

  return {
    ...base,
    validGeometry: true,
    x,
    y,
    width,
    height,
    left,
    right,
    top,
    bottom,
    entirelyOutside,
    exceedsPageBounds,
    residualRotationDegrees,
    startsWithSpace: /^\s/u.test(String(item.str ?? '')),
    endsWithSpace: /\s$/u.test(String(item.str ?? '')),
  };
}

function deduplicateItems(items) {
  const seen = new Set();
  const uniqueItems = [];
  let duplicateCharacters = 0;
  for (const item of items) {
    // Keep this exact: nearby bold/shadow glyphs are not silently treated as
    // an accessibility-layer duplicate.
    const key = [item.text, item.left, item.top, item.right, item.bottom].join('\u0000');
    if (seen.has(key)) {
      duplicateCharacters += item.characterCount;
      continue;
    }
    seen.add(key);
    uniqueItems.push(item);
  }
  return { uniqueItems, duplicateCharacters };
}

function groupVisualLines(items) {
  if (!items.length) return [];
  const typicalHeight = median(items.map((item) => item.height).filter((value) => value > 0)) || 10;
  const lineTolerance = clamp(typicalHeight * 0.32, 1, 3.5);
  const ordered = [...items].sort((left, right) => (
    (left.y - right.y) || (left.x - right.x) || (left.index - right.index)
  ));
  const lines = [];

  for (const item of ordered) {
    const current = lines.at(-1);
    if (!current || Math.abs(item.y - current.anchorY) > lineTolerance) {
      lines.push({ anchorY: item.y, items: [item] });
      continue;
    }
    current.items.push(item);
    current.anchorY = median(current.items.map((entry) => entry.y));
  }

  return lines.map((line) => ({
    y: median(line.items.map((item) => item.y)),
    items: line.items.sort((left, right) => (
      (left.x - right.x) || (left.index - right.index)
    )),
  }));
}

function overlappingCharacters(lines) {
  let characters = 0;
  for (const line of lines) {
    let furthestRightItem = null;
    for (const item of line.items) {
      if (furthestRightItem
        && (furthestRightItem.right - item.left) > 0.5) {
        characters += item.characterCount;
      }
      if (!furthestRightItem || item.right > furthestRightItem.right) {
        furthestRightItem = item;
      }
    }
  }
  return characters;
}

function joinerForItems(previous, current, gap, typicalHeight) {
  if (previous.endsWithSpace || current.startsWithSpace) return ' ';
  if (/^[,.;:%)\]}]/u.test(current.text)) return '';
  if (/[([{/$#-]$/u.test(previous.text)) return '';
  return gap >= Math.max(0.8, typicalHeight * 0.12) ? ' ' : '';
}

function mergeLineRuns(line) {
  if (!line.items.length) return [];
  const typicalHeight = median(line.items.map((item) => item.height).filter((value) => value > 0)) || 10;
  const sameCellGap = clamp(typicalHeight * 1.15, 7, 14);
  const runs = [];

  for (const item of line.items) {
    const previous = runs.at(-1);
    if (!previous) {
      runs.push({ ...item });
      continue;
    }

    const previousEnd = previous.x + previous.width;
    const gap = item.x - previousEnd;
    if (gap > sameCellGap) {
      runs.push({ ...item });
      continue;
    }

    const joiner = joinerForItems(previous, item, gap, typicalHeight);
    previous.text = `${previous.text}${joiner}${item.text}`;
    previous.endsWithSpace = item.endsWithSpace;
    previous.width = Math.max(previousEnd, item.x + item.width) - previous.x;
  }

  return runs.map((run) => ({ x: roundCoordinate(run.x), text: run.text }));
}

function pageTextLayout(pageNumber, totalPages, page, textContent, pdfJs) {
  const viewport = page.getViewport({ scale: 1 });
  if (!Number.isFinite(Number(viewport?.width)) || Number(viewport.width) <= 0
    || !Number.isFinite(Number(viewport?.height)) || Number(viewport.height) <= 0) {
    throw new Error('PDF.js returned invalid page geometry.');
  }
  const sourceItems = textContent?.items || [];
  const analyzedItems = sourceItems
    .map((item, index) => textItemGeometry(item, index, viewport, pdfJs))
    .filter(Boolean);
  const invalidGeometryItems = analyzedItems.filter((item) => !item.validGeometry);
  const geometricItems = analyzedItems.filter((item) => item.validGeometry);
  const { uniqueItems: items, duplicateCharacters } = deduplicateItems(geometricItems);
  const groupedLines = groupVisualLines(items);
  const overlapCharacters = overlappingCharacters(groupedLines);
  const lines = groupedLines.map((line) => ({
    y: roundCoordinate(line.y),
    runs: mergeLineRuns(line),
  }));
  const normalizedText = analyzedItems.map((item) => item.text).join(' ');
  const textChars = normalizedText.length;
  const measuredCharacters = analyzedItems.reduce(
    (total, item) => total + item.characterCount,
    0,
  );
  const alphanumericCharacters = analyzedItems.reduce(
    (total, item) => total + item.alphanumericCharacters,
    0,
  );
  const badGlyphs = sourceItems.reduce(
    (total, item) => total + countBadGlyphs(item?.str),
    0,
  );
  const geometryOverflowCharacters = geometricItems.reduce(
    (total, item) => total + (item.exceedsPageBounds ? item.characterCount : 0),
    0,
  );
  const entirelyOutsideItems = geometricItems.filter((item) => item.entirelyOutside).length;
  const nonLtrItems = analyzedItems.filter((item) => !item.ltr).length;
  const maxResidualRotationDegrees = geometricItems.reduce(
    (maximum, item) => Math.max(maximum, item.residualRotationDegrees),
    0,
  );

  const pageTag = `[[PAGE ${pageNumber}/${totalPages};${roundCoordinate(viewport.width)}x${roundCoordinate(viewport.height)};r${Number(page.rotate) || 0}]]`;
  const compactLines = lines.map((line) => [
    String(line.y),
    ...line.runs.map((run) => `${run.x}:${escapeCompactText(run.text)}`),
  ].join('|'));

  return {
    pageNumber,
    width: roundCoordinate(viewport.width),
    height: roundCoordinate(viewport.height),
    rotation: Number(page.rotate) || 0,
    textChars,
    textItems: analyzedItems.length,
    lineCount: lines.length,
    alphanumericCharacters,
    alphanumericRatio: textChars ? alphanumericCharacters / textChars : 0,
    badGlyphs,
    invalidGeometryItems: invalidGeometryItems.length,
    nonLtrItems,
    maxResidualRotationDegrees,
    entirelyOutsideItems,
    geometryOverflowCharacters,
    geometryOverflowCharacterRatio: measuredCharacters
      ? geometryOverflowCharacters / measuredCharacters
      : 0,
    duplicateCharacters,
    duplicateCharacterRatio: measuredCharacters
      ? duplicateCharacters / measuredCharacters
      : 0,
    overlappingCharacters: overlapCharacters,
    overlappingCharacterRatio: measuredCharacters
      ? overlapCharacters / measuredCharacters
      : 0,
    compactPage: [pageTag, ...compactLines].join('\n'),
  };
}

function determinant(matrix) {
  if (!Array.isArray(matrix) || matrix.length < 4) return null;
  const [a, b, c, d] = matrix.map(Number);
  if (![a, b, c, d].every(Number.isFinite)) return null;
  const value = Math.abs((a * d) - (b * c));
  return Number.isFinite(value) ? value : null;
}

function operatorPageMetrics(operatorList, page, viewport, pdfJs) {
  const ops = pdfJs.OPS || {};
  const imageOperatorCodes = new Set(Object.entries(ops)
    .filter(([name, code]) => /^paint.*image/iu.test(name) && Number.isInteger(code))
    .map(([, code]) => code));
  const directImageCodes = new Set([
    ops.paintImageXObject,
    ops.paintInlineImageXObject,
    ops.paintImageMaskXObject,
    ops.paintSolidColorImageMask,
  ].filter(Number.isInteger));
  const textPaintingCodes = new Set([
    ops.showText,
    ops.showSpacedText,
    ops.nextLineShowText,
    ops.nextLineSetSpacingShowText,
  ].filter(Number.isInteger));
  const pageArea = Number(viewport.width) * Number(viewport.height);
  const userUnit = Number(page?.userUnit) || 1;
  let areaScale = userUnit * userUnit;
  let textRenderingMode = 0;
  const stack = [];
  let paintedImages = 0;
  let largestPaintedImageRatio = 0;
  let invisibleOrClipOnlyTextOps = 0;
  let unmeasurableOperatorGeometry = 0;

  function recordImage(areaDeterminant, count = 1) {
    const ratio = Number(areaDeterminant) / pageArea;
    if (!Number.isFinite(ratio) || ratio < 0 || !Number.isInteger(count) || count < 1) {
      unmeasurableOperatorGeometry += 1;
      return;
    }
    paintedImages += count;
    largestPaintedImageRatio = Math.max(largestPaintedImageRatio, ratio);
  }

  const fnArray = operatorList?.fnArray;
  const argsArray = operatorList?.argsArray;
  if (!Array.isArray(fnArray) || !Array.isArray(argsArray) || fnArray.length !== argsArray.length) {
    throw new Error('PDF.js returned an invalid operator list.');
  }

  for (let index = 0; index < fnArray.length; index += 1) {
    const operator = fnArray[index];
    const args = argsArray[index] || [];
    if (operator === ops.save) {
      stack.push({ areaScale, textRenderingMode });
      continue;
    }
    if (operator === ops.restore) {
      const restored = stack.pop();
      if (!restored) {
        unmeasurableOperatorGeometry += 1;
      } else {
        ({ areaScale, textRenderingMode } = restored);
      }
      continue;
    }
    if (operator === ops.transform) {
      const transformDeterminant = determinant(args);
      if (transformDeterminant === null) {
        unmeasurableOperatorGeometry += 1;
      } else {
        areaScale *= transformDeterminant;
        if (!Number.isFinite(areaScale)) unmeasurableOperatorGeometry += 1;
      }
      continue;
    }
    if (operator === ops.setTextRenderingMode) {
      const mode = Number(args[0]);
      if (!Number.isInteger(mode) || mode < 0 || mode > 7) {
        unmeasurableOperatorGeometry += 1;
      } else {
        textRenderingMode = mode;
      }
      continue;
    }
    if (textPaintingCodes.has(operator)) {
      if (textRenderingMode === 3 || textRenderingMode === 7) {
        invisibleOrClipOnlyTextOps += 1;
      }
      continue;
    }
    if (!imageOperatorCodes.has(operator)) continue;

    if (directImageCodes.has(operator)) {
      recordImage(areaScale);
      continue;
    }
    if (operator === ops.paintImageXObjectRepeat) {
      const scaleDeterminant = determinant([args[1], 0, 0, args[2]]);
      const positions = args[3];
      if (scaleDeterminant === null || (!Array.isArray(positions) && !ArrayBuffer.isView(positions))) {
        unmeasurableOperatorGeometry += 1;
      } else {
        recordImage(areaScale * scaleDeterminant, Math.max(1, Math.floor(positions.length / 2)));
      }
      continue;
    }
    if (operator === ops.paintImageMaskXObjectRepeat) {
      const scaleDeterminant = determinant([args[1], args[2], args[3], args[4]]);
      const positions = args[5];
      if (scaleDeterminant === null || (!Array.isArray(positions) && !ArrayBuffer.isView(positions))) {
        unmeasurableOperatorGeometry += 1;
      } else {
        recordImage(areaScale * scaleDeterminant, Math.max(1, Math.floor(positions.length / 2)));
      }
      continue;
    }
    if (operator === ops.paintInlineImageXObjectGroup
      || operator === ops.paintImageMaskXObjectGroup) {
      const entries = operator === ops.paintInlineImageXObjectGroup ? args[1] : args[0];
      if (!Array.isArray(entries) || !entries.length) {
        unmeasurableOperatorGeometry += 1;
      } else {
        for (const entry of entries) {
          const entryDeterminant = determinant(entry?.transform);
          if (entryDeterminant === null) unmeasurableOperatorGeometry += 1;
          else recordImage(areaScale * entryDeterminant);
        }
      }
      continue;
    }
    unmeasurableOperatorGeometry += 1;
  }

  return {
    paintedImages,
    largestPaintedImageRatio,
    invisibleOrClipOnlyTextOps,
    unmeasurableOperatorGeometry,
  };
}

function emptyTotals() {
  return {
    textChars: 0,
    textItems: 0,
    lineCount: 0,
    alphanumericCharacters: 0,
    badGlyphs: 0,
    invalidGeometryItems: 0,
    nonLtrItems: 0,
    entirelyOutsideItems: 0,
    geometryOverflowCharacters: 0,
    duplicateCharacters: 0,
    overlappingCharacters: 0,
    paintedImages: 0,
    invisibleOrClipOnlyTextOps: 0,
    unmeasurableOperatorGeometry: 0,
    maxResidualRotationDegrees: 0,
    maxGeometryOverflowCharacterRatio: 0,
    maxDuplicateCharacterRatio: 0,
    maxOverlappingCharacterRatio: 0,
    largestPaintedImageRatio: 0,
    visionSupplementPages: 0,
    eligiblePages: 0,
    eligiblePageRatio: 0,
    serializedPayloadChars: 0,
    estimatedTokens: 0,
  };
}

function closedReasonCodes(codes) {
  const requested = new Set(codes);
  for (const code of requested) {
    if (!REASON_CODE_SET.has(code)) throw new Error('Unsupported native PDF text reason code.');
  }
  return NATIVE_PDF_TEXT_REASON_CODES.filter((code) => requested.has(code));
}

function closedFallback(reason, {
  totalPages = null,
  pdfJsPageCount = null,
  pdfLibPageCount = null,
  reasonCodes = [reason],
} = {}) {
  if (!FALLBACK_CODE_SET.has(reason)) throw new Error('Unsupported native PDF fallback code.');
  return {
    status: 'fallback',
    format: NATIVE_PDF_TEXT_FORMAT,
    totalPages,
    pdfJsPageCount,
    pdfLibPageCount,
    compactText: null,
    pages: [],
    totals: emptyTotals(),
    eligibility: {
      eligible: false,
      reasonCodes: closedReasonCodes(reasonCodes),
      thresholds: { ...NATIVE_PDF_TEXT_ELIGIBILITY },
    },
    fallback: {
      required: true,
      reason,
      strategy: 'source_pdf',
      pageNumbers: Number.isInteger(totalPages)
        ? Array.from({ length: totalPages }, (_, index) => index + 1)
        : [],
    },
  };
}

async function countPdfPagesWithPdfLib(pdfBytes, pdfLibLoader) {
  const pdfLib = await pdfLibLoader();
  if (!pdfLib?.PDFDocument || typeof pdfLib.PDFDocument.load !== 'function') {
    throw new Error('pdf-lib loader is incomplete.');
  }
  const document = await pdfLib.PDFDocument.load(copyPdfBytes(pdfBytes), {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const pageCount = Number(document?.getPageCount?.());
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error('pdf-lib returned an invalid page count.');
  }
  return pageCount;
}

function pageEligibilityReasonCodes(page) {
  const profile = NATIVE_PDF_TEXT_ELIGIBILITY;
  const codes = [];
  if (page.textChars < profile.minPageTextChars) codes.push('page_text_chars_below_minimum');
  if (page.textItems < profile.minPageTextItems) codes.push('page_text_items_below_minimum');
  if (page.lineCount < profile.minPageLineCount) codes.push('page_line_count_below_minimum');
  if (page.alphanumericRatio < profile.minPageAlphanumericRatio) {
    codes.push('page_alphanumeric_ratio_below_minimum');
  }
  if (page.invalidGeometryItems > 0) codes.push('invalid_text_geometry');
  if (page.nonLtrItems > 0) codes.push('non_ltr_text');
  if (page.maxResidualRotationDegrees > profile.maxResidualRotationDegrees) {
    codes.push('rotated_text');
  }
  if (page.entirelyOutsideItems > 0) codes.push('text_bbox_outside_page');
  if (page.geometryOverflowCharacterRatio > profile.maxGeometryOverflowCharacterRatio) {
    codes.push('text_geometry_overflow');
  }
  if (page.badGlyphs > 0) codes.push('bad_text_glyph');
  if (page.duplicateCharacterRatio > profile.maxDuplicateCharacterRatio) {
    codes.push('duplicate_text_layer');
  }
  if (page.overlappingCharacterRatio > profile.maxOverlappingCharacterRatio) {
    codes.push('overlapping_text_cells');
  }
  if (page.invisibleOrClipOnlyTextOps > 0) codes.push('invisible_or_clip_only_text');
  if (page.largestPaintedImageRatio >= profile.maxPaintedImagePageRatio) {
    codes.push('painted_image_too_large');
  }
  if (page.unmeasurableOperatorGeometry > 0) codes.push('unmeasurable_operator_geometry');
  return closedReasonCodes(codes);
}

/**
 * Extract an ordered, coordinate-bearing native text layer from a PDF.
 *
 * The result deliberately fails closed: `compactText` is null whenever the
 * document does not meet the fixed native-text eligibility thresholds. The
 * original PDF can then follow the caller's existing scan/vision fallback.
 */
export async function extractNativePdfText(pdfBytes, {
  pdfJsLoader = defaultPdfJsLoader,
  pdfLibLoader = defaultPdfLibLoader,
  contextOnlyPageLegends = [],
} = {}) {
  const contextLegends = normalizedContextOnlyPageLegends(contextOnlyPageLegends);
  let loadingTask = null;
  let document = null;
  let knownTotalPages = null;
  let pdfLibPageCount = null;
  let failureCode = 'pdf_lib_failure';
  try {
    pdfLibPageCount = await countPdfPagesWithPdfLib(pdfBytes, pdfLibLoader);
    failureCode = 'pdfjs_failure';
    const pdfJs = await pdfJsLoader();
    if (!pdfJs || typeof pdfJs.getDocument !== 'function' || !pdfJs.Util || !pdfJs.OPS) {
      throw new Error('PDF.js loader is incomplete.');
    }
    loadingTask = pdfJs.getDocument({
      data: copyPdfBytes(pdfBytes),
      disableWorker: true,
      useSystemFonts: true,
      verbosity: 0,
    });
    document = await loadingTask.promise;
    knownTotalPages = Number(document?.numPages);
    if (!Number.isInteger(knownTotalPages) || knownTotalPages < 1) {
      throw new Error('PDF has no pages.');
    }
    if (knownTotalPages !== pdfLibPageCount) {
      return closedFallback('page_count_mismatch', {
        totalPages: null,
        pdfJsPageCount: knownTotalPages,
        pdfLibPageCount,
        reasonCodes: ['page_count_mismatch'],
      });
    }
    if ([...contextLegends.keys()].some((pageNumber) => pageNumber > knownTotalPages)) {
      throw new Error('Native PDF context-only page is outside the document.');
    }

    const extractedPages = [];
    for (let pageNumber = 1; pageNumber <= knownTotalPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const layout = pageTextLayout(
          pageNumber,
          knownTotalPages,
          page,
          await page.getTextContent({ includeMarkedContent: false }),
          pdfJs,
        );
        const operatorMetrics = operatorPageMetrics(
          await page.getOperatorList(),
          page,
          viewport,
          pdfJs,
        );
        const measuredPage = { ...layout, ...operatorMetrics };
        const contextLegend = contextLegends.get(pageNumber) || null;
        // A context page exists only to carry the source-derived bureau-column
        // legend. Its original text/image content is never serialized or sent
        // as a vision supplement, and its source layout cannot make otherwise
        // eligible substantive data pages fall back to the full source PDF.
        const reasonCodes = contextLegend ? [] : pageEligibilityReasonCodes(measuredPage);
        const classification = contextLegend
          ? 'context_only'
          : !reasonCodes.length
            ? 'native_text'
            : measuredPage.largestPaintedImageRatio >= NATIVE_PDF_TEXT_ELIGIBILITY.maxPaintedImagePageRatio
              ? 'scan_candidate'
              : 'ineligible_native_text';
        extractedPages.push({
          ...measuredPage,
          ...(contextLegend
            ? {
              compactPage: contextOnlyCompactPage(measuredPage, knownTotalPages, contextLegend),
              contextOnly: true,
              contextLegendFormat: NATIVE_PDF_CONTEXT_LEGEND_FORMAT,
            }
            : {}),
          reasonCodes,
          classification,
        });
      } finally {
        page.cleanup?.();
      }
    }

    const totals = extractedPages.reduce((sum, page) => {
      sum.textChars += page.textChars;
      sum.textItems += page.textItems;
      sum.lineCount += page.lineCount;
      sum.alphanumericCharacters += page.alphanumericCharacters;
      sum.badGlyphs += page.badGlyphs;
      sum.invalidGeometryItems += page.invalidGeometryItems;
      sum.nonLtrItems += page.nonLtrItems;
      sum.entirelyOutsideItems += page.entirelyOutsideItems;
      sum.geometryOverflowCharacters += page.geometryOverflowCharacters;
      sum.duplicateCharacters += page.duplicateCharacters;
      sum.overlappingCharacters += page.overlappingCharacters;
      sum.paintedImages += page.paintedImages;
      sum.invisibleOrClipOnlyTextOps += page.invisibleOrClipOnlyTextOps;
      sum.unmeasurableOperatorGeometry += page.unmeasurableOperatorGeometry;
      sum.maxResidualRotationDegrees = Math.max(
        sum.maxResidualRotationDegrees,
        page.maxResidualRotationDegrees,
      );
      sum.maxGeometryOverflowCharacterRatio = Math.max(
        sum.maxGeometryOverflowCharacterRatio,
        page.geometryOverflowCharacterRatio,
      );
      sum.maxDuplicateCharacterRatio = Math.max(
        sum.maxDuplicateCharacterRatio,
        page.duplicateCharacterRatio,
      );
      sum.maxOverlappingCharacterRatio = Math.max(
        sum.maxOverlappingCharacterRatio,
        page.overlappingCharacterRatio,
      );
      sum.largestPaintedImageRatio = Math.max(
        sum.largestPaintedImageRatio,
        page.largestPaintedImageRatio,
      );
      return sum;
    }, emptyTotals());
    totals.eligiblePages = extractedPages.filter(
      (page) => ['native_text', 'context_only'].includes(page.classification),
    ).length;
    totals.eligiblePageRatio = totals.eligiblePages / knownTotalPages;
    const visionSupplementPageNumbers = extractedPages
      .filter((page) => !page.contextOnly && page.paintedImages > 0)
      .map((page) => page.pageNumber);
    totals.visionSupplementPages = visionSupplementPageNumbers.length;

    const compactCandidate = [
      FORMAT_LEGEND,
      ...extractedPages.map((page) => page.compactPage),
    ].join('\n');
    totals.serializedPayloadChars = compactCandidate.length;
    totals.estimatedTokens = Math.ceil(
      compactCandidate.length / NATIVE_PDF_TEXT_ELIGIBILITY.estimatedCharactersPerToken,
    );

    const allReasonCodes = extractedPages.flatMap((page) => page.reasonCodes);
    if (totals.serializedPayloadChars > NATIVE_PDF_TEXT_ELIGIBILITY.maxSerializedPayloadChars) {
      allReasonCodes.push('serialized_payload_too_large');
    }
    if (totals.estimatedTokens > NATIVE_PDF_TEXT_ELIGIBILITY.maxEstimatedTokens) {
      allReasonCodes.push('estimated_token_count_too_large');
    }
    if (visionSupplementPageNumbers.length
      > NATIVE_PDF_TEXT_ELIGIBILITY.maxVisionSupplementPages) {
      allReasonCodes.push('vision_supplement_limit_exceeded');
    }
    const reasonCodes = closedReasonCodes(allReasonCodes);
    const eligible = !reasonCodes.length;
    const publicPages = extractedPages.map(({ compactPage, ...page }) => page);
    const fallbackPageNumbers = extractedPages
      .filter((page) => !['native_text', 'context_only'].includes(page.classification))
      .map((page) => page.pageNumber);

    return {
      status: eligible
        ? (visionSupplementPageNumbers.length ? 'hybrid' : 'eligible')
        : 'fallback',
      format: NATIVE_PDF_TEXT_FORMAT,
      totalPages: knownTotalPages,
      pdfJsPageCount: knownTotalPages,
      pdfLibPageCount,
      compactText: eligible ? compactCandidate : null,
      visionSupplementPageNumbers: eligible ? visionSupplementPageNumbers : [],
      pages: publicPages,
      totals,
      eligibility: {
        eligible,
        reasonCodes,
        thresholds: { ...NATIVE_PDF_TEXT_ELIGIBILITY },
      },
      fallback: eligible ? null : {
        required: true,
        reason: reasonCodes.includes('serialized_payload_too_large')
          || reasonCodes.includes('estimated_token_count_too_large')
          ? 'payload_limit_exceeded'
          : 'image_only_or_unreadable',
        strategy: 'source_pdf',
        pageNumbers: fallbackPageNumbers.length
          ? fallbackPageNumbers
          : Array.from({ length: knownTotalPages }, (_, index) => index + 1),
      },
    };
  } catch {
    const trustedTotalPages = Number.isInteger(knownTotalPages) && knownTotalPages > 0
      && knownTotalPages === pdfLibPageCount
      ? knownTotalPages
      : null;
    return closedFallback(failureCode, {
      totalPages: trustedTotalPages,
      pdfJsPageCount: Number.isInteger(knownTotalPages) ? knownTotalPages : null,
      pdfLibPageCount,
      reasonCodes: [failureCode],
    });
  } finally {
    try {
      await loadingTask?.destroy?.();
    } catch { /* PDF.js cleanup is best-effort. */ }
  }
}
