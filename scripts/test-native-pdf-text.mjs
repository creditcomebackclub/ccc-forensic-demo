#!/usr/bin/env node
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import {
  NATIVE_PDF_TEXT_ELIGIBILITY,
  NATIVE_PDF_TEXT_FORMAT,
  extractNativePdfText,
} from '../src/utils/nativePdfText.js';

let failures = 0;

function check(condition, label) {
  if (condition) return;
  failures += 1;
  console.error(`FAIL: ${label}`);
}

async function makeNativeTablePdf({ smallImage = false, firstPageOnlyText = null } = {}) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const smallPng = smallImage ? await document.embedPng(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  )) : null;
  for (let pageIndex = 0; pageIndex < 2; pageIndex += 1) {
    const page = document.addPage([612, 792]);
    if (smallPng && pageIndex === 0) {
      page.drawImage(smallPng, { x: 540, y: 730, width: 18, height: 18 });
    }
    // Deliberately paint cells out of reading order. Layout extraction must
    // recover visual row/column order from coordinates, not content-stream order.
    page.drawText('Bureau C', { x: 390, y: 720, size: 10, font });
    page.drawText('Account details', { x: 48, y: 720, size: 10, font });
    page.drawText('Bureau A', { x: 220, y: 720, size: 10, font });
    if (pageIndex === 0 && firstPageOnlyText) {
      page.drawText(firstPageOnlyText, { x: 48, y: 548, size: 10, font });
    }
    page.drawText('Balance', { x: 48, y: 692, size: 10, font });
    page.drawText('300', { x: 390, y: 692, size: 10, font });
    page.drawText('100', { x: 220, y: 692, size: 10, font });
    page.drawText('Payment history reported for twenty four months', {
      x: 48,
      y: 660,
      size: 10,
      font,
    });
    page.drawText('Account status is current and complete', {
      x: 48,
      y: 632,
      size: 10,
      font,
    });
    page.drawText('Reported terms and dates remain available for review', {
      x: 48,
      y: 604,
      size: 10,
      font,
    });
    page.drawText('Monthly payment values are displayed in source order', {
      x: 48,
      y: 576,
      size: 10,
      font,
    });
  }
  return document.save();
}

async function makeImageOnlyPdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const png = await document.embedPng(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ));
  page.drawImage(png, { x: 0, y: 0, width: 612, height: 792 });
  page.drawRectangle({ x: 40, y: 40, width: 532, height: 712, borderColor: rgb(0, 0, 0) });
  return document.save();
}

async function makeGuardPdf({
  rotation = 0,
  duplicate = false,
  overlap = false,
  outside = false,
  punctuation = false,
} = {}) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  const values = [];
  for (let index = 0; index < 10; index += 1) {
    const text = punctuation
      ? '!@#$%&*()-_=+[]{};:,.?/!@#$%&*()'
      : `Synthetic account field ${index + 1} contains enough readable letters and digits 12345`;
    const options = {
      x: 48,
      y: 720 - (index * 48),
      size: 9,
      font,
      ...(rotation ? { rotate: degrees(rotation) } : {}),
    };
    page.drawText(text, options);
    values.push({ text, options });
  }
  if (duplicate) page.drawText(values[0].text, values[0].options);
  if (overlap) {
    page.drawText('Different overlapping account cell with readable content 67890', values[0].options);
  }
  if (outside) {
    page.drawText('Entirely outside text must make native extraction fail 12345', {
      x: 612,
      y: 200,
      size: 9,
      font,
    });
  }
  return document.save();
}

async function makeOversizedPayloadPdf() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let pageIndex = 0; pageIndex < 30; pageIndex += 1) {
    const page = document.addPage([612, 792]);
    for (let line = 0; line < 50; line += 1) {
      page.drawText(`Synthetic field value 1234567890 page ${pageIndex + 1} line ${line + 1}`, {
        x: 40,
        y: 750 - (line * 14),
        size: 8,
        font,
      });
    }
  }
  return document.save();
}

const nativeBytes = await makeNativeTablePdf();
const first = await extractNativePdfText(nativeBytes);
const second = await extractNativePdfText(Buffer.from(nativeBytes));

