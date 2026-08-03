#!/usr/bin/env node
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  SAFE_PDF_CHUNK_PAGES,
  countPdfPages,
  describePdfChunk,
  pdfNeedsChunking,
  splitPdfByPages,
} from '../src/utils/pdfPageChunks.js';
import {
  mergeAuditParseResults,
  mergeBureauParseResults,
} from '../src/utils/mergePdfAuditChunks.js';

let failed = 0;
function assert(condition, message) {
  if (!condition) {
    failed += 1;
    console.error('FAIL:', message);
  } else {
    console.log('ok:', message);
  }
}

async function makePdf(pageCount) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${i + 1}`, { x: 50, y: 700, size: 18, font });
  }
  return await doc.save();
}

const small = await makePdf(10);
assert(await countPdfPages(small) === 10, 'countPdfPages reads 10');
const smallChunks = await splitPdfByPages(small);
assert(smallChunks.length === 1, 'small PDF stays one chunk');
assert(smallChunks[0].startPage === 1 && smallChunks[0].endPage === 10, 'small chunk spans full file');
assert(!pdfNeedsChunking(10), '10 pages does not need chunking');

const over = await makePdf(119);
assert(pdfNeedsChunking(119), '119 pages needs chunking');
const overChunks = await splitPdfByPages(over, { maxPages: 95, overlap: 2 });
assert(overChunks.length === 2, `119 pages → 2 chunks (got ${overChunks.length})`);
assert(overChunks[0].endPage - overChunks[0].startPage + 1 <= 95, 'chunk 1 under max');
assert(overChunks[1].endPage === 119, 'chunk 2 ends at last page');
assert(overChunks[1].startPage < overChunks[0].endPage, 'chunks overlap');
assert(describePdfChunk(overChunks[0]).includes('part 1/2'), 'describePdfChunk labels part');

const huge = await makePdf(237);
const hugeChunks = await splitPdfByPages(huge, { maxPages: 95, overlap: 2 });
assert(hugeChunks.length === 3, `237 pages → 3 chunks (got ${hugeChunks.length})`);
assert(hugeChunks.every((c) => (c.endPage - c.startPage + 1) <= 95), 'every huge chunk under max');
assert(hugeChunks[2].endPage === 237, 'final chunk reaches end');
assert(SAFE_PDF_CHUNK_PAGES < 100, 'safe chunk size stays under Anthropic 100-page cap');

const mergedBureau = mergeBureauParseResults([
  {
    bureau: 'Experian',
    client: { name: 'Pat Client', address: '1 Main', score: 620 },
    accounts: [{
      furnisher: 'Wells Fargo Bank, N.A.',
      accountNumber: '****1234',
      type: 'revolving',
      status: 'Open',
      balance: 100,
      pastDue: 0,
      lastPaymentDate: null,
      dofd: null,
      paymentHistory: 'CCCCCCCC',
      remarks: null,
      accountClassification: 'B',
      violations: [{ field: 'Field 8', currentValue: '11', expectedValue: '11', reason: 'ok' }],
    }],
    inquiries: [{ furnisher: 'Cap One', date: '2024-01-01', type: 'Individual' }],
    personalInfo: { formerAddresses: ['Old St'], nameVariants: [], formerEmployers: [], dateOfBirth: null, phone: null, currentAddress: null },
  },
  {
    bureau: 'Experian',
    client: { name: 'Pat Client', address: '1 Main', score: 620 },
    accounts: [{
      furnisher: 'WELLS FARGO BANK NA',
      accountNumber: '****1234',
      type: 'revolving',
      status: 'Open',
      balance: 150,
      pastDue: 25,
      lastPaymentDate: '2024-02-01',
      dofd: '2023-01-01',
      paymentHistory: 'CCCCCCCCLLLL',
      remarks: 'CO',
      accountClassification: 'A',
      violations: [
        { field: 'Field 8', currentValue: '11', expectedValue: '11', reason: 'ok' },
        { field: 'Field 13A', currentValue: '97', expectedValue: 'blank', reason: 'charge-off' },
      ],
    }],
    inquiries: [{ furnisher: 'Cap One', date: '2024-01-01', type: 'Individual' }],
    personalInfo: { formerAddresses: ['Old St', 'New Ave'], nameVariants: ['P Client'], formerEmployers: [], dateOfBirth: '01/01/1980', phone: '555', currentAddress: '1 Main' },
  },
], 'Experian');

assert(mergedBureau.accounts.length === 1, 'overlapping accounts dedupe');
assert(mergedBureau.accounts[0].violations.length === 2, 'violations unioned');
assert(mergedBureau.accounts[0].balance === 150, 'richer balance kept');
assert(mergedBureau.inquiries.length === 1, 'duplicate inquiries dedupe');
assert(mergedBureau.personalInfo.formerAddresses.length === 2, 'personal addresses unioned');
assert(mergedBureau.personalInfo.dateOfBirth === '01/01/1980', 'DOB preserved from later chunk');

const mergedAudit = mergeAuditParseResults([
  {
    client: { name: 'A', address: null, scores: { equifax: 600 } },
    accounts: [
      { id: 'a1', furnisher: 'Bank A', accountNumberMasked: '****1111', type: 'A', status: 'CO', balance: 1, bureaus: ['EQ'], violations: [{ field: 'x', issue: 'i', currentlyReports: 'a', shouldReport: 'b', statute: 's', severity: 'high' }], primaryViolation: 'x', addressStatus: 'PENDING', furnisherAddress: null, batch: 2, strategy: 's1' },
    ],
    inquiries: [],
    personalInfo: { formerAddresses: [], nameVariants: [], formerEmployers: [], dateOfBirth: null, phone: null, currentAddress: null },
  },
  {
    client: { name: 'A', address: 'Addr', scores: { experian: 610 } },
    accounts: [
      { id: 'a2', furnisher: 'Bank B', accountNumberMasked: '****2222', type: 'C', status: 'Collection', balance: 2, bureaus: ['EXP'], violations: [{ field: 'y', issue: 'i', currentlyReports: 'a', shouldReport: 'b', statute: 's', severity: 'med' }, { field: 'z', issue: 'i', currentlyReports: 'a', shouldReport: 'b', statute: 's', severity: 'low' }], primaryViolation: 'y', addressStatus: 'PENDING', furnisherAddress: null, batch: 2, strategy: 's2' },
    ],
    inquiries: [{ furnisher: 'Q', date: '2024-01-01', bureaus: ['EXP'], linkedAccountId: null, ageInMonths: 12, category: 'stale' }],
    personalInfo: { formerAddresses: ['X'], nameVariants: [], formerEmployers: [], dateOfBirth: null, phone: null, currentAddress: null },
  },
]);
assert(mergedAudit.accounts.length === 2, 'audit accounts merged');
assert(mergedAudit.accounts[0].batch === 1, 'densest account becomes batch 1');
assert(mergedAudit.client.scores.equifax === 600 && mergedAudit.client.scores.experian === 610, 'scores merged');
assert(mergedAudit.totalViolations === 3, 'totalViolations recomputed');

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll PDF page-chunking assertions passed');
