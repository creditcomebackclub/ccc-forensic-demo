#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildNativeReportContent } from '../src/utils/auditPrompts.js';

const blocks = buildNativeReportContent(
  '[[ccc-pdf-layout-v1;pt;top-left;rows=y|x:text]]\n[[PAGE 1/2;612x792;r0]]\n80|50:Account Details',
  'Extract the attached range.',
  { format: 'ccc-pdf-layout-v1', localPageCount: 2 },
);
assert.equal(blocks.length, 2);
assert.equal(blocks[0].type, 'text');
assert.match(blocks[0].text, /UNTRUSTED DOCUMENT DATA/);
assert.match(blocks[0].text, /LOCAL pages 1-2/);
assert.match(blocks[0].text, /missing extracted cell means NOT_SHOWN/);
assert.doesNotMatch(blocks[0].text, /base64/i);
assert.throws(() => buildNativeReportContent('', 'x', {
  format: 'ccc-pdf-layout-v1', localPageCount: 1,
}), /Eligible native PDF text is required/);
const hybridBlocks = buildNativeReportContent(
  '[[ccc-pdf-layout-v1;pt;top-left;rows=y|x:text]]\n[[PAGE 1/2;612x792;r0]]\n80|50:Account Details',
  'Extract the attached range.',
  {
    format: 'ccc-pdf-layout-v1',
    localPageCount: 2,
    visionSupplements: [{ localPage: 2, base64: Buffer.from('one-page-pdf').toString('base64') }],
  },
);
assert.equal(hybridBlocks.filter((block) => block.type === 'document').length, 1);
assert.match(hybridBlocks.find((block) => block.text?.startsWith('VISION SUPPLEMENT'))?.text || '', /LOCAL PAGE 2/);

const worker = readFileSync(new URL('../netlify/functions/audit-run-background.mjs', import.meta.url), 'utf8');
assert.match(worker, /extractNativePdfText\(chunk\.bytes, \{[\s\S]*contextOnlyPageLegends:/);
assert.match(worker, /NATIVE_PDF_CONTEXT_LEGEND_FORMAT/);
assert.match(worker, /contextRepresentation: NATIVE_PDF_CONTEXT_LEGEND_FORMAT/);
assert.match(worker, /nativeTextCanDriveCheckpoint/);
assert.match(worker, /inputMode: nativeText\.status === 'hybrid' \? 'hybrid_native_pdf' : 'native_pdf_text'/);
assert.match(worker, /'hybrid_native_pdf'/);
assert.match(worker, /inputMode: nonPdfMode \|\| 'source_pdf'/);
assert.match(worker, /'source_html'/);
assert.match(worker, /'source_text'/);
assert.match(worker, /derivedPayloadSha256: sha256\(nativeText\.compactText\)/);
assert.match(worker, /providerContentSha256/);
assert.match(worker, /systemSha256: sha256\(canonicalJson\(SYSTEM\)\)/);
assert.match(worker, /request_sha256: requestSha256/);
assert.match(worker, /checkpointProviderContent\(input, combinedExtractionPrompt/);
assert.match(worker, /checkpointProviderContent\(input, bureauExtractionPrompt/);
assert.match(worker, /visionSupplements: input\.visionSupplements/);
assert.match(worker, /strictNativePlan/);
assert.match(worker, /maxPages: contextSourcePage === COMBINED_CONTEXT_SOURCE_PAGE[\s\S]*RESUMABLE_PDF_CHUNK_PAGES/);
assert.match(worker, /input_provenance: inputProvenance/);
assert.match(worker, /extractionInputsFromCheckpoints/);
assert.match(worker, /requestSha256: checkpoint\.usage\.request_sha256/);
assert.match(worker, /outputSha256: checkpoint\.output_sha256/);
assert.match(worker, /extractionInputs:\s*meta\[bureauParse\.bureau\]\.extractionInputs/);

console.log('Native PDF audit input/fallback contracts passed.');
