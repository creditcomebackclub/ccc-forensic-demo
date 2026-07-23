// JSON Schemas for structured outputs — mirror the output contracts documented
// in masterPrompt.js §10. With output_config.format the API guarantees the
// response parses and matches these shapes, eliminating the old
// regex-scrape-and-pray JSON extraction failure mode.

const NULLABLE_STRING = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const NULLABLE_NUMBER = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const BUREAUS = { type: 'array', items: { type: 'string', enum: ['EQ', 'EXP', 'TU'] } };

const VIOLATION = {
  type: 'object',
  additionalProperties: false,
  properties: {
    field: { type: 'string' },
    issue: { type: 'string' },
    currentlyReports: { type: 'string' },
    shouldReport: { type: 'string' },
    statute: { type: 'string' },
    severity: { type: 'string', enum: ['high', 'med', 'low'] },
  },
  required: ['field', 'issue', 'currentlyReports', 'shouldReport', 'statute', 'severity'],
};

const ACCOUNT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    furnisher: { type: 'string' },
    originalCreditor: NULLABLE_STRING,
    accountNumberMasked: { type: 'string' },
    type: { type: 'string', enum: ['A', 'B', 'C'] },
    status: { type: 'string' },
    balance: { type: 'number' },
    bureaus: BUREAUS,
    violations: { type: 'array', items: VIOLATION },
    primaryViolation: { type: 'string' },
    addressStatus: { type: 'string', enum: ['YES', 'CONFIRM', 'PENDING'] },
    // The known/candidate address behind addressStatus, if any, as one free-
    // text string (e.g. "USALLIANCE Financial, 411 Theodore Fremd Avenue
    // Suite 350, Rye, NY 10580-1426") — lets the human reviewer confirm a
    // pre-filled address instead of starting blank. A nested {name,line1,
    // city,state,zip} object was tried first but pushed the structured-
    // output grammar over the API's compiled-size limit (400 error on every
    // audit); a flat nullable string costs the same as originalCreditor.
    // null when addressStatus is PENDING (no candidate address at all).
    furnisherAddress: NULLABLE_STRING,
    batch: { type: 'integer', enum: [1, 2] },
    strategy: { type: 'string' },
    // Added for the progress-report diff engine (Retention Build 1a) — additive
    // only, mirrors Metro 2 fields already referenced in violations (DOFD =
    // Field 25, disputeFlag = Field 19 compliance condition code).
    paymentRating: NULLABLE_STRING,
    dateOfFirstDelinquency: NULLABLE_STRING,
    remarks: NULLABLE_STRING,
    disputeFlag: { type: 'boolean' },
  },
  required: [
    'id', 'furnisher', 'originalCreditor', 'accountNumberMasked', 'type', 'status',
    'balance', 'bureaus', 'violations', 'primaryViolation', 'addressStatus', 'furnisherAddress', 'batch', 'strategy',
    'paymentRating', 'dateOfFirstDelinquency', 'remarks', 'disputeFlag',
  ],
};

const PERSONAL_INFO = {
  type: 'object',
  additionalProperties: false,
  properties: {
    formerAddresses: { type: 'array', items: { type: 'string' } },
    nameVariants: { type: 'array', items: { type: 'string' } },
    formerEmployers: { type: 'array', items: { type: 'string' } },
    dateOfBirth: NULLABLE_STRING,
    phone: NULLABLE_STRING,
    currentAddress: NULLABLE_STRING,
  },
  required: ['formerAddresses', 'nameVariants', 'formerEmployers', 'dateOfBirth', 'phone', 'currentAddress'],
};

const INQUIRY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    furnisher: { type: 'string' },
    date: { type: 'string' },
    bureaus: BUREAUS,
    linkedAccountId: NULLABLE_STRING,
    ageInMonths: { type: 'number' },
    category: { type: 'string', enum: ['no_linked_account', 'duplicate', 'stale', 'linked_to_open_account'] },
  },
  required: ['furnisher', 'date', 'bureaus', 'linkedAccountId', 'ageInMonths', 'category'],
};

