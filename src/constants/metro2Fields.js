// Authoritative Metro 2 Base Segment field map.
//
// ─── REFERENCE VINTAGE — READ BEFORE TRUSTING ANY NAME OR CODE ───────────
// The reference copy backing every citation in this file is the **2003 CDIA
// Credit Reporting Resource Guide**, filed as an exhibit in Case
// 1:05-cv-00599-SLR (11/08/2007). Consequences:
//   • Base Segment field NUMBERING (1-46) has been stable since 2003, so
//     field-number citations here remain valid against current editions.
//   • Field NAMES, STATUS CODES, and COMPLIANCE CONDITION CODE values HAVE
//     CHANGED across editions. Field 24 is the live example — it is
//     "Billing Date" in this edition and was renamed in later ones.
// A current CRRG should replace this reference. Until it does, treat names
// and codes as edition-specific and re-verify before relying on them in
// correspondence that a furnisher's counsel will read.
//
// ─── PROVENANCE RULE (standing constraint, 2026-07-24) ───────────────────
// No Metro 2 field number, field name, or status/comment code may be
// written here from memory or recall. Every entry carries a `source`
// citation and a `verified` date. Unsourced entries are a build error, not
// a judgment call — assertSourced() throws, and validateFieldCitations() is
// wired into both letter-generation paths so an unsourced or unknown field
// number cannot reach a generated letter.
//
// Why this file exists: the corpus these prompts were originally authored
// from had Field 19 mislabeled as Compliance Condition Code (it is Special
// Comment; CCC is Field 20) and Field 21 mislabeled as Amount Past Due (it
// is Current Balance; APD is Field 22). Every letter generated against it
// inherited the error and a furnisher's counsel caught it. A first
// correction pass fixed those two but was itself still wrong on eight more
// entries, because that pass was also done from recall. Those eight were
// subsequently checked against the CRRG and confirmed — but "correct output
// from an unverified process is luck, not a fix," which is what the
// provenance rule above exists to prevent recurring.
//
// VERIFICATION STATUS: field numbers and names below were verified against
// the CRRG (426 Base Segment, character format) on 2026-07-24. Character
// POSITIONS are recorded only where the CRRG position was cited directly;
// every other entry says so explicitly rather than importing a position
// from a secondary source and presenting it as CRRG-verified.

const CRRG = 'CRRG 2003 ed. (Case 1:05-cv-00599-SLR exhibit), 426 Base Segment, character format';
const CRRG_NAME_ONLY = `${CRRG} (field number + name verified; character position not independently verified)`;
const VERIFIED = '2026-07-24';

