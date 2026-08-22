export const ROUTING_FACTS_VERSION = 'ccc-routing-facts-v1';

export const ROUTING_ACCOUNT_KINDS = Object.freeze([
  'charge_off',
  'collection',
  'repossession',
  'bankruptcy',
  'student_loan',
  'late_payment',
  'positive',
  'other',
]);

export const ROUTING_BUREAU_CODES = Object.freeze(['EQ', 'EXP', 'TU']);
export const ROUTING_BUREAU_KEYS = Object.freeze({ equifax: 'EQ', experian: 'EXP', transunion: 'TU' });

export const HARD_ROUTING_BLOCKERS = Object.freeze([
  'INCOMPLETE_3B',
  'DUPLICATE_BUREAU_REPORT',
  'ACCOUNT_MATCH_AMBIGUOUS',
]);

const COLLECTION_ACCOUNT_TYPES = new Set(['0C', '48', '77']);
const MONTH_WORD = /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)$/i;
const NEUTRAL_HISTORY_TOKEN = /^(?:ok|cur|current|paid|pays|agreed|nd|n\/a|na|none|unknown|u|x|co|rf|pp|dash|-+)$/i;
const LATE_STATUS_TOKEN = /^(?:30|60|90|120|150|180)(?:\+)?$/;

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeKind(value) {
  const normalized = clean(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'chargeoff' || normalized === 'charged_off') return 'charge_off';
  if (normalized === 'repo') return 'repossession';
  if (normalized === 'late') return 'late_payment';
  return ROUTING_ACCOUNT_KINDS.includes(normalized) ? normalized : 'other';
}

export function latePaymentBandForCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) return 'unclear';
  if (count === 0) return 'none';
  return count <= 2 ? 'two_or_fewer' : 'three_or_more';
}

export function validateLatePaymentFacts(countValue, bandValue) {
  const count = Number(countValue);
  const band = clean(bandValue).toLowerCase();
  if (!Number.isInteger(count) || count < 1 || count > 500) return 'A late-payment account requires at least 1 visible late marker (maximum 500).';
  if (!['two_or_fewer', 'three_or_more', 'mixed'].includes(band)) return 'Choose a confirmed non-zero late-payment pattern.';
  if (band === 'two_or_fewer' && (count < 1 || count > 2)) return 'The 2-or-fewer pattern requires a count of 1 or 2.';
  if (band === 'three_or_more' && count < 3) return 'The 3-or-more pattern requires a count of at least 3.';
  if (band === 'mixed' && count < 3) return 'A mixed late-payment stretch requires at least 3 visible late markers.';
  return null;
}

/**
 * Parse only bounded, recognizable payment-history displays. Unknown layouts
 * return review_required instead of guessing from dates or arbitrary digits.
 */