// Full audit object — combined 3B mode, single-bureau mode, and the merge step
export const AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    client: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        address: NULLABLE_STRING,
        reportDate: NULLABLE_STRING,
      },
      required: ['name', 'address', 'reportDate'],
    },
    scores: {
      type: 'object',
      additionalProperties: false,
      properties: {
        equifax: NULLABLE_NUMBER,
        experian: NULLABLE_NUMBER,
        transunion: NULLABLE_NUMBER,
      },
      required: ['equifax', 'experian', 'transunion'],
    },
    executiveSummary: { type: 'string' },
    accountsScanned: { type: 'number' },
    accountsTargeted: { type: 'number' },
    totalViolations: { type: 'number' },
    accounts: { type: 'array', items: ACCOUNT },
    violationsByType: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string' },
          count: { type: 'number' },
          statute: { type: 'string' },
        },
        required: ['type', 'count', 'statute'],
      },
    },
    inquiries: { type: 'array', items: INQUIRY },
    personalInfo: PERSONAL_INFO,
  },
  required: [
    'client', 'scores', 'executiveSummary', 'accountsScanned', 'accountsTargeted',
    'totalViolations', 'accounts', 'violationsByType', 'inquiries', 'personalInfo',
  ],
};

// Per-bureau parse step of Individual mode — mirrors the inline schema in the
// bureau prompt (richer per-account fields; violations use current/expected/reason)
export const BUREAU_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    bureau: { type: 'string' },
    client: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        address: NULLABLE_STRING,
        score: NULLABLE_NUMBER,
      },
      required: ['name', 'address', 'score'],
    },
    accounts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          furnisher: { type: 'string' },
          accountNumber: { type: 'string' },
          type: { type: 'string' },
          status: { type: 'string' },
          balance: { type: 'number' },
          pastDue: { type: 'number' },
          lastPaymentDate: NULLABLE_STRING,
          dofd: NULLABLE_STRING,
          paymentHistory: NULLABLE_STRING,
          remarks: NULLABLE_STRING,
          accountClassification: { type: 'string', enum: ['A', 'B', 'C'] },
          violations: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                field: { type: 'string' },
                currentValue: { type: 'string' },
                expectedValue: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['field', 'currentValue', 'expectedValue', 'reason'],
            },
          },
        },
        required: [
          'furnisher', 'accountNumber', 'type', 'status', 'balance', 'pastDue',
          'lastPaymentDate', 'dofd', 'paymentHistory', 'remarks', 'accountClassification', 'violations',
        ],
      },
    },
    inquiries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          furnisher: { type: 'string' },
          date: { type: 'string' },
          type: NULLABLE_STRING,
        },
        required: ['furnisher', 'date', 'type'],
      },
    },
    personalInfo: PERSONAL_INFO,
  },
  required: ['bureau', 'client', 'accounts', 'inquiries', 'personalInfo'],
};

// Phase 2 (furnisher response) analysis — mirrors the JSON contract in
// src/prompts/phase2Prompt.js field-for-field. Consumers: ResponseAnalyzer's
// results UI and savePhase3Letters(). Do not add/rename fields here without
// updating both.
export const PHASE2_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    classification: {
      type: 'string',
      enum: ['FORM_LETTER', 'STATEMENT_COPY', 'PARTIAL_FIX', 'WRONG_FRAMEWORK', 'NON_RESPONSE', 'ADEQUATE'],
    },
    summary: { type: 'string' },
    demandAnalysis: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          demand: { type: 'string' },
          outcome: { type: 'string', enum: ['ADDRESSED', 'IGNORED', 'PARTIALLY_ADDRESSED', 'ADMITTED'] },
          notes: { type: 'string' },
        },
        required: ['demand', 'outcome', 'notes'],
      },
    },
    admissions: { type: 'array', items: { type: 'string' } },
    phase3Leverage: { type: 'string' },
    letters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        equifax: { type: 'string', description: 'Complete HTML document (<!DOCTYPE html>...) for the Phase 3 letter to Equifax, styled with navy headers, violation tables, and print-ready CSS matching Phase 1 letter formatting.' },
        experian: { type: 'string', description: 'Complete HTML document (<!DOCTYPE html>...) for the Phase 3 letter to Experian, styled with navy headers, violation tables, and print-ready CSS matching Phase 1 letter formatting.' },
        transunion: { type: 'string', description: 'Complete HTML document (<!DOCTYPE html>...) for the Phase 3 letter to TransUnion, styled with navy headers, violation tables, and print-ready CSS matching Phase 1 letter formatting.' },
      },
      required: ['equifax', 'experian', 'transunion'],
    },
  },
  required: ['classification', 'summary', 'demandAnalysis', 'admissions', 'phase3Leverage', 'letters'],
};
