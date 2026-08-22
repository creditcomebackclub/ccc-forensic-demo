import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CRA_TEMPLATE_FIELD_GROUPS,
  CRA_TEMPLATE_FLOWS,
  DIRECT_TEMPLATE_FIELD_GROUPS,
  consumerStatementTokenCount,
  disallowedTemplateTokensForFlow,
  hasMalformedTemplatePlaceholders,
  renderDisputeTemplate,
  templateAudienceForFlow,
  templateFieldGroupsForFlow,
  templateTokenCount,
  validateConsumerStatementContract,
  validateTemplateTokenContract,
} from '../src/utils/disputeTemplateEngine.js';

const craBody = 'Fixed law text.\n\n{consumer_statement}\n\nFixed demand text.';
const persistenceMigration = readFileSync(
  new URL('../supabase/migrations/20260820250000_enforce_template_curly_contract.sql', import.meta.url),
  'utf8',
);
const templatePersistenceSource = readFileSync(
  new URL('../src/utils/disputeTemplates.js', import.meta.url),
  'utf8',
);
assert.match(persistenceMigration, /dispute_template_token_contract_valid/);
assert.match(persistenceMigration, /dispute_templates_active_curly_contract/);
assert.match(persistenceMigration, /Retired by physical-recipient curly validation/);
assert.match(persistenceMigration, /v_consumer_statement_count <> 1/);
assert.match(persistenceMigration, /v_screenshot_count > 1/);
assert.match(persistenceMigration, /client_first_name.*creditor_name/s);
assert.match(templatePersistenceSource, /validateTemplateTokenContract/);
assert.match(templatePersistenceSource, /if \(tokenContractError\) throw new Error\(tokenContractError\)/);
const rendered = renderDisputeTemplate(craBody, {
  consumer_statement: 'Lost housing <script>alert("unsafe")</script> & paid more.\nPlease correct it.',
}, ['consumer_statement']);

assert.equal(
  (rendered.match(/data-ccc-section="consumer_statement"/g) || []).length,
  1,
  'a Consumer Statement curly renders exactly one semantic section',
);
assert.equal(
  (rendered.match(/Consumer Statement:<\/h2>/g) || []).length,
  1,
  'the renderer owns one fixed visible Consumer Statement heading',
);
assert.match(rendered, /Lost housing &lt;script&gt;alert\(&quot;unsafe&quot;\)&lt;\/script&gt; &amp; paid more\.<br>Please correct it\./);
assert.doesNotMatch(rendered, /<script>/, 'Consumer Statement text stays escaped even if incorrectly listed as safe HTML');
assert.match(rendered, /Fixed law text\./);
assert.match(rendered, /Fixed demand text\./);

const duplicateRendered = renderDisputeTemplate('{consumer_statement}\n{consumer_statement}', {
  consumer_statement: 'Confirmed facts only.',
});
assert.equal((duplicateRendered.match(/data-ccc-section="consumer_statement"/g) || []).length, 1);
assert.equal((duplicateRendered.match(/Confirmed facts only\./g) || []).length, 1);
assert.equal(consumerStatementTokenCount('{{ Consumer Statement }}\n{consumer-statement}'), 2);
assert.equal(templateTokenCount('{screenshots}\n{{ screenshots }}', 'screenshots'), 2);
assert.match(
  validateTemplateTokenContract({ flow: 'accuracy', body: `${craBody}\n{screenshots}\nFixed closing`, active: true }),
  /final template field/,
);
assert.match(
  validateTemplateTokenContract({ flow: 'accuracy', body: `${craBody}\n{screenshots}\n{screenshots}`, active: true }),
  /at most one/,
);
assert.equal(
  validateTemplateTokenContract({ flow: 'accuracy', body: `${craBody}\n{screenshots}`, active: true }),
  null,
);
assert.equal(hasMalformedTemplatePlaceholders('{client_first_name} {{ client_last_name }}'), false);
for (const malformed of ['{client.first_name}', '{{client_name}', '{client_name', 'client_name}']) {
  assert.equal(hasMalformedTemplatePlaceholders(malformed), true, `${malformed} must fail closed`);
  assert.match(
    validateTemplateTokenContract({ flow: 'accuracy', body: `${craBody}\n${malformed}`, active: true }),
    /malformed curly/,
  );
}

const missingValue = renderDisputeTemplate('{consumer_statement}', {});
assert.match(missingValue, /Consumer Statement:<\/h2>/);
assert.match(missingValue, /data-missing-token="consumer_statement"/);