export function parseLatePaymentHistory(value) {
  const raw = clean(value);
  if (!raw) return { status: 'missing', count: null, band: 'unclear', evidence: null };
  if (raw.length > 12000) return { status: 'review_required', count: null, band: 'unclear', evidence: raw.slice(0, 500), reason: 'Payment history exceeds the deterministic parser limit.' };
  if (/\b\d{1,2}[\/-]\d{1,2}[\/-](?:\d{2}|\d{4})\b/.test(raw)) {
    return { status: 'review_required', count: null, band: 'unclear', evidence: raw, reason: 'Day-level dates make bare 30/60/90 tokens ambiguous.' };
  }

  const explicit = [...raw.matchAll(/\b(30|60|90|120|150|180)\+?\s*(?:days?)?\s*(?:late|past\s*due|delinquent)\b(?:\s*[:x=\-]?\s*(\d{1,3})\s*(?:x|times?|occurrences?|months?))?/gi)];
  if (explicit.length) {
    const unboundMultiplicity = raw.replace(/\b(30|60|90|120|150|180)\+?\s*(?:days?)?\s*(?:late|past\s*due|delinquent)\b(?:\s*[:x=\-]?\s*(\d{1,3})\s*(?:x|times?|occurrences?|months?))?/gi, ' ');
    if (/\b(?:\d+|twice|thrice)\b/i.test(unboundMultiplicity)) {
      return { status: 'review_required', count: null, band: 'unclear', evidence: raw, reason: 'A late-payment multiplicity was not tied to a specific late-status phrase.' };
    }
    const count = explicit.reduce((total, match) => total + (match[2] == null ? 1 : Number(match[2])), 0);
    if (!Number.isInteger(count) || count < 1 || count > 500) {
      return { status: 'review_required', count: null, band: 'unclear', evidence: raw, reason: 'The visible late-payment multiplicity is outside the supported 1-to-500 range.' };
    }
    return { status: 'confirmed', count, band: latePaymentBandForCount(count), evidence: raw, parser: 'explicit_late_phrases_with_multiplicity' };
  }

  const withoutMonthYears = raw
    .replace(/\b(?:0?[1-9]|1[0-2])[\/-](?:19|20)\d{2}\b/g, ' ')
    .replace(/[|,;:\[\](){}]/g, ' ')
    .replace(/\bpayment\s+history\b/gi, ' ');
  const tokens = withoutMonthYears.split(/\s+/).map((token) => token.trim()).filter(Boolean);
  let count = 0;
  const unknown = [];
  for (const token of tokens) {
    const normalized = /^[.!?]+$/.test(token) ? token : token.replace(/[.!?]+$/g, '');
    if (!normalized) continue;
    if (LATE_STATUS_TOKEN.test(normalized)) { count += 1; continue; }
    if (NEUTRAL_HISTORY_TOKEN.test(normalized) || MONTH_WORD.test(normalized) || /^(?:19|20)\d{2}$/.test(normalized)) continue;
    unknown.push(normalized);
  }
  if (unknown.length) {
    return {
      status: 'review_required', count: null, band: 'unclear', evidence: raw,
      reason: `Unrecognized payment-history token${unknown.length === 1 ? '' : 's'}: ${unknown.slice(0, 8).join(', ')}`,
    };
  }
  return { status: 'confirmed', count, band: latePaymentBandForCount(count), evidence: raw, parser: 'recognized_status_grid' };
}

export function reportCoverageFacts(reports = []) {
  const counts = Object.fromEntries(ROUTING_BUREAU_CODES.map((code) => [code, 0]));
  for (const report of reports) {
    const code = ROUTING_BUREAU_KEYS[String(report?.bureau || '').toLowerCase()] || String(report?.bureau || '').toUpperCase();
    if (Object.prototype.hasOwnProperty.call(counts, code)) counts[code] += 1;
  }
  const missing = ROUTING_BUREAU_CODES.filter((code) => counts[code] === 0);
  const duplicates = ROUTING_BUREAU_CODES.filter((code) => counts[code] > 1);
  return {
    bureauCodes: ROUTING_BUREAU_CODES.filter((code) => counts[code] > 0),
    counts,
    missing,
    duplicates,
    complete: missing.length === 0 && duplicates.length === 0,
  };
}

function fieldEvidence(variant, field) {
  const evidence = (Array.isArray(variant?.evidence) ? variant.evidence : []).find((item) => (
    clean(item?.field || item?.name).toLowerCase() === clean(field).toLowerCase()
    && item?.page !== null
    && item?.page !== undefined
    && item?.page !== ''
    && Number.isInteger(Number(item.page))
    && Number(item.page) >= 1
    && clean(item?.rawValue).toLowerCase() === clean(variant?.[field]).toLowerCase()
  ));
  return evidence ? {
    page: Number(evidence.page),
    label: clean(evidence.label) || null,
    rawValue: evidence.rawValue ?? variant?.[field] ?? null,
  } : null;
}