export const METRO2_FIELDS = {
  CONSUMER_ACCOUNT_NUMBER:   { num: '7',   name: 'Consumer Account Number',                    source: CRRG_NAME_ONLY, verified: VERIFIED },
  PORTFOLIO_TYPE:            { num: '8',   name: 'Portfolio Type',                             source: CRRG_NAME_ONLY, verified: VERIFIED },
  ACCOUNT_TYPE:              { num: '9',   name: 'Account Type',                               source: CRRG_NAME_ONLY, verified: VERIFIED },
  DATE_OPENED:               { num: '10',  name: 'Date Opened',                                source: CRRG_NAME_ONLY, verified: VERIFIED },
  CREDIT_LIMIT:              { num: '11',  name: 'Credit Limit',                               source: CRRG_NAME_ONLY, verified: VERIFIED },
  HIGHEST_CREDIT:            { num: '12',  name: 'Highest Credit or Original Loan Amount',     source: CRRG_NAME_ONLY, verified: VERIFIED },
  TERMS_DURATION:            { num: '13',  name: 'Terms Duration',                             source: CRRG_NAME_ONLY, verified: VERIFIED },
  TERMS_FREQUENCY:           { num: '14',  name: 'Terms Frequency',                            source: CRRG_NAME_ONLY, verified: VERIFIED },
  SCHEDULED_MONTHLY_PAYMENT: { num: '15',  name: 'Scheduled Monthly Payment Amount',           source: CRRG_NAME_ONLY, verified: VERIFIED },
  ACTUAL_PAYMENT:            { num: '16',  name: 'Actual Payment Amount',                      source: CRRG_NAME_ONLY, verified: VERIFIED },
  ACCOUNT_STATUS:            { num: '17A', name: 'Account Status',                             source: CRRG_NAME_ONLY, verified: VERIFIED },
  PAYMENT_RATING:            { num: '17B', name: 'Payment Rating',                             source: CRRG_NAME_ONLY, verified: VERIFIED },
  PAYMENT_HISTORY_PROFILE:   { num: '18',  name: 'Payment History Profile',                    source: CRRG_NAME_ONLY, verified: VERIFIED },
  SPECIAL_COMMENT:           { num: '19',  name: 'Special Comment',                            source: CRRG_NAME_ONLY, verified: VERIFIED },
  // The one entry with a directly-cited CRRG character position.
  COMPLIANCE_CONDITION_CODE: { num: '20',  name: 'Compliance Condition Code',                  source: `${CRRG}, pos. 153-154`, verified: VERIFIED },
  CURRENT_BALANCE:           { num: '21',  name: 'Current Balance',                            source: CRRG_NAME_ONLY, verified: VERIFIED },
  AMOUNT_PAST_DUE:           { num: '22',  name: 'Amount Past Due',                            source: CRRG_NAME_ONLY, verified: VERIFIED },
  ORIGINAL_CHARGE_OFF_AMT:   { num: '23',  name: 'Original Charge-off Amount',                 source: CRRG_NAME_ONLY, verified: VERIFIED },
  // Edition-sensitive: "Billing Date" in the 2003 edition; renamed to
  // "Date of Account Information" in later CRRG editions. Do not silently
  // "correct" this to the newer name — it must match the reference edition
  // being cited, or the citation is wrong for that edition.
  BILLING_DATE:              { num: '24',  name: 'Billing Date',                               source: CRRG_NAME_ONLY, verified: VERIFIED },
  DATE_FIRST_DELINQUENCY:    { num: '25',  name: 'FCRA Compliance/Date of First Delinquency',  source: CRRG_NAME_ONLY, verified: VERIFIED },
  DATE_CLOSED:               { num: '26',  name: 'Date Closed',                                source: CRRG_NAME_ONLY, verified: VERIFIED },
  DATE_LAST_PAYMENT:         { num: '27',  name: 'Date of Last Payment',                       source: CRRG_NAME_ONLY, verified: VERIFIED },
};

