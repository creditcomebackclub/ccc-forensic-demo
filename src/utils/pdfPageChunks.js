// Split oversized credit-report PDFs into Anthropic-safe page windows.
// Claude caps PDFs at 100 pages per request on the ~200k context class this
// app uses (600 with a 1M window). Credit reports of 100–250+ pages are
// common for dense individual-bureau exports; without splitting, those jobs
// fail at the document API before any audit runs.
import { PDFDocument } from 'pdf-lib';

/** Anthropic hard cap for requests under a 1M context window. */
export const ANTHROPIC_MAX_PDF_PAGES = 100;

/** Stay under the hard cap so dense table pages don't blow the request. */
export const SAFE_PDF_CHUNK_PAGES = 95;

/** Overlap so accounts that straddle a chunk boundary appear in both parts. */
export const PDF_CHUNK_OVERLAP_PAGES = 2;

function toUint8Array(pdfBytes) {
  if (pdfBytes instanceof Uint8Array) return pdfBytes;
  if (Buffer.isBuffer(pdfBytes)) return new Uint8Array(pdfBytes);
  return new Uint8Array(pdfBytes);
}

export async function countPdfPages(pdfBytes) {
  const src = await PDFDocument.load(toUint8Array(pdfBytes), { ignoreEncryption: true });
  return src.getPageCount();
}

/**
 * Rebuild one exact 1-indexed inclusive page range from its immutable source.
 * Resumable checkpoints use this instead of relying on generated PDF bytes
 * being bit-for-bit stable across separate Netlify invocations.
 */
export async function extractPdfPageRange(pdfBytes, { startPage, endPage } = {}) {
  const bytes = toUint8Array(pdfBytes);
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const totalPages = src.getPageCount();
  const start = Number(startPage);
  const end = Number(endPage);
  if (!Number.isInteger(start) || !Number.isInteger(end)
      || start < 1 || end < start || end > totalPages) {
    throw new Error(`Invalid PDF page range ${startPage}–${endPage} for ${totalPages} pages`);
  }
  if (start === 1 && end === totalPages) {
    return {
      bytes, base64: Buffer.from(bytes).toString('base64'),
      startPage: start, endPage: end, totalPages,
    };
  }
  const doc = await PDFDocument.create();
  const indices = Array.from({ length: end - start + 1 }, (_, index) => start - 1 + index);
  const copied = await doc.copyPages(src, indices);
  copied.forEach((page) => doc.addPage(page));
  const output = await doc.save();
  const outputBytes = output instanceof Uint8Array ? output : new Uint8Array(output);
  return {
    bytes: outputBytes, base64: Buffer.from(outputBytes).toString('base64'),
    startPage: start, endPage: end, totalPages,
  };
}

/**
 * Rebuild an exact ordered set of 1-indexed source pages.
 *
 * Combined-report checkpoints use this to prepend the report's visible
 * bureau-layout page without pretending that the copied page is part of the
 * checkpoint's contiguous data range. `sourcePageMap[localPage - 1]` is the
 * only valid way to map provider page references back to the source PDF.
 */
export async function extractPdfPages(pdfBytes, { pageNumbers } = {}) {
  const bytes = toUint8Array(pdfBytes);
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const totalPages = src.getPageCount();
  if (!Array.isArray(pageNumbers) || !pageNumbers.length) {
    throw new Error('At least one PDF source page is required');
  }
  const sourcePageMap = pageNumbers.map((pageNumber) => Number(pageNumber));
  if (sourcePageMap.some((pageNumber) => (
    !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > totalPages
  ))) {
    throw new Error(`Invalid PDF source page map for ${totalPages} pages`);
  }
  if (new Set(sourcePageMap).size !== sourcePageMap.length) {
    throw new Error('PDF source page map cannot contain duplicate pages');
  }

  const isWholeDocument = sourcePageMap.length === totalPages
    && sourcePageMap.every((pageNumber, index) => pageNumber === index + 1);
  if (isWholeDocument) {
    return {
      bytes,
      base64: Buffer.from(bytes).toString('base64'),
      totalPages,
      sourcePageMap,
    };
  }

  const doc = await PDFDocument.create();
  const copied = await doc.copyPages(src, sourcePageMap.map((pageNumber) => pageNumber - 1));
  copied.forEach((page) => doc.addPage(page));
  const output = await doc.save();
  const outputBytes = output instanceof Uint8Array ? output : new Uint8Array(output);
  return {
    bytes: outputBytes,
    base64: Buffer.from(outputBytes).toString('base64'),
    totalPages,
    sourcePageMap,
  };
}

/**
 * Split a PDF into page ranges of at most `maxPages` (with optional overlap).
 * Returns one chunk when the file is already under the limit.
 *
 * Page numbers in the result are 1-indexed inclusive (startPage..endPage).
 */
export async function splitPdfByPages(pdfBytes, {
  maxPages = SAFE_PDF_CHUNK_PAGES,
  overlap = PDF_CHUNK_OVERLAP_PAGES,
} = {}) {
  if (!Number.isFinite(maxPages) || maxPages < 1) {
    throw new Error('maxPages must be a positive number');
  }
  if (!Number.isFinite(overlap) || overlap < 0) {
    throw new Error('overlap must be a non-negative number');
  }
  if (overlap >= maxPages) {
    throw new Error('overlap must be smaller than maxPages');
  }

  const bytes = toUint8Array(pdfBytes);
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const totalPages = src.getPageCount();

  if (totalPages <= maxPages) {
    return [{
      bytes,
      base64: Buffer.from(bytes).toString('base64'),
      startPage: 1,
      endPage: totalPages,
      totalPages,
      index: 0,
      chunkCount: 1,
    }];
  }

  const chunks = [];
  let start = 0; // 0-indexed inclusive
  while (start < totalPages) {
    const end = Math.min(start + maxPages, totalPages); // exclusive
    const doc = await PDFDocument.create();
    const indices = [];
    for (let i = start; i < end; i++) indices.push(i);
    const copied = await doc.copyPages(src, indices);
    copied.forEach((page) => doc.addPage(page));
    const out = await doc.save();
    const outBytes = out instanceof Uint8Array ? out : new Uint8Array(out);
    chunks.push({
      bytes: outBytes,
      base64: Buffer.from(outBytes).toString('base64'),
      startPage: start + 1,
      endPage: end,
      totalPages,
      index: chunks.length,
      chunkCount: 0,
    });
    if (end >= totalPages) break;
    const nextStart = end - overlap;
    // Guard against a no-progress loop if overlap math ever changes.
    start = nextStart > start ? nextStart : end;
  }

  chunks.forEach((chunk) => { chunk.chunkCount = chunks.length; });
  return chunks;
}

export function pdfNeedsChunking(pageCount, maxPages = SAFE_PDF_CHUNK_PAGES) {
  return Number(pageCount) > maxPages;
}

export function describePdfChunk(chunk) {
  if (!chunk) return '';
  if (chunk.chunkCount <= 1) return `full report (${chunk.totalPages} page${chunk.totalPages === 1 ? '' : 's'})`;
  return `pages ${chunk.startPage}–${chunk.endPage} of ${chunk.totalPages} (part ${chunk.index + 1}/${chunk.chunkCount})`;
}