check(first.status === 'eligible', 'native table PDF is eligible');
check(first.format === NATIVE_PDF_TEXT_FORMAT, 'result identifies the compact format');
check(first.totalPages === 2, 'native table page count is preserved');
check(first.pages.every((page) => page.classification === 'native_text'), 'all native pages are classified');
check(first.pages.every((page) => page.lineCount >= 3), 'visual rows are retained');
check(first.compactText === second.compactText, 'output is byte-for-byte deterministic');
check(first.compactText?.includes('[[PAGE 1/2;') === true, 'page tags are emitted');
check(first.compactText?.includes('48:Account details') === true, 'left table cell keeps its x coordinate');
check(first.compactText?.includes('220:Bureau A') === true, 'middle table cell keeps its x coordinate');
check(first.compactText?.includes('390:Bureau C') === true, 'right table cell keeps its x coordinate');
const headerStart = first.compactText?.indexOf('48:Account details') ?? -1;
const middleStart = first.compactText?.indexOf('220:Bureau A') ?? -1;
const rightStart = first.compactText?.indexOf('390:Bureau C') ?? -1;
check(headerStart >= 0 && headerStart < middleStart && middleStart < rightStart,
  'table cells are in visual left-to-right order');
check(first.fallback === null, 'eligible native text has no fallback');
check(first.pdfJsPageCount === 2 && first.pdfLibPageCount === 2,
  'independent page counts agree');
check(NATIVE_PDF_TEXT_ELIGIBILITY.minPageTextChars === 200
  && NATIVE_PDF_TEXT_ELIGIBILITY.minPageTextItems === 10
  && NATIVE_PDF_TEXT_ELIGIBILITY.minPageLineCount === 5
  && NATIVE_PDF_TEXT_ELIGIBILITY.minPageAlphanumericRatio === 0.45,
'calibrated page-density gates are fixed');

const hybrid = await extractNativePdfText(await makeNativeTablePdf({ smallImage: true }));
check(hybrid.status === 'hybrid', 'small painted region requires hybrid native plus vision input');
check(hybrid.visionSupplementPageNumbers?.length === 1
  && hybrid.visionSupplementPageNumbers[0] === 1,
'hybrid result identifies the exact local vision-supplement page');
check(hybrid.compactText !== null, 'hybrid mode retains the validated native layout');

const contextOnlySecret = 'SOURCE PAGE ONE SUBSTANTIVE PROFILE VALUE MUST NOT LEAK';
const sanitizedContext = await extractNativePdfText(await makeNativeTablePdf({
  smallImage: true,
  firstPageOnlyText: contextOnlySecret,
}), {
  contextOnlyPageLegends: [{
    pageNumber: 1,
    columns: [
      { position: 'left', bureau: 'transunion' },
      { position: 'center', bureau: 'equifax' },
      { position: 'right', bureau: 'experian' },
    ],
  }],
});
check(sanitizedContext.status === 'eligible',
  'a painted context page does not force an otherwise native range into source-PDF fallback');
check(sanitizedContext.pages[0]?.classification === 'context_only',
  'the source-derived legend page is explicitly classified as context-only');
check(sanitizedContext.visionSupplementPageNumbers?.length === 0,
  'a context-only page is never sent as a vision supplement');
check(sanitizedContext.compactText?.includes('CONTEXT_ONLY;ccc-source-derived-bureau-column-legend-v1'),
  'compact native input identifies the deterministic context representation');
check(sanitizedContext.compactText?.includes('LEFT COLUMN=TRANSUNION')
  && sanitizedContext.compactText?.includes('CENTER COLUMN=EQUIFAX')
  && sanitizedContext.compactText?.includes('RIGHT COLUMN=EXPERIAN'),
'the safe context stub retains only the source-policy-bound column order');
check(!sanitizedContext.compactText?.includes(contextOnlySecret),
  'substantive source-page-one text is absent from provider input');
let invalidContextOrderRejected = false;
try {
  await extractNativePdfText(new Uint8Array([1]), {
    contextOnlyPageLegends: [{
      pageNumber: 1,
      columns: [
        { position: 'left', bureau: 'equifax' },
        { position: 'center', bureau: 'transunion' },
        { position: 'right', bureau: 'experian' },
      ],
    }],
  });
} catch (error) {
  invalidContextOrderRejected = /bureau-column order is invalid/i.test(error?.message || '');
}
check(invalidContextOrderRejected,
  'the SmartCredit context representation rejects a bureau permutation before reading the PDF');