function kindEvidenceForVariants(variants = {}) {
  const evidence = [];
  const add = (kind, bureau, variant, field, value, strength = 'text') => {
    const sourceEvidence = fieldEvidence(variant, field);
    evidence.push({
      kind,
      bureau,
      field,
      value: clean(value),
      strength,
      page: sourceEvidence?.page ?? null,
      label: sourceEvidence?.label ?? null,
      autoEligible: !!sourceEvidence,
      source: sourceEvidence ? 'structured_page_anchored' : 'narrative_unanchored',
    });
  };
  const addTextMatch = (kind, bureau, variant, fields, pattern, strength = 'explicit') => {
    for (const field of fields) {
      const value = clean(variant?.[field]);
      if (value && pattern.test(value.toLowerCase())) add(kind, bureau, variant, field, value, strength);
      pattern.lastIndex = 0;
    }
  };
  for (const [bureauKey, variant] of Object.entries(variants || {})) {
    const bureau = ROUTING_BUREAU_KEYS[bureauKey] || String(bureauKey).toUpperCase();
    addTextMatch('repossession', bureau, variant,
      ['accountStatus', 'specialComment', 'reportedType', 'statusText', 'remarks'],
      /repossess|repossession|\brepo\b|voluntary surrender|involuntary surrender/);
    addTextMatch('student_loan', bureau, variant,
      ['reportedType', 'originalCreditor', 'furnisher', 'remarks', 'specialComment'],
      /student\s+loan|education\s+loan|department\s+of\s+education|dept\.?\s+of\s+education|navient|nelnet|mohela|aidvantage|edfinancial|great\s+lakes|sallie\s+mae/);
    addTextMatch('bankruptcy', bureau, variant,
      ['accountStatus', 'specialComment', 'reportedType', 'statusText', 'remarks'],
      /bankrupt|chapter\s+(?:7|11|13)|included\s+in\s+bankruptcy|discharged\s+(?:through|in)\s+bankruptcy/);
    const accountType = clean(variant.accountType).toUpperCase();
    if (COLLECTION_ACCOUNT_TYPES.has(accountType)) add('collection', bureau, variant, 'accountType', accountType, 'coded');
    addTextMatch('collection', bureau, variant,
      ['accountStatus', 'specialComment', 'reportedType', 'statusText', 'remarks'],
      /collection\s+(?:account|agency)|debt\s+(?:collector|buyer|purchaser)|third[- ]party\s+collector|placed\s+for\s+collection/);
    addTextMatch('charge_off', bureau, variant,
      ['accountStatus', 'paymentRating', 'specialComment', 'reportedType', 'statusText', 'remarks'],
      /charge[ -]?off|charged[ -]?off|profit\s+and\s+loss|written\s+off/);
    if (clean(variant.accountStatus) === '97') add('charge_off', bureau, variant, 'accountStatus', variant.accountStatus, 'coded');
    addTextMatch('late_payment', bureau, variant,
      ['accountStatus', 'paymentRating', 'specialComment', 'statusText', 'remarks'],
      /\b(?:30|60|90|120|150|180)\+?\s*(?:days?)?\s*(?:late|past\s*due|delinquent)\b|\bdelinquent\b/);
    const history = parseLatePaymentHistory(variant?.paymentHistory);
    if (history.status === 'confirmed' && history.count > 0) add('late_payment', bureau, variant, 'paymentHistory', variant.paymentHistory, 'structured_history');
    const status = clean(variant.accountStatus).toUpperCase();
    if (status === '11') add('positive', bureau, variant, 'accountStatus', status, 'coded');
    addTextMatch('positive', bureau, variant,
      ['accountStatus', 'statusText', 'paymentRating'],
      /\bcurrent\b|pays?\s+as\s+agreed|paid\s+as\s+agreed|never\s+late|satisfactory/,
      'explicit_positive');
  }
  return evidence;
}

function chooseAccountKind(variants, evidence) {
  const eligibleEvidence = evidence.filter((item) => item.autoEligible);
  const kinds = new Set(eligibleEvidence.map((item) => item.kind));
  // Explicit repo and bankruptcy descriptions name the course account class.
  if (kinds.has('repossession')) return { kind: 'repossession', conflict: false };
  if (kinds.has('bankruptcy')) return { kind: 'bankruptcy', conflict: false };
  // A collected student loan is ambiguous under the supplied course sources;
  // do not silently decide whether the student or collector path controls.
  if (kinds.has('student_loan') && kinds.has('collection')) return { kind: 'other', conflict: true };
  if (kinds.has('collection')) return { kind: 'collection', conflict: false };
  if (kinds.has('student_loan')) return { kind: 'student_loan', conflict: false };
  if (kinds.has('charge_off')) return { kind: 'charge_off', conflict: false };

  if (kinds.has('late_payment')) {
    return { kind: 'late_payment', conflict: false };
  }
  const bureauCount = Object.keys(variants || {}).length;
  const positiveBureaus = new Set(eligibleEvidence.filter((item) => item.kind === 'positive').map((item) => item.bureau));
  return { kind: bureauCount > 0 && positiveBureaus.size === bureauCount ? 'positive' : 'other', conflict: false };
}

