import Ajv from 'ajv';

const ANTHROPIC_JSON_ENVELOPE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    payload: {
      type: 'string',
      description: 'A JSON-serialized object matching the exact local validation contract supplied in the user message. No Markdown fences.',
    },
  },
  required: ['payload'],
});

const ajv = new Ajv({
  allErrors: true,
  strict: true,
  validateFormats: false,
});
const localValidators = new WeakMap();

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function countAnthropicUnionParameters(value) {
  if (!value || typeof value !== 'object') return 0;
  if (Array.isArray(value)) {
    return value.reduce((sum, entry) => sum + countAnthropicUnionParameters(entry), 0);
  }
  let count = Array.isArray(value.anyOf) || Array.isArray(value.type) ? 1 : 0;
  for (const entry of Object.values(value)) count += countAnthropicUnionParameters(entry);
  return count;
}

// The complete extraction contract is intentionally too large for
// Anthropic's grammar compiler (and contains locally enforced constraints
// that its JSON-schema dialect rejects). Use one tiny strict envelope so the
// provider always returns parseable outer JSON, while the full unchanged
// contract travels in the prompt and CCC validates the decoded payload.
export function anthropicJsonSchemaFormat() {
  return {
    type: 'json_schema',
    schema: deepClone(ANTHROPIC_JSON_ENVELOPE_SCHEMA),
  };
}

export function withLocalSchemaContract(userContent, localSchema) {
  if (!localSchema || typeof localSchema !== 'object') return userContent;
  const contractInstruction = {
    type: 'text',
    text: [
      'OUTPUT CONTRACT:',
      'Return exactly one object with exactly one property named payload.',
      'payload must be a JSON-encoded string. Decode that string once and the result must be the object described by the exact local validation schema below.',
      'Do not place Markdown fences, commentary, or any text outside the JSON encoded inside payload.',
      'Use null exactly where the contract permits null. Include every required property.',
      'EXACT LOCAL VALIDATION SCHEMA:',
      JSON.stringify(localSchema),
    ].join('\n'),
  };
  if (Array.isArray(userContent)) return [...userContent, contractInstruction];
  if (typeof userContent === 'string') {
    return [{ type: 'text', text: userContent }, contractInstruction];
  }
  throw new Error('Anthropic structured-output content must be text or a content-block array.');
}

export function unwrapAnthropicJsonEnvelope(text) {
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new Error('Anthropic returned an invalid structured-output envelope.');
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
      || Object.keys(envelope).length !== 1 || typeof envelope.payload !== 'string') {
    throw new Error('Anthropic returned an invalid structured-output payload envelope.');
  }
  return envelope.payload;
}

function localValidator(schema) {
  let validator = localValidators.get(schema);
  if (!validator) {
    validator = ajv.compile(schema);
    localValidators.set(schema, validator);
  }
  return validator;
}

function validationSummary(errors) {
  return (errors || []).slice(0, 6).map((error) => {
    const path = error.instancePath || '/';
    return `${path} ${error.message || 'is invalid'}`;
  }).join('; ');
}

export function parseAndValidateAnthropicJsonEnvelope(text, localSchema) {
  const payload = unwrapAnthropicJsonEnvelope(text);
  let decoded;
  try {
    decoded = JSON.parse(payload);
  } catch {
    throw new Error('Anthropic returned invalid JSON inside the structured-output envelope.');
  }
  if (!localSchema || typeof localSchema !== 'object') {
    throw new Error('A local validation schema is required for Anthropic structured output.');
  }
  const validate = localValidator(localSchema);
  if (!validate(decoded)) {
    throw new Error(`Anthropic output did not match CCC's local validation contract: ${validationSummary(validate.errors)}`);
  }
  return decoded;
}
