import { lastFour, nameSimilarity, normalizeFurnisher } from './diffEngine.js';
import { deriveAccountRoutingFacts, reportCoverageFacts } from './disputeRoutingFacts.js';
import { CREDIT_ACCOUNT_FIELD_NAMES } from './creditExtractionSchemas.js';

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

export function normalizeReportDate(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return raw;
}

function normalizedIdentityName(value) {
  const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
  const tokens = String(value || '').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 2 && suffixes.has(tokens[tokens.length - 1])) tokens.pop();
  if (tokens.length < 2) return null;
  return { first: tokens[0], last: tokens[tokens.length - 1], canonical: `${tokens[0]}:${tokens[tokens.length - 1]}` };
}

function normalizedDob(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return normalizeReportDate(raw);
  const mdy = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!mdy) return null;
  return normalizeReportDate(`${mdy[3]}-${String(Number(mdy[1])).padStart(2, '0')}-${String(Number(mdy[2])).padStart(2, '0')}`);
}

function normalizedIdentityAddress(value) {
  const replacements = new Map([
    ['street', 'st'], ['road', 'rd'], ['avenue', 'ave'], ['boulevard', 'blvd'],
    ['drive', 'dr'], ['lane', 'ln'], ['court', 'ct'], ['place', 'pl'],
    ['parkway', 'pkwy'], ['highway', 'hwy'], ['apartment', 'apt'], ['suite', 'ste'],
    ['north', 'n'], ['south', 's'], ['east', 'e'], ['west', 'w'],
  ]);
  const tokens = String(value || '').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => replacements.get(token) || token);
  return tokens.length >= 3 ? tokens.join(' ') : null;
}

function isPageReference(value) {
  return value !== null && value !== undefined && value !== ''
    && Number.isInteger(Number(value)) && Number(value) >= 1;
}

function hasExtractedValue(value) {
  return value !== null && value !== undefined && value !== '';
}

function assertValuePagePair(label, value, page) {
  const hasValue = hasExtractedValue(value);
  const hasPage = isPageReference(page);
  if (hasValue && !hasPage) throw new Error(`The extracted ${label} has no source page reference.`);
  if (!hasValue && page !== null && page !== undefined && page !== '') {
    throw new Error(`The extracted ${label} has a source page but no displayed value.`);
  }
}

function consistentValuePagePair(rows, {
  label,
  value,
  page,
  normalize = (candidate) => String(candidate).trim().toLowerCase().replace(/\s+/g, ' '),
} = {}) {
  const observed = [];
  for (const row of rows || []) {
    const rawValue = value(row);
    const rawPage = page(row);
    assertValuePagePair(label, rawValue, rawPage);
    if (!hasExtractedValue(rawValue)) continue;
    observed.push({ value: rawValue, page: Number(rawPage), normalized: normalize(rawValue) });
  }
  const distinct = new Set(observed.map((entry) => entry.normalized));
  if (distinct.size > 1) throw new Error(`Split report parts display conflicting ${label} values.`);
  return observed[0] || { value: null, page: null, normalized: null };
}

/**
 * Fail-closed identity comparison used before a report can be attached to a
 * selected CRM client. Middle names/initials and suffixes may differ, but the
 * normalized first and last names must match. A CRM DOB, when present, must
 * match every DOB visibly extracted from the report. The mutable CRM mailing
 * address is deliberately not an audit-attribution key: clients may move, and
 * the separately verified current letter identity owns outbound addresses.
 */
export function assertConsistentReportIdentity(reports, selectedClient = null) {
  const rows = (reports || []).map((report) => ({
    bureau: bureauKey(report?.bureau),
    name: report?.client?.name,
    signature: normalizedIdentityName(report?.client?.name),
    rawDob: clean(report?.personalInfo?.dateOfBirth),
    dob: normalizedDob(report?.personalInfo?.dateOfBirth),
    nameEvidencePage: report?.client?.nameEvidencePage,
    dobEvidencePage: report?.personalInfo?.dateOfBirthEvidencePage,
  }));
  if (!rows.length || rows.some((row) => !row.signature)) {
    throw new Error('Every report must visibly identify the consumer by first and last name.');
  }
  if (rows.some((row) => !Number.isInteger(Number(row.nameEvidencePage)) || Number(row.nameEvidencePage) < 1)) {
    throw new Error('Every report consumer name must be bound to a valid source page.');
  }
  if (rows.some((row) => row.dob && (!Number.isInteger(Number(row.dobEvidencePage)) || Number(row.dobEvidencePage) < 1))) {
    throw new Error('Every extracted date of birth must be bound to a valid source page.');
  }
  if (rows.some((row) => row.rawDob && !row.dob)) {
    throw new Error('An extracted consumer date of birth is not a valid calendar date.');
  }
  const names = new Set(rows.map((row) => row.signature.canonical));
  if (names.size !== 1) throw new Error('The uploaded reports identify different consumers and cannot be combined.');
  const dobs = new Set(rows.map((row) => row.dob).filter(Boolean));
  if (dobs.size > 1) throw new Error('The uploaded reports display conflicting dates of birth and cannot be combined.');

  if (selectedClient) {
    const selected = normalizedIdentityName(selectedClient.name);
    if (!selected || selected.canonical !== rows[0].signature.canonical) {
      throw new Error('The report consumer does not match the exact CRM client selected for this audit.');
    }
    const selectedDobRaw = clean(selectedClient.dateOfBirth || selectedClient.date_of_birth);
    const selectedDob = normalizedDob(selectedDobRaw);
    if (selectedDobRaw && !selectedDob) throw new Error('The selected CRM client has an invalid date of birth.');
    if (selectedDob) {
      for (const row of rows) {
        if (row.dob && row.dob !== selectedDob) {
          throw new Error('A report date of birth does not match the selected CRM client.');
        }
      }
    }
  }
  return {
    canonicalName: rows[0].signature.canonical,
    dateOfBirth: [...dobs][0] || null,
  };
}

/** Validate source-derived bureau coverage and report cohort before rules run. */
export function assertReportCohort(reports, {
  requireThree = true,
  selectedClient = null,
  now = null,
  maxAgeDays = REPORT_MAX_AGE_DAYS,
} = {}) {
  const usable = reports || [];
  if (!usable.length) throw new Error('No extracted bureau reports were supplied.');
  const bureaus = usable.map((report) => bureauKey(report?.bureau));
  if (bureaus.some((bureau) => !bureau)) throw new Error('A report does not visibly identify its bureau.');
  if (new Set(bureaus).size !== bureaus.length) throw new Error('Duplicate bureau reports were supplied; exactly one report per bureau is required.');
  if (requireThree && (usable.length !== 3 || !BUREAU_KEYS.every((bureau) => bureaus.includes(bureau)))) {
    throw new Error('A unified 3B audit requires exactly one Equifax, one Experian, and one TransUnion report.');
  }

  const dates = usable.map((report) => normalizeReportDate(report?.reportDate));
  if (dates.some((date) => !date)) throw new Error('Every report must display an exact report-level date before it can be audited.');
  const uniqueDates = new Set(dates);
  if (uniqueDates.size !== 1) throw new Error('The reports are from different report dates and cannot be merged into one 3B cohort.');
  const reportDate = dates[0];
  const reportTime = new Date(`${reportDate}T00:00:00.000Z`).getTime();
  if (now === null || now === undefined || now === '') {
    throw new Error('Audit cohort validation requires an immutable evaluation timestamp.');
  }
  const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowTime)) throw new Error('Audit cohort validation received an invalid current date.');
  const ageDays = Math.floor((nowTime - reportTime) / 86400000);
  if (ageDays < -1) throw new Error('The report date is in the future and cannot be accepted.');
  if (requireThree && ageDays > maxAgeDays) {
    throw new Error(`The report cohort is ${ageDays} days old. A fresh 3B report (within ${maxAgeDays} days) is required.`);
  }
  return {
    reportDate,
    ageDays: Math.max(0, ageDays),
    bureaus,
    complete: requireThree,
    identity: assertConsistentReportIdentity(usable, selectedClient),
  };
}

