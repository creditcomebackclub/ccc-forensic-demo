import Ajv from 'ajv';
import {
  COMBINED_CREDIT_EXTRACTION_SCHEMA,
  CREDIT_ACCOUNT_FIELD_NAMES,
  CREDIT_BUREAU_EXTRACTION_SCHEMA,
} from './creditExtractionSchemas.js';

// Compact provider-output contract for the repeated 21-field account block.
// A tuple is [fieldIndex, stateCode, rawValue, numericValue, evidencePage,
// displayedLabel]. The short immutable index makes tuple order self-verifying:
// a provider cannot swap two values and have the decoder silently relabel
// them. Downstream code receives the original verbose objects after decode.
export const COMPACT_FIELD_STATE_CODES = Object.freeze({
  PRESENT: 'P',
  EXPLICITLY_BLANK: 'B',
  NOT_SHOWN: 'N',
  UNREADABLE: 'U',
});

const FIELD_STATE_BY_CODE = Object.freeze(Object.fromEntries(
  Object.entries(COMPACT_FIELD_STATE_CODES).map(([state, code]) => [code, state]),
));
const FIELD_NAME_SET = new Set(CREDIT_ACCOUNT_FIELD_NAMES);
const TUPLE_LENGTH = 6;

const NULLABLE_STRING = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const NULLABLE_NUMBER = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const NULLABLE_PAGE = { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] };

export const COMPACT_EXTRACTED_FIELD_TUPLE_SCHEMA = {
  type: 'array',
  minItems: TUPLE_LENGTH,
  maxItems: TUPLE_LENGTH,
  additionalItems: false,
  items: [
    { type: 'integer', minimum: 0, maximum: CREDIT_ACCOUNT_FIELD_NAMES.length - 1 },
    { type: 'string', enum: Object.values(COMPACT_FIELD_STATE_CODES) },
    NULLABLE_STRING,
    NULLABLE_NUMBER,
    NULLABLE_PAGE,
    NULLABLE_STRING,
  ],
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function compactBureauSchema() {
  const schema = cloneJson(CREDIT_BUREAU_EXTRACTION_SCHEMA);
  schema.properties.accounts.items.properties.fields = {
    type: 'array',
    minItems: CREDIT_ACCOUNT_FIELD_NAMES.length,
    maxItems: CREDIT_ACCOUNT_FIELD_NAMES.length,
    items: COMPACT_EXTRACTED_FIELD_TUPLE_SCHEMA,
    description: [
      `Exactly ${CREDIT_ACCOUNT_FIELD_NAMES.length} tuples in this fixed index/order: ${CREDIT_ACCOUNT_FIELD_NAMES.map((name, index) => `${index}=${name}`).join(', ')}.`,
      'Each tuple is [fieldIndex, stateCode, rawValue, numericValue, evidencePage, displayedLabel].',
      'State codes: P=PRESENT, B=EXPLICITLY_BLANK, N=NOT_SHOWN, U=UNREADABLE.',
    ].join(' '),
  };
  return schema;
}

export const COMPACT_CREDIT_BUREAU_EXTRACTION_SCHEMA = compactBureauSchema();
export const COMPACT_COMBINED_CREDIT_EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reports: { type: 'array', items: COMPACT_CREDIT_BUREAU_EXTRACTION_SCHEMA },
  },
  required: ['reports'],
};

const ajv = new Ajv({
  allErrors: true,
  strict: true,
  validateFormats: false,
});
const validators = Object.freeze({
  verboseBureau: ajv.compile(CREDIT_BUREAU_EXTRACTION_SCHEMA),
  verboseCombined: ajv.compile(COMBINED_CREDIT_EXTRACTION_SCHEMA),
  compactBureau: ajv.compile(COMPACT_CREDIT_BUREAU_EXTRACTION_SCHEMA),
  compactCombined: ajv.compile(COMPACT_COMBINED_CREDIT_EXTRACTION_SCHEMA),
});

function validationSummary(errors) {
  return (errors || []).slice(0, 8).map((error) => {
    const path = error.instancePath || '/';
    return `${path} ${error.message || 'is invalid'}`;
  }).join('; ');
}