/** Build the only automatic account facts allowed to authorize R1 routing. */
export function deriveAccountRoutingFacts({ variants = {}, findings = [], coverage = null } = {}) {
  const reportCoverage = coverage || { bureauCodes: Object.keys(variants).map((key) => ROUTING_BUREAU_KEYS[key]).filter(Boolean), missing: [], duplicates: [], complete: false };
  const evidence = kindEvidenceForVariants(variants);
  const { kind, conflict } = chooseAccountKind(variants, evidence);
  const blockingCodes = [];
  if (!reportCoverage.complete) blockingCodes.push('INCOMPLETE_3B');
  if (reportCoverage.duplicates?.length) blockingCodes.push('DUPLICATE_BUREAU_REPORT');
  if ((findings || []).some((finding) => finding?.ruleId === 'ACCOUNT_MATCH_AMBIGUOUS' || finding?.type === 'ACCOUNT_MATCH_AMBIGUOUS')) blockingCodes.push('ACCOUNT_MATCH_AMBIGUOUS');
  if (conflict) blockingCodes.push('CATEGORY_AMBIGUOUS');
  if (kind === 'other') blockingCodes.push('CATEGORY_UNKNOWN');
  const anchoredKinds = new Set(evidence.filter((item) => item.autoEligible).map((item) => item.kind));
  if (evidence.some((item) => !item.autoEligible && item.kind !== 'positive' && !anchoredKinds.has(item.kind))) {
    blockingCodes.push('CATEGORY_EVIDENCE_UNANCHORED');
  }

  const bureauFacts = {};
  for (const [bureauKey, variant] of Object.entries(variants || {})) {
    const code = ROUTING_BUREAU_KEYS[bureauKey] || String(bureauKey).toUpperCase();
    if (!ROUTING_BUREAU_CODES.includes(code)) continue;
    const late = parseLatePaymentHistory(variant?.paymentHistory);
    const lateEvidence = fieldEvidence(variant, 'paymentHistory');
    bureauFacts[code] = {
      accountKind: kind,
      latePaymentCount: kind === 'late_payment' ? late.count : null,
      latePaymentBand: kind === 'late_payment' ? late.band : 'none',
      latePaymentStatus: kind === 'late_payment' ? late.status : 'not_applicable',
      latePaymentEvidence: kind === 'late_payment' ? late.evidence : null,
      latePaymentReason: kind === 'late_payment' ? (late.reason || null) : null,
      latePaymentEvidencePage: kind === 'late_payment' ? (lateEvidence?.page ?? null) : null,
    };
    if (kind === 'late_payment' && (late.status !== 'confirmed' || late.count < 1 || !lateEvidence)) blockingCodes.push('LATE_HISTORY_REVIEW_REQUIRED');
  }

  const uniqueBlockers = [...new Set(blockingCodes)];
  const counts = Object.values(bureauFacts).map((fact) => fact.latePaymentCount).filter((value) => Number.isInteger(value));
  const bands = Object.values(bureauFacts).map((fact) => fact.latePaymentBand).filter(Boolean);
  return {
    version: ROUTING_FACTS_VERSION,
    status: uniqueBlockers.length ? 'review_required' : 'confirmed',
    source: 'deterministic_report_facts',
    accountKind: kind,
    blockingCodes: uniqueBlockers,
    reportCoverage,
    evidence,
    bureauFacts,
    latePaymentCount: counts.length && new Set(counts).size === 1 ? counts[0] : null,
    latePaymentBand: bands.length && new Set(bands).size === 1 ? bands[0] : (kind === 'late_payment' ? 'per_bureau' : 'none'),
  };
}

export function hardRoutingBlockers(routingFacts = {}) {
  return (routingFacts.blockingCodes || []).filter((code) => HARD_ROUTING_BLOCKERS.includes(code));
}

export function routingFactForBureau(account = {}, bureauCode = null) {
  const facts = account.routingFacts || {};
  const code = bureauCode || (Array.isArray(account.bureaus) && account.bureaus.length === 1 ? account.bureaus[0] : null);
  return {
    status: facts.status || 'review_required',
    source: facts.source || null,
    accountKind: normalizeKind(account.accountKind || facts.accountKind),
    blockingCodes: Array.isArray(facts.blockingCodes) ? facts.blockingCodes : [],
    reportCoverage: facts.reportCoverage || null,
    bureauCode: code,
    bureauFact: code ? facts.bureauFacts?.[code] || null : null,
  };
}
