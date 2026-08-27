#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');

const publicIdentityFiles = [
  'public/cancellation-refund-policy.html',
  'public/croa-statement.html',
  'public/freeguide.html',
  'public/home.html',
  'public/privacy.html',
  'public/terms.html',
  'scripts/build-credit-field-guide.py',
  'src/components/AuthPage.jsx',
  'website-preview/index.html',
];

const prohibitedIdentityPatterns = [
  /Credit Comeback Club\s*,?\s*L\.?L\.?C\.?/i,
  /Colorado limited liability company/i,
];

for (const path of publicIdentityFiles) {
  const source = read(path);
  for (const pattern of prohibitedIdentityPatterns) {
    assert.doesNotMatch(source, pattern, `${path} must not claim LLC status for Credit Comeback Club`);
  }
}

const legalIdentity = 'Christopher Holland, a Colorado sole proprietor doing business as Credit Comeback Club';
for (const path of [
  'public/cancellation-refund-policy.html',
  'public/privacy.html',
  'public/terms.html',
]) {
  assert.ok(read(path).includes(legalIdentity), `${path} must identify the current service provider`);
}

const guideBuilder = read('scripts/build-credit-field-guide.py');
assert.ok(guideBuilder.includes('author="Credit Comeback Club"'), 'Field-guide PDF metadata must use the current brand name');

const clientsPage = read('src/components/ClientsPage.jsx');
const disputeFlow = read('src/utils/disputeFlow.js');
for (const thirdPartyName of [
  'Equifax Information Services LLC',
  'TransUnion LLC',
  'LVNV Funding LLC',
]) {
  assert.ok(
    clientsPage.includes(thirdPartyName) || disputeFlow.includes(thirdPartyName),
    `Legitimate third-party identity must be preserved: ${thirdPartyName}`,
  );
}

console.log('Site legal-identity assertions passed.');