assert.equal(validateConsumerStatementContract({ flow: 'accuracy', body: craBody, active: true }), null);
assert.match(
  validateConsumerStatementContract({ flow: 'combo', body: 'Fixed law only.', active: true }),
  /must contain one \{consumer_statement\}/,
);
assert.match(
  validateConsumerStatementContract({ flow: 'collection', body: '{consumer_statement}\n{consumer_statement}', active: true }),
  /must contain exactly one/,
);
assert.equal(
  validateConsumerStatementContract({ flow: 'accuracy', body: 'Retired legacy template.', active: false }),
  null,
  'retired CRA history is not blocked by the active-template contract',
);
assert.equal(validateConsumerStatementContract({ flow: 'direct', body: 'Direct fixed law.', active: true }), null);
assert.match(
  validateConsumerStatementContract({ flow: 'direct', body: '{consumer_statement}', active: false }),
  /bureau\/CRA-only/,
  'direct templates can never contain a Consumer Statement curly',
);

assert.ok(templateFieldGroupsForFlow('accuracy').human.includes('consumer_statement'));
assert.ok(!templateFieldGroupsForFlow('direct').human.includes('consumer_statement'));

const sharedAutomatic = [
  'client_first_name', 'client_last_name', 'client_name', 'client_address', 'curr_date',
];
const craOnlyAutomatic = [
  'ss_number', 'bdate', 'bureau_address', 'bureau_name',
  'dispute_item_and_explanation', 'account_list', 'report_date', 'screenshots',
];
const directOnlyAutomatic = [
  'creditor_name', 'creditor_address', 'creditor_city', 'creditor_state',
  'creditor_zip', 'account_number',
];
const sharedHuman = ['damages', 'personalization', 'penalty', 'optional_strengthener'];

assert.deepEqual(CRA_TEMPLATE_FIELD_GROUPS.automatic, [...sharedAutomatic, ...craOnlyAutomatic]);
assert.deepEqual(CRA_TEMPLATE_FIELD_GROUPS.human, [...sharedHuman, 'consumer_statement']);
assert.deepEqual(DIRECT_TEMPLATE_FIELD_GROUPS.automatic, [...sharedAutomatic, ...directOnlyAutomatic]);
assert.deepEqual(DIRECT_TEMPLATE_FIELD_GROUPS.human, sharedHuman);

for (const flow of CRA_TEMPLATE_FLOWS) {
  assert.equal(templateAudienceForFlow(flow), 'cra', `${flow} must resolve to a CRA recipient`);
  assert.deepEqual(templateFieldGroupsForFlow(flow), {
    automatic: [...sharedAutomatic, ...craOnlyAutomatic],
    human: [...sharedHuman, 'consumer_statement'],
  }, `${flow} must expose only CRA curlys`);
  assert.deepEqual(
    disallowedTemplateTokensForFlow(flow, [...sharedAutomatic, ...craOnlyAutomatic, ...sharedHuman, 'consumer_statement']
      .map((token) => `{${token}}`).join('\n')),
    [],
    `${flow} CRA allowlist must accept every advertised curly`,
  );
  assert.deepEqual(
    disallowedTemplateTokensForFlow(flow, directOnlyAutomatic.map((token) => `{${token}}`).join('\n')),
    directOnlyAutomatic,
    `${flow} cannot address a collector`,
  );
  for (const token of directOnlyAutomatic) {
    assert.match(
      validateTemplateTokenContract({ flow, body: `{consumer_statement}\n{${token}}`, active: true }),
      new RegExp(`\\{${token}\\}`),
      `${flow} must fail closed on collector curly {${token}}`,
    );
  }
}

assert.equal(templateAudienceForFlow('direct'), 'direct');
assert.deepEqual(templateFieldGroupsForFlow('direct'), {
  automatic: [...sharedAutomatic, ...directOnlyAutomatic],
  human: sharedHuman,
});
assert.deepEqual(
  disallowedTemplateTokensForFlow('direct', [...sharedAutomatic, ...directOnlyAutomatic, ...sharedHuman]
    .map((token) => `{${token}}`).join('\n')),
  [],
  'Direct allowlist accepts client/date, exact creditor/account, and human authoring curlys',
);
assert.deepEqual(
  disallowedTemplateTokensForFlow('direct', [...craOnlyAutomatic, 'consumer_statement']
    .map((token) => `{${token}}`).join('\n')),
  [...craOnlyAutomatic, 'consumer_statement'],
  'Direct templates cannot expose CRA identity, bureau, report, account-list, or screenshot data',
);
for (const token of craOnlyAutomatic) {
  assert.match(
    validateTemplateTokenContract({ flow: 'direct', body: `{${token}}`, active: true }),
    new RegExp(`\\{${token}\\}`),
    `Direct must fail closed on CRA curly {${token}}`,
  );
}