function transformExtractionPageRefs(extraction, transformPage) {
  const copy = JSON.parse(JSON.stringify(extraction || {}));
  const mapPage = (value) => (
    isPageReference(value) ? transformPage(Number(value)) : value
  );
  const shiftReport = (report) => {
    if (!report || typeof report !== 'object') return;
    report.bureauEvidencePage = mapPage(report.bureauEvidencePage);
    if (isPageReference(report.reportSectionStartEvidencePage)) {
      report.reportSectionStartEvidencePage = mapPage(report.reportSectionStartEvidencePage);
    }
    report.reportDateEvidencePage = mapPage(report.reportDateEvidencePage);
    if (report.client) {
      report.client.nameEvidencePage = mapPage(report.client.nameEvidencePage);
      report.client.addressEvidencePage = mapPage(report.client.addressEvidencePage);
      report.client.scoreEvidencePage = mapPage(report.client.scoreEvidencePage);
    }
    if (isPageReference(report.personalInfo?.dateOfBirthEvidencePage)) {
      report.personalInfo.dateOfBirthEvidencePage = mapPage(report.personalInfo.dateOfBirthEvidencePage);
    }
    if (isPageReference(report.personalInfo?.phoneEvidencePage)) {
      report.personalInfo.phoneEvidencePage = mapPage(report.personalInfo.phoneEvidencePage);
    }
    if (isPageReference(report.personalInfo?.currentAddressEvidencePage)) {
      report.personalInfo.currentAddressEvidencePage = mapPage(report.personalInfo.currentAddressEvidencePage);
    }
    for (const listName of ['formerAddressEvidence', 'nameVariantEvidence', 'formerEmployerEvidence']) {
      for (const entry of report.personalInfo?.[listName] || []) {
        if (isPageReference(entry?.page)) entry.page = mapPage(entry.page);
      }
    }
    for (const inquiry of report.inquiries || []) {
      if (isPageReference(inquiry?.evidencePage)) inquiry.evidencePage = mapPage(inquiry.evidencePage);
    }
    for (const account of report.accounts || []) {
      for (const property of [
        'accountIdentityEvidencePage',
        'reportedTypeEvidencePage',
        'statusTextEvidencePage',
        'consumerDisputeIndicatorEvidencePage',
        'remarksEvidencePage',
      ]) {
        if (isPageReference(account?.[property])) account[property] = mapPage(account[property]);
      }
      for (const field of account.fields || []) {
        if (isPageReference(field.page)) field.page = mapPage(field.page);
      }
      for (const evidence of account.evidence || []) {
        if (isPageReference(evidence.page)) evidence.page = mapPage(evidence.page);
      }
    }
  };
  if (Array.isArray(copy.reports)) copy.reports.forEach(shiftReport);
  else shiftReport(copy);
  return copy;
}

/** Map model page references from a contiguous split attachment back to the source PDF. */
export function rebaseExtractionPageRefs(extraction, pageOffset = 0) {
  const offset = Number(pageOffset);
  if (!Number.isInteger(offset) || offset < 0) throw new Error('Page-reference offset must be a non-negative integer.');
  return transformExtractionPageRefs(extraction, (page) => page + offset);
}

/**
 * Map model-local pages through an exact provider-attachment/source-page map.
 * This is required when a combined-report checkpoint prepends a context page.
 */
export function mapExtractionPageRefs(extraction, sourcePageMap) {
  if (!Array.isArray(sourcePageMap) || !sourcePageMap.length
      || sourcePageMap.some((page) => !Number.isInteger(Number(page)) || Number(page) < 1)) {
    throw new Error('Source page map must contain positive source page numbers.');
  }
  const normalizedMap = sourcePageMap.map(Number);
  return transformExtractionPageRefs(extraction, (localPage) => {
    const sourcePage = normalizedMap[localPage - 1];
    if (!Number.isInteger(sourcePage)) {
      throw new Error(`Extraction cites local page ${localPage}, outside the provider attachment map.`);
    }
    return sourcePage;
  });
}

function substantiveEvidencePages(report) {
  return [
    report?.reportSectionStartEvidencePage,
    report?.client?.nameEvidencePage,
    report?.client?.addressEvidencePage,
    report?.client?.scoreEvidencePage,
    report?.personalInfo?.dateOfBirthEvidencePage,
    report?.personalInfo?.phoneEvidencePage,
    report?.personalInfo?.currentAddressEvidencePage,
    ...(report?.personalInfo?.formerAddressEvidence || []).map((entry) => entry?.page),
    ...(report?.personalInfo?.nameVariantEvidence || []).map((entry) => entry?.page),
    ...(report?.personalInfo?.formerEmployerEvidence || []).map((entry) => entry?.page),
    ...(report?.inquiries || []).map((inquiry) => inquiry?.evidencePage),
    ...(report?.accounts || []).flatMap((account) => [
      account?.accountIdentityEvidencePage,
      account?.reportedTypeEvidencePage,
      account?.statusTextEvidencePage,
      account?.consumerDisputeIndicatorEvidencePage,
      account?.remarksEvidencePage,
      ...(account?.fields || []).map((field) => field?.page),
      ...(account?.evidence || []).map((entry) => entry?.page),
    ]),
  ].filter(isPageReference).map(Number);
}

/**
 * Guard a combined checkpoint before source-page mapping. A sanitized context
 * page may prove bureau identity only; every other fact must cite a data page.
 * A data-bearing report without a bureau remains a hard failure.
 */
export function assertCombinedCheckpointAttribution(extraction, {
  contextLocalPages = [],
} = {}) {
  const contextPages = new Set((contextLocalPages || []).map(Number));
  if ([...contextPages].some((page) => !Number.isInteger(page) || page < 1)) {
    throw new Error('Combined checkpoint context pages are invalid.');
  }
  const seenBureaus = new Set();
  for (const report of extraction?.reports || []) {
    const dataBearing = (report?.accounts || []).length
      || (report?.inquiries || []).length
      || substantiveEvidencePages(report).length;
    const key = bureauKey(report?.bureau);
    if (dataBearing && !key) {
      throw new Error('A combined-report checkpoint contains data without a source-bound bureau identity.');
    }
    if (key) {
      if (seenBureaus.has(key)) {
        throw new Error(`A combined-report checkpoint contains more than one ${key} report object.`);
      }
      seenBureaus.add(key);
    }
    if (!contextPages.size) continue;
    if (report?.reportSectionStart === true) {
      throw new Error('A context-only bureau legend cannot be claimed as this checkpoint\'s report section start.');
    }
    if (contextPages.has(Number(report?.reportDateEvidencePage))) {
      throw new Error('A context-only bureau legend cannot be claimed as report-date evidence.');
    }
    if (substantiveEvidencePages(report).some((page) => contextPages.has(page))) {
      throw new Error('A combined-report checkpoint cited context-only page data as substantive evidence.');
    }
  }
  return extraction;
}