function assertSchema(validate, value, label) {
  if (!validate(value)) {
    throw new Error(`${label} failed strict local validation: ${validationSummary(validate.errors)}`);
  }
}

function canonicalFieldMap(fields, accountIndex) {
  if (!Array.isArray(fields)) {
    throw new Error(`Account ${accountIndex + 1} extracted fields must be an array.`);
  }
  const byName = new Map();
  for (const field of fields) {
    const name = field?.name;
    if (!FIELD_NAME_SET.has(name)) {
      throw new Error(`Account ${accountIndex + 1} contains unsupported extracted field ${String(name)}.`);
    }
    if (byName.has(name)) {
      throw new Error(`Account ${accountIndex + 1} contains duplicate extracted field ${name}.`);
    }
    byName.set(name, field);
  }
  const missing = CREDIT_ACCOUNT_FIELD_NAMES.filter((name) => !byName.has(name));
  if (missing.length || byName.size !== CREDIT_ACCOUNT_FIELD_NAMES.length) {
    throw new Error(
      `Account ${accountIndex + 1} must contain exactly one of all ${CREDIT_ACCOUNT_FIELD_NAMES.length} extracted fields; missing: ${missing.join(', ') || 'none'}.`,
    );
  }
  return byName;
}

function encodeField(field, index) {
  const stateCode = COMPACT_FIELD_STATE_CODES[field.state];
  if (!stateCode) throw new Error(`Unsupported extracted field state ${String(field.state)}.`);
  return [index, stateCode, field.rawValue, field.numericValue, field.page, field.label];
}

function decodeField(tuple, index) {
  if (tuple[0] !== index) {
    throw new Error(`Compact extracted field index ${String(tuple[0])} does not match position ${index}.`);
  }
  const state = FIELD_STATE_BY_CODE[tuple[1]];
  if (!state) throw new Error(`Unsupported compact extracted field state code ${String(tuple[1])}.`);
  return {
    name: CREDIT_ACCOUNT_FIELD_NAMES[index],
    rawValue: tuple[2],
    numericValue: tuple[3],
    state,
    page: tuple[4],
    label: tuple[5],
  };
}

export function encodeCompactBureauExtraction(extraction) {
  const fieldMaps = (extraction?.accounts || []).map((account, index) => (
    canonicalFieldMap(account?.fields, index)
  ));
  assertSchema(validators.verboseBureau, extraction, 'Verbose bureau extraction');

  const compact = cloneJson(extraction);
  compact.accounts.forEach((account, index) => {
    account.fields = CREDIT_ACCOUNT_FIELD_NAMES.map((name, fieldIndex) => (
      encodeField(fieldMaps[index].get(name), fieldIndex)
    ));
  });
  assertSchema(validators.compactBureau, compact, 'Compact bureau extraction');
  return compact;
}

export function decodeCompactBureauExtraction(compact) {
  assertSchema(validators.compactBureau, compact, 'Compact bureau extraction');
  const verbose = cloneJson(compact);
  verbose.accounts.forEach((account) => {
    account.fields = account.fields.map(decodeField);
  });
  assertSchema(validators.verboseBureau, verbose, 'Decoded bureau extraction');
  verbose.accounts.forEach((account, index) => canonicalFieldMap(account.fields, index));
  return verbose;
}

export function encodeCompactCombinedExtraction(extraction) {
  assertSchema(validators.verboseCombined, extraction, 'Verbose combined extraction');
  const compact = {
    reports: extraction.reports.map(encodeCompactBureauExtraction),
  };
  assertSchema(validators.compactCombined, compact, 'Compact combined extraction');
  return compact;
}

export function decodeCompactCombinedExtraction(compact) {
  assertSchema(validators.compactCombined, compact, 'Compact combined extraction');
  const verbose = {
    reports: compact.reports.map(decodeCompactBureauExtraction),
  };
  assertSchema(validators.verboseCombined, verbose, 'Decoded combined extraction');
  return verbose;
}