// Account Status (Field 17A) codes. Same provenance rule, same edition
// caveat — status code MEANINGS have changed across CRRG editions.
// 71-84 are TIME-BASED DELINQUENCY STAGES: a balance on one of these is
// normal and is never a violation by itself. The prior corpus read 71 as
// "Settled", which turned every 30-days-late account into a fabricated
// violation.
export const METRO2_STATUS_CODES = {
  '05': { meaning: 'Account transferred',                                 source: CRRG_NAME_ONLY, verified: VERIFIED },
  '11': { meaning: 'Current account (0-29 days past due)',                source: CRRG_NAME_ONLY, verified: VERIFIED },
  '13': { meaning: 'Paid or closed account / zero balance',               source: CRRG_NAME_ONLY, verified: VERIFIED },
  '61': { meaning: 'Paid in full, was a voluntary surrender',             source: CRRG_NAME_ONLY, verified: VERIFIED },
  '62': { meaning: 'Paid in full, was a collection account',              source: CRRG_NAME_ONLY, verified: VERIFIED },
  '63': { meaning: 'Paid in full, was a repossession',                    source: CRRG_NAME_ONLY, verified: VERIFIED },
  '64': { meaning: 'Paid in full, was a charge-off',                      source: CRRG_NAME_ONLY, verified: VERIFIED },
  '65': { meaning: 'Paid in full, a foreclosure was started',             source: CRRG_NAME_ONLY, verified: VERIFIED },
  '71': { meaning: '30-59 days past the due date',                        source: CRRG_NAME_ONLY, verified: VERIFIED },
  '78': { meaning: '60-89 days past the due date',                        source: CRRG_NAME_ONLY, verified: VERIFIED },
  '80': { meaning: '90-119 days past the due date',                       source: CRRG_NAME_ONLY, verified: VERIFIED },
  '82': { meaning: '120-149 days past the due date',                      source: CRRG_NAME_ONLY, verified: VERIFIED },
  '83': { meaning: '150-179 days past the due date',                      source: CRRG_NAME_ONLY, verified: VERIFIED },
  '84': { meaning: '180 or more days past the due date',                  source: CRRG_NAME_ONLY, verified: VERIFIED },
  '88': { meaning: 'Claim filed with government for insured portion',     source: CRRG_NAME_ONLY, verified: VERIFIED },
  '89': { meaning: 'Deed received in lieu of foreclosure',                source: CRRG_NAME_ONLY, verified: VERIFIED },
  '93': { meaning: 'Account assigned to internal or external collections', source: CRRG_NAME_ONLY, verified: VERIFIED },
  '94': { meaning: 'Foreclosure completed',                               source: CRRG_NAME_ONLY, verified: VERIFIED },
  '95': { meaning: 'Voluntary surrender',                                 source: CRRG_NAME_ONLY, verified: VERIFIED },
  '96': { meaning: 'Merchandise repossessed',                             source: CRRG_NAME_ONLY, verified: VERIFIED },
  '97': { meaning: 'Unpaid balance reported as a loss (charge-off)',      source: CRRG_NAME_ONLY, verified: VERIFIED },
  'DA': { meaning: 'Delete entire account (non-fraud)',                   source: CRRG_NAME_ONLY, verified: VERIFIED },
  'DF': { meaning: 'Delete entire account (confirmed fraud)',             source: CRRG_NAME_ONLY, verified: VERIFIED },
};

// ─── Debt purchaser / collection agency conformity ────────────────────────
// Source: CRRG Ch. 10, "Third Party Collection Agency / Debt Purchaser /
// Factoring Company Reporting Guidelines." These are FORMAT-level
// requirements, so a violation here is facial — it does not depend on
// whether the underlying debt is valid, which is what makes it strong.
export const DEBT_PURCHASER_RULES = {
  permittedAccountStatus: ['93', '62', 'DA'],
  permittedPortfolioType: ['O'],
  permittedAccountType: ['0C', '48', '77'],
  accountTypeMeanings: { '0C': 'Factoring Co./Debt Purchaser', '48': 'Collection Agency/Attorney', '77': 'Returned Check' },
  source: 'CRRG 2003 ed. Ch. 10 — Third Party Collection Agency / Debt Purchaser / Factoring Company Reporting Guidelines',
  verified: VERIFIED,
};

export const DOFD_NOT_TRACED = 'DOFD_NOT_TRACED_TO_ORIGINAL_CREDITOR';