/** Validate every model-supplied page reference against the exact source. */
export function assertExtractionPageBounds(report, pageCount) {
  const maxPage = Number(pageCount);
  if (!Number.isInteger(maxPage) || maxPage < 1) throw new Error('Source page count must be a positive integer.');
  const required = [
    ['bureau', report?.bureau, report?.bureauEvidencePage],
    ['report date', report?.reportDate, report?.reportDateEvidencePage],
    ['consumer name', report?.client?.name, report?.client?.nameEvidencePage],
    ['consumer address', report?.client?.address, report?.client?.addressEvidencePage],
    ['consumer score', report?.client?.score, report?.client?.scoreEvidencePage],
    ['consumer date of birth', report?.personalInfo?.dateOfBirth, report?.personalInfo?.dateOfBirthEvidencePage],
    ['consumer phone', report?.personalInfo?.phone, report?.personalInfo?.phoneEvidencePage],
    ['consumer current address', report?.personalInfo?.currentAddress, report?.personalInfo?.currentAddressEvidencePage],
  ];
  if (typeof report?.reportSectionStart !== 'boolean') {
    throw new Error('Every extraction must explicitly identify whether it contains the bureau report section start.');
  }
  if (report.reportSectionStart === true && !isPageReference(report.reportSectionStartEvidencePage)) {
    throw new Error('The visible bureau report section start has no source page reference.');
  }
  if (report.reportSectionStart === false && report.reportSectionStartEvidencePage != null) {
    throw new Error('A continuation chunk cannot claim a bureau report section-start page.');
  }
  for (const [label, value, page] of required) {
    assertValuePagePair(label, value, page);
  }
  for (const account of report?.accounts || []) {
    const fieldNames = (account?.fields || []).map((field) => field?.name);
    if (fieldNames.length !== CREDIT_ACCOUNT_FIELD_NAMES.length
        || new Set(fieldNames).size !== CREDIT_ACCOUNT_FIELD_NAMES.length
        || CREDIT_ACCOUNT_FIELD_NAMES.some((name) => !fieldNames.includes(name))) {
      throw new Error('Each extracted account must contain exactly one entry for every allowed credit-report field.');
    }
    if (!isPageReference(account?.accountIdentityEvidencePage)) {
      throw new Error('The extracted account identity has no source page reference.');
    }
    for (const [label, value, page] of [
      ['reported type', account?.reportedType, account?.reportedTypeEvidencePage],
      ['status text', account?.statusText, account?.statusTextEvidencePage],
      ['account remarks', account?.remarks, account?.remarksEvidencePage],
    ]) {
      assertValuePagePair(label, value, page);
    }
    if (['PRESENT', 'ABSENT'].includes(account?.consumerDisputeIndicator)
        && !isPageReference(account?.consumerDisputeIndicatorEvidencePage)) {
      throw new Error('The extracted consumer dispute indicator has no source page reference.');
    }
    if (!['PRESENT', 'ABSENT'].includes(account?.consumerDisputeIndicator)
        && account?.consumerDisputeIndicatorEvidencePage != null) {
      throw new Error('The extracted consumer dispute indicator has a source page but no displayed value.');
    }
    for (const field of account?.fields || []) {
      if (['PRESENT', 'EXPLICITLY_BLANK'].includes(field?.state) && !isPageReference(field?.page)) {
        throw new Error(`The extracted ${field?.name || 'account field'} observation has no source page reference.`);
      }
    }
    for (const entry of account?.evidence || []) {
      if ((entry?.field || entry?.name || entry?.label || entry?.rawValue != null)
        && !isPageReference(entry?.page)) {
        throw new Error(`The extracted ${entry?.field || entry?.name || 'account evidence'} observation has no source page reference.`);
      }
    }
  }
  for (const inquiry of report?.inquiries || []) {
    if (!isPageReference(inquiry?.evidencePage)) {
      throw new Error('An extracted hard inquiry has no source page reference.');
    }
  }
  const personalGroups = [
    ['former address', report?.personalInfo?.formerAddresses, report?.personalInfo?.formerAddressEvidence],
    ['name variant', report?.personalInfo?.nameVariants, report?.personalInfo?.nameVariantEvidence],
    ['former employer', report?.personalInfo?.formerEmployers, report?.personalInfo?.formerEmployerEvidence],
  ];
  for (const [label, values, evidence] of personalGroups) {
    for (const value of values || []) {
      const match = (evidence || []).find((entry) => clean(entry?.value)?.toLowerCase() === clean(value)?.toLowerCase());
      if (!match || !isPageReference(match.page)) {
        throw new Error(`The extracted ${label} has no matching source page reference.`);
      }
    }
  }
  const refs = [
    report?.bureauEvidencePage,
    report?.reportSectionStartEvidencePage,
    report?.reportDateEvidencePage,
    report?.client?.nameEvidencePage,
    report?.client?.addressEvidencePage,
    report?.client?.scoreEvidencePage,
    report?.personalInfo?.dateOfBirthEvidencePage,
    report?.personalInfo?.phoneEvidencePage,
    report?.personalInfo?.currentAddressEvidencePage,
    ...(report?.personalInfo?.formerAddressEvidence || []).map((entry) => entry?.page),
    ...(report?.personalInfo?.nameVariantEvidence || []).map((entry) => entry?.page),
    ...(report?.personalInfo?.formerEmployerEvidence || []).map((entry) => entry?.page),
    ...(report?.inquiries || []).map((inquiry) => inquiry?.evidencePage),
    ...(report?.accounts || []).flatMap((account) => [
      account?.accountIdentityEvidencePage,
      account?.reportedTypeEvidencePage,
      account?.statusTextEvidencePage,
      account?.consumerDisputeIndicatorEvidencePage,
      account?.remarksEvidencePage,
      ...(account?.fields || []).map((field) => field?.page),
      ...(account?.evidence || []).map((entry) => entry?.page),
    ]),
  ].filter((page) => page !== null && page !== undefined);
  for (const page of refs) {
    if (!Number.isInteger(Number(page)) || Number(page) < 1 || Number(page) > maxPage) {
      throw new Error(`Extraction cites source page ${page}, outside the valid 1-${maxPage} range.`);
    }
  }
  return report;
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

const ACCOUNT_MERGE_NON_VALUE_KEYS = new Set([
  'evidence', 'fields', 'explicitlyBlankFields', 'unreadableFields',
  'accountIdentityEvidencePage', 'reportedTypeEvidencePage', 'statusTextEvidencePage',
  'consumerDisputeIndicatorEvidencePage', 'remarks', 'remarksEvidencePage',
]);

const EXTRACTED_FIELD_STATE_RANK = Object.freeze({
  NOT_SHOWN: 0,
  UNREADABLE: 1,
  EXPLICITLY_BLANK: 2,
  PRESENT: 3,
});

function comparableExtractedFieldValue(field) {
  if (field?.state === 'EXPLICITLY_BLANK') return '__BLANK__';
  if (field?.state !== 'PRESENT') return null;
  if (Number.isFinite(field?.numericValue)) return `number:${Number(field.numericValue)}`;
  return `text:${String(field?.rawValue ?? '').trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

function mergeExtractedFields(leftFields, rightFields) {
  const left = new Map((leftFields || []).map((field) => [field?.name, field]));
  const right = new Map((rightFields || []).map((field) => [field?.name, field]));
  return CREDIT_ACCOUNT_FIELD_NAMES.map((name) => {
    const a = left.get(name);
    const b = right.get(name);
    if (!a) return b;
    if (!b) return a;
    const aValue = comparableExtractedFieldValue(a);
    const bValue = comparableExtractedFieldValue(b);
    if (aValue !== null && bValue !== null && aValue !== bValue) {
      throw new Error(`Overlapping report chunks contain conflicting ${name} values for the same account.`);
    }
    const aRank = EXTRACTED_FIELD_STATE_RANK[a.state] ?? -1;
    const bRank = EXTRACTED_FIELD_STATE_RANK[b.state] ?? -1;
    return bRank > aRank ? b : a;
  }).filter(Boolean);
}

function comparableAccountMergeValue(key, value) {
  if (value === null || value === undefined || value === '' || value === 'UNKNOWN') return null;
  if (typeof value === 'number') return String(value);
  if (key === 'furnisher' || key === 'originalCreditor') return normalizeFurnisher(value);
  if (key === 'accountNumber') return String(value).replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (/date/i.test(key)) return normalizedDate(value);
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function assertNoChunkAccountConflict(a, b) {
  for (const key of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    if (ACCOUNT_MERGE_NON_VALUE_KEYS.has(key)) continue;
    const left = comparableAccountMergeValue(key, a?.[key]);
    const right = comparableAccountMergeValue(key, b?.[key]);
    if (left !== null && right !== null && left !== right) {
      throw new Error(`Overlapping report chunks contain conflicting ${key} values for the same account.`);
    }
  }
  for (const blankField of a?.explicitlyBlankFields || []) {
    if (comparableAccountMergeValue(blankField, b?.[blankField]) !== null) {
      throw new Error(`Overlapping report chunks conflict on blank versus displayed ${blankField} for the same account.`);
    }
  }
  for (const blankField of b?.explicitlyBlankFields || []) {
    if (comparableAccountMergeValue(blankField, a?.[blankField]) !== null) {
      throw new Error(`Overlapping report chunks conflict on blank versus displayed ${blankField} for the same account.`);
    }
  }
}

function normalizedTextTokens(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
}

function containsTokenSequence(longer, shorter) {
  if (!shorter.length || shorter.length > longer.length) return false;
  for (let index = 0; index <= longer.length - shorter.length; index += 1) {
    if (shorter.every((token, offset) => longer[index + offset] === token)) return true;
  }
  return false;
}

function mergeOverlapRemarks(a, b) {
  const left = clean(a?.remarks);
  const right = clean(b?.remarks);
  if (!left) return { remarks: right, remarksEvidencePage: b?.remarksEvidencePage ?? null };
  if (!right) return { remarks: left, remarksEvidencePage: a?.remarksEvidencePage ?? null };

  const leftTokens = normalizedTextTokens(left);
  const rightTokens = normalizedTextTokens(right);
  if (leftTokens.length && rightTokens.length && leftTokens.join(' ') === rightTokens.join(' ')) {
    return left.length >= right.length
      ? { remarks: left, remarksEvidencePage: a?.remarksEvidencePage ?? null }
      : { remarks: right, remarksEvidencePage: b?.remarksEvidencePage ?? null };
  }
  const leftPage = Number(a?.remarksEvidencePage);
  const rightPage = Number(b?.remarksEvidencePage);
  if (isPageReference(leftPage) && leftPage === rightPage) {
    if (containsTokenSequence(leftTokens, rightTokens)) {
      return { remarks: left, remarksEvidencePage: leftPage };
    }
    if (containsTokenSequence(rightTokens, leftTokens)) {
      return { remarks: right, remarksEvidencePage: rightPage };
    }
  }
  throw new Error('Overlapping report chunks contain conflicting remarks values for the same account.');
}

export function mergeOverlappingAccountExtracts(a, b) {
  if (!a) return { ...b };
  assertNoChunkAccountConflict(a, b);
  const mergedRemarks = mergeOverlapRemarks(a, b);
  const score = (item) => Object.values(item || {}).filter((v) => v !== null && v !== '' && v !== undefined).length;
  const primary = score(b) > score(a) ? b : a;
  const secondary = primary === a ? b : a;
  // Chunk overlap is sparse: a later continuation often has more populated
  // columns overall while leaving fields from the earlier page null. Merge
  // property-by-property so a null never erases a visible source value.
  const out = { ...secondary };
  for (const [key, value] of Object.entries(primary || {})) {
    if (value !== null && value !== undefined && value !== '') out[key] = value;
  }
  out.evidence = [...(a.evidence || []), ...(b.evidence || [])];
  out.fields = mergeExtractedFields(a.fields, b.fields);
  out.explicitlyBlankFields = mergeStrings([...(a.explicitlyBlankFields || []), ...(b.explicitlyBlankFields || [])]);
  out.unreadableFields = mergeStrings([...(a.unreadableFields || []), ...(b.unreadableFields || [])]);
  out.remarks = mergedRemarks.remarks;
  out.remarksEvidencePage = mergedRemarks.remarksEvidencePage;
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
 * page_backed: every load-bearing observation has a valid page number
 * value_only: observations exist but at least one is not page-anchored
 * insufficient: no usable refs
 */
export function evidenceQuality(evidenceRefs) {
  const refs = Array.isArray(evidenceRefs) ? evidenceRefs : [];
  if (!refs.length) return 'insufficient';
  if (refs.every((ref) => isPageReference(ref?.page))) return 'page_backed';
  const hasValue = refs.some((ref) => ref?.rawValue != null && ref.rawValue !== '');
  return hasValue ? 'value_only' : 'insufficient';
}

const SEVERITY_WEIGHT_LOOKUP = SEVERITY_WEIGHT;

/** Weighted priority for Batch-1 selection. Higher = more urgent. */
export function computePriorityScore(account) {
  const violations = Array.isArray(account?.violations) ? account.violations : [];
  // Missing adjudication is not authority. This mirrors the finding gate so
  // legacy/unreviewed rows cannot regain priority merely because a caller
  // passed them through the older `violations` shape.
  const authorized = violations.filter(isAuthorizedFinding);
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
  const pendingSource = String(findingObj.verificationStatus || '').includes('PENDING');
  const status = findingObj.outcome === 'FLAG'
    && evidenceQuality(findingObj.evidenceRefs) === 'page_backed'
    && !pendingSource
    ? 'authorized'
    : 'needs_client_fact';
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
  // Missing adjudication is never authority. Historical stored violations
  // remain visible, but any recomputation or new routing must have an explicit
  // authorized status produced by a page-backed, currently-sourced rule or a
  // later staff adjudication.
  return status === 'authorized';
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

export function coerceBureauExtraction(report, expectedBureau = null, options = {}) {
  for (const [label, value, page] of [
    ['bureau', report?.bureau, report?.bureauEvidencePage],
    ['report date', report?.reportDate, report?.reportDateEvidencePage],
    ['consumer name', report?.client?.name, report?.client?.nameEvidencePage],
    ['consumer address', report?.client?.address, report?.client?.addressEvidencePage],
    ['consumer score', report?.client?.score, report?.client?.scoreEvidencePage],
    ['consumer date of birth', report?.personalInfo?.dateOfBirth, report?.personalInfo?.dateOfBirthEvidencePage],
    ['consumer phone', report?.personalInfo?.phone, report?.personalInfo?.phoneEvidencePage],
    ['consumer current address', report?.personalInfo?.currentAddress, report?.personalInfo?.currentAddressEvidencePage],
  ]) assertValuePagePair(label, value, page);
  for (const account of report?.accounts || []) {
    for (const [label, value, page] of [
      ['reported type', account?.reportedType, account?.reportedTypeEvidencePage],
      ['status text', account?.statusText, account?.statusTextEvidencePage],
      ['account remarks', account?.remarks, account?.remarksEvidencePage],
    ]) assertValuePagePair(label, value, page);
    if (['PRESENT', 'ABSENT'].includes(account?.consumerDisputeIndicator)) {
      assertValuePagePair('consumer dispute indicator', account.consumerDisputeIndicator, account.consumerDisputeIndicatorEvidencePage);
    } else if (account?.consumerDisputeIndicatorEvidencePage != null) {
      throw new Error('The extracted consumer dispute indicator has a source page but no displayed value.');
    }
    for (const field of account?.fields || []) {
      if (['PRESENT', 'EXPLICITLY_BLANK'].includes(field?.state) && !isPageReference(field?.page)) {
        throw new Error(`The extracted ${field?.name || 'account field'} observation has no source page reference.`);
      }
      if (field?.state === 'NOT_SHOWN' && field?.page != null) {
        throw new Error(`The unshown ${field?.name || 'account field'} cannot claim a source page.`);
      }
    }
  }
  const detectedBureau = bureauKey(report?.bureau);
  const expected = bureauKey(expectedBureau);
  if (expected && detectedBureau && expected !== detectedBureau) {
    throw new Error(`The ${expected} upload slot contains a source-identified ${detectedBureau} report.`);
  }
  const inherited = bureauKey(options.inheritedBureau);
  const bureau = detectedBureau || (options.allowInheritedMetadata ? inherited : null);
  if (!bureau) throw new Error('Credit extraction has no source-derived recognized bureau.');
  const reportDate = normalizeReportDate(report?.reportDate)
    || (options.allowInheritedMetadata ? normalizeReportDate(options.inheritedReportDate) : null);
  return {
    bureau,
    bureauEvidencePage: isPageReference(report?.bureauEvidencePage) ? Number(report.bureauEvidencePage) : null,
    reportSectionStart: report?.reportSectionStart === false ? false : true,
    reportSectionStartEvidencePage: isPageReference(report?.reportSectionStartEvidencePage)
      ? Number(report.reportSectionStartEvidencePage) : null,
    reportDate,
    reportDateRaw: clean(report?.reportDateRaw),
    reportDateEvidencePage: isPageReference(report?.reportDateEvidencePage) ? Number(report.reportDateEvidencePage) : null,
    client: {
      name: clean(report?.client?.name),
      nameEvidencePage: isPageReference(report?.client?.nameEvidencePage) ? Number(report.client.nameEvidencePage) : null,
      address: clean(report?.client?.address),
      addressEvidencePage: isPageReference(report?.client?.addressEvidencePage) ? Number(report.client.addressEvidencePage) : null,
      score: Number.isFinite(report?.client?.score) ? report.client.score : null,
      scoreEvidencePage: isPageReference(report?.client?.scoreEvidencePage) ? Number(report.client.scoreEvidencePage) : null,
    },
    accounts: (report?.accounts || []).map((a) => {
      const normalizedFields = (a.fields || []).map((field) => ({
        name: field?.name,
        rawValue: field?.rawValue == null ? null : String(field.rawValue),
        numericValue: Number.isFinite(field?.numericValue) ? Number(field.numericValue) : null,
        state: field?.state,
        page: isPageReference(field?.page) ? Number(field.page) : null,
        label: field?.label == null ? null : String(field.label),
      }));
      const extractedFields = new Map(normalizedFields.map((field) => [field?.name, field]));
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
      const rootEvidence = [
        {
          field: 'accountIdentity',
          rawValue: [a.furnisher, a.originalCreditor, a.accountNumber || a.accountNumberMasked].filter(Boolean).join(' | '),
          page: a.accountIdentityEvidencePage,
          label: 'Account identity',
        },
        { field: 'reportedType', rawValue: a.reportedType || a.type, page: a.reportedTypeEvidencePage, label: 'Reported type' },
        { field: 'statusText', rawValue: a.statusText || a.status, page: a.statusTextEvidencePage, label: 'Status text' },
        {
          field: 'consumerDisputeIndicator',
          rawValue: a.consumerDisputeIndicator,
          page: a.consumerDisputeIndicatorEvidencePage,
          label: 'Consumer dispute indicator',
        },
        { field: 'remarks', rawValue: a.remarks, page: a.remarksEvidencePage, label: 'Remarks' },
      ].filter((entry) => entry.rawValue !== null && entry.rawValue !== undefined && entry.rawValue !== 'UNKNOWN' && entry.rawValue !== '');
      // Preserve page-anchored non-Field observations supplied by older or
      // future extractors (for example a source-reported type label). Routing
      // still requires the individual observation to carry a finite page.
      const legacyEvidence = Array.isArray(a.evidence) ? a.evidence : [];
      const evidence = [...rootEvidence, ...structuredEvidence];
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
      accountIdentityEvidencePage: isPageReference(a.accountIdentityEvidencePage) ? Number(a.accountIdentityEvidencePage) : null,
      reportedType: clean(a.reportedType || a.type),
      reportedTypeEvidencePage: isPageReference(a.reportedTypeEvidencePage) ? Number(a.reportedTypeEvidencePage) : null,
      portfolioType: clean(value('portfolioType', a.portfolioType)),
      accountType: clean(value('accountType', a.accountType)),
      accountStatus: clean(value('accountStatus', a.accountStatus || a.status)),
      statusText: clean(a.statusText || a.status),
      statusTextEvidencePage: isPageReference(a.statusTextEvidencePage) ? Number(a.statusTextEvidencePage) : null,
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
      consumerDisputeIndicatorEvidencePage: isPageReference(a.consumerDisputeIndicatorEvidencePage)
        ? Number(a.consumerDisputeIndicatorEvidencePage) : null,
      remarks: clean(a.remarks),
      remarksEvidencePage: isPageReference(a.remarksEvidencePage) ? Number(a.remarksEvidencePage) : null,
      fields: normalizedFields,
      explicitlyBlankFields,
      unreadableFields,
      evidence,
    };
    }),
    inquiries: Array.isArray(report?.inquiries) ? report.inquiries.map((inquiry) => ({
      ...inquiry,
      evidencePage: isPageReference(inquiry?.evidencePage) ? Number(inquiry.evidencePage) : null,
    })) : [],
    personalInfo: {
      formerAddresses: Array.isArray(report?.personalInfo?.formerAddresses) ? report.personalInfo.formerAddresses : [],
      formerAddressEvidence: Array.isArray(report?.personalInfo?.formerAddressEvidence) ? report.personalInfo.formerAddressEvidence : [],
      nameVariants: Array.isArray(report?.personalInfo?.nameVariants) ? report.personalInfo.nameVariants : [],
      nameVariantEvidence: Array.isArray(report?.personalInfo?.nameVariantEvidence) ? report.personalInfo.nameVariantEvidence : [],
      formerEmployers: Array.isArray(report?.personalInfo?.formerEmployers) ? report.personalInfo.formerEmployers : [],
      formerEmployerEvidence: Array.isArray(report?.personalInfo?.formerEmployerEvidence) ? report.personalInfo.formerEmployerEvidence : [],
      dateOfBirth: clean(report?.personalInfo?.dateOfBirth),
      dateOfBirthEvidencePage: isPageReference(report?.personalInfo?.dateOfBirthEvidencePage)
        ? Number(report.personalInfo.dateOfBirthEvidencePage) : null,
      phone: clean(report?.personalInfo?.phone),
      phoneEvidencePage: isPageReference(report?.personalInfo?.phoneEvidencePage)
        ? Number(report.personalInfo.phoneEvidencePage) : null,
      currentAddress: clean(report?.personalInfo?.currentAddress),
      currentAddressEvidencePage: isPageReference(report?.personalInfo?.currentAddressEvidencePage)
        ? Number(report.personalInfo.currentAddressEvidencePage) : null,
    },
  };
}

function inquiryMergeKey(inquiry) {
  return [
    normalizeFurnisher(inquiry?.furnisher || ''),
    normalizedDate(inquiry?.date) || clean(inquiry?.date) || '',
    upper(inquiry?.type) || '',
  ].join('::');
}

function mergeInquiries(parts) {
  const seen = new Map();
  for (const inquiry of (parts || []).flatMap((part) => part?.inquiries || [])) {
    const key = inquiryMergeKey(inquiry);
    if (!seen.has(key)) seen.set(key, inquiry);
  }
  return [...seen.values()];
}

function mergePersonalEvidence(parts, property) {
  const seen = new Map();
  for (const entry of (parts || []).flatMap((part) => part?.personalInfo?.[property] || [])) {
    const value = clean(entry?.value);
    if (!value || !isPageReference(entry?.page)) continue;
    const key = `${value.toLowerCase()}::${Number(entry.page)}`;
    if (!seen.has(key)) seen.set(key, { value, page: Number(entry.page) });
  }
  return [...seen.values()];
}

export function mergeBureauExtractions(parts, expectedBureau = null) {
  const rawParts = parts || [];
  if (!rawParts.length) throw new Error('No bureau extraction parts to merge.');
  const sectionStarts = rawParts.filter((part) => part?.reportSectionStart === true);
  for (const sectionStart of sectionStarts) {
    if (!isPageReference(sectionStart?.reportSectionStartEvidencePage)) {
      throw new Error('The visible bureau report section start has no source page reference.');
    }
  }
  // Adjacent PDF checkpoints overlap by two pages. The same visible bureau
  // header can therefore be extracted twice from the exact same source page;
  // that is one section, not two. Distinct source pages remain a hard stop.
  const distinctSectionStarts = [...new Map(sectionStarts.map((part) => [
    Number(part.reportSectionStartEvidencePage), part,
  ])).values()];
  if (distinctSectionStarts.length !== 1) {
    throw new Error(distinctSectionStarts.length
      ? 'The source contains more than one bureau report section for the same bureau.'
      : 'No visible bureau report section start was extracted from this source.');
  }
  const detected = [...new Set(rawParts.map((part) => bureauKey(part?.bureau)).filter(Boolean))];
  if (detected.length !== 1) {
    throw new Error(detected.length
      ? 'Split report parts identify conflicting bureaus.'
      : 'No split report part visibly identifies its bureau.');
  }
  const expected = bureauKey(expectedBureau);
  if (expected && detected[0] !== expected) {
    throw new Error(`The ${expected} upload slot contains a source-identified ${detected[0]} report.`);
  }
  const detectedDates = [...new Set(rawParts.map((part) => normalizeReportDate(part?.reportDate)).filter(Boolean))];
  if (detectedDates.length !== 1) {
    throw new Error(detectedDates.length
      ? 'Split report parts display conflicting report-level dates.'
      : 'No split report part displays an exact report-level date.');
  }
  const bureauPair = consistentValuePagePair(rawParts, {
    label: 'bureau', value: (part) => part?.bureau, page: (part) => part?.bureauEvidencePage,
    normalize: (candidate) => bureauKey(candidate) || String(candidate).trim().toLowerCase(),
  });
  const reportDatePair = consistentValuePagePair(rawParts, {
    label: 'report date', value: (part) => part?.reportDate, page: (part) => part?.reportDateEvidencePage,
    normalize: (candidate) => normalizeReportDate(candidate) || String(candidate).trim(),
  });
  if (rawParts.some((part) => part?.reportSectionStart === false && part?.reportSectionStartEvidencePage != null)) {
    throw new Error('A continuation chunk cannot claim a bureau report section-start page.');
  }
  const identityParts = rawParts.filter((part) => clean(part?.client?.name));
  if (identityParts.length > 1) assertConsistentReportIdentity(identityParts);
  const visibleDobs = rawParts.map((part) => ({
    raw: clean(part?.personalInfo?.dateOfBirth),
    normalized: normalizedDob(part?.personalInfo?.dateOfBirth),
  })).filter((entry) => entry.raw);
  if (visibleDobs.some((entry) => !entry.normalized)) {
    throw new Error('A split report part contains an invalid consumer date of birth.');
  }
  if (new Set(visibleDobs.map((entry) => entry.normalized)).size > 1) {
    throw new Error('Split report parts display conflicting dates of birth.');
  }
  const usable = rawParts.map((part) => coerceBureauExtraction(part, expected || detected[0], {
    allowInheritedMetadata: true,
    inheritedBureau: detected[0],
    inheritedReportDate: detectedDates[0],
  }));
  const clientNamePair = consistentValuePagePair(rawParts, {
    label: 'consumer name', value: (part) => part?.client?.name, page: (part) => part?.client?.nameEvidencePage,
    normalize: (candidate) => normalizedIdentityName(candidate)?.canonical || String(candidate).trim().toLowerCase(),
  });
  const clientAddressPair = consistentValuePagePair(rawParts, {
    label: 'consumer address', value: (part) => part?.client?.address, page: (part) => part?.client?.addressEvidencePage,
    normalize: (candidate) => normalizedIdentityAddress(candidate) || String(candidate).trim().toLowerCase(),
  });
  const clientScorePair = consistentValuePagePair(rawParts, {
    label: 'consumer score', value: (part) => part?.client?.score, page: (part) => part?.client?.scoreEvidencePage,
    normalize: (candidate) => String(Number(candidate)),
  });
  const dobPair = consistentValuePagePair(rawParts, {
    label: 'consumer date of birth', value: (part) => part?.personalInfo?.dateOfBirth,
    page: (part) => part?.personalInfo?.dateOfBirthEvidencePage,
    normalize: (candidate) => normalizedDob(candidate) || String(candidate).trim(),
  });
  const phonePair = consistentValuePagePair(rawParts, {
    label: 'consumer phone', value: (part) => part?.personalInfo?.phone,
    page: (part) => part?.personalInfo?.phoneEvidencePage,
    normalize: (candidate) => String(candidate).replace(/\D/g, ''),
  });
  const currentAddressPair = consistentValuePagePair(rawParts, {
    label: 'consumer current address', value: (part) => part?.personalInfo?.currentAddress,
    page: (part) => part?.personalInfo?.currentAddressEvidencePage,
    normalize: (candidate) => normalizedIdentityAddress(candidate) || String(candidate).trim().toLowerCase(),
  });
  const accounts = new Map();
  usable.forEach((part, partIndex) => {
    const baseKeys = part.accounts.map((account, index) => accountKey(account, index, `${part.bureau}-part${partIndex}`));
    const counts = baseKeys.reduce((map, key) => map.set(key, (map.get(key) || 0) + 1), new Map());
    part.accounts.forEach((account, index) => {
      const base = baseKeys[index];
      const key = counts.get(base) > 1 ? `${base}::ambiguous::${index}` : base;
      accounts.set(key, mergeOverlappingAccountExtracts(accounts.get(key), account));
    });
  });
  const first = usable[0];
  const personalInfo = {
    formerAddresses: mergeStrings(usable.flatMap((p) => p.personalInfo?.formerAddresses || [])),
    formerAddressEvidence: mergePersonalEvidence(usable, 'formerAddressEvidence'),
    nameVariants: mergeStrings(usable.flatMap((p) => p.personalInfo?.nameVariants || [])),
    nameVariantEvidence: mergePersonalEvidence(usable, 'nameVariantEvidence'),
    formerEmployers: mergeStrings(usable.flatMap((p) => p.personalInfo?.formerEmployers || [])),
    formerEmployerEvidence: mergePersonalEvidence(usable, 'formerEmployerEvidence'),
    dateOfBirth: dobPair.value,
    dateOfBirthEvidencePage: dobPair.page,
    phone: phonePair.value,
    phoneEvidencePage: phonePair.page,
    currentAddress: currentAddressPair.value,
    currentAddressEvidencePage: currentAddressPair.page,
  };
  return {
    bureau: first.bureau,
    bureauEvidencePage: bureauPair.page,
    reportSectionStart: true,
    reportSectionStartEvidencePage: usable.map((p) => p.reportSectionStartEvidencePage).find(Number.isFinite) ?? null,
    reportDate: detectedDates[0],
    reportDateRaw: usable.map((p) => p.reportDateRaw).find(Boolean) || detectedDates[0],
    reportDateEvidencePage: reportDatePair.page,
    client: {
      name: clientNamePair.value || first.client.name,
      nameEvidencePage: clientNamePair.page,
      address: clientAddressPair.value,
      addressEvidencePage: clientAddressPair.page,
      score: clientScorePair.value,
      scoreEvidencePage: clientScorePair.page,
    },
    accounts: [...accounts.values()],
    inquiries: mergeInquiries(usable),
    personalInfo,
  };
}

export function mergeCombinedExtractions(parts) {
  const grouped = new Map();
  for (const part of parts || []) {
    for (const report of part?.reports || []) {
      const key = bureauKey(report.bureau);
      if (!key) {
        if ((report?.accounts || []).length || (report?.inquiries || []).length) {
          throw new Error('A combined-report chunk contains data without a visible bureau identity.');
        }
        continue;
      }
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
  // Every automated finding, regardless of severity, needs rule-relevant
  // page-backed evidence. Pending-edition rules also remain visible but may
  // not authorize a dispute until a current citation or staff fact resolves
  // them. Value-level findings are retained for review — only authorization
  // is withheld.
  if (
    withQuality.outcome === 'FLAG'
    && (quality !== 'page_backed' || String(withQuality.verificationStatus || '').includes('PENDING'))
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
    const pageBacked = displayed.filter((entry) => isPageReference(entry.evidence?.page)).length;
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

function collectorEvidenceFields(account) {
  if (COLLECTOR_ACCOUNT_TYPES.has(upper(account?.accountType))) return ['accountType'];
  const matcher = /collection agency|debt purchaser|debt buyer|third[- ]party collector/;
  if (matcher.test(String(account?.reportedType || '').toLowerCase())) return ['reportedType'];
  if (matcher.test(String(account?.statusText || '').toLowerCase())) return ['statusText'];
  if (matcher.test(String(account?.remarks || '').toLowerCase())) return ['remarks'];
  return [];
}

function ruleEvidenceFields(ruleType) {
  const type = String(ruleType || '');
  if (type.includes('STATUS_NONCONFORMING')) return ['accountStatus', 'accountType'];
  if (type.includes('PORTFOLIO_TYPE_NONCONFORMING')) return ['portfolioType', 'accountType'];
  if (type.includes('ACCOUNT_TYPE_NONCONFORMING')) return ['accountType'];
  if (type.includes('DATE_OPENED')) return ['dateOpened', 'accountType'];
  if (type.includes('DOFD')) return ['dofd', 'accountType'];
  if (type.includes('SCHEDULED_PAYMENT')) return ['scheduledMonthlyPayment', 'portfolioType', 'accountStatus'];
  if (type.includes('DATE_OF_LAST_PAYMENT') || type.includes('DOLP')) return ['lastPaymentDate', 'dateOpened', 'accountType'];
  return [];
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
    const collectorEvidence = collectorEvidenceFields(account).flatMap(refs);
    if (collector && account.explicitlyBlankFields?.includes('dofd')) {
      out.push(finding('COLLECTION_DOFD_EXPLICITLY_BLANK', {
        field: `Field 25 (${METRO2_FIELDS.DATE_FIRST_DELINQUENCY.name})`,
        issue: 'The report visibly displays the Date of First Delinquency field as blank on a collection/debt-purchaser account.',
        currentlyReports: `${BUREAU_CODES[bureau]}: explicitly blank`,
        shouldReport: 'Investigate and report the substantiated original-creditor DOFD when required',
        source: '15 U.S.C. §1681s-2(a)(5); CRRG Field 25', severity: 'high',
        evidenceRefs: [...refs('dofd'), ...collectorEvidence],
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
        evidenceRefs: [...refs('consumerDisputeIndicator'), ...refs('complianceConditionCode')],
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
      const exactFields = ruleEvidenceFields(v.type);
      if (collector) exactFields.push(...collectorEvidenceFields(account));
      const exactEvidence = [...new Set(exactFields)].map((field) => evidenceFor(account, field, bureau));
      out.push(finding(v.type, {
        // A prior owner decision kept these findings visible as FLAGs. The
        // evidence/current-edition gate in finding() now prevents a FLAG from
        // becoming an automated authorization when its source is pending or
        // its exact input fields are not page-backed.
        outcome: 'FLAG',
        field: v.field,
        issue: v.issue,
        currentlyReports: `${BUREAU_CODES[bureau]}: ${v.found || 'nonconforming value displayed'}`,
        shouldReport: v.expected || 'Correct to the substantiated conforming value',
        source: v.statute || 'CRRG deterministic rule', severity: 'high',
        verificationStatus: v.verification_status || null,
        evidenceRefs: exactEvidence,
      }));
    }
  }
  return out;
}

function mergePersonalInfo(reports) {
  const observationSpecs = [
    ['former_address', 'formerAddressEvidence'],
    ['name_variant', 'nameVariantEvidence'],
    ['former_employer', 'formerEmployerEvidence'],
  ];
  const observations = [];
  const seen = new Set();
  for (const report of reports || []) {
    for (const [category, property] of observationSpecs) {
      for (const entry of report?.personalInfo?.[property] || []) {
        const value = clean(entry?.value);
        if (!value || !isPageReference(entry?.page)) continue;
        const key = `${category}::${value.toLowerCase()}::${report.bureau}::${Number(entry.page)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        observations.push({
          category,
          value,
          bureau: BUREAU_CODES[report.bureau],
          page: Number(entry.page),
        });
      }
    }
  }
  const phoneReport = reports.find((report) => clean(report?.personalInfo?.phone)
    && isPageReference(report?.personalInfo?.phoneEvidencePage));
  const addressReport = reports.find((report) => clean(report?.personalInfo?.currentAddress)
    && isPageReference(report?.personalInfo?.currentAddressEvidencePage));
  return {
    formerAddresses: mergeStrings(reports.flatMap((r) => r.personalInfo?.formerAddresses || [])),
    nameVariants: mergeStrings(reports.flatMap((r) => r.personalInfo?.nameVariants || [])),
    formerEmployers: mergeStrings(reports.flatMap((r) => r.personalInfo?.formerEmployers || [])),
    dateOfBirth: reports.map((r) => r.personalInfo?.dateOfBirth).find(Boolean) || null,
    dateOfBirthEvidencePage: reports.map((r) => r.personalInfo?.dateOfBirthEvidencePage).find(Number.isFinite) ?? null,
    phone: phoneReport?.personalInfo?.phone || null,
    phoneEvidence: phoneReport ? {
      bureau: BUREAU_CODES[phoneReport.bureau], page: Number(phoneReport.personalInfo.phoneEvidencePage),
    } : null,
    currentAddress: addressReport?.personalInfo?.currentAddress || null,
    currentAddressEvidence: addressReport ? {
      bureau: BUREAU_CODES[addressReport.bureau], page: Number(addressReport.personalInfo.currentAddressEvidencePage),
    } : null,
    observations,
  };
}

