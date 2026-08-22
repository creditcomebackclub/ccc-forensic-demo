import { lastFour, nameSimilarity, normalizeFurnisher } from './diffEngine.js';
import { deriveAccountRoutingFacts, reportCoverageFacts } from './disputeRoutingFacts.js';

// Bureaus routinely truncate or reformat the same furnisher's name
// differently (e.g. Equifax "JEFFERSON CAPITAL LL" vs Experian "JEFFERSON
// CAPITAL SYST" for the identical tradeline, same account suffix, same
// original creditor, same open date). accountKey()'s exact-string furnisher
// match then mints two half-blind accounts instead of one — each missing
// the other bureau's evidence, and neither flagged as ambiguous since
// within-bureau dedup never sees the mismatch. This mirrors
// accountIdentity.js's anchor: last-4 is the strong signal across bureaus,
// furnisher name only disambiguates a genuine last-4 collision.
//
// Multi-signal matching (below) still requires last-4 as the hard anchor,
// then scores additional signals (name, original creditor, open date, DOFD,
// balance band) so a weak name-only coincidence cannot fold two different
// tradelines together.
const CROSS_BUREAU_NAME_MATCH_THRESHOLD = 0.5;
import {
  METRO2_FIELDS,
  validateDateOfLastPayment,
  validateDebtPurchaserConformity,
  validateScheduledPayment,
} from '../constants/metro2Fields.js';

// Additive schema: v2/v3 fields remain; v4 adds evidence-backed routing facts
// and exact three-bureau coverage. These are the only automatic facts allowed
// to authorize a CCC R1 classification.
export const DETERMINISTIC_AUDIT_SCHEMA_VERSION = 'deterministic-audit-v4';

/** Single source of truth for report freshness (days). Used by timingChecks
 *  and by campaignBlueprint.auditFreshness when callers do not override. */
export const REPORT_MAX_AGE_DAYS = 45;

/** Matching thresholds for cross-bureau account folding. */
export const MATCH_THRESHOLDS = Object.freeze({
  name: CROSS_BUREAU_NAME_MATCH_THRESHOLD,
  /** Minimum independent signals (beyond last-4) required to auto-merge. */
  multiSignalMin: 2,
  dateWindowDays: 60,
  balanceRelativeTolerance: 0.15,
  balanceAbsoluteFloor: 25,
});

const SEVERITY_WEIGHT = Object.freeze({ high: 3, med: 2, low: 1 });

const BUREAU_KEYS = ['equifax', 'experian', 'transunion'];
const BUREAU_CODES = { equifax: 'EQ', experian: 'EXP', transunion: 'TU' };
const PAID_STATUSES = new Set(['13', '61', '62', '63', '64', '65']);
const COLLECTOR_ACCOUNT_TYPES = new Set(['0C', '48', '77']);
// Metro 2 Account Status codes for an active missed-payment delinquency
// stage (METRO2_STATUS_CODES 71/78/80/82/83/84 — "30-59" through "180+ days
// past the due date"). Deliberately excludes '11' ("0-29 days past due" —
// current, not delinquent).
const DELINQUENCY_STATUS_CODES = new Set(['71', '78', '80', '82', '83', '84']);
// Real reports almost never transcribe the raw two-digit code — they show
// free text like "120 days late" or "90 days past due". Match that
// phrasing directly rather than requiring the literal code, same reasoning
// as everywhere else in this file that free text won't equal a Metro 2
// code verbatim. Requires >=30 days so "0-29 days" (current) never matches.
function isActiveDelinquencyStatus(status) {
  const s = upper(status);
  if (!s) return false;
  if (DELINQUENCY_STATUS_CODES.has(s)) return true;
  const match = s.match(/\b(\d{2,3})\+?\s*(?:-\s*\d{1,3})?\s*DAYS?\b[^A-Z]{0,20}(PAST\s*DUE|LATE|DELINQUENT)/);
  return !!match && Number(match[1]) >= 30;
}

function bureauKey(value) {
  const v = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  if (v === 'eq' || v === 'equifax') return 'equifax';
  if (v === 'exp' || v === 'experian') return 'experian';
  if (v === 'tu' || v === 'transunion') return 'transunion';
  return null;
}

function clean(value) {
  return value == null ? null : String(value).trim() || null;
}

function upper(value) {
  return clean(value)?.toUpperCase() || null;
}

function normalizedDate(value) {
  const s = clean(value);
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const mdy = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (mdy) return `${mdy[3]}-${String(+mdy[1]).padStart(2, '0')}-${String(+mdy[2]).padStart(2, '0')}`;
  const my = s.match(/^(\d{1,2})[\/-](\d{4})$/);
  if (my) return `${my[2]}-${String(+my[1]).padStart(2, '0')}`;
  return s.toLowerCase().replace(/\s+/g, ' ');
}