// Fires only for furnisherClass DEBT_PURCHASER | COLLECTION_AGENCY.
// Each argument is optional — a check is skipped when its value wasn't
// extracted, so a missing field never fabricates a violation. Returns a
// list of {type, field, found, expected, issue, statute}.
export function validateDebtPurchaserConformity({
  furnisherClass,
  accountStatus,
  portfolioType,
  accountType,
  dateOpened,
  originalCreditorOriginationDate,
  dofd,
  dofdSource,
} = {}) {
  const out = [];
  if (furnisherClass !== 'DEBT_PURCHASER' && furnisherClass !== 'COLLECTION_AGENCY') return out;
  const R = DEBT_PURCHASER_RULES;

  if (accountStatus && !R.permittedAccountStatus.includes(String(accountStatus).toUpperCase())) {
    out.push({
      type: 'DEBT_PURCHASER_STATUS_NONCONFORMING',
      field: `Field ${METRO2_FIELDS.ACCOUNT_STATUS.num} (${METRO2_FIELDS.ACCOUNT_STATUS.name})`,
      found: String(accountStatus),
      expected: R.permittedAccountStatus.join(', '),
      issue: `A debt purchaser or collection agency may report Account Status ${R.permittedAccountStatus.join(', ')} only. Status ${accountStatus} is not permitted for this furnisher class under the CRRG collection-agency guidelines.`,
      statute: R.source,
    });
  }

  if (portfolioType && !R.permittedPortfolioType.includes(String(portfolioType).toUpperCase())) {
    out.push({
      type: 'DEBT_PURCHASER_PORTFOLIO_TYPE_NONCONFORMING',
      field: `Field ${METRO2_FIELDS.PORTFOLIO_TYPE.num} (${METRO2_FIELDS.PORTFOLIO_TYPE.name})`,
      found: String(portfolioType),
      expected: 'O (Open)',
      issue: `A debt purchaser or collection agency must report Portfolio Type "O" (Open). "${portfolioType}" is nonconforming.`,
      statute: R.source,
    });
  }

  if (accountType && !R.permittedAccountType.includes(String(accountType).toUpperCase())) {
    const allowed = R.permittedAccountType.map((c) => `${c} (${R.accountTypeMeanings[c]})`).join(', ');
    out.push({
      type: 'DEBT_PURCHASER_ACCOUNT_TYPE_NONCONFORMING',
      field: `Field ${METRO2_FIELDS.ACCOUNT_TYPE.num} (${METRO2_FIELDS.ACCOUNT_TYPE.name})`,
      found: String(accountType),
      expected: allowed,
      issue: `A debt purchaser or collection agency must report Account Type ${allowed}. "${accountType}" is nonconforming.`,
      statute: R.source,
    });
  }

  // Date Opened must be the placement/assignment/purchase date, not the
  // original creditor's origination date.
  if (dateOpened && originalCreditorOriginationDate && String(dateOpened) === String(originalCreditorOriginationDate)) {
    out.push({
      type: 'DEBT_PURCHASER_DATE_OPENED_IS_ORIGINATION',
      field: `Field ${METRO2_FIELDS.DATE_OPENED.num} (${METRO2_FIELDS.DATE_OPENED.name})`,
      found: String(dateOpened),
      expected: 'Date the account was placed, assigned, or purchased',
      issue: `Date Opened reports the original creditor's origination date (${dateOpened}). For a debt purchaser or collection agency, Field 10 must report the date the account was placed, assigned, or purchased — not the original account's opening date.`,
      statute: R.source,
    });
  }

  // The one that matters most: DOFD must trace to the ORIGINAL CREDITOR's
  // records, not anything derived from the purchaser's own servicing file.
  if (dofd && dofdSource && String(dofdSource).toUpperCase() !== 'ORIGINAL_CREDITOR') {
    out.push({
      type: DOFD_NOT_TRACED,
      field: `Field ${METRO2_FIELDS.DATE_FIRST_DELINQUENCY.num} (${METRO2_FIELDS.DATE_FIRST_DELINQUENCY.name})`,
      found: `${dofd} (derived from: ${dofdSource})`,
      expected: "First delinquency with the ORIGINAL CREDITOR that led to placement or sale",
      issue: `The reported Date of First Delinquency is derived from the purchaser's own servicing file rather than the original creditor's records. The CRRG is explicit that DOFD must trace to the first delinquency with the original creditor that led to the account being placed or sold — a purchaser cannot restart or re-derive this date from its own acquisition.`,
      statute: R.source,
    });
  }

  return out;
}

// Throws if a field is referenced without a populated source/verified pair.
// Converts "someone added a field from memory" from a silent judgment call
// into a hard failure.
export function assertSourced(key) {
  const f = METRO2_FIELDS[key];
  if (!f) throw new Error(`Metro 2 field "${key}" is not in the verified field map.`);
  if (!f.source || !f.verified) {
    throw new Error(`Metro 2 field "${key}" (Field ${f.num}) has no source citation — unsourced Metro 2 field numbers may not reach a generated letter.`);
  }
  return f;
}

// Fails loudly at import time if any entry lacks provenance, so an unsourced
// addition can never sit dormant waiting to reach a letter.
export function assertMapFullySourced() {
  const bad = [];
  for (const [k, v] of Object.entries(METRO2_FIELDS)) if (!v.source || !v.verified) bad.push(`METRO2_FIELDS.${k}`);
  for (const [k, v] of Object.entries(METRO2_STATUS_CODES)) if (!v.source || !v.verified) bad.push(`METRO2_STATUS_CODES['${k}']`);
  if (bad.length) throw new Error('Unsourced Metro 2 entries (every entry needs source + verified): ' + bad.join(', '));
  return true;
}