assert.equal(
  validateTemplateTokenContract({
    flow: 'direct',
    body: [...sharedAutomatic, ...directOnlyAutomatic, ...sharedHuman].map((token) => `{${token}}`).join('\n'),
    active: true,
  }),
  null,
);
assert.equal(
  validateTemplateTokenContract({
    flow: 'accuracy',
    body: [...sharedAutomatic, ...craOnlyAutomatic.filter((token) => token !== 'screenshots'), ...sharedHuman, 'consumer_statement', 'screenshots']
      .map((token) => `{${token}}`).join('\n'),
    active: true,
  }),
  null,
);
assert.match(
  validateTemplateTokenContract({ flow: 'direct', body: '{consumer_statement}', active: false }),
  /bureau\/CRA-only/,
  'Direct Consumer Statements remain forbidden even on retired templates',
);
assert.match(
  validateTemplateTokenContract({ flow: 'accuracy', body: '{consumer_statement}\n{totally_unknown}', active: true }),
  /\{totally_unknown\}/,
  'unknown curlys fail closed after the Consumer Statement contract passes',
);
assert.equal(
  validateTemplateTokenContract({ flow: 'accuracy', body: 'Retired historical fixed text.', active: false }),
  null,
  'retired CRA history may predate Consumer Statements but still uses the recipient allowlist',
);
assert.match(
  validateTemplateTokenContract({ flow: 'accuracy', body: '{creditor_name}', active: false }),
  /\{creditor_name\}/,
  'retirement never permits cross-recipient curlys',
);
assert.deepEqual(templateFieldGroupsForFlow('not_a_flow'), { automatic: [], human: [] });
assert.equal(templateAudienceForFlow('not_a_flow'), null);
assert.match(
  validateTemplateTokenContract({ flow: 'not_a_flow', body: '{client_name}', active: true }),
  /Unknown physical template flow/,
  'unknown physical flows fail closed before authoring or save',
);

const seedSource = readFileSync(
  new URL('../supabase/migrations/20260820120000_seed_ccc_template_library_v1.sql', import.meta.url),
  'utf8',
);
const seedTemplates = [];
const seedMarker = /^-- CCC-TEMPLATE (.+)$/gm;
let seedMatch;
while ((seedMatch = seedMarker.exec(seedSource))) {
  const metadata = JSON.parse(seedMatch[1]);
  const nextMarker = seedSource.indexOf('\n-- CCC-TEMPLATE ', seedMarker.lastIndex);
  const block = seedSource.slice(seedMarker.lastIndex, nextMarker < 0 ? seedSource.length : nextMarker);
  const opening = block.match(/'v1', (\$ccc_\d+\$)/);
  assert.ok(opening, `${metadata.key}: seeded body opening tag is missing`);
  const bodyStart = opening.index + opening[0].length;
  const bodyEnd = block.indexOf(opening[1], bodyStart);
  assert.notEqual(bodyEnd, -1, `${metadata.key}: seeded body closing tag is missing`);
  seedTemplates.push({ metadata, body: block.slice(bodyStart, bodyEnd) });
}
assert.equal(seedTemplates.length, 38, 'all 38 physical CCC templates must be checked against their recipient allowlist');
for (const { metadata, body } of seedTemplates) {
  assert.equal(
    validateTemplateTokenContract({ flow: metadata.flow, body, active: true }),
    null,
    `${metadata.key}: seeded physical template violates its ${metadata.flow === 'direct' ? 'collector' : 'CRA'} curly contract`,
  );
}

const librarySource = readFileSync(
  new URL('../src/components/DisputeTemplateLibrary.jsx', import.meta.url),
  'utf8',
);
assert.match(librarySource, /templateFieldGroupsForFlow\(draft\.flow\)/, 'Library picker must use the recipient-scoped allowlist');
assert.match(librarySource, /validateTemplateTokenContract\(\{[\s\S]*?flow: draft\.flow,[\s\S]*?body: draft\.body/, 'Library must validate the physical recipient before save');
assert.match(librarySource, /if \(templateTokenContractError \|\| screenshotPolicyError\)/, 'save handler must fail closed on a token-contract error');
assert.match(librarySource, /Boolean\(templateTokenContractError\)/, 'save control must stay disabled while the token contract fails');

console.log('Physical template curly allowlists, Consumer Statement render, and Letter Library save contract tests passed.');