function accountKey(account, index = 0, scope = 'unscoped') {
  const furnisher = normalizeFurnisher(account?.furnisher || account?.originalCreditor || '') || 'unknown';
  const four = lastFour(account?.accountNumber || account?.accountNumberMasked || '');
  if (four) return `${furnisher}::${four}`;
  const number = String(account?.accountNumber || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (number) return `${furnisher}::${number}`;
  return `${furnisher}::unresolved::${scope}::${index}`;
}

function evidenceFor(account, field, bureau) {
  const explicit = (account?.evidence || []).find((item) => item?.field === field);
  return {
    bureau: BUREAU_CODES[bureau] || bureau,
    field,
    page: explicit?.page ?? null,
    label: explicit?.label || null,
    rawValue: explicit?.rawValue ?? account?.[field] ?? null,
  };
}

function mergeStrings(values) {
  const seen = new Set();
  return (values || []).filter((value) => {
    const key = String(value || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function preferAccount(a, b) {
  if (!a) return { ...b };
  const score = (item) => Object.values(item || {}).filter((v) => v !== null && v !== '' && v !== undefined).length;
  const primary = score(b) > score(a) ? b : a;
  const secondary = primary === a ? b : a;
  const out = { ...secondary, ...primary };
  out.evidence = [...(a.evidence || []), ...(b.evidence || [])];
  out.explicitlyBlankFields = mergeStrings([...(a.explicitlyBlankFields || []), ...(b.explicitlyBlankFields || [])]);
  out.unreadableFields = mergeStrings([...(a.unreadableFields || []), ...(b.unreadableFields || [])]);
  return out;
}

function parseComparableDate(value) {
  if (!value) return null;
  const normalized = normalizedDate(value);
  if (!normalized) return null;
  // YYYY-MM or YYYY-MM-DD
  const iso = normalized.length === 7 ? `${normalized}-01` : normalized;
  const time = new Date(iso).getTime();
  return Number.isFinite(time) ? time : null;
}

function datesWithinWindow(a, b, windowDays = MATCH_THRESHOLDS.dateWindowDays) {
  const ta = parseComparableDate(a);
  const tb = parseComparableDate(b);
  if (ta == null || tb == null) return false;
  return Math.abs(ta - tb) <= windowDays * 86400000;
}

function balancesClose(a, b) {
  if (a == null || b == null || !Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) return false;
  const aa = Math.abs(Number(a));
  const bb = Math.abs(Number(b));
  const tolerance = Math.max(MATCH_THRESHOLDS.balanceAbsoluteFloor, MATCH_THRESHOLDS.balanceRelativeTolerance * Math.max(aa, bb));
  return Math.abs(aa - bb) <= tolerance;
}

/**
 * Score independent match signals between a candidate account and an existing
 * cross-bureau group. last-4 is assumed already matched by the caller.
 * Returns { score, signals[] } where score is the count of independent hits.
 */
function scoreCrossBureauSignals(candidate, group) {
  const signals = [];
  const candFurn = normalizeFurnisher(candidate?.furnisher || candidate?.originalCreditor || '');
  const groupFurn = group.furnisherNorm || '';
  const nameSim = nameSimilarity(candFurn, groupFurn);
  if (nameSim >= MATCH_THRESHOLDS.name) signals.push({ id: 'furnisher_name', strength: nameSim });

  const candOrig = normalizeFurnisher(candidate?.originalCreditor || '');
  const groupOrig = group.originalCreditorNorm || '';
  if (candOrig && groupOrig && nameSimilarity(candOrig, groupOrig) >= MATCH_THRESHOLDS.name) {
    signals.push({ id: 'original_creditor', strength: nameSimilarity(candOrig, groupOrig) });
  }

  // Use any existing variant as the date/balance reference.
  const ref = Object.values(group.variants || {})[0] || {};
  if (datesWithinWindow(candidate?.dateOpened, ref.dateOpened)) signals.push({ id: 'date_opened', strength: 1 });
  if (datesWithinWindow(candidate?.dofd, ref.dofd)) signals.push({ id: 'dofd', strength: 1 });
  if (balancesClose(candidate?.balance, ref.balance)) signals.push({ id: 'balance', strength: 1 });

  return { score: signals.length, signals, nameSim };
}

/**
 * Classify evidence quality for a finding's evidenceRefs.
 * page_backed: at least one observation has a finite page number
 * value_only: observations exist but none are page-anchored
 * insufficient: no usable refs
 */
export function evidenceQuality(evidenceRefs) {
  const refs = Array.isArray(evidenceRefs) ? evidenceRefs : [];
  if (!refs.length) return 'insufficient';
  const pageBacked = refs.filter((ref) => Number.isFinite(Number(ref?.page))).length;
  if (pageBacked > 0) return 'page_backed';
  const hasValue = refs.some((ref) => ref?.rawValue != null && ref.rawValue !== '');
  return hasValue ? 'value_only' : 'insufficient';
}

const SEVERITY_WEIGHT_LOOKUP = SEVERITY_WEIGHT;

/** Weighted priority for Batch-1 selection. Higher = more urgent. */
export function computePriorityScore(account) {
  const violations = Array.isArray(account?.violations) ? account.violations : [];
  const authorized = violations.filter((v) => !v.adjudication || v.adjudication.status === 'authorized');
  const severityScore = authorized.reduce((sum, v) => sum + (SEVERITY_WEIGHT_LOOKUP[v.severity] || 1), 0);
  const balance = Math.max(0, Number(account?.balance) || 0);
  const balanceBand = balance <= 0 ? 0 : Math.min(3, Math.log10(balance + 1));
  const collectorBonus = account?.type === 'C' ? 1.5 : 1;
  const crossBureauBonus = authorized.some((v) => String(v.ruleId || '').startsWith('CROSS_BUREAU_')) ? 1.25 : 1;
  return Number((severityScore * collectorBonus * crossBureauBonus + balanceBand * 0.5).toFixed(3));
}

/**
 * Default adjudication on every finding. Staff can later suppress or mark
 * needs_client_fact; only `authorized` findings flow into the Blueprint and
 * campaign routing.
 */
function withAdjudication(findingObj) {
  if (findingObj.adjudication) return findingObj;
  const status = findingObj.outcome === 'FLAG' ? 'authorized' : 'needs_client_fact';
  return {
    ...findingObj,
    adjudication: {
      status,
      reason: null,
      by: null,
      at: null,
    },
  };
}

/**
 * Apply staff adjudication to a finding. Pure helper for UI / API layers.
 * Does not mutate the input.
 */
export function applyFindingAdjudication(findingObj, { status, reason = null, by = null, at = null } = {}) {
  const allowed = new Set(['authorized', 'suppressed', 'needs_client_fact']);
  if (!allowed.has(status)) throw new Error(`Invalid adjudication status: ${status}`);
  return {
    ...findingObj,
    adjudication: {
      status,
      reason: reason || null,
      by: by || null,
      at: at || new Date().toISOString(),
    },
  };
}

export function isAuthorizedFinding(findingObj) {
  if (!findingObj) return false;
  if (findingObj.outcome && findingObj.outcome !== 'FLAG') return false;
  const status = findingObj.adjudication?.status;
  // Backward compatible: missing adjudication on a FLAG is treated as authorized.
  return !status || status === 'authorized';
}

/**
 * After staff adjudication changes on findings[], rebuild the derived
 * fields the Blueprint and campaign layer consume. Does not re-run rules.
 */
export function recomputeAccountFromFindings(account) {
  if (!account || typeof account !== 'object') return account;
  const findings = Array.isArray(account.findings) ? account.findings : [];
  const authorized = findings.filter(isAuthorizedFinding);
  const primary = authorized[0] || findings.find((f) => f.outcome === 'FLAG') || findings[0] || null;
  const next = {
    ...account,
    findings,
    violations: authorized.map((f) => ({
      ruleId: f.ruleId,
      field: f.field,
      issue: f.issue,
      currentlyReports: f.currentlyReports,
      shouldReport: f.shouldReport,
      statute: f.source || f.statute,
      severity: f.severity,
      evidenceRefs: f.evidenceRefs,
      outcome: f.outcome,
      evidenceQuality: f.evidenceQuality || null,
      verificationStatus: f.verificationStatus || null,
      adjudication: f.adjudication || null,
      challengeStatement: f.challengeStatement || challengeStatementFor(f),
    })),
    primaryViolation: primary?.issue || '',
    primaryChallengeStatement: primary ? challengeStatementFor(primary) : '',
    authorizedFindingIds: authorized.map((f) => f.ruleId),
    strategy: authorized.length
      ? `Use only the ${authorized.length} authorized deterministic finding${authorized.length === 1 ? '' : 's'} identified by rule ID and preserve the cited report evidence.`
      : 'No authorized deterministic accuracy finding was established from displayed fields; staff review is required before targeting this account.',
  };
  next.priorityScore = computePriorityScore(next);
  return next;
}

/**
 * Apply adjudication to one finding on an account and recompute derived fields.
 * Pure — does not mutate inputs.
 */
export function adjudicateAccountFinding(account, ruleId, adjudication) {
  const findings = (account?.findings || []).map((f) => {
    if (f.ruleId !== ruleId) return f;
    // Match first occurrence if duplicate ruleIds exist across bureaus —
    // callers should pass a more specific key when needed.
    return applyFindingAdjudication(f, adjudication);
  });
  // If multiple findings share a ruleId, only the first was updated above.
  // Prefer index-based updates from the UI when available.
  return recomputeAccountFromFindings({ ...account, findings });
}

export function adjudicateAccountFindingAt(account, findingIndex, adjudication) {
  const findings = (account?.findings || []).map((f, index) => (
    index === findingIndex ? applyFindingAdjudication(f, adjudication) : f
  ));
  return recomputeAccountFromFindings({ ...account, findings });
}

/** Client-facing challenge sentence derived from ruleId / field. Deterministic. */
export function challengeStatementFor(findingObj) {
  if (!findingObj) return 'Reporting accuracy issue documented in the forensic audit.';
  const ruleId = String(findingObj.ruleId || '');
  const field = String(findingObj.field || 'a reported field');
  if (ruleId.startsWith('CROSS_BUREAU_') && ruleId.endsWith('_MISMATCH')) {
    return `Bureaus report conflicting values for ${field} on the same matched account.`;
  }
  if (ruleId === 'PAID_STATUS_WITH_NONZERO_BALANCE') {
    return 'A paid or closed status is reported alongside a positive current balance.';
  }
  if (ruleId === 'PAID_STATUS_WITH_PAST_DUE') {
    return 'A paid or closed status is reported alongside a positive amount past due.';
  }
  if (ruleId === 'ZERO_BALANCE_WITH_ACTIVE_DELINQUENCY') {
    return 'A zero balance is reported alongside an active 30+ day delinquency status.';
  }
  if (ruleId.includes('DEBT_PURCHASER') || ruleId.includes('COLLECTOR') || ruleId.includes('CONFORMITY')) {
    return `Debt-purchaser / collector reporting on ${field} does not conform to the cited Metro 2 rule.`;
  }
  if (ruleId.includes('SCHEDULED_PAYMENT') || ruleId.includes('SCHEDULED_MONTHLY')) {
    return 'Scheduled monthly payment amount is inconsistent with the reported portfolio type or account status.';
  }
  if (ruleId.includes('DATE_OF_LAST_PAYMENT') || ruleId.includes('LAST_PAYMENT')) {
    return 'Date of last payment is inconsistent with the furnisher class or account placement timeline.';
  }
  if (ruleId.includes('XB') || ruleId.includes('COMPLIANCE_CONDITION')) {
    return 'Compliance Condition Code reporting requires review against the dispute and investigation timeline.';
  }
  return findingObj.issue || `Documented discrepancy on ${field}.`;
}

function collectCitationDebt(accounts) {
  const pending = [];
  for (const account of accounts || []) {
    for (const f of account.findings || []) {
      if (f.verificationStatus && String(f.verificationStatus).includes('PENDING')) {
        pending.push({
          accountId: account.id,
          ruleId: f.ruleId,
          field: f.field,
          verificationStatus: f.verificationStatus,
          furnisher: account.furnisher,
        });
      }
    }
  }
  return {
    count: pending.length,
    items: pending,
  };
}

export function coerceBureauExtraction(report, forcedBureau = null) {
  const bureau = bureauKey(forcedBureau || report?.bureau);
  if (!bureau) throw new Error('Credit extraction has no recognized bureau.');
  return {
    bureau,
    client: {
      name: clean(report?.client?.name) || 'Unknown Client',
      address: clean(report?.client?.address),
      score: Number.isFinite(report?.client?.score) ? report.client.score : null,
    },
    accounts: (report?.accounts || []).map((a) => {
      const extractedFields = new Map((a.fields || []).map((field) => [field?.name, field]));
      const value = (name, legacy) => {
        const field = extractedFields.get(name);
        if (!field) return legacy;
        if (field.state !== 'PRESENT') return null;
        return field.numericValue ?? clean(field.rawValue);
      };
      const explicitlyBlankFields = extractedFields.size
        ? [...extractedFields.values()].filter((field) => field?.state === 'EXPLICITLY_BLANK').map((field) => field.name)
        : (Array.isArray(a.explicitlyBlankFields) ? a.explicitlyBlankFields : []);
      const unreadableFields = extractedFields.size
        ? [...extractedFields.values()].filter((field) => field?.state === 'UNREADABLE').map((field) => field.name)
        : (Array.isArray(a.unreadableFields) ? a.unreadableFields : []);
      const structuredEvidence = extractedFields.size
        ? [...extractedFields.values()].filter((field) => field?.state === 'PRESENT' || field?.state === 'EXPLICITLY_BLANK').map((field) => ({
          field: field.name, rawValue: field.rawValue, page: field.page, label: field.label,
        }))
        : [];
      // Preserve page-anchored non-Field observations supplied by older or
      // future extractors (for example a source-reported type label). Routing
      // still requires the individual observation to carry a finite page.
      const legacyEvidence = Array.isArray(a.evidence) ? a.evidence : [];
      const evidence = [...structuredEvidence];
      for (const item of legacyEvidence) {
        if (!evidence.some((entry) => entry.field === (item?.field || item?.name)
          && Number(entry.page) === Number(item?.page)
          && String(entry.rawValue ?? '') === String(item?.rawValue ?? ''))) {
          evidence.push(item);
        }
      }
      return {
      furnisher: clean(a.furnisher) || 'Unknown Furnisher',
      furnisherAddress: clean(a.furnisherAddress),
      originalCreditor: clean(a.originalCreditor),
      accountNumber: clean(a.accountNumber || a.accountNumberMasked) || '',
      reportedType: clean(a.reportedType || a.type),
      portfolioType: clean(value('portfolioType', a.portfolioType)),
      accountType: clean(value('accountType', a.accountType)),
      accountStatus: clean(value('accountStatus', a.accountStatus || a.status)),
      statusText: clean(a.statusText || a.status),
      balance: Number.isFinite(value('balance', a.balance)) ? Number(value('balance', a.balance)) : null,
      pastDue: Number.isFinite(value('pastDue', a.pastDue)) ? Number(value('pastDue', a.pastDue)) : null,
      scheduledMonthlyPayment: Number.isFinite(value('scheduledMonthlyPayment', a.scheduledMonthlyPayment)) ? Number(value('scheduledMonthlyPayment', a.scheduledMonthlyPayment)) : null,
      originalLoanAmount: Number.isFinite(value('originalLoanAmount', a.originalLoanAmount)) ? Number(value('originalLoanAmount', a.originalLoanAmount)) : null,
      dateOpened: clean(value('dateOpened', a.dateOpened)), dofd: clean(value('dofd', a.dofd || a.dateOfFirstDelinquency)),
      dateClosed: clean(value('dateClosed', a.dateClosed)), lastPaymentDate: clean(value('lastPaymentDate', a.lastPaymentDate)),
      billingDate: clean(value('billingDate', a.billingDate)), paymentHistory: clean(value('paymentHistory', a.paymentHistory)),
      specialComment: clean(value('specialComment', a.specialComment)), complianceConditionCode: clean(value('complianceConditionCode', a.complianceConditionCode)),
      creditLimit: Number.isFinite(value('creditLimit', a.creditLimit)) ? Number(value('creditLimit', a.creditLimit)) : null,
      termsDuration: clean(value('termsDuration', a.termsDuration)),
      termsFrequency: clean(value('termsFrequency', a.termsFrequency)),
      actualPaymentAmount: Number.isFinite(value('actualPaymentAmount', a.actualPaymentAmount)) ? Number(value('actualPaymentAmount', a.actualPaymentAmount)) : null,
      paymentRating: clean(value('paymentRating', a.paymentRating)),
      originalChargeOffAmount: Number.isFinite(value('originalChargeOffAmount', a.originalChargeOffAmount)) ? Number(value('originalChargeOffAmount', a.originalChargeOffAmount)) : null,
      consumerDisputeIndicator: ['PRESENT', 'ABSENT'].includes(a.consumerDisputeIndicator)
        ? a.consumerDisputeIndicator : (a.disputeFlag === true ? 'PRESENT' : 'UNKNOWN'),
      remarks: clean(a.remarks),
      explicitlyBlankFields,
      unreadableFields,
      evidence,
    };
    }),
    inquiries: Array.isArray(report?.inquiries) ? report.inquiries : [],
    personalInfo: report?.personalInfo || {
      formerAddresses: [], nameVariants: [], formerEmployers: [],
      dateOfBirth: null, phone: null, currentAddress: null,
    },
  };
}

export function mergeBureauExtractions(parts, forcedBureau = null) {
  const usable = (parts || []).map((part) => coerceBureauExtraction(part, forcedBureau || part?.bureau));
  if (!usable.length) throw new Error('No bureau extraction parts to merge.');
  const accounts = new Map();
  usable.forEach((part, partIndex) => {
    const baseKeys = part.accounts.map((account, index) => accountKey(account, index, `${part.bureau}-part${partIndex}`));
    const counts = baseKeys.reduce((map, key) => map.set(key, (map.get(key) || 0) + 1), new Map());
    part.accounts.forEach((account, index) => {
      const base = baseKeys[index];
      const key = counts.get(base) > 1 ? `${base}::ambiguous::${index}` : base;
      accounts.set(key, preferAccount(accounts.get(key), account));
    });
  });
  const first = usable[0];
  const personalInfo = {
    formerAddresses: mergeStrings(usable.flatMap((p) => p.personalInfo?.formerAddresses || [])),
    nameVariants: mergeStrings(usable.flatMap((p) => p.personalInfo?.nameVariants || [])),
    formerEmployers: mergeStrings(usable.flatMap((p) => p.personalInfo?.formerEmployers || [])),
    dateOfBirth: usable.map((p) => p.personalInfo?.dateOfBirth).find(Boolean) || null,
    phone: usable.map((p) => p.personalInfo?.phone).find(Boolean) || null,
    currentAddress: usable.map((p) => p.personalInfo?.currentAddress).find(Boolean) || null,
  };
  return {
    bureau: first.bureau,
    client: {
      name: usable.map((p) => p.client?.name).find((v) => v && v !== 'Unknown Client') || first.client.name,
      address: usable.map((p) => p.client?.address).find(Boolean) || null,
      score: usable.map((p) => p.client?.score).find(Number.isFinite) ?? null,
    },
    accounts: [...accounts.values()],
    inquiries: usable.flatMap((p) => p.inquiries || []),
    personalInfo,
  };
}

export function mergeCombinedExtractions(parts) {
  const grouped = new Map();
  for (const part of parts || []) {
    for (const report of part?.reports || []) {
      const key = bureauKey(report.bureau);
      if (!key) continue;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(report);
    }
  }
  return BUREAU_KEYS.filter((key) => grouped.has(key))
    .map((key) => mergeBureauExtractions(grouped.get(key), key));
}

function legacyViolation(findingObj) {
  return {
    ruleId: findingObj.ruleId,
    field: findingObj.field,
    issue: findingObj.issue,
    currentlyReports: findingObj.currentlyReports,
    shouldReport: findingObj.shouldReport,
    statute: findingObj.source,
    severity: findingObj.severity,
    evidenceRefs: findingObj.evidenceRefs,
    outcome: findingObj.outcome,
    evidenceQuality: findingObj.evidenceQuality || evidenceQuality(findingObj.evidenceRefs),
    verificationStatus: findingObj.verificationStatus || null,
    adjudication: findingObj.adjudication || null,
    challengeStatement: findingObj.challengeStatement || challengeStatementFor(findingObj),
  };
}

function finding(ruleId, data) {
  const base = { ruleId, outcome: 'FLAG', ...data };
  const quality = base.evidenceQuality || evidenceQuality(base.evidenceRefs);
  const withQuality = { ...base, evidenceQuality: quality };
  // Soft evidence gate: high-severity cross-bureau mismatches with no
  // page-backed observations demote to REVIEW_REQUIRED so staff confirm
  // before the finding becomes an authorized target. Value-level mismatch
  // is still recorded — only the outcome changes.
  if (
    withQuality.outcome === 'FLAG'
    && withQuality.severity === 'high'
    && String(ruleId).startsWith('CROSS_BUREAU_')
    && quality === 'insufficient'
  ) {
    withQuality.outcome = 'REVIEW_REQUIRED';
  }
  const adjudicated = withAdjudication(withQuality);
  return {
    ...adjudicated,
    challengeStatement: adjudicated.challengeStatement || challengeStatementFor(adjudicated),
  };
}

// Every field the extraction schema actually captures per account (see
// FIELD_NAME in creditExtractionSchemas.js) gets a cross-bureau comparison
// here, EXCEPT two deliberately excluded as not meaningfully comparable by
// raw equality:
//   - paymentHistory (Field 18): a 24-month grid whose window/format varies
//     legitimately by bureau pull date — an exact-string check would flag
//     almost every account and drown real findings in noise.
//   - complianceConditionCode (Field 20): already has a dedicated,
//     timing-aware rule (validateXbRetention) — CCC codes are asynchronous
//     bureau-specific state (one bureau gets a direct dispute, another
//     doesn't), not something expected to match across bureaus at all.
// Field 7 (Consumer Account Number) is also excluded: it's the last-4 match
// ANCHOR these variants were grouped by, so comparing it here would either
// be a tautology (matched) or contradict the matcher itself (shouldn't
// happen) — not an independent signal.
function crossBureauFindings(variants) {
  const out = [];
  const specs = [
    ['dofd', '25', METRO2_FIELDS.DATE_FIRST_DELINQUENCY.name, normalizedDate, 'high'],
    ['accountStatus', '17A', METRO2_FIELDS.ACCOUNT_STATUS.name, upper, 'high'],
    ['accountType', METRO2_FIELDS.ACCOUNT_TYPE.num, METRO2_FIELDS.ACCOUNT_TYPE.name, upper, 'med'],
    ['portfolioType', METRO2_FIELDS.PORTFOLIO_TYPE.num, METRO2_FIELDS.PORTFOLIO_TYPE.name, upper, 'med'],
    ['balance', '21', METRO2_FIELDS.CURRENT_BALANCE.name, (v) => Number(v), 'med'],
    ['pastDue', METRO2_FIELDS.AMOUNT_PAST_DUE.num, METRO2_FIELDS.AMOUNT_PAST_DUE.name, (v) => Number(v), 'med'],
    ['dateOpened', METRO2_FIELDS.DATE_OPENED.num, METRO2_FIELDS.DATE_OPENED.name, normalizedDate, 'med'],
    ['lastPaymentDate', '27', METRO2_FIELDS.DATE_OF_LAST_PAYMENT.name, normalizedDate, 'med'],
    ['billingDate', '24', METRO2_FIELDS.BILLING_DATE.name, normalizedDate, 'low'],
    ['dateClosed', METRO2_FIELDS.DATE_CLOSED.num, METRO2_FIELDS.DATE_CLOSED.name, normalizedDate, 'low'],
    ['originalLoanAmount', METRO2_FIELDS.HIGHEST_CREDIT.num, METRO2_FIELDS.HIGHEST_CREDIT.name, (v) => Number(v), 'low'],
    ['specialComment', METRO2_FIELDS.SPECIAL_COMMENT.num, METRO2_FIELDS.SPECIAL_COMMENT.name, upper, 'low'],
    ['scheduledMonthlyPayment', METRO2_FIELDS.SCHEDULED_MONTHLY_PMT.num, METRO2_FIELDS.SCHEDULED_MONTHLY_PMT.name, (v) => Number(v), 'low'],
    ['creditLimit', METRO2_FIELDS.CREDIT_LIMIT.num, METRO2_FIELDS.CREDIT_LIMIT.name, (v) => Number(v), 'low'],
    ['termsDuration', METRO2_FIELDS.TERMS_DURATION.num, METRO2_FIELDS.TERMS_DURATION.name, upper, 'low'],
    ['termsFrequency', METRO2_FIELDS.TERMS_FREQUENCY.num, METRO2_FIELDS.TERMS_FREQUENCY.name, upper, 'low'],
    ['actualPaymentAmount', METRO2_FIELDS.ACTUAL_PAYMENT_AMOUNT.num, METRO2_FIELDS.ACTUAL_PAYMENT_AMOUNT.name, (v) => Number(v), 'low'],
    ['paymentRating', METRO2_FIELDS.PAYMENT_RATING.num, METRO2_FIELDS.PAYMENT_RATING.name, upper, 'med'],
    ['originalChargeOffAmount', METRO2_FIELDS.ORIGINAL_CHARGE_OFF_AMT.num, METRO2_FIELDS.ORIGINAL_CHARGE_OFF_AMT.name, (v) => Number(v), 'med'],
  ];
  for (const [property, number, label, normalize, severity] of specs) {
    const observed = [];
    for (const [bureau, account] of Object.entries(variants)) {
      const raw = account[property];
      if (raw === null || raw === undefined || raw === '') continue;
      const value = normalize(raw);
      if (value === null || (typeof value === 'number' && Number.isNaN(value))) continue;
      observed.push({ bureau, raw, value, evidence: evidenceFor(account, property, bureau) });
    }
    if (new Set(observed.map((v) => String(v.value))).size > 1) {
      const display = observed.map((v) => `${BUREAU_CODES[v.bureau]}: ${v.raw}`).join('; ');
      out.push(finding(`CROSS_BUREAU_${property.replace(/([A-Z])/g, '_$1').toUpperCase()}_MISMATCH`, {
        field: `Field ${number} (${label})`,
        issue: `The same matched account displays different ${label} values across bureaus. This is a discrepancy requiring source verification; this rule does not guess which bureau is correct.`,
        currentlyReports: display,
        shouldReport: 'Reconcile to one substantiated value after investigation',
        source: 'Deterministic cross-bureau consistency rule; FCRA §607(b) review lead',
        severity,
        evidenceRefs: observed.map((v) => v.evidence),
      }));
    }
  }
  return out;
}

// Mirrors crossBureauFindings' spec list exactly (same fields, same
// exclusions) so every field that can generate a finding also has a row in
// the staff-facing side-by-side table it points to via evidenceRefs.
function buildForensicComparison(variants) {
  const specs = [
    ['dofd', '25', METRO2_FIELDS.DATE_FIRST_DELINQUENCY.name, normalizedDate],
    ['accountStatus', '17A', METRO2_FIELDS.ACCOUNT_STATUS.name, upper],
    ['accountType', METRO2_FIELDS.ACCOUNT_TYPE.num, METRO2_FIELDS.ACCOUNT_TYPE.name, upper],
    ['portfolioType', METRO2_FIELDS.PORTFOLIO_TYPE.num, METRO2_FIELDS.PORTFOLIO_TYPE.name, upper],
    ['balance', '21', METRO2_FIELDS.CURRENT_BALANCE.name, (value) => Number(value)],
    ['pastDue', '22', METRO2_FIELDS.AMOUNT_PAST_DUE.name, (value) => Number(value)],
    ['dateOpened', METRO2_FIELDS.DATE_OPENED.num, METRO2_FIELDS.DATE_OPENED.name, normalizedDate],
    ['lastPaymentDate', '27', METRO2_FIELDS.DATE_OF_LAST_PAYMENT.name, normalizedDate],
    ['billingDate', '24', METRO2_FIELDS.BILLING_DATE.name, normalizedDate],
    ['dateClosed', METRO2_FIELDS.DATE_CLOSED.num, METRO2_FIELDS.DATE_CLOSED.name, normalizedDate],
    ['originalLoanAmount', METRO2_FIELDS.HIGHEST_CREDIT.num, METRO2_FIELDS.HIGHEST_CREDIT.name, (value) => Number(value)],
    ['specialComment', METRO2_FIELDS.SPECIAL_COMMENT.num, METRO2_FIELDS.SPECIAL_COMMENT.name, upper],
    ['scheduledMonthlyPayment', METRO2_FIELDS.SCHEDULED_MONTHLY_PMT.num, METRO2_FIELDS.SCHEDULED_MONTHLY_PMT.name, (value) => Number(value)],
    ['creditLimit', METRO2_FIELDS.CREDIT_LIMIT.num, METRO2_FIELDS.CREDIT_LIMIT.name, (value) => Number(value)],
    ['termsDuration', METRO2_FIELDS.TERMS_DURATION.num, METRO2_FIELDS.TERMS_DURATION.name, upper],
    ['termsFrequency', METRO2_FIELDS.TERMS_FREQUENCY.num, METRO2_FIELDS.TERMS_FREQUENCY.name, upper],
    ['actualPaymentAmount', METRO2_FIELDS.ACTUAL_PAYMENT_AMOUNT.num, METRO2_FIELDS.ACTUAL_PAYMENT_AMOUNT.name, (value) => Number(value)],
    ['paymentRating', METRO2_FIELDS.PAYMENT_RATING.num, METRO2_FIELDS.PAYMENT_RATING.name, upper],
    ['originalChargeOffAmount', METRO2_FIELDS.ORIGINAL_CHARGE_OFF_AMT.num, METRO2_FIELDS.ORIGINAL_CHARGE_OFF_AMT.name, (value) => Number(value)],
  ];
  return specs.map(([property, fieldNumber, label, normalize]) => {
    const observations = Object.entries(variants).map(([bureau, account]) => {
      const rawValue = account?.[property];
      const normalizedValue = rawValue === null || rawValue === undefined || rawValue === ''
        ? null : normalize(rawValue);
      return {
        bureau: BUREAU_CODES[bureau],
        rawValue: rawValue ?? null,
        normalizedValue: Number.isNaN(normalizedValue) ? null : normalizedValue,
        evidence: evidenceFor(account, property, bureau),
      };
    });
    const displayed = observations.filter((entry) => entry.normalizedValue !== null);
    const uniqueValues = new Set(displayed.map((entry) => String(entry.normalizedValue)));
    const pageBacked = displayed.filter((entry) => Number.isFinite(Number(entry.evidence?.page))).length;
    let mismatchStrength = 'INSUFFICIENT_DATA';
    if (displayed.length >= 2 && uniqueValues.size === 1) mismatchStrength = 'CONSISTENT';
    if (uniqueValues.size > 1) mismatchStrength = pageBacked === displayed.length
      ? 'CONFIRMED_CONTRADICTION' : 'STRONG_INCONSISTENCY';
    return {
      field: property,
      fieldNumber,
      label,
      mismatchStrength,
      observations,
    };
  });
}

function isCollector(account) {
  const accountType = upper(account.accountType);
  const text = `${account.reportedType || ''} ${account.statusText || ''} ${account.remarks || ''}`.toLowerCase();
  return COLLECTOR_ACCOUNT_TYPES.has(accountType) || /collection agency|debt purchaser|debt buyer|third[- ]party collector/.test(text);
}

function perVariantFindings(variants) {
  const out = [];
  for (const [bureau, account] of Object.entries(variants)) {
    const status = upper(account.accountStatus);
    const refs = (field) => [evidenceFor(account, field, bureau)];
    if (PAID_STATUSES.has(status) && Number(account.balance) > 0) {
      out.push(finding('PAID_STATUS_WITH_NONZERO_BALANCE', {
        field: `Fields 17A/21 (${METRO2_FIELDS.ACCOUNT_STATUS.name} / ${METRO2_FIELDS.CURRENT_BALANCE.name})`,
        issue: 'A paid/closed zero-balance status is reported with a positive current balance.',
        currentlyReports: `${BUREAU_CODES[bureau]}: status ${status}; balance $${account.balance}`,
        shouldReport: 'The status and balance must be mutually consistent',
        source: 'CRRG Base Segment Fields 17A and 21 consistency rule', severity: 'high',
        evidenceRefs: [...refs('accountStatus'), ...refs('balance')],
      }));
    }
    if (PAID_STATUSES.has(status) && Number(account.pastDue) > 0) {
      out.push(finding('PAID_STATUS_WITH_PAST_DUE', {
        field: `Fields 17A/22 (${METRO2_FIELDS.ACCOUNT_STATUS.name} / ${METRO2_FIELDS.AMOUNT_PAST_DUE.name})`,
        issue: 'A paid/closed zero-balance status is reported with a positive amount past due.',
        currentlyReports: `${BUREAU_CODES[bureau]}: status ${status}; past due $${account.pastDue}`,
        shouldReport: 'The status and amount past due must be mutually consistent',
        source: 'CRRG Base Segment Fields 17A and 22 consistency rule', severity: 'high',
        evidenceRefs: [...refs('accountStatus'), ...refs('pastDue')],
      }));
    }
    if (Number(account.balance) === 0 && isActiveDelinquencyStatus(account.accountStatus)) {
      out.push(finding('ZERO_BALANCE_WITH_ACTIVE_DELINQUENCY', {
        field: `Fields 17A/21 (${METRO2_FIELDS.ACCOUNT_STATUS.name} / ${METRO2_FIELDS.CURRENT_BALANCE.name})`,
        issue: 'A zero current balance is reported alongside an active missed-payment delinquency status. A $0 balance means nothing is owed, which cannot coexist with an active 30+ day delinquency stage.',
        currentlyReports: `${BUREAU_CODES[bureau]}: status ${status}; balance $0`,
        shouldReport: 'The status and balance must be mutually consistent',
        source: 'CRRG Base Segment Fields 17A and 21 consistency rule', severity: 'high',
        evidenceRefs: [...refs('accountStatus'), ...refs('balance')],
      }));
    }

    const collector = isCollector(account);
    if (collector && account.explicitlyBlankFields?.includes('dofd')) {
      out.push(finding('COLLECTION_DOFD_EXPLICITLY_BLANK', {
        field: `Field 25 (${METRO2_FIELDS.DATE_FIRST_DELINQUENCY.name})`,
        issue: 'The report visibly displays the Date of First Delinquency field as blank on a collection/debt-purchaser account.',
        currentlyReports: `${BUREAU_CODES[bureau]}: explicitly blank`,
        shouldReport: 'Investigate and report the substantiated original-creditor DOFD when required',
        source: '15 U.S.C. §1681s-2(a)(5); CRRG Field 25', severity: 'high',
        evidenceRefs: refs('dofd'),
      }));
    }
    if (account.consumerDisputeIndicator === 'PRESENT'
        && account.explicitlyBlankFields?.includes('complianceConditionCode')) {
      out.push(finding('DISPUTE_INDICATOR_WITH_EXPLICITLY_BLANK_FIELD_20', {
        outcome: 'REVIEW_REQUIRED',
        field: `Field 20 (${METRO2_FIELDS.COMPLIANCE_CONDITION_CODE.name})`,
        issue: 'The report explicitly identifies a consumer dispute while visibly displaying the Compliance Condition Code field as blank.',
        currentlyReports: `${BUREAU_CODES[bureau]}: dispute indicator present; Field 20 explicitly blank`,
        shouldReport: 'Investigate whether the applicable dispute code is required for this reporting cycle',
        source: 'CRRG Dec. 2024 Exhibit 8; requires dispute-context review', severity: 'high',
        evidenceRefs: refs('complianceConditionCode'),
      }));
    }

    const furnisherClass = collector ? 'DEBT_COLLECTOR' : 'ORIGINAL_CREDITOR';
    const deterministic = [
      ...validateDebtPurchaserConformity({
        furnisherClass,
        accountStatus: account.accountStatus,
        portfolioType: account.portfolioType,
        accountType: account.accountType,
        dateOpened: account.dateOpened,
        originalCreditorOriginationDate: null,
        dofd: account.dofd,
        dofdSource: null,
      }),
      validateScheduledPayment({
        portfolioType: account.portfolioType,
        accountStatus: account.accountStatus,
        scheduledMonthlyPayment: account.scheduledMonthlyPayment,
      }),
      validateDateOfLastPayment({
        furnisherClass,
        dateOfLastPayment: account.lastPaymentDate,
        accountPurchaseDate: account.dateOpened,
      }),
    ].filter((v) => v && v.isViolation !== false);
    for (const v of deterministic) {
      out.push(finding(v.type, {
        // Business decision (2026-08-15): debt-purchaser conformity findings
        // resolve to FLAG regardless of verification_status. The citation's
        // provenance metadata is preserved as-is below (verificationStatus)
        // so it's never misrepresented as independently re-verified — this
        // only changes whether that metadata gates the outcome, not what it
        // says about the source.
        outcome: 'FLAG',
        field: v.field,
        issue: v.issue,
        currentlyReports: `${BUREAU_CODES[bureau]}: ${v.found || 'nonconforming value displayed'}`,
        shouldReport: v.expected || 'Correct to the substantiated conforming value',
        source: v.statute || 'CRRG deterministic rule', severity: 'high',
        verificationStatus: v.verification_status || null,
        evidenceRefs: account.evidence || [],
      }));
    }
  }
  return out;
}

function mergePersonalInfo(reports) {
  return {
    formerAddresses: mergeStrings(reports.flatMap((r) => r.personalInfo?.formerAddresses || [])),
    nameVariants: mergeStrings(reports.flatMap((r) => r.personalInfo?.nameVariants || [])),
    formerEmployers: mergeStrings(reports.flatMap((r) => r.personalInfo?.formerEmployers || [])),
    dateOfBirth: reports.map((r) => r.personalInfo?.dateOfBirth).find(Boolean) || null,
    phone: reports.map((r) => r.personalInfo?.phone).find(Boolean) || null,
    currentAddress: reports.map((r) => r.personalInfo?.currentAddress).find(Boolean) || null,
  };
}

export function buildDeterministicAudit(rawReports, { reportDate = null } = {}) {
  const reports = (rawReports || []).map((report) => coerceBureauExtraction(report));
  if (!reports.length) throw new Error('No extracted bureau data was available for deterministic evaluation.');
  const reportCoverage = reportCoverageFacts(reports);
  const grouped = new Map();
  reports.forEach((report) => {
    const baseKeys = report.accounts.map((account, index) => accountKey(account, index, report.bureau));
    const counts = baseKeys.reduce((map, key) => map.set(key, (map.get(key) || 0) + 1), new Map());
    report.accounts.forEach((account, index) => {
      const base = baseKeys[index];
      const key = counts.get(base) > 1 ? `${base}::ambiguous::${report.bureau}::${index}` : base;
      const four = lastFour(account?.accountNumber || account?.accountNumberMasked || '');
      const norm = normalizeFurnisher(account?.furnisher || account?.originalCreditor || '');
      const origNorm = normalizeFurnisher(account?.originalCreditor || '');

      // Only attempt a cross-bureau fold for a clean (non-collided,
      // non-unresolved) key — an already-ambiguous within-bureau duplicate
      // must stay flagged, not get absorbed into some other bureau's clean
      // single account.
      // Multi-signal: last-4 is required; then at least multiSignalMin
      // independent supporting signals (name, original creditor, open date,
      // DOFD, balance band) before auto-merge.
      let targetKey = key;
      if (four && key === base) {
        let bestKey = null;
        let bestScore = -1;
        for (const [existingKey, existing] of grouped.entries()) {
          if (existing.last4 !== four) continue;
          if (existing.variants[report.bureau]) continue; // this bureau already has its own account in that group
          const { score } = scoreCrossBureauSignals(account, existing);
          // A similar furnisher name is only one signal. Never collapse two
          // tradelines unless the last-four anchor has at least two
          // independent supporting signals.
          const effective = score >= MATCH_THRESHOLDS.multiSignalMin;
          if (effective && score > bestScore) {
            bestScore = score;
            bestKey = existingKey;
          }
        }
        if (bestKey) targetKey = bestKey;
      }

      if (!grouped.has(targetKey)) {
        grouped.set(targetKey, {
          last4: four,
          furnisherNorm: norm,
          originalCreditorNorm: origNorm,
          variants: {},
        });
      }
      const group = grouped.get(targetKey);
      if (!group.originalCreditorNorm && origNorm) group.originalCreditorNorm = origNorm;
      group.variants[report.bureau] = preferAccount(group.variants[report.bureau], account);
    });
  });

  const last4GroupCounts = new Map();
  for (const group of grouped.values()) {
    if (!group.last4) continue;
    last4GroupCounts.set(group.last4, (last4GroupCounts.get(group.last4) || 0) + 1);
  }
  const ambiguousLast4s = new Set(
    [...last4GroupCounts.entries()].filter(([, count]) => count > 1).map(([suffix]) => suffix)
  );

  const accounts = [];
  for (const [key, group] of grouped.entries()) {
    const variants = group.variants;
    const representative = Object.values(variants)[0];
    const findings = [...crossBureauFindings(variants), ...perVariantFindings(variants)];
    if (key.includes('::unresolved::') || key.includes('::ambiguous::') || ambiguousLast4s.has(group.last4)) {
      findings.unshift(finding('ACCOUNT_MATCH_AMBIGUOUS', {
        outcome: 'REVIEW_REQUIRED',
        field: 'Account identity',
        issue: ambiguousLast4s.has(group.last4)
          ? `More than one unresolved tradeline shares masked-account suffix ${group.last4}; staff must confirm the exact account identities.`
          : 'This account has no stable masked-account suffix, so it was not matched to another bureau record.',
        currentlyReports: Object.keys(variants).map((b) => BUREAU_CODES[b]).join(', '),
        shouldReport: 'Staff must resolve account identity before any cross-bureau comparison',
        source: 'Deterministic account-matching safety rule',
        severity: 'med',
        evidenceRefs: [],
      }));
    }
    const collector = Object.values(variants).some(isCollector);
    const paid = Object.values(variants).some((a) => PAID_STATUSES.has(upper(a.accountStatus)));
    const reportTime = reportDate ? new Date(reportDate).getTime() : NaN;
    const ageDays = Number.isFinite(reportTime)
      ? Math.max(0, Math.floor((Date.now() - reportTime) / 86400000)) : null;
    const flaggedFindings = findings.filter((f) => f.outcome === 'FLAG');
    const authorizedFindingsList = flaggedFindings.filter(isAuthorizedFinding);
    const primary = authorizedFindingsList[0] || flaggedFindings[0] || findings[0] || null;
    const accountRecord = {
      id: key,
      furnisher: representative.furnisher,
      originalCreditor: representative.originalCreditor,
      accountNumberMasked: representative.accountNumber,
      type: collector ? 'C' : (paid ? 'B' : 'A'),
      status: representative.statusText || representative.accountStatus || 'Not displayed',
      balance: Object.values(variants).map((a) => a.balance).find(Number.isFinite) ?? 0,
      bureaus: Object.keys(variants).map((b) => BUREAU_CODES[b]),
      // violations = authorized FLAGs only (adjudication-aware)
      violations: authorizedFindingsList.map(legacyViolation),
      findings,
      primaryViolation: primary?.issue || '',
      primaryChallengeStatement: primary ? challengeStatementFor(primary) : '',
      addressStatus: representative.furnisherAddress ? 'CONFIRM' : 'PENDING',
      furnisherAddress: representative.furnisherAddress || null,
      batch: 2,
      priorityScore: 0, // filled after object is complete
      strategy: authorizedFindingsList.length
        ? `Use only the ${authorizedFindingsList.length} authorized deterministic finding${authorizedFindingsList.length === 1 ? '' : 's'} identified by rule ID and preserve the cited report evidence.`
        : 'No authorized deterministic accuracy finding was established from displayed fields; staff review is required before targeting this account.',
      // Field 17B was never actually extracted until now — this always fell
      // back to Field 17A's text (statusText/accountStatus), silently
      // relabeling Account Status as Payment Rating. Prefer the real
      // extracted 17B value now that one exists; keep the old fallback for
      // accounts where no bureau reported a rating distinct from status.
      paymentRating: representative.paymentRating || representative.statusText || representative.accountStatus || null,
      dateOfFirstDelinquency: representative.dofd || null,
      remarks: representative.remarks || null,
      disputeFlag: representative.consumerDisputeIndicator === 'PRESENT',
      extractedByBureau: variants,
      forensicComparison: buildForensicComparison(variants),
      timingChecks: {
        reportDate,
        ageDays,
        maxAgeDays: REPORT_MAX_AGE_DAYS,
        currentForGeneration: ageDays !== null && ageDays <= REPORT_MAX_AGE_DAYS,
        requiredAction: ageDays === null || ageDays > REPORT_MAX_AGE_DAYS ? 'FRESH_REPORT_REQUIRED' : null,
      },
      authorizedFindingIds: authorizedFindingsList.map((entry) => entry.ruleId),
    };
    accountRecord.routingFacts = deriveAccountRoutingFacts({ variants, findings, coverage: reportCoverage });
    accountRecord.accountKind = accountRecord.routingFacts.accountKind;
    accountRecord.latePaymentCount = accountRecord.routingFacts.latePaymentCount;
    accountRecord.latePaymentBand = accountRecord.routingFacts.latePaymentBand;
    accountRecord.latePaymentByBureau = accountRecord.routingFacts.bureauFacts;
    accountRecord.priorityScore = computePriorityScore(accountRecord);
    accounts.push(accountRecord);
  }
  // Rank by weighted priority (severity × collector/cross-bureau bonuses × balance band),
  // not raw violation count.
  accounts.sort((a, b) => (b.priorityScore - a.priorityScore) || (b.violations.length - a.violations.length));
  accounts.filter((a) => a.violations.length).forEach((account, index) => { account.batch = index < 5 ? 1 : 2; });
  const totalViolations = accounts.reduce((sum, account) => sum + account.violations.length, 0);
  const citationDebt = collectCitationDebt(accounts);
  const reportClock = reportDate ? new Date(reportDate) : new Date();
  const inquiries = reports.flatMap((report) => (report.inquiries || []).map((inquiry) => {
    const linked = accounts.find((account) => normalizeFurnisher(account.furnisher) === normalizeFurnisher(inquiry.furnisher));
    const inquiryDate = new Date(inquiry.date);
    const ageInMonths = Number.isNaN(inquiryDate.getTime())
      ? 0
      : Math.max(0, Math.floor((reportClock.getTime() - inquiryDate.getTime()) / (30.4375 * 86400000)));
    return {
      furnisher: inquiry.furnisher,
      date: inquiry.date,
      bureaus: [BUREAU_CODES[report.bureau]],
      linkedAccountId: linked?.id || null,
      ageInMonths,
      category: linked ? 'linked_to_open_account' : 'no_linked_account',
    };
  }));
  const clientName = reports.map((r) => r.client?.name).find((name) => name && name !== 'Unknown Client') || 'Unknown Client';
  const scores = { equifax: null, experian: null, transunion: null };
  reports.forEach((report) => { scores[report.bureau] = report.client?.score ?? null; });
  return {
    schemaVersion: DETERMINISTIC_AUDIT_SCHEMA_VERSION,
    evaluationMode: 'deterministic',
    client: {
      name: clientName,
      address: reports.map((r) => r.client?.address).find(Boolean) || null,
      reportDate,
      scores,
    },
    scores,
    executiveSummary: `${accounts.length} matched account record${accounts.length === 1 ? '' : 's'} evaluated; ${totalViolations} deterministic finding${totalViolations === 1 ? '' : 's'} produced. Ambiguous or undisplayed values were not guessed.`,
    accountsScanned: accounts.length,
    accountsTargeted: accounts.filter((a) => a.violations.length).length,
    totalViolations,
    citationDebt,
    reportCoverage,
    classificationReview: null,
    accounts,
    inquiries,
    personalInfo: mergePersonalInfo(reports),
    extraction: { schemaVersion: 'credit-extraction-v1', bureaus: reports.map((r) => r.bureau) },
  };
}
