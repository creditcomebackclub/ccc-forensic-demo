// Extraction-only structured-output contracts. Models using these schemas may
// transcribe what a report/response displays, but cannot emit violations,
// legal conclusions, priorities, strategies, or next actions.

const NULLABLE_STRING = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const NULLABLE_NUMBER = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const NULLABLE_PAGE = { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] };
const NULLABLE_BUREAU = {
  anyOf: [
    { type: 'string', enum: ['equifax', 'experian', 'transunion'] },
    { type: 'null' },
  ],
};
export const CREDIT_ACCOUNT_FIELD_NAMES = Object.freeze([
  'portfolioType', 'accountType', 'accountStatus', 'balance', 'pastDue',
  'scheduledMonthlyPayment', 'originalLoanAmount', 'dateOpened', 'dofd',
  'dateClosed', 'lastPaymentDate', 'billingDate', 'paymentHistory',
  'specialComment', 'complianceConditionCode', 'creditLimit', 'termsDuration',
  'termsFrequency', 'actualPaymentAmount', 'paymentRating', 'originalChargeOffAmount',
]);

const FIELD_NAME = {
  type: 'string',
  enum: [...CREDIT_ACCOUNT_FIELD_NAMES],
};

const CLIENT = {
  type: 'object', additionalProperties: false,
  properties: {
    name: NULLABLE_STRING,
    nameEvidencePage: NULLABLE_PAGE,
    address: NULLABLE_STRING,
    addressEvidencePage: NULLABLE_PAGE,
    score: NULLABLE_NUMBER,
    scoreEvidencePage: NULLABLE_PAGE,
  },
  required: ['name', 'nameEvidencePage', 'address', 'addressEvidencePage', 'score', 'scoreEvidencePage'],
};

const PERSONAL_INFO = {
  type: 'object', additionalProperties: false,
  properties: {
    formerAddresses: { type: 'array', items: { type: 'string' } },
    formerAddressEvidence: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: { value: { type: 'string' }, page: { type: 'integer', minimum: 1 } },
      required: ['value', 'page'],
    } },
    nameVariants: { type: 'array', items: { type: 'string' } },
    nameVariantEvidence: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: { value: { type: 'string' }, page: { type: 'integer', minimum: 1 } },
      required: ['value', 'page'],
    } },
    formerEmployers: { type: 'array', items: { type: 'string' } },
    formerEmployerEvidence: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: { value: { type: 'string' }, page: { type: 'integer', minimum: 1 } },
      required: ['value', 'page'],
    } },
    dateOfBirth: NULLABLE_STRING,
    dateOfBirthEvidencePage: NULLABLE_PAGE,
    phone: NULLABLE_STRING,
    phoneEvidencePage: NULLABLE_PAGE,
    currentAddress: NULLABLE_STRING,
    currentAddressEvidencePage: NULLABLE_PAGE,
  },
  required: [
    'formerAddresses', 'formerAddressEvidence', 'nameVariants', 'nameVariantEvidence',
    'formerEmployers', 'formerEmployerEvidence', 'dateOfBirth',
    'dateOfBirthEvidencePage', 'phone', 'phoneEvidencePage',
    'currentAddress', 'currentAddressEvidencePage',
  ],
};

const EXTRACTED_FIELD = {
  type: 'object', additionalProperties: false,
  properties: {
    name: FIELD_NAME,
    rawValue: NULLABLE_STRING,
    numericValue: NULLABLE_NUMBER,
    state: { type: 'string', enum: ['PRESENT', 'EXPLICITLY_BLANK', 'NOT_SHOWN', 'UNREADABLE'] },
    page: NULLABLE_PAGE,
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
    // One page must visibly support the account identity used for matching
    // (furnisher/original creditor plus the displayed account number/suffix).
    accountIdentityEvidencePage: NULLABLE_PAGE,
    reportedType: NULLABLE_STRING,
    reportedTypeEvidencePage: NULLABLE_PAGE,
    statusText: NULLABLE_STRING,
    statusTextEvidencePage: NULLABLE_PAGE,
    consumerDisputeIndicator: { type: 'string', enum: ['PRESENT', 'ABSENT', 'UNKNOWN'] },
    consumerDisputeIndicatorEvidencePage: NULLABLE_PAGE,
    remarks: NULLABLE_STRING,
    remarksEvidencePage: NULLABLE_PAGE,
    fields: {
      type: 'array',
      minItems: CREDIT_ACCOUNT_FIELD_NAMES.length,
      maxItems: CREDIT_ACCOUNT_FIELD_NAMES.length,
      items: EXTRACTED_FIELD,
    },
  },
  required: [
    'furnisher', 'furnisherAddress', 'originalCreditor', 'accountNumber',
    'accountIdentityEvidencePage', 'reportedType', 'reportedTypeEvidencePage',
    'statusText', 'statusTextEvidencePage', 'consumerDisputeIndicator',
    'consumerDisputeIndicatorEvidencePage', 'remarks', 'remarksEvidencePage', 'fields',
  ],
};

const INQUIRY = {
  type: 'object', additionalProperties: false,
  properties: {
    furnisher: { type: 'string' }, date: { type: 'string' }, type: NULLABLE_STRING,
    evidencePage: { type: 'integer', minimum: 1 },
  },
  required: ['furnisher', 'date', 'type', 'evidencePage'],
};

export const CREDIT_BUREAU_EXTRACTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    // Metadata is source-derived. A split bureau-specific PDF chunk may omit
    // the header/date, so null is allowed at extraction time and inherited
    // only from another chunk of that same exact file. Combined-report chunks
    // carrying unlabeled bureau data fail closed because they cannot be
    // assigned safely.
    bureau: NULLABLE_BUREAU,
    bureauEvidencePage: NULLABLE_PAGE,
    reportSectionStart: { type: 'boolean' },
    reportSectionStartEvidencePage: NULLABLE_PAGE,
    reportDate: NULLABLE_STRING,
    reportDateRaw: NULLABLE_STRING,
    reportDateEvidencePage: NULLABLE_PAGE,
    client: CLIENT,
    accounts: { type: 'array', items: EXTRACTED_ACCOUNT },
    inquiries: { type: 'array', items: INQUIRY },
    personalInfo: PERSONAL_INFO,
  },
  required: [
    'bureau', 'bureauEvidencePage', 'reportSectionStart', 'reportSectionStartEvidencePage',
    'reportDate', 'reportDateRaw',
    'reportDateEvidencePage', 'client', 'accounts', 'inquiries', 'personalInfo',
  ],
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
