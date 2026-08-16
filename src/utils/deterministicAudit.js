import { lastFour, nameSimilarity, normalizeFurnisher } from './diffEngine.js';

// Bureaus routinely truncate or reformat the same furnisher's name
// differently (e.g. Equifax "JEFFERSON CAPITAL LL" vs Experian "JEFFERSON
// CAPITAL SYST" for the identical tradeline, same account suffix, same
// original creditor, same open date). accountKey()'s exact-string furnisher
// match then mints two half-blind accounts instead of one — each missing
// the other bureau's evidence, and neither flagged as ambiguous since
// within-bureau dedup never sees the mismatch. This mirrors
// accountIdentity.js's anchor: last-4 is the strong signal across bureaus,
// furnisher name only disambiguates a genuine last-4 collision.
const CROSS_BUREAU_NAME_MATCH_THRESHOLD = 0.5;
import {
  METRO2_FIELDS,
  validateDateOfLastPayment,
  validateDebtPurchaserConformity,
  validateScheduledPayment,
} from '../constants/metro2Fields.js';

export const DETERMINISTIC_AUDIT_SCHEMA_VERSION = 'deterministic-audit-v2';

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
      const evidence = extractedFields.size
        ? [...extractedFields.values()].filter((field) => field?.state === 'PRESENT' || field?.state === 'EXPLICITLY_BLANK').map((field) => ({
          field: field.name, rawValue: field.rawValue, page: field.page, label: field.label,
        }))
        : (Array.isArray(a.evidence) ? a.evidence : []);
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

function legacyViolation(finding) {
  return {
    ruleId: finding.ruleId,
    field: finding.field,
    issue: finding.issue,
    currentlyReports: finding.currentlyReports,
    shouldReport: finding.shouldReport,
    statute: finding.source,
    severity: finding.severity,
    evidenceRefs: finding.evidenceRefs,
    outcome: finding.outcome,
  };
}

function finding(ruleId, data) {
  return { ruleId, outcome: 'FLAG', ...data };
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
        outcome: v.verification_status ? 'REVIEW_REQUIRED' : 'FLAG',
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
  const grouped = new Map();
  reports.forEach((report) => {
    const baseKeys = report.accounts.map((account, index) => accountKey(account, index, report.bureau));
    const counts = baseKeys.reduce((map, key) => map.set(key, (map.get(key) || 0) + 1), new Map());
    report.accounts.forEach((account, index) => {
      const base = baseKeys[index];
      const key = counts.get(base) > 1 ? `${base}::ambiguous::${report.bureau}::${index}` : base;
      const four = lastFour(account?.accountNumber || account?.accountNumberMasked || '');
      const norm = normalizeFurnisher(account?.furnisher || account?.originalCreditor || '');

      // Only attempt a cross-bureau fold for a clean (non-collided,
      // non-unresolved) key — an already-ambiguous within-bureau duplicate
      // must stay flagged, not get absorbed into some other bureau's clean
      // single account.
      let targetKey = key;
      if (four && key === base) {
        let bestKey = null;
        let bestScore = -1;
        for (const [existingKey, existing] of grouped.entries()) {
          if (existing.last4 !== four) continue;
          if (existing.variants[report.bureau]) continue; // this bureau already has its own account in that group
          const sim = nameSimilarity(norm, existing.furnisherNorm);
          if (sim >= CROSS_BUREAU_NAME_MATCH_THRESHOLD && sim > bestScore) { bestScore = sim; bestKey = existingKey; }
        }
        if (bestKey) targetKey = bestKey;
      }

      if (!grouped.has(targetKey)) grouped.set(targetKey, { last4: four, furnisherNorm: norm, variants: {} });
      const group = grouped.get(targetKey);
      group.variants[report.bureau] = preferAccount(group.variants[report.bureau], account);
    });
  });

  const accounts = [];
  for (const [key, group] of grouped.entries()) {
    const variants = group.variants;
    const representative = Object.values(variants)[0];
    const findings = [...crossBureauFindings(variants), ...perVariantFindings(variants)];
    if (key.includes('::unresolved::') || key.includes('::ambiguous::')) {
      findings.unshift(finding('ACCOUNT_MATCH_AMBIGUOUS', {
        outcome: 'REVIEW_REQUIRED',
        field: 'Account identity',
        issue: 'This account has no stable masked-account suffix, so it was not matched to another bureau record.',
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
    accounts.push({
      id: key,
      furnisher: representative.furnisher,
      originalCreditor: representative.originalCreditor,
      accountNumberMasked: representative.accountNumber,
      type: collector ? 'C' : (paid ? 'B' : 'A'),
      status: representative.statusText || representative.accountStatus || 'Not displayed',
      balance: Object.values(variants).map((a) => a.balance).find(Number.isFinite) ?? 0,
      bureaus: Object.keys(variants).map((b) => BUREAU_CODES[b]),
      violations: findings.filter((f) => f.outcome === 'FLAG').map(legacyViolation),
      findings,
      primaryViolation: findings[0]?.issue || '',
      addressStatus: representative.furnisherAddress ? 'CONFIRM' : 'PENDING',
      furnisherAddress: representative.furnisherAddress || null,
      batch: 2,
      strategy: findings.length
        ? `Use only the ${findings.length} deterministic finding${findings.length === 1 ? '' : 's'} identified by rule ID and preserve the cited report evidence.`
        : 'No deterministic accuracy finding was established from displayed fields; staff review is required before targeting this account.',
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
        currentForGeneration: ageDays !== null && ageDays <= 45,
        requiredAction: ageDays === null || ageDays > 45 ? 'FRESH_REPORT_REQUIRED' : null,
      },
      authorizedFindingIds: findings.filter((entry) => entry.outcome === 'FLAG').map((entry) => entry.ruleId),
    });
  }
  accounts.sort((a, b) => b.violations.length - a.violations.length);
  accounts.filter((a) => a.violations.length).forEach((account, index) => { account.batch = index < 5 ? 1 : 2; });
  const totalViolations = accounts.reduce((sum, account) => sum + account.violations.length, 0);
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
    accounts,
    inquiries,
    personalInfo: mergePersonalInfo(reports),
    extraction: { schemaVersion: 'credit-extraction-v1', bureaus: reports.map((r) => r.bureau) },
  };
}
