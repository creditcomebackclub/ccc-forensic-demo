export const MAX_SELECTED_TEXT_CHARS = 6000;
export const MAX_REPLACEMENT_CHARS = 8000;
export const MAX_STORY_NOTES_CHARS = 12000;
export const MAX_REWRITE_OUTPUT_TOKENS = 1200;
export const MAX_REWRITE_REQUEST_CHARS = 16000;
export const MAX_REWRITE_TRACKS = 50;

const FLOW_MAX_ROUNDS = Object.freeze({
  accuracy: 12,
  collection: 10,
  combo: 12,
  consent: 3,
  late_pay: 2,
  repo: 3,
  accuracy_solo: 1,
});

const BUREAUS = new Set(['EQ', 'EXP', 'TU']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizedWords(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Damages prose may mention the practical effects of inaccurate reporting,
// but a rewrite must never reach the course's fixed statute/law language.
// Keep this intentionally broader than only "15 USC" so abbreviated course
// citations and named consumer statutes receive the same protection.
const PROTECTED_LEGAL_PATTERNS = [
  /(?:\u00a7|&#167;|&sect;)/i,
  /\b(?:\d+\s*)?u\.?\s*s\.?\s*c\.?\b/i,
  /\b(?:15|12)\s*usc\b/i,
  /\b(?:1681|1692)[a-z]?(?:\s*[-\u2013\u2014]\s*\d+)?(?:\s*\([a-z0-9]+\))*/i,
  /\b(?:f\.?c\.?r\.?a\.?|f\.?d\.?c\.?p\.?a\.?)\b/i,
  /\bfair credit reporting act\b/i,
  /\bfair debt collection practices act\b/i,
  /\b(?:federal|state)\s+(?:statute|law)\b/i,
  /\bstatut(?:e|es|ory)\b/i,
  /\blegal\s+(?:right|rights|obligation|obligations|violation|violations|penalty|penalties|claim|claims)\b/i,
  /\b(?:willful|negligent)\s+noncompliance\b/i,
];

const PROHIBITED_SENSITIVE_PATTERNS = [
  /\[REDACTED(?:\s+[A-Z]+)?\]/i,
  /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/,
  /\b(?:social security(?: number)?|ssn|date of birth|birthdate|dob|password|passcode|credential|login(?:\s+credential)?)\s*(?:(?::|=|#|-|\bis\b|\bwas\b)\s*|\s+)[^\s,;]+/i,
  /\b(?:social security(?: number)?|ssn|account|acct|card)(?:\s+(?:number|no\.?))?\s+(?:ending|ends|last)\s+(?:in\s+|with\s+)?[x*#-]*\d{2,}\b/i,
  /\b(?:account|acct)(?:\s+(?:number|no\.?))?(?:\s*[:#-]\s*|\s+)(?=[a-z0-9*-]*\d)[a-z0-9*-]{4,}(?=\s|$|[,;.])/i,
  /\b(?:driver'?s?\s+licen[cs]e|state\s+id|identification|id)(?:\s+(?:number|no\.?))?(?:\s*[:#-]\s*|\s+)[a-z0-9-]{3,}(?=\s|$|[,;.])/i,
  /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i,
  /(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]\d{3}[-.\s]\d{4}\b/,
  /\b(?:\d[ -]?){12,18}\d\b/,
  /\b\d{7,19}\b/,
  /\b(?:0?[1-9]|1[0-2])[\/-](?:0?[1-9]|[12]\d|3[01])[\/-](?:19|20)\d{2}\b/,
  /\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/,
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*|\s+)(?:19|20)\d{2}\b/i,
  /(?:[x*#-]{2,}\d{4,}|\d{4,}[x*#-]{2,})/i,
  /\bp\.?\s*o\.?\s+box\s+\d+[a-z0-9-]*\b/i,
  /\b\d{1,6}\s+[a-z0-9.' -]+\s(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl)\b/i,
  /\b(?:medical|health|diagnos(?:is|ed)|doctor|hospital|medication|prescription|therap(?:y|ist)|psychiatr(?:y|ic|ist)|disability|disabled|pregnan(?:cy|t)|anxiety|depression|ptsd|bipolar|cancer|diabetes|hiv|aids|surgery|surgical|cardiac|heart|illness|injur(?:y|ed)|symptom|treatment|emergency\s+room|urgent\s+care|mental\s+health)\b/i,
];

export class DisputeRewriteValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'DisputeRewriteValidationError';
    this.statusCode = statusCode;
  }
}

function normalizedTrackBindings(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REWRITE_TRACKS) {
    throw new DisputeRewriteValidationError(`Bind between 1 and ${MAX_REWRITE_TRACKS} exact active account tracks to the rewrite.`);
  }
  const seen = new Set();
  const bindings = value.map((binding) => {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)
        || Object.keys(binding).some((key) => !['trackId', 'revision'].includes(key))) {
      throw new DisputeRewriteValidationError('Every rewrite track binding must contain only trackId and revision.');
    }
    const trackId = typeof binding.trackId === 'string' ? binding.trackId.trim().toLowerCase() : '';
    const revision = typeof binding.revision === 'number'
      ? binding.revision
      : (typeof binding.revision === 'string' && /^\d+$/.test(binding.revision.trim())
        ? Number(binding.revision)
        : Number.NaN);
    if (!UUID_PATTERN.test(trackId)) {
      throw new DisputeRewriteValidationError('Every rewrite trackId must be a valid UUID.');
    }
    if (!Number.isInteger(revision) || revision < 0) {
      throw new DisputeRewriteValidationError('Every rewrite track revision must be a non-negative integer.');
    }
    if (seen.has(trackId)) {
      throw new DisputeRewriteValidationError('A rewrite request cannot repeat an account track.');
    }
    seen.add(trackId);
    return { trackId, revision };
  });
  return bindings.sort((left, right) => left.trackId.localeCompare(right.trackId));
}

function rowField(row, snakeCase, camelCase) {
  return row?.[snakeCase] ?? row?.[camelCase] ?? null;
}

function rewriteContextError(message) {
  return new DisputeRewriteValidationError(message, 409);
}

export function hasProtectedLegalLanguage(text) {
  const value = typeof text === 'string' ? text : '';
  return PROTECTED_LEGAL_PATTERNS.some((pattern) => pattern.test(value));
}

export function hasProhibitedSensitiveData(text) {
  const value = typeof text === 'string' ? text : '';
  return PROHIBITED_SENSITIVE_PATTERNS.some((pattern) => pattern.test(value));
}

// Pattern matching catches generic secrets; this second gate compares the
// excerpt against the target client's actual stored identity and credentials.
// None of these reference values are included in the model input.
export function hasKnownClientSensitiveData(text, known = {}) {
  const value = String(text || '');
  const normalizedText = normalizedWords(value);
  const containsWords = (candidate) => {
    const normalizedCandidate = normalizedWords(candidate);
    return !!normalizedCandidate && normalizedText.includes(normalizedCandidate);
  };

  const fullName = normalizedWords(known.name);
  if (fullName && normalizedText.includes(fullName)) return true;
  if (fullName && fullName.split(' ').some((part) => part.length >= 2 && normalizedText.split(' ').includes(part))) return true;
  if (containsWords(known.address) || containsWords(known.email) || containsWords(known.monitoringEmail)) return true;

  const phoneDigits = String(known.phone || '').replace(/\D/g, '');
  if (phoneDigits.length >= 7 && value.replace(/\D/g, '').includes(phoneDigits)) return true;

  const dobDigits = String(known.dateOfBirth || '').replace(/\D/g, '');
  if (dobDigits.length >= 6 && value.replace(/\D/g, '').includes(dobDigits)) return true;

  const ssnLast4 = String(known.ssnLast4 || '').replace(/\D/g, '').slice(-4);
  if (ssnLast4.length === 4 && new RegExp(`(?:^|\\D)${escapeRegExp(ssnLast4)}(?:\\D|$)`).test(value)) return true;

  const monitoringPassword = String(known.monitoringPassword || '');
  if (monitoringPassword && value.toLowerCase().includes(monitoringPassword.toLowerCase())) return true;
  return false;
}

export function canStaffAccessClient(role, callerId, ownerId) {
  if (role === 'admin') return true;
  return role === 'auditor'
    && typeof callerId === 'string'
    && callerId.length > 0
    && callerId === ownerId;
}

export function normalizeDisputeRewriteRequest(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new DisputeRewriteValidationError('A JSON request object is required.');
  }

  const allowedKeys = new Set(['clientId', 'sectionKey', 'flow', 'bureau', 'round', 'selectedText', 'storyNotesVersion']);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw new DisputeRewriteValidationError('The rewrite request contains unsupported fields.');
  }

  const clientId = typeof payload.clientId === 'string' ? payload.clientId.trim() : '';
  const sectionKey = typeof payload.sectionKey === 'string' ? payload.sectionKey.trim() : '';
  const flow = typeof payload.flow === 'string' ? payload.flow.trim().toLowerCase() : '';
  const bureau = typeof payload.bureau === 'string' ? payload.bureau.trim().toUpperCase() : '';
  const round = typeof payload.round === 'number'
    ? payload.round
    : (typeof payload.round === 'string' && /^\d+$/.test(payload.round.trim()) ? Number(payload.round) : Number.NaN);
  const selectedText = payload.selectedText;
  const storyNotesVersion = typeof payload.storyNotesVersion === 'string'
    ? payload.storyNotesVersion.trim().toLowerCase()
    : '';

  if (!UUID_PATTERN.test(clientId)) {
    throw new DisputeRewriteValidationError('clientId must be a valid UUID.');
  }
  if (sectionKey !== 'damages') {
    throw new DisputeRewriteValidationError('Only the damages section can be rewritten.');
  }
  if (!Object.prototype.hasOwnProperty.call(FLOW_MAX_ROUNDS, flow)) {
    throw new DisputeRewriteValidationError('Unknown dispute flow.');
  }
  if (!BUREAUS.has(bureau)) {
    throw new DisputeRewriteValidationError('Unknown bureau.');
  }
  if (!Number.isInteger(round) || round < 1 || round > FLOW_MAX_ROUNDS[flow]) {
    throw new DisputeRewriteValidationError('Round is outside the selected flow.');
  }
  if (typeof selectedText !== 'string' || !selectedText.trim()) {
    throw new DisputeRewriteValidationError('Select damages text to rewrite.');
  }
  if (selectedText.length > MAX_SELECTED_TEXT_CHARS) {
    throw new DisputeRewriteValidationError(`Selected text must be ${MAX_SELECTED_TEXT_CHARS} characters or fewer.`);
  }
  if (hasProtectedLegalLanguage(selectedText)) {
    throw new DisputeRewriteValidationError('The selection contains protected legal language and cannot be rewritten.');
  }
  if (hasProhibitedSensitiveData(selectedText)) {
    throw new DisputeRewriteValidationError('Remove identifiers, contact/address details, exact dates, and medical or health information from the selection.');
  }
  if (!/^[a-f0-9]{64}$/.test(storyNotesVersion)) {
    throw new DisputeRewriteValidationError('Approve the current saved story notes before requesting a rewrite.');
  }

  return { clientId, sectionKey, flow, bureau, round, selectedText, storyNotesVersion };
}

export function replaceDisputeSelection(text, selection, replacement) {
  if (typeof text !== 'string' || typeof replacement !== 'string') {
    throw new DisputeRewriteValidationError('Text and replacement must be strings.');
  }
  if (!replacement.trim() || replacement.length > MAX_REPLACEMENT_CHARS) {
    throw new DisputeRewriteValidationError(`Replacement must be between 1 and ${MAX_REPLACEMENT_CHARS} characters.`);
  }

  let start;
  let end;
  if (typeof selection === 'string') {
    if (!selection) throw new DisputeRewriteValidationError('Selection cannot be empty.');
    start = text.indexOf(selection);
    if (start < 0) throw new DisputeRewriteValidationError('Selection no longer matches the damages text.');
    if (text.indexOf(selection, start + selection.length) !== -1) {
      throw new DisputeRewriteValidationError('Selection is ambiguous; use its start and end positions.');
    }
    end = start + selection.length;
  } else {
    start = selection?.start;
    end = selection?.end;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) {
      throw new DisputeRewriteValidationError('Selection positions are invalid.');
    }
    const expected = selection?.text ?? selection?.selectedText;
    if (expected != null && text.slice(start, end) !== expected) {
      throw new DisputeRewriteValidationError('Selection no longer matches the damages text.');
    }
  }

  const selectedText = text.slice(start, end);
  if (!selectedText.trim()) {
    throw new DisputeRewriteValidationError('Selection cannot be only whitespace.');
  }
  if (hasProtectedLegalLanguage(selectedText) || hasProtectedLegalLanguage(replacement)) {
    throw new DisputeRewriteValidationError('Protected legal language cannot be rewritten.');
  }
  if (hasProhibitedSensitiveData(replacement)) {
    throw new DisputeRewriteValidationError('Protected client information cannot be inserted.');
  }
  const leadingWhitespace = selectedText.match(/^\s*/)?.[0] || '';
  const trailingWhitespace = selectedText.match(/\s*$/)?.[0] || '';
  return `${text.slice(0, start)}${leadingWhitespace}${replacement.trim()}${trailingWhitespace}${text.slice(end)}`;
}

// Story notes are intentionally the only client context sent to the model.
// Remove common accidental secrets before the model request without trying
// to reinterpret the client's actual story or silently shorten it.
export function redactSensitiveStoryNotes(notes) {
  return String(notes || '')
    .replace(/\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g, '[REDACTED SSN]')
    .replace(/((?:social security(?: number)?|ssn)\s*[:#-]?\s*)[^\n,;]+/gi, '$1[REDACTED]')
    .replace(/((?:date of birth|birthdate|birthday|dob|born)\s*[:#-]?\s*)[^\n,;]+/gi, '$1[REDACTED]')
    .replace(/((?:password|passcode|credential|login(?:\s+credential)?)\s*(?:(?::|=|#|-|\bis\b|\bwas\b)\s*|\s+))[^\n,;]+/gi, '$1[REDACTED]')
    .replace(/((?:social security(?: number)?|ssn|account|acct|card)(?:\s+(?:number|no\.?)?)?\s+(?:ending|ends|last)\s+(?:in\s+|with\s+)?)[x*#-]*\d{2,}/gi, '$1[REDACTED]')
    .replace(/((?:account|acct)(?:\s+(?:number|no\.?))?(?:\s*[:#-]\s*|\s+))(?=[a-z0-9*-]*\d)[a-z0-9*-]{4,}(?=\s|$|[,;.])/gi, '$1[REDACTED]')
    .replace(/((?:driver'?s?\s+licen[cs]e|state\s+id|identification|id)(?:\s+(?:number|no\.?))?(?:\s*[:#-]\s*|\s+))[a-z0-9-]{3,}(?=\s|$|[,;.])/gi, '$1[REDACTED]')
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, '[REDACTED EMAIL]')
    .replace(/(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]\d{3}[-.\s]\d{4}\b/g, '[REDACTED PHONE]')
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, '[REDACTED IDENTIFIER]')
    .replace(/\b\d{7,19}\b/g, '[REDACTED IDENTIFIER]')
    .replace(/\b(?:0?[1-9]|1[0-2])[\/-](?:0?[1-9]|[12]\d|3[01])[\/-](?:19|20)\d{2}\b/g, '[REDACTED DATE]')
    .replace(/\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/g, '[REDACTED DATE]')
    .replace(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*|\s+)(?:19|20)\d{2}\b/gi, '[REDACTED DATE]')
    .replace(/(?:[x*#-]{2,}\d{4,}|\d{4,}[x*#-]{2,})/gi, '[REDACTED IDENTIFIER]')
    .replace(/\bp\.?\s*o\.?\s+box\s+\d+[a-z0-9-]*\b/gi, '[REDACTED ADDRESS]')
    .replace(/((?:(?:home|mailing|street)\s+)?address\s*[:#-]?\s*)[^\n,;]+/gi, '$1[REDACTED]')
    .replace(/\b\d{1,6}\s+[a-z0-9.' -]+\s(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl)\b/gi, '[REDACTED ADDRESS]')
    .replace(/\b(?:medical|health|diagnos(?:is|ed)|doctor|hospital|medication|prescription|therap(?:y|ist)|psychiatr(?:y|ic|ist)|disability|disabled|pregnan(?:cy|t)|anxiety|depression|ptsd|bipolar|cancer|diabetes|hiv|aids|surgery|surgical|cardiac|heart|illness|injur(?:y|ed)|symptom|treatment|emergency\s+room|urgent\s+care|mental\s+health)\b/gi, '[REDACTED HEALTH]');
}