const imageBytes = await makeImageOnlyPdf();
const imageOnly = await extractNativePdfText(imageBytes);
check(imageOnly.status === 'fallback', 'image-only PDF fails closed');
check(imageOnly.compactText === null, 'fallback never exposes partial compact text');
check(imageOnly.pages[0]?.classification === 'scan_candidate', 'painted image is detected as a scan candidate');
check(imageOnly.fallback?.reason === 'image_only_or_unreadable', 'scan fallback reason is explicit');
check(imageOnly.fallback?.strategy === 'source_pdf', 'scan fallback names the source-PDF strategy');
check(imageOnly.eligibility.reasonCodes.includes('painted_image_too_large'),
  'full-page painted image exceeds the calibrated area cap');
check(imageOnly.fallback?.pageNumbers?.length === 1 && imageOnly.fallback.pageNumbers[0] === 1,
  'scan fallback identifies the affected page');

const invalid = await extractNativePdfText(new Uint8Array([1, 2, 3, 4]));
check(invalid.status === 'fallback', 'invalid PDF returns fallback instead of throwing');
check(invalid.fallback?.reason === 'pdf_lib_failure', 'independent parser failure reason is bounded');
check(invalid.compactText === null, 'parser failure has no compact text');

const pdfJsFailure = await extractNativePdfText(nativeBytes, {
  pdfJsLoader: async () => { throw new Error('private parser detail'); },
});
check(pdfJsFailure.fallback?.reason === 'pdfjs_failure', 'PDF.js failure code is bounded');
check(!JSON.stringify(pdfJsFailure).includes('private parser detail'), 'private parser errors never escape');

const pageCountMismatch = await extractNativePdfText(nativeBytes, {
  pdfLibLoader: async () => ({
    PDFDocument: { load: async () => ({ getPageCount: () => 3 }) },
  }),
});
check(pageCountMismatch.fallback?.reason === 'page_count_mismatch',
  'independent page-count mismatch fails closed');
check(pageCountMismatch.compactText === null, 'page-count mismatch has no compact text');

const rotated = await extractNativePdfText(await makeGuardPdf({ rotation: 5 }));
check(rotated.eligibility.reasonCodes.includes('rotated_text'), 'residual text rotation is rejected');

const duplicated = await extractNativePdfText(await makeGuardPdf({ duplicate: true }));
check(duplicated.eligibility.reasonCodes.includes('duplicate_text_layer'),
  'duplicated text and bounding boxes are rejected');

const overlapped = await extractNativePdfText(await makeGuardPdf({ overlap: true }));
check(overlapped.eligibility.reasonCodes.includes('overlapping_text_cells'),
  'significantly overlapping cells are rejected');

const outside = await extractNativePdfText(await makeGuardPdf({ outside: true }));
check(outside.eligibility.reasonCodes.includes('text_bbox_outside_page'),
  'text entirely outside the page is rejected');

const lowAlphanumeric = await extractNativePdfText(await makeGuardPdf({ punctuation: true }));
check(lowAlphanumeric.eligibility.reasonCodes.includes('page_alphanumeric_ratio_below_minimum'),
  'punctuation-only text fails the alphanumeric gate');

const oversized = await extractNativePdfText(await makeOversizedPayloadPdf());
check(oversized.fallback?.reason === 'payload_limit_exceeded',
  'oversized serialized checkpoint payload fails closed');
check(oversized.totals.serializedPayloadChars > 60_000, 'payload cap uses deterministic characters');
check(oversized.compactText === null, 'oversized payload is never returned as provider input');

console.log(JSON.stringify({
  native: {
    status: first.status,
    pages: first.totalPages,
    textChars: first.totals.textChars,
    textItems: first.totals.textItems,
    lines: first.totals.lineCount,
  },
  imageOnly: {
    status: imageOnly.status,
    pages: imageOnly.totalPages,
    scanCandidatePages: imageOnly.fallback?.pageNumbers?.length || 0,
  },
  hardening: {
    guardedFallbacks: [rotated, duplicated, overlapped, outside, lowAlphanumeric].filter(
      (result) => result.status === 'fallback',
    ).length,
    oversizedPayloadChars: oversized.totals.serializedPayloadChars,
  },
  assertions: failures ? 'failed' : 'passed',
}));

process.exit(failures ? 1 : 0);