export function buildDeterministicAudit(rawReports, { reportDate = null, evaluatedAt = null, provenance = null } = {}) {
  const reports = (rawReports || []).map((report) => coerceBureauExtraction(report));
  if (!reports.length) throw new Error('No extracted bureau data was available for deterministic evaluation.');
  const sourceDates = [...new Set(reports.map((report) => normalizeReportDate(report.reportDate)).filter(Boolean))];
  if (sourceDates.length > 1) throw new Error('Deterministic audit input contains mixed report-level dates.');
  const requestedDate = normalizeReportDate(reportDate);
  if (reportDate && !requestedDate) throw new Error('Deterministic audit received an invalid report date.');
  if (requestedDate && sourceDates.length === 1 && requestedDate !== sourceDates[0]) {
    throw new Error('The requested audit date does not match the source-derived report date.');
  }
  const effectiveReportDate = sourceDates[0] || requestedDate || null;
  const evaluationClock = evaluatedAt ? new Date(evaluatedAt) : (effectiveReportDate ? new Date(`${effectiveReportDate}T00:00:00.000Z`) : null);
  if (evaluatedAt && !Number.isFinite(evaluationClock.getTime())) throw new Error('Deterministic audit received an invalid evaluation timestamp.');
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
      group.variants[report.bureau] = mergeOverlappingAccountExtracts(group.variants[report.bureau], account);
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
    const reportTime = effectiveReportDate ? new Date(effectiveReportDate).getTime() : NaN;
    const ageDays = Number.isFinite(reportTime) && evaluationClock
      ? Math.max(0, Math.floor((evaluationClock.getTime() - reportTime) / 86400000)) : null;
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
        reportDate: effectiveReportDate,
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
  const reportClock = effectiveReportDate ? new Date(`${effectiveReportDate}T00:00:00.000Z`) : null;
  const inquiries = reports.flatMap((report) => (report.inquiries || []).map((inquiry) => {
    const linked = accounts.find((account) => normalizeFurnisher(account.furnisher) === normalizeFurnisher(inquiry.furnisher));
    const inquiryDate = new Date(inquiry.date);
    const ageInMonths = Number.isNaN(inquiryDate.getTime()) || !reportClock
      ? null
      : Math.max(0, Math.floor((reportClock.getTime() - inquiryDate.getTime()) / (30.4375 * 86400000)));
    return {
      furnisher: inquiry.furnisher,
      date: inquiry.date,
      bureaus: [BUREAU_CODES[report.bureau]],
      sourcePage: isPageReference(inquiry.evidencePage) ? Number(inquiry.evidencePage) : null,
      linkedAccountId: linked?.id || null,
      ageInMonths,
      category: linked ? 'linked_to_open_account' : 'no_linked_account',
    };
  }));
  const clientName = reports.map((r) => r.client?.name).find((name) => name && name !== 'Unknown Client') || 'Unknown Client';
  const clientAddressReport = reports.find((report) => clean(report?.client?.address)
    && isPageReference(report?.client?.addressEvidencePage));
  const scores = { equifax: null, experian: null, transunion: null };
  reports.forEach((report) => { scores[report.bureau] = report.client?.score ?? null; });
  return {
    schemaVersion: DETERMINISTIC_AUDIT_SCHEMA_VERSION,
    evaluationMode: 'deterministic',
    client: {
      name: clientName,
      address: clientAddressReport?.client?.address || null,
      addressEvidence: clientAddressReport ? {
        bureau: BUREAU_CODES[clientAddressReport.bureau],
        page: Number(clientAddressReport.client.addressEvidencePage),
      } : null,
      reportDate: effectiveReportDate,
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
    extraction: {
      schemaVersion: 'credit-extraction-v2',
      bureaus: reports.map((r) => r.bureau),
      ...(provenance && typeof provenance === 'object' ? { provenance } : {}),
    },
  };
}
