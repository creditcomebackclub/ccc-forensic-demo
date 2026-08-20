import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  TEMPLATE_FIELD_GROUPS,
  buildAutomaticTemplateValues,
  extractTemplateTokens,
  unknownTemplateTokens,
} from '../src/utils/disputeTemplateEngine.js';
import { FLOW_LETTER_ROUNDS, FLOW_SEQUENCES } from '../src/utils/disputeFlow.js';

const migrationPath = new URL('../supabase/migrations/20260820120000_seed_ccc_template_library_v1.sql', import.meta.url);
const sql = readFileSync(migrationPath, 'utf8');

function parseTemplates(source) {
  const records = [];
  const marker = /^-- CCC-TEMPLATE (.+)$/gm;
  let match;
  while ((match = marker.exec(source))) {
    const metadata = JSON.parse(match[1]);
    const nextMarker = source.indexOf('\n-- CCC-TEMPLATE ', marker.lastIndex);
    const block = source.slice(marker.lastIndex, nextMarker < 0 ? source.length : nextMarker);
    const opening = block.match(/'v1', (\$ccc_\d+\$)/);
    assert.ok(opening, `${metadata.key}: body opening tag is missing`);
    const bodyStart = opening.index + opening[0].length;
    const bodyEnd = block.indexOf(opening[1], bodyStart);
    assert.notEqual(bodyEnd, -1, `${metadata.key}: body closing tag is missing`);
    records.push({ metadata, body: block.slice(bodyStart, bodyEnd) });
  }
  return records;
}

const templates = parseTemplates(sql);
assert.equal(templates.length, 38, 'the source-controlled CCC library must contain exactly 38 templates');

const expectedCounts = {
  accuracy: 12,
  collection: 10,
  combo: 9,
  consent: 3,
  late_pay: 1,
  direct: 2,
  accuracy_solo: 1,
};
const actualCounts = Object.fromEntries(Object.keys(expectedCounts).map((flow) => [
  flow,
  templates.filter(({ metadata }) => metadata.flow === flow).length,
]));
assert.deepEqual(actualCounts, expectedCounts, 'template count by course flow changed');
assert.equal(new Set(templates.map(({ metadata }) => metadata.key)).size, 38, 'template keys must be unique');

const knownTokens = new Set(Object.values(TEMPLATE_FIELD_GROUPS).flat());
const craAutoTokens = [
  'client_first_name', 'client_last_name', 'client_address', 'ss_number', 'bdate',
  'bureau_address', 'curr_date', 'dispute_item_and_explanation',
];
const directAutoTokens = [
  'client_first_name', 'client_last_name', 'client_address', 'curr_date',
  'creditor_name', 'creditor_address', 'creditor_city', 'creditor_state',
  'creditor_zip', 'account_number',
];
const sampleAutomaticValues = buildAutomaticTemplateValues({
  identity: {
    name: 'Avery Sample Consumer',
    address: '123 Sample Street\nPhoenix, AZ 85001',
    ssnLast4: '6789',
    dateOfBirth: 'January 2, 1990',
  },
  audit: { client: { reportDate: 'August 18, 2026' } },
  bureau: { name: 'TransUnion', address: 'P.O. Box 2000\nChester, PA 19016' },
  accounts: [{ id: 'account-1', furnisher: 'Example Bank', accountNumberMasked: '***1234', primaryViolation: 'Balance mismatch' }],
  creditor: {
    name: 'Example Collector',
    address: '456 Collector Way',
    city: 'Phoenix',
    state: 'AZ',
    zip: '85002',
    accountNumberMasked: '***9876',
  },
  currentDate: new Date('2026-08-20T12:00:00Z'),
});
assert.equal(sampleAutomaticValues.client_first_name, 'Avery');
assert.equal(sampleAutomaticValues.client_last_name, 'Sample Consumer');
assert.equal(sampleAutomaticValues.ss_number, '***-**-6789');
assert.equal(sampleAutomaticValues.bureau_name, 'TransUnion');
assert.equal(sampleAutomaticValues.creditor_name, 'Example Collector');
assert.equal(sampleAutomaticValues.account_number, '***9876');
assert.match(sampleAutomaticValues.dispute_item_and_explanation, /Example Bank/);

