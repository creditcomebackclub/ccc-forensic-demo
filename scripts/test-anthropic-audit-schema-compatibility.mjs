#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COMBINED_CREDIT_EXTRACTION_SCHEMA,
  CREDIT_BUREAU_EXTRACTION_SCHEMA,
} from '../src/utils/creditExtractionSchemas.js';
import { ACCOUNT_ENRICHMENT_SCHEMA } from '../src/utils/auditSchemas.js';
import {
  anthropicJsonSchemaFormat,
  countAnthropicUnionParameters,
  parseAndValidateAnthropicJsonEnvelope,
  unwrapAnthropicJsonEnvelope,
  withLocalSchemaContract,
} from '../netlify/functions/_anthropicSchema.mjs';

const worker = readFileSync(new URL('../netlify/functions/audit-run-background.mjs', import.meta.url), 'utf8');

function collectKeys(value, found = new Set()) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectKeys(entry, found));
    return found;
  }
  for (const [key, entry] of Object.entries(value)) {
    found.add(key);
    collectKeys(entry, found);
  }
  return found;
}

const providerUnsupportedConstraintKeys = [
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'minLength', 'maxLength', 'maxItems', 'multipleOf',
];

// The source contracts deliberately remain richer than Anthropic's accepted
// structured-output dialect because CCC revalidates exact page and array
// invariants after parsing.
assert.equal(
  CREDIT_BUREAU_EXTRACTION_SCHEMA.properties.client.properties.nameEvidencePage.anyOf[0].minimum,
  1,
);
assert.equal(
  CREDIT_BUREAU_EXTRACTION_SCHEMA.properties.accounts.items.properties.fields.minItems,
  21,
);
assert.equal(
  CREDIT_BUREAU_EXTRACTION_SCHEMA.properties.accounts.items.properties.fields.maxItems,
  21,
);

for (const localSchema of [
  CREDIT_BUREAU_EXTRACTION_SCHEMA,
  COMBINED_CREDIT_EXTRACTION_SCHEMA,
  ACCOUNT_ENRICHMENT_SCHEMA,
]) {
  const before = JSON.stringify(localSchema);
  if (localSchema !== ACCOUNT_ENRICHMENT_SCHEMA) {
    assert.ok(countAnthropicUnionParameters(localSchema) > 16,
      'the regression fixture must prove the raw extraction contract exceeds Anthropic\'s union cap');
  }
  const format = anthropicJsonSchemaFormat();
  assert.equal(format.type, 'json_schema');
  assert.ok(format.schema && typeof format.schema === 'object');
  assert.equal(format.schema.additionalProperties, false);
  assert.equal(JSON.stringify(localSchema), before, 'provider transformation must not mutate CCC validation schemas');
  assert.equal(countAnthropicUnionParameters(format.schema), 0);
  assert.deepEqual(format.schema.required, ['payload']);
  assert.deepEqual(Object.keys(format.schema.properties), ['payload']);

  const providerKeys = collectKeys(format.schema);
  for (const key of providerUnsupportedConstraintKeys) {
    assert.equal(
      providerKeys.has(key),
      false,
      `provider schema must not send unsupported JSON Schema keyword ${key}`,
    );
  }

  const content = withLocalSchemaContract([{ type: 'text', text: 'Extract this report.' }], localSchema);
  assert.equal(content.length, 2);
  assert.match(content[1].text, /EXACT LOCAL VALIDATION SCHEMA:/);
  assert.match(content[1].text, /"required"/);
  assert.ok(content[1].text.endsWith(JSON.stringify(localSchema)));
}

assert.deepEqual(
  JSON.parse(unwrapAnthropicJsonEnvelope('{"payload":"{\\"reports\\":[]}"}')),
  { reports: [] },
);
assert.deepEqual(
  parseAndValidateAnthropicJsonEnvelope(
    '{"payload":"{\\"reports\\":[]}"}',
    COMBINED_CREDIT_EXTRACTION_SCHEMA,
  ),
  { reports: [] },
);
assert.throws(() => unwrapAnthropicJsonEnvelope('{"payload":7}'), /invalid structured-output payload envelope/i);
assert.throws(() => unwrapAnthropicJsonEnvelope('not json'), /invalid structured-output envelope/i);

const strictFixtureSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    state: { type: 'string', enum: ['PRESENT', 'NOT_SHOWN'] },
    page: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
  },
  required: ['state', 'page'],
};
const envelope = (value) => JSON.stringify({ payload: JSON.stringify(value) });
assert.deepEqual(
  parseAndValidateAnthropicJsonEnvelope(envelope({ state: 'PRESENT', page: 1 }), strictFixtureSchema),
  { state: 'PRESENT', page: 1 },
);
assert.throws(
  () => parseAndValidateAnthropicJsonEnvelope(envelope({ state: 'BOGUS', page: 1 }), strictFixtureSchema),
  /local validation contract/i,
);
assert.throws(
  () => parseAndValidateAnthropicJsonEnvelope(envelope({ state: 'PRESENT' }), strictFixtureSchema),
  /local validation contract/i,
);
assert.throws(
  () => parseAndValidateAnthropicJsonEnvelope(envelope({ state: 'PRESENT', page: 0 }), strictFixtureSchema),
  /local validation contract/i,
);
assert.throws(
  () => parseAndValidateAnthropicJsonEnvelope(envelope({ state: 'PRESENT', page: 1, extra: true }), strictFixtureSchema),
  /local validation contract/i,
);
assert.throws(
  () => parseAndValidateAnthropicJsonEnvelope('{"payload":"not json"}', strictFixtureSchema),
  /invalid JSON inside/i,
);

assert.match(worker, /anthropicJsonSchemaFormat\(\)/);
assert.match(worker, /withLocalSchemaContract\(userContent, schema\)/);
assert.match(worker, /parseAndValidateAnthropicJsonEnvelope\(providerText, schema\)/);
assert.match(worker, /schema:\s*providerSchema/);
assert.match(worker, /localSchemaSha256:/);
assert.match(worker, /isProviderInvalidRequestError\(error\)/);
assert.match(worker, /error\.auditTerminal\s*=\s*true/);
assert.match(worker, /error\.auditErrorType\s*=\s*['"]provider_invalid_request['"]/);
assert.match(worker, /error\?\.requestID/);
assert.match(worker, /e\.auditUserMessage\s*\|\|\s*e\.message/);
assert.doesNotMatch(
  worker,
  /params\.output_config\.format\s*=\s*\{\s*type:\s*['"]json_schema['"],\s*schema\s*\}/,
  'the audit worker must never send the untransformed local schema directly',
);

console.log('Anthropic audit structured-output schema compatibility tests passed.');
