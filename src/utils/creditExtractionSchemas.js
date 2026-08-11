// Extraction-only structured-output contracts. Models using these schemas may
// transcribe what a report/response displays, but cannot emit violations,
// legal conclusions, priorities, strategies, or next actions.

const NULLABLE_STRING = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const NULLABLE_NUMBER = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const FIELD_NAME = {
  type: 'string',
  enum: [
    'portfolioType', 'accountType', 'accountStatus', 'balance', 'pastDue',
    'scheduledMonthlyPayment', 'originalLoanAmount', 'dateOpened', 'dofd',
    'dateClosed', 'lastPaymentDate', 'billingDate', 'paymentHistory',
    'specialComment', 'complianceConditionCode',
  ],
};

const CLIENT = {
  type: 'object', additionalProperties: false,
  properties: { name: { type: 'string' }, address: NULLABLE_STRING, score: NULLABLE_NUMBER },
  required: ['name', 'address', 'score'],
};

const PERSONAL_INFO = {
  type: 'object', additionalProperties: false,
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

const EXTRACTED_FIELD = {
  type: 'object', additionalProperties: false,
  properties: {
    name: FIELD_NAME,
    rawValue: NULLABLE_STRING,
    numericValue: NULLABLE_NUMBER,
    state: { type: 'string', enum: ['PRESENT', 'EXPLICITLY_BLANK', 'NOT_SHOWN', 'UNREADABLE'] },
    page: NULLABLE_NUMBER,
    label: NULLABLE_STRING,
  },
  required: ['name', 'rawValue', 'numericValue', 'state', 'page', 'label'],
};

const EXTRACTED_ACCOUNT = {
  type: 'object', additionalProperties: false,
  properties: {
    furnisher: { type: 'string' },
    furnisherAddress: NULLABLE_STRING,
    originalCreditor: NULLABLE_STRING,
    accountNumber: { type: 'string' },
    reportedType: NULLABLE_STRING,
    statusText: NULLABLE_STRING,
    consumerDisputeIndicator: { type: 'string', enum: ['PRESENT', 'ABSENT', 'UNKNOWN'] },
    remarks: NULLABLE_STRING,
    fields: { type: 'array', items: EXTRACTED_FIELD },
  },
  required: [
    'furnisher', 'furnisherAddress', 'originalCreditor', 'accountNumber', 'reportedType',
    'statusText', 'consumerDisputeIndicator', 'remarks', 'fields',
  ],
};

const INQUIRY = {
  type: 'object', additionalProperties: false,
  properties: { furnisher: { type: 'string' }, date: { type: 'string' }, type: NULLABLE_STRING },
  required: ['furnisher', 'date', 'type'],
};

export const CREDIT_BUREAU_EXTRACTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    bureau: { type: 'string', enum: ['equifax', 'experian', 'transunion'] },
    client: CLIENT,
    accounts: { type: 'array', items: EXTRACTED_ACCOUNT },
    inquiries: { type: 'array', items: INQUIRY },
    personalInfo: PERSONAL_INFO,
  },
  required: ['bureau', 'client', 'accounts', 'inquiries', 'personalInfo'],
};

export const COMBINED_CREDIT_EXTRACTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reports: { type: 'array', items: CREDIT_BUREAU_EXTRACTION_SCHEMA },
  },
  required: ['reports'],
};

const RESPONSE_CLAIM = {
  type: 'object', additionalProperties: false,
  properties: {
    type: {
      type: 'string',
      enum: [
        'GENERIC_VERIFICATION', 'CORRECTION_STATED', 'DELETION_STATED',
        'EXPLANATION_PROVIDED', 'DOCUMENTS_PROVIDED', 'REQUEST_FOR_INFORMATION',
        'PROCEDURAL_REJECTION', 'DISPUTE_REJECTED', 'CRA_DISPUTE_FRAMEWORK_STATED',
        'ADMISSION', 'OTHER',
      ],
    },
    fieldNumber: NULLABLE_STRING,
    accountSuffix: NULLABLE_STRING,
    value: NULLABLE_STRING,
    statement: { type: 'string' },
    page: NULLABLE_NUMBER,
  },
  required: ['type', 'fieldNumber', 'accountSuffix', 'value', 'statement', 'page'],
};

export const RESPONSE_EXTRACTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    sender: NULLABLE_STRING,
    responseDate: NULLABLE_STRING,
    claims: { type: 'array', items: RESPONSE_CLAIM },
    providedDocumentTypes: { type: 'array', items: { type: 'string' } },
    documentQuality: {
      type: 'object', additionalProperties: false,
      properties: {
        enclosureLegible: { type: 'boolean' },
        issues: { type: 'array', items: { type: 'string' } },
      },
      required: ['enclosureLegible', 'issues'],
    },
  },
  required: ['sender', 'responseDate', 'claims', 'providedDocumentTypes', 'documentQuality'],
};
