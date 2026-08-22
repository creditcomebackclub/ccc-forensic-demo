import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  TEMPLATE_FIELD_GROUPS,
  buildAutomaticTemplateValues,
  accountsMissingConfirmedDisputeFacts,
  formatDateOfBirth,
  maskAccountNumber,
  splitClientName,
  extractTemplateTokens,
  unknownTemplateTokens,
} from '../src/utils/disputeTemplateEngine.js';
import { FLOW_LETTER_ROUNDS, FLOW_SEQUENCES } from '../src/utils/disputeFlow.js';

const migrationPath = new URL('../supabase/migrations/20260820120000_seed_ccc_template_library_v1.sql', import.meta.url);
const sql = readFileSync(migrationPath, 'utf8');
const globalConsumerStatementSql = readFileSync(
  new URL('../supabase/migrations/20260820170000_require_personal_statement.sql', import.meta.url),
  'utf8',
);
const craConsumerStatementSql = readFileSync(
  new URL('../supabase/migrations/20260820180000_scope_consumer_statement_to_cra.sql', import.meta.url),
  'utf8',
);
const screenshotPolicySql = readFileSync(
  new URL('../supabase/migrations/20260820200000_course_screenshot_policies.sql', import.meta.url),
  'utf8',
);

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
    const idMatch = block.match(/\(\s*'([0-9a-f-]{36})'\s*,\s*null\s*,/i);
    assert.ok(idMatch, `${metadata.key}: deterministic source id is missing`);
    const bodyStart = opening.index + opening[0].length;
    const bodyEnd = block.indexOf(opening[1], bodyStart);
    assert.notEqual(bodyEnd, -1, `${metadata.key}: body closing tag is missing`);
    records.push({ id: idMatch[1].toLowerCase(), metadata, body: block.slice(bodyStart, bodyEnd) });
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
assert.equal(sampleAutomaticValues.account_number, '****9876');
assert.match(sampleAutomaticValues.dispute_item_and_explanation, /Example Bank/);
assert.equal(maskAccountNumber('4111 1111 1111 1111'), '****1111');
assert.equal(maskAccountNumber('***9876'), '****9876');
assert.equal(maskAccountNumber('A-12'), '', 'short account identifiers must not be printed');
assert.deepEqual(accountsMissingConfirmedDisputeFacts([
  { furnisher: 'Confirmed', primaryViolation: 'Balance mismatch' },
  { furnisher: 'Missing', violations: [] },
]), [{ furnisher: 'Missing', violations: [] }]);
const fullSsnIsStillMasked = buildAutomaticTemplateValues({ identity: { ssnLast4: '123-45-6789' } });
assert.equal(fullSsnIsStillMasked.ss_number, '***-**-6789');
const partialSsnIsBlocked = buildAutomaticTemplateValues({ identity: { ssnLast4: '789' } });
assert.equal(partialSsnIsBlocked.ss_number, '');
const rawAccountIsMaskedInList = buildAutomaticTemplateValues({
  accounts: [{ furnisher: 'Raw Account', accountNumber: '5555444433332222', primaryViolation: 'Status mismatch' }],
});
assert.match(rawAccountIsMaskedInList.dispute_item_and_explanation, /\*\*\*\*2222/);
assert.doesNotMatch(rawAccountIsMaskedInList.dispute_item_and_explanation, /5555444433332222/);
assert.equal(formatDateOfBirth('1990-01-02'), 'January 2, 1990');
assert.equal(formatDateOfBirth('01/02/1990'), 'January 2, 1990');
assert.equal(formatDateOfBirth('January 2nd, 1990'), 'January 2, 1990');
assert.equal(formatDateOfBirth('February 30, 1990'), '');
assert.equal(formatDateOfBirth('not-a-date'), '');
assert.deepEqual(splitClientName('Avery Sample Consumer'), { first: 'Avery', last: 'Sample Consumer' });
assert.deepEqual(splitClientName('Prince'), { first: 'Prince', last: '' });

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
  assert.equal(
    bodyTokens.includes('consumer_statement'),
    metadata.flow !== 'direct',
    `${metadata.key}: Consumer Statement scope must match the original CRA/direct course flow`,
  );

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
assert.match(globalConsumerStatementSql, /dispute_templates_active_personal_statement/);
assert.match(craConsumerStatementSql, /8341ad23-49f5-505d-a05d-23a0202b5746/);
assert.match(craConsumerStatementSql, /d0a64f13-9e1f-55e4-867c-c38fc3f39e41/);
assert.match(craConsumerStatementSql, /created_by is null/);
assert.match(craConsumerStatementSql, /flow_code = 'direct'/);
assert.match(craConsumerStatementSql, /right\(body_text,[\s\S]*\{consumer_statement\}/);
assert.match(craConsumerStatementSql, /Team field required: consumer_statement/);
assert.match(craConsumerStatementSql, /drop constraint if exists dispute_templates_active_personal_statement/);
assert.match(craConsumerStatementSql, /dispute_templates_active_cra_consumer_statement/);
assert.match(craConsumerStatementSql, /created_by is not null[\s\S]*flow_code = 'direct'[\s\S]*body_text like '%\{consumer_statement\}%'/);
assert.doesNotMatch(craConsumerStatementSql, /disable trigger/i, 'the correction must preserve used-template immutability');
assert.match(craConsumerStatementSql, /if exists \([\s\S]*letter\.dispute_template_id = source_template\.id[\s\S]*insert into public\.dispute_templates/i, 'used direct templates must receive a successor version');
assert.match(craConsumerStatementSql, /supersedes_template_id/, 'the corrective version must retain lineage');

const expectedScreenshotPolicies = Object.fromEntries(templates.map(({ metadata }) => [metadata.key, 'none']));
Object.assign(expectedScreenshotPolicies, {
  'ACC-R2-v1': 'cross_bureau_mismatch',
  'ACC-R3-v1': 'inaccurate_accounts',
  'ACC-R4-v1': 'inaccurate_accounts',
  'ACC-R7-v1': 'prior_consumer_statement_comments',
  'ACC-R8-v1': 'inaccurate_accounts',
  'ACC-R9-v1': 'mismatching_accounts',
  'ACC-R10-v1': 'closure_status',
  'ACC-SOLO-R1-v1': 'dispute_comments',
  'COMBO-R2-v1': 'cross_bureau_mismatch',
  'COMBO-R3-v1': 'inaccurate_accounts',
  'COMBO-R4-v1': 'inaccurate_accounts',
  'COMBO-R8-v1': 'inaccurate_accounts',
  'COMBO-R9-v1': 'mismatching_accounts',
  'COMBO-R10-v1': 'closure_status',
});

const policyById = new Map();
const policyTuple = /\('([0-9a-f-]{36})'::uuid, '([a-z_]+)', (?:null|'(?:''|[^'])*')\)/gi;
let policyMatch;
while ((policyMatch = policyTuple.exec(screenshotPolicySql))) {
  policyById.set(policyMatch[1].toLowerCase(), policyMatch[2]);
}
assert.equal(policyById.size, 22, 'every Accuracy, Accuracy Solo, and dedicated Combo template needs explicit source policy metadata');
assert.match(
  screenshotPolicySql,
  /flow_code in \('collection', 'consent', 'late_pay', 'direct'\)/,
  'all non-evidence source flows must be explicitly defaulted to no screenshots',
);

const falsePositiveScreenshotKeys = new Set([
  'ACC-R1-v1',
  'ACC-R5-v1',
  'ACC-R6-v1',
  'ACC-R11-v1',
  'ACC-R12-v1',
  'COMBO-R1-v1',
  'COMBO-R11-v1',
  'COMBO-R12-v1',
]);
const genericScreenshotBlock = /\n— — — SCREENSHOTS — ACCURACY \/ COMBO ONLY — — —\nThe information below consists of screenshots taken directly from my credit report showing the inaccurate accounts described in this dispute\.\n\n\{screenshots\}\s*$/i;
const falsePositiveIds = new Set();
for (const { id, metadata, body } of templates) {
  const actualPolicy = policyById.get(id)
    || (['collection', 'consent', 'late_pay', 'direct'].includes(metadata.flow) ? 'none' : undefined);
  assert.equal(actualPolicy, expectedScreenshotPolicies[metadata.key], `${metadata.key}: course screenshot policy changed`);
  const hasPlacementToken = extractTemplateTokens(body).includes('screenshots');
  if (expectedScreenshotPolicies[metadata.key] !== 'none') {
    assert.equal(hasPlacementToken, true, `${metadata.key}: required exhibits lost their preview placement token`);
  } else if (hasPlacementToken) {
    assert.equal(falsePositiveScreenshotKeys.has(metadata.key), true, `${metadata.key}: unexplained no-policy screenshot token`);
    assert.match(body, genericScreenshotBlock, `${metadata.key}: false-positive block cannot be removed safely`);
    assert.doesNotMatch(body.replace(genericScreenshotBlock, ''), /\{screenshots\}/, `${metadata.key}: correction must remove the whole placement block`);
    falsePositiveIds.add(id);
  }
}
assert.equal(falsePositiveScreenshotKeys.size, 8);
const correctionSourceIds = new Set();
const correctionTuple = /\('([0-9a-f-]{36})'::uuid, '[0-9a-f-]{36}'::uuid\)/gi;
let correctionMatch;
while ((correctionMatch = correctionTuple.exec(screenshotPolicySql))) correctionSourceIds.add(correctionMatch[1].toLowerCase());
assert.deepEqual([...correctionSourceIds].sort(), [...falsePositiveIds].sort(), 'the forward migration must correct exactly the eight false-positive source bodies');
assert.match(screenshotPolicySql, /if exists \([\s\S]*public\.letters[\s\S]*dispute_template_id = source_template\.id/);
assert.match(screenshotPolicySql, /successor_id[\s\S]*supersedes_template_id/);
assert.match(screenshotPolicySql, /prevent_used_dispute_template_rewrite[\s\S]*old\.screenshot_policy_code[\s\S]*old\.screenshot_staff_instructions/);
assert.match(screenshotPolicySql, /dispute_screenshot_policy_snapshot jsonb not null default '\{\}'::jsonb/);
assert.match(screenshotPolicySql, /letters_dispute_screenshot_policy_snapshot_contract[\s\S]*staffInstructions/);
assert.match(screenshotPolicySql, /prevent_dispute_screenshot_policy_snapshot_rewrite/);
assert.match(screenshotPolicySql, /The screenshots merge token controls placement only/);

console.log('CCC 38-template library, CRA-only Consumer Statement, exact course screenshot policies, law signatures, and curly contracts passed.');