for (const { metadata, body } of templates) {
  const hash = createHash('sha256').update(body).digest('hex');
  assert.equal(hash, metadata.bodySha256, `${metadata.key}: fixed text or curly placement drifted`);

  const bodyTokens = extractTemplateTokens(body);
  const unsupported = bodyTokens.filter((token) => !knownTokens.has(token));
  assert.deepEqual(unsupported, [], `${metadata.key}: unsupported curlys would render unpopulated`);
  const populatedValues = {
    ...sampleAutomaticValues,
    ...Object.fromEntries(TEMPLATE_FIELD_GROUPS.human.map((token) => [token, `Confirmed ${token}`])),
  };
  assert.deepEqual(unknownTemplateTokens(body, populatedValues), [], `${metadata.key}: a curly has no population contract`);

  for (const token of metadata.sourceTokens) {
    if (!metadata.exampleOnlyTokens.includes(token)) {
      assert.ok(bodyTokens.includes(token), `${metadata.key}: source curly {${token}} was lost`);
    }
  }
  for (const token of metadata.humanTokens) {
    assert.ok(bodyTokens.includes(token), `${metadata.key}: team field {${token}} is missing`);
  }

  const requiredAutoTokens = metadata.flow === 'direct' ? directAutoTokens : craAutoTokens;
  for (const token of requiredAutoTokens) {
    assert.ok(bodyTokens.includes(token), `${metadata.key}: required automatic curly {${token}} is missing`);
  }
  assert.ok(bodyTokens.includes('damages'), `${metadata.key}: damages authoring field is missing`);
  assert.ok(bodyTokens.includes('penalty'), `${metadata.key}: penalty authoring field is missing`);
  if (metadata.flow !== 'direct') {
    assert.ok(bodyTokens.includes('consumer_statement'), `${metadata.key}: consumer statement field is missing`);
  }

  const needsScreenshots = ['accuracy', 'combo', 'accuracy_solo'].includes(metadata.flow);
  assert.equal(bodyTokens.includes('screenshots'), needsScreenshots, `${metadata.key}: screenshot requirement changed`);
  assert.ok(metadata.round >= 1 && metadata.round <= FLOW_LETTER_ROUNDS[metadata.flow], `${metadata.key}: invalid round metadata`);
  assert.ok(FLOW_SEQUENCES[metadata.flow]?.[metadata.round - 1], `${metadata.key}: flow sequence label is missing`);
}

const lawSignatures = {
  'ACC-R1-v1': ['FACTUAL DISPUTE'],
  'ACC-R2-v1': ['1681e(b)'],
  'ACC-R3-v1': ['1681i(a)(5)'],
  'ACC-R4-v1': ['1681i(a)(1)(A)'],
  'ACC-R5-v1': ['1681i(a)(7)'],
  'ACC-R6-v1': ['1681i(a)(6)(B)'],
  'ACC-R7-v1': ['1681i(c)'],
  'ACC-R8-v1': ['1681s-2', '1681i(a)(2)(A)'],
  'ACC-R9-v1': ['1681(b)', '1681e(b)', '1681i(a)'],
  'ACC-R10-v1': ['1681c(e)'],
  'ACC-R11-v1': ['1681e(b)', 'discharged debt'],
  'ACC-R12-v1': ['1681o', '1681n'],
  'ACC-SOLO-R1-v1': ['1681c(f)'],
  'COL-R1-v1': ['1692g'],
  'COL-R2-v1': ['1692g(b)'],
  'COL-R3-v1': ['1692j'],
  'COL-R4-v1': ['1681a(m)'],
  'COL-R5-v1': ['1681(b)'],
  'COL-R6-v1': ['1692e(10)'],
  'COL-R7-v1': ['1681q'],
  'COL-R8-v1': ['1692c(c)'],
  'COL-R9-v1': ['1681b(a)(3)(A)'],
  'COL-R10-v1': ['1692k'],
  'COMBO-R1-v1': ['INACCURATE REPORTING', '1692g'],
  'COMBO-R2-v1': ['1681e(b)', '1692g(b)'],
  'COMBO-R3-v1': ['1681i(a)(5)', '1692j'],
  'COMBO-R4-v1': ['1681i(a)(1)(A)', '1681a(m)'],
  'COMBO-R8-v1': ['1681s-2(b)', '1681(b)'],
  'COMBO-R9-v1': ['1681(b)', '1692e(10)'],
  'COMBO-R10-v1': ['1681c(e)', '1681q'],
  'COMBO-R11-v1': ['1681e(b)', '1692c(c)'],
  'COMBO-R12-v1': ['1681o', '1681n'],
  'CON-R1-v1': ['1681b(a)(2)'],
  'CON-R2-v1': ['1681(a)(4)'],
  'CON-R3-v1': ['1681a(d)(2)(B)'],
  'DIRECT-R1-v1': ['1692g(b)'],
  'DIRECT-R2-v1': ['1692g(b)', '1692e(10)'],
  'LP-R1-v1': ['1681a(d)(a)(2)(a)(i)'],
};
assert.deepEqual(
  [...Object.keys(lawSignatures)].sort(),
  templates.map(({ metadata }) => metadata.key).sort(),
  'every library entry needs an explicit law-sequence regression signature',
);
for (const { metadata, body } of templates) {
  for (const signature of lawSignatures[metadata.key]) {
    assert.ok(body.toLowerCase().includes(signature.toLowerCase()), `${metadata.key}: law signature ${signature} changed`);
  }
}

assert.doesNotMatch(sql, /►►|EXAMPLE OF THE RIGHT LENGTH|THIS LETTER GOES TO THE DEBT COLLECTOR/i);
assert.doesNotMatch(sql, /backdate|CFPB complaint/i, 'CCC does not backdate or assert parallel CFPB complaints');
assert.match(sql, /created_by drop not null/, 'system-seeded templates need an auditable null creator');
assert.equal((sql.match(/on conflict \(id\) do update set/g) || []).length, 38, 'every seed row must remain idempotent');

console.log('CCC 38-template library, law signatures, and curly contracts passed.');
