import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const files = [
  '../src/components/InboxPage.jsx',
  '../src/components/DashboardPage.jsx',
  '../src/components/BureauFollowUpPanel.jsx',
  '../public/privacy.html',
  '../public/freeguide.html',
  '../public/home.html',
  '../public/join.html',
  '../public/join-embed.js',
  '../public/terms.html',
];

const sources = new Map(files.map((file) => [
  file,
  readFileSync(new URL(file, import.meta.url), 'utf8'),
]));

const joined = [...sources.values()].join('\n');
assert.doesNotMatch(
  joined,
  /\bLPOA\b|limited power of attorney|power of attorney/i,
  'assigned active surfaces must not expose the retired authorization workflow',
);
assert.doesNotMatch(
  joined,
  /certified(?:-|\s)+mail|return receipt|Metro(?:-|\s)*2|furnisher(?:-|\s)*first|first(?:-|\s)*work(?:\s+fee)?|setup(?:\s*&\s*|\s+and\s+|\s+)spike/i,
  'assigned active surfaces must not describe the retired mail or dispute method',
);
assert.doesNotMatch(
  joined,
  /pricing-work-fee|7-Metro2-Dispute-Templates/i,
  'retired Metro 2 guide and fee hooks must not remain reachable from assigned public pages',
);

const dashboard = sources.get('../src/components/DashboardPage.jsx');
assert.match(dashboard, /Sent by first-class mail/);
assert.doesNotMatch(dashboard, /Furnisher replied/);

const followUp = sources.get('../src/components/BureauFollowUpPanel.jsx');
assert.match(followUp, /Historical workflow retired/);
assert.match(followUp, /no longer creates or sends follow-up letters/);
assert.doesNotMatch(followUp, /runPhase2Job|saveLetter|signatureInjection|metro2Fields/i,
  'the retired modal must not retain a live generator or signature dependency');

for (const file of ['../public/home.html', '../public/freeguide.html', '../public/terms.html']) {
  const source = sources.get(file);
  assert.match(source, /149/);
  assert.match(source, /299/);
  assert.match(source, /997/);
  assert.match(source, /6(?:-|\s)*month/i);
}

const guide = sources.get('../public/freeguide.html');
assert.match(guide, /Review your credit reports with a/);
assert.match(guide, /Read\. Document\. Write\. Track\./);
assert.match(guide, /intent:'guide_download'/,
  'the current free guide uses a dedicated tracked download intent');
assert.doesNotMatch(guide, /netlify\/functions\/assets|credit-comeback-club-credit-report-field-guide\.pdf/,
  'the public page must not expose the private bundled PDF path or filename');

const netlify = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
assert.match(
  netlify,
  /from\s*=\s*"\/downloads\/7-Metro2-Dispute-Templates\.pdf"[\s\S]*?to\s*=\s*"\/freeguide\.html"[\s\S]*?status\s*=\s*301[\s\S]*?force\s*=\s*true/,
  'old direct PDF bookmarks must be forced to the current on-page guide',
);
assert.equal(
  existsSync(new URL('../public/downloads/7-Metro2-Dispute-Templates.pdf', import.meta.url)),
  false,
  'the retired Metro 2 PDF must not remain in the publicly served directory',
);
assert.equal(
  existsSync(new URL('../netlify/functions/assets/credit-comeback-club-credit-report-field-guide.pdf', import.meta.url)),
  true,
  'the new field guide must remain private inside the function bundle',
);
assert.equal(
  existsSync(new URL('../docs/archive/retired-public-assets/7-Metro2-Dispute-Templates.pdf', import.meta.url)),
  true,
  'the retired PDF must remain recoverable in the internal archive',
);

const join = sources.get('../public/join.html');
const embed = sources.get('../public/join-embed.js');
for (const source of [join, embed]) {
  assert.match(source, /review how accounts appear across your three credit reports/i);
  assert.match(source, /build factual disputes/i);
}

console.log('Visible current-method cleanup assertions passed.');
