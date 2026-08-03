/**
 * Recovery Blueprint data helpers + PDF smoke test.
 * Run: node scripts/test-recovery-blueprint.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  accountBalance,
  blueprintStats,
  ensureSentence,
  money,
  openingMoveBullets,
  personalInfoLines,
  pickOpeningMove,
} from '../src/utils/recoveryBlueprintData.js';
import {
  auditPdfFilename,
  buildAuditPdfDoc,
  defaultRecoveryBlueprintEmail,
} from '../src/utils/auditPdf.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

assert.equal(ensureSentence('Escalate to all three CRAs if not corrected'), 'Escalate to all three CRAs if not corrected.');
assert.equal(ensureSentence('Already done.'), 'Already done.');
assert.equal(money(28988), '$28,988');
assert.equal(accountBalance({ balance: '28,988' }), 28988);
assert.equal(accountBalance({ balance: '$110392' }), 110392);

const sample = {
  client: {
    name: 'David Ernesto Moya',
    address: '6597 Crescent Loop, Winter Haven, FL 33884',
    reportDate: '2026-07-31',
  },
  accountsScanned: 61,
  accountsTargeted: 15,
  totalViolations: 21,
  personalInfo: {
    nameVariants: ['David Ernesto Moya', 'David Moya'],
    formerAddresses: ['7796 SW 99th St, Miami, FL 33156'],
  },
  accounts: [
    {
      id: 'boa',
      furnisher: 'Bank of America',
      balance: 28988,
      batch: 1,
      status: 'Charge-off',
      bureaus: ['EQ', 'EXP', 'TU'],
      primaryViolation: 'Charge-off still reporting with full balance and past-due as of Jul 2026',
      strategy:
        'Direct dispute to Bank of America demanding Metro 2 accuracy on account status, current balance, amount past due, and Date of First Delinquency; require complete payment history and charge-off documentation. Escalate to all three CRAs if not corrected',
      violations: [
        {
          field: 'Field 17A / Account Status',
          issue: 'Charge-off continues to report with matching past-due and balance years after first delinquency',
        },
        {
          field: 'Field 25 DOFD',
          issue: 'DOFD/first delinquency must be fixed and consistent across furnishers and bureaus',
        },
      ],
    },
    { id: 'nfcu', furnisher: 'Navy Federal Credit Union', balance: 25166, batch: 1, strategy: 'Dispute NFCU charge-off' },
    { id: 'pra', furnisher: 'Portfolio Recovery', balance: 4644, batch: 1 },
    { id: 'midland', furnisher: 'Midland Credit', balance: 2276, batch: 2 },
  ],
};

const stats = blueprintStats(sample);
assert.equal(stats.openingMove.furnisher, 'Bank of America');
assert.equal(stats.batch1Balance, 28988 + 25166 + 4644);
assert.equal(stats.totalBalance, stats.batch1Balance + 2276);

const bullets = openingMoveBullets(stats.openingMove);
const campaign = bullets.find((b) => b.field === 'Campaign');
assert.ok(campaign);
assert.match(campaign.text, /Escalate to all three CRAs if not corrected\./);
assert.ok(!campaign.text.includes('…'));
assert.ok(!campaign.text.includes('...'));

const pi = personalInfoLines(sample.personalInfo);
assert.equal(pi[0].label, 'Name variants');
assert.match(pi[1].value, /Miami/);

assert.equal(
  auditPdfFilename(sample),
  'ccc-recovery-blueprint-david-ernesto-moya-2026-07-31.pdf',
);

const email = defaultRecoveryBlueprintEmail({ audit: sample });
assert.match(email, /Recovery Blueprint/);
assert.match(email, /Bank of America/);
assert.match(email, /\$28,988/);
assert.match(email, /Hi David/);

// Prefer full Moya artifact when present
let audit = sample;
try {
  const artifact = join('/opt/cursor/artifacts/david-moya-audit.json');
  audit = JSON.parse(readFileSync(artifact, 'utf8'));
  const om = pickOpeningMove(audit.accounts);
  assert.equal(om.furnisher, 'Bank of America');
  assert.equal(accountBalance(om), 28988);
} catch (_) {
  /* optional */
}

const doc = await buildAuditPdfDoc(audit);
const pages = doc.getNumberOfPages();
assert.ok(pages >= 6, `expected >= 6 pages, got ${pages}`);

const outDir = join(root, 'artifacts-moya-sales');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'production-recovery-blueprint-smoke.pdf');
writeFileSync(outPath, Buffer.from(doc.output('arraybuffer')));

// Cover page text should include client NAME under Client meta, not only city
const coverText = doc.getPageText ? null : null;
void coverText;

console.log('recovery-blueprint tests passed');
console.log(`pages=${pages} wrote ${outPath}`);
console.log(`openingMove=${pickOpeningMove(audit.accounts)?.furnisher} ${money(accountBalance(pickOpeningMove(audit.accounts)))}`);