const VALID_NUMS = new Set(Object.values(METRO2_FIELDS).map((f) => f.num.toUpperCase()));

const NAME_TOKENS = Object.values(METRO2_FIELDS).map((f) => ({
  num: f.num.toUpperCase(),
  name: f.name,
  head: f.name.toLowerCase().replace(/[^a-z ]/g, '').split(' ')[0],
}));

// Scans generated letter HTML for "Field N" citations and returns problems.
// Catches the two failure modes seen in real production letters: a field
// number that does not exist in the Base Segment at all (real letters cited
// "Field 30 — Amount Past Due", "Field 4 — Date Opened", "Field 6 — Account
// Status"), and a real number paired with another field's name (real letters
// cited "Field 19 — Compliance Condition Code" and "Field 17A — Current
// Balance").
export function validateFieldCitations(html) {
  if (!html) return [];
  const text = String(html).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
  const problems = [];
  const seen = new Set();

  for (const m of text.matchAll(/Field\s*(\d{1,2}[AB]?)\s*[—\-–:(]?\s*([A-Za-z][A-Za-z '\/]{2,45})?/g)) {
    const num = m[1].toUpperCase();
    const label = (m[2] || '').trim().replace(/\s+/g, ' ');

    if (!VALID_NUMS.has(num)) {
      const key = 'unknown:' + num;
      if (!seen.has(key)) {
        seen.add(key);
        problems.push(`Cites "Field ${num}"${label ? ` — ${label}` : ''}, which is not a Metro 2 Base Segment field number in the verified map.`);
      }
      continue;
    }
    if (!label) continue;

    // Value-level check FIRST — it must run before the generic-label guard
    // below, because "XB/XC" reduces to a 4-char token and would otherwise
    // be skipped as prose. XA/XB/XC/XD/XE/XF/XG/XH/XJ/XR are Compliance
    // Condition Code VALUES and live in Field 20. A real letter cited
    // "Field 19 — XB/XC 'Dispute Resolved'", which the name-matching rule
    // cannot catch because "XB/XC" is not a field name. This is the exact
    // defect the original report called out, so it gets its own rule.
    if (num === '19' && /\bX[ABCDEFGHJR]\b/.test(label)) {
      const key = 'ccc-value-on-19';
      if (!seen.has(key)) {
        seen.add(key);
        problems.push(`Cites "Field 19 — ${label}", but XA/XB/XC-style codes are Compliance Condition Code values, which live in Field ${METRO2_FIELDS.COMPLIANCE_CONDITION_CODE.num} (${METRO2_FIELDS.COMPLIANCE_CONDITION_CODE.name}). Field 19 is ${METRO2_FIELDS.SPECIAL_COMMENT.name}.`);
      }
      continue;
    }

    const labelHead = label.toLowerCase().replace(/[^a-z ]/g, '').split(' ')[0];
    if (labelHead.length <= 4) continue; // too generic to judge ("date", "the", prose)

    const actual = NAME_TOKENS.find((t) => t.num === num);
    if (actual && labelHead === actual.head) continue; // correct label

    const claimsAnother = NAME_TOKENS.find((t) => t.num !== num && t.head === labelHead && t.head.length > 4);
    if (actual && claimsAnother) {
      const key = 'mislabel:' + num + ':' + claimsAnother.num;
      if (!seen.has(key)) {
        seen.add(key);
        problems.push(`Cites "Field ${num} — ${label}", but Field ${num} is ${actual.name}; "${claimsAnother.name}" is Field ${claimsAnother.num}.`);
      }
    }
  }
  return problems;
}

// "Field 25 (FCRA Compliance/Date of First Delinquency)" style.
export function formatMetro2Field(key) {
  const f = assertSourced(key);
  return `Field ${f.num} (${f.name})`;
}
