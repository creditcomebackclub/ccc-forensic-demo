// Authoritative Metro 2 field map, Compliance Condition Codes, and the
// debt-buyer / collection-agency conformity rules.
//
// ─── STANDING RULE ───────────────────────────────────────────────────────
// Never write a Metro 2 field number, name, or code value from memory. Cite
// the source file, edition, and page/position — or flag it and stop. Every
// entry below carries `source` + `edition`; entries that could not be tied
// to a cited page carry `verification_status` saying so explicitly rather
// than borrowing authority from a neighbouring citation.
//
// ─── TWO EDITIONS ARE IN PLAY. WHERE THEY CONFLICT, Dec. 2024 WINS. ──────
//   • CRRG_2003_FULL_CourtExhibit_05cv599.pdf — complete: all fields,
//     exhibits, modules. Backs the Base Segment positions below.
//   • CRRG_2024Dec_Excerpt_Exhibit8_DebtBuyerModule.pdf — Exhibit 8 plus
//     Debt Buyer module items 10–13 only. Backs the Compliance Condition
//     Code definitions and Fields 20/21/22/27.
// Base Segment field NUMBERING (1-46) has been stable since 2003, so
// 2003-sourced numbers hold. NAMES and CODE VALUES have changed — Field 24
// is "Billing Date" in 2003 and was renamed "Date of Account Information"
// later; the XB definition changed materially. Do not "modernize" a name
// while citing the 2003 edition.
//
// Why this file exists: the corpus these prompts were authored from had
// Field 19 mislabeled as Compliance Condition Code (it is Special Comment;
// CCC is Field 20) and Field 21 as Amount Past Due (it is Current Balance).
// Letters shipped with the error and a furnisher's counsel quoted it back.
// The first correction pass was itself done from recall and was wrong on
// eight more entries. Correct output from an unverified process is luck,
// not a fix — hence the rule at the top.
//
// NOTE (outside this repo): the same Field 19 = Compliance Condition Code
// error also lives in Holland_Dispute_Letters_.docx in project knowledge.
// Chris fixes that separately; until then, any AI drafting prompts against
// that corpus will try to reintroduce it.

const B2003 = (pos) => `CRRG 2003 426 Base, pos. ${pos}`;

// promptNote is optional, additive context for renderMetro2FieldTable() (the
// text a letter-generation prompt shows alongside the field) — never
// consulted by validateFieldCitations/autoFixFieldCitations, so getting a
// note wrong can't create a false pass/fail, only a less helpful hint.
export const METRO2_FIELDS = {
  CONSUMER_ACCOUNT_NUMBER:   { num: '7',   name: 'Consumer Account Number',                        source: B2003('43-72'),   edition: '2003', promptNote: 'Cross-bureau conflicts' }, // packed 37-66
  PORTFOLIO_TYPE:            { num: '8',   name: 'Portfolio Type',                                 source: B2003('73'),      edition: '2003', promptNote: 'C=Line of credit, I=Installment, M=Mortgage, O=Open, R=Revolving' }, // packed 67
  ACCOUNT_TYPE:              { num: '9',   name: 'Account Type',                                   source: B2003('74-75'),   edition: '2003', promptNote: 'Two-digit code (e.g. 01 auto, 07 charge card, 48 collection)' }, // packed 68-69
  DATE_OPENED:               { num: '10',  name: 'Date Opened',                                    source: B2003('76-83'),   edition: '2003', promptNote: 'Origination or placement date; not the start of a lifetime Field 18 demand' }, // packed 70-74
  CREDIT_LIMIT:              { num: '11',  name: 'Credit Limit',                                   source: B2003('84-92'),   edition: '2003' }, // packed 75-79
  HIGHEST_CREDIT:            { num: '12',  name: 'Highest Credit or Original Loan Amount',         source: B2003('93-101'),  edition: '2003', promptNote: 'Impossible values (e.g. below current balance)' }, // packed 80-84
  TERMS_DURATION:            { num: '13',  name: 'Terms Duration',                                 source: B2003('102-104'), edition: '2003', promptNote: 'Must match agreement' }, // packed 85-87

  TERMS_FREQUENCY:           { num: '14',  name: 'Terms Frequency',                                source: B2003('105'),     edition: '2003' }, // packed 88
  SCHEDULED_MONTHLY_PMT:     { num: '15',  name: 'Scheduled Monthly Payment Amount',               source: B2003('106-114'), edition: '2003', promptNote: 'Apply the portfolio-type rule; do not assume every charge-off must report $0' }, // packed 89-93
  ACTUAL_PAYMENT_AMOUNT:     { num: '16',  name: 'Actual Payment Amount',                          source: B2003('115-123'), edition: '2003' }, // packed 94-98

  ACCOUNT_STATUS:            { num: '17A', name: 'Account Status',                                 source: B2003('124-125'), edition: '2003', promptNote: 'THE most-cited; see status code table' }, // packed 99-100
  PAYMENT_RATING:            { num: '17B', name: 'Payment Rating',                                 source: B2003('126'),     edition: '2003', promptNote: 'Cross-check against 17A' }, // packed 101
  PAYMENT_HISTORY_PROFILE:   { num: '18',  name: 'Payment History Profile',                        source: B2003('127-150'), edition: '2003', promptNote: 'Rolling 24-month history, not lifetime; suppression = gold' }, // packed 102-125
  SPECIAL_COMMENT:           { num: '19',  name: 'Special Comment',                                source: B2003('151-152'), edition: '2003', promptNote: 'e.g. AU = paid in full for less than the full balance (settlement). Never Compliance Condition Code values (XA/XB/XC/etc.) — those are Field 20' }, // packed 126-127
  COMPLIANCE_CONDITION_CODE: { num: '20',  name: 'Compliance Condition Code',                      source: 'CRRG Dec. 2024, Exhibit 8, p. 5-32',  edition: '2024', promptNote: 'XB = consumer disputes (Fair Credit Reporting Act)' },
  CURRENT_BALANCE:           { num: '21',  name: 'Current Balance',                                source: 'CRRG Dec. 2024, Debt Buyer item 11',  edition: '2024', promptNote: '$0 on paid/settled' },
  AMOUNT_PAST_DUE:           { num: '22',  name: 'Amount Past Due',                                source: 'CRRG Dec. 2024, Debt Buyer item 11',  edition: '2024', promptNote: '$0 on paid/settled; equals Current Balance is NORMAL on a collection account, not a violation by itself' },
  ORIGINAL_CHARGE_OFF_AMT:   { num: '23',  name: 'Original Charge-off Amount',                     source: B2003('173-181'), edition: '2003', promptNote: 'No inflation; no continued reporting post-payment' },
  // Renamed "Date of Account Information" in later editions — keep the 2003
  // name while citing the 2003 edition.
  BILLING_DATE:              { num: '24',  name: 'Billing Date',                                   source: B2003('182-189'), edition: '2003', promptNote: 'Cross-bureau conflicts' },
  DATE_FIRST_DELINQUENCY:    { num: '25',  name: 'FCRA Compliance/Date of First Delinquency',      source: B2003('190-197'), edition: '2003', promptNote: '§623(a)(5); 7-yr clock — never assert a later date than reported' },
  DATE_CLOSED:               { num: '26',  name: 'Date Closed',                                    source: B2003('198-205'), edition: '2003' },
  DATE_OF_LAST_PAYMENT:      { num: '27',  name: 'Date of Last Payment',                           source: 'CRRG Dec. 2024, Debt Buyer item 12',  edition: '2024', promptNote: 'Cross-bureau conflicts' },
};

// ─── Compliance Condition Codes (Field 20) ───────────────────────────────
// XA/XB/XC/XH/XR carry the Dec. 2024 definitions, which supersede 2003.
// The 2003 XB definition was materially different and is not used.
// XD–XG and XJ are absent from the Dec. 2024 excerpt, so they retain 2003
// definitions and are tagged accordingly.
const CCC_2024 = 'CRRG Dec. 2024, Exhibit 8, p. 5-32';
export const COMPLIANCE_CONDITION_CODES = {
  XA: { meaning: "Account closed at consumer's request", source: CCC_2024, edition: '2024' },
  XB: { meaning: 'Account information has been disputed by the consumer directly to the data furnisher under the FCRA; the data furnisher is conducting its investigation. Also reported for FDCPA disputes.', source: CCC_2024, edition: '2024' },
  XC: { meaning: "FCRA direct dispute investigation completed — consumer disagrees with the results of the data furnisher's investigation.", source: CCC_2024, edition: '2024' },
  XH: { meaning: 'Account previously in dispute; the data furnisher has completed its investigation. (FDCPA disputes and FCRA direct disputes)', source: CCC_2024, edition: '2024' },
  XR: { meaning: 'Removes the most recently reported Compliance Condition Code', source: CCC_2024, edition: '2024' },
  XD: { meaning: 'Not present in the Dec. 2024 excerpt — 2003 definition retained', source: 'CRRG 2003 (definition not re-verified)', edition: '2003', verification_status: 'PENDING_CURRENT_EDITION' },
  XE: { meaning: 'Not present in the Dec. 2024 excerpt — 2003 definition retained', source: 'CRRG 2003 (definition not re-verified)', edition: '2003', verification_status: 'PENDING_CURRENT_EDITION' },
  XF: { meaning: 'Not present in the Dec. 2024 excerpt — 2003 definition retained', source: 'CRRG 2003 (definition not re-verified)', edition: '2003', verification_status: 'PENDING_CURRENT_EDITION' },
  XG: { meaning: 'Not present in the Dec. 2024 excerpt — 2003 definition retained', source: 'CRRG 2003 (definition not re-verified)', edition: '2003', verification_status: 'PENDING_CURRENT_EDITION' },
  XJ: { meaning: 'Not present in the Dec. 2024 excerpt — 2003 definition retained', source: 'CRRG 2003 (definition not re-verified)', edition: '2003', verification_status: 'PENDING_CURRENT_EDITION' },
};

// Account Status (Field 17A). 71–84 are TIME-BASED DELINQUENCY STAGES: a
// balance on one is normal and never a violation by itself. The prior
// corpus read 71 as "Settled", which turned every 30-days-late account into
// a fabricated violation.
const ST = { source: 'CRRG 2003 426 Base, pos. 124-125 (Account Status code table)', edition: '2003' };
export const METRO2_STATUS_CODES = {
  '05': { meaning: 'Account transferred', ...ST },
  '11': { meaning: 'Current account (0-29 days past due)', ...ST },
  '13': { meaning: 'Paid or closed account / zero balance', ...ST },
  '61': { meaning: 'Paid in full, was a voluntary surrender', ...ST },
  '62': { meaning: 'Paid in full, was a collection account', ...ST },
  '63': { meaning: 'Paid in full, was a repossession', ...ST },
  '64': { meaning: 'Paid in full, was a charge-off', ...ST },
  '65': { meaning: 'Paid in full, a foreclosure was started', ...ST },
  '71': { meaning: '30-59 days past the due date', ...ST },
  '78': { meaning: '60-89 days past the due date', ...ST },
  '80': { meaning: '90-119 days past the due date', ...ST },
  '82': { meaning: '120-149 days past the due date', ...ST },
  '83': { meaning: '150-179 days past the due date', ...ST },
  '84': { meaning: '180 or more days past the due date', ...ST },
  '88': { meaning: 'Claim filed with government for insured portion', ...ST },
  '89': { meaning: 'Deed received in lieu of foreclosure', ...ST },
  '93': { meaning: 'Account assigned to internal or external collections', ...ST },
  '94': { meaning: 'Foreclosure completed', ...ST },
  '95': { meaning: 'Voluntary surrender', ...ST },
  '96': { meaning: 'Merchandise repossessed', ...ST },
  '97': { meaning: 'Unpaid balance reported as a loss (charge-off)', ...ST },
  'DA': { meaning: 'Delete entire account (non-fraud)', ...ST },
  'DF': { meaning: 'Delete entire account (confirmed fraud)', ...ST },
};

export const COLLECTOR_CLASSES = ['DEBT_PURCHASER', 'COLLECTION_AGENCY', 'DEBT_COLLECTOR'];
const isCollector = (c) => COLLECTOR_CLASSES.includes(c);

// ─── §5 — XB demand gating in Phase 3 ────────────────────────────────────
// CRRG Dec. 2024 Exhibit 8: Compliance Condition Codes "should not be
// reported in response to a consumer dispute investigation request from the
// consumer reporting agencies, EXCEPT where a data furnisher uses a
// Compliance Condition Code to satisfy its FDCPA obligation to communicate
// that a debt is disputed." So an XB demand only belongs in a Phase 3 CRA
// letter when the furnisher is a debt collector.
export function xbDemandForPhase3({ furnisherClass, phase1Date } = {}) {
  if (!isCollector(furnisherClass)) return { render: false, reason: 'Furnisher is not a debt collector — per CRRG Dec. 2024 Exhibit 8, Compliance Condition Codes should not be reported in response to a CRA dispute investigation request, so an XB demand does not belong in a Phase 3 CRA letter. Suppressed.' };
  return {
    render: true,
    text: `Compliance Condition Code XB is triggered by the consumer's direct dispute to the furnisher dated ${phase1Date || '[PHASE_1_DATE]'}, not by this reinvestigation request. The furnisher is a debt collector and uses the code to satisfy its obligation under 15 U.S.C. §1692e(8) to communicate that the debt is disputed.`,
    source: CCC_2024,
  };
}

// ─── §6 — XB_NOT_REMOVED_AFTER_INVESTIGATION ─────────────────────────────
// CRRG Dec. 2024: "Code XB should no longer be reported after the
// investigation is completed; the XB should be removed by reporting the
// removal code or changed to another code." Carve-out: for FDCPA disputes
// XB may remain "as long as stated in the Debt Buyer's or Third Party
// Collection Agency's policies/procedures" — so an FDCPA-basis dispute does
// NOT fire a violation; it produces a policy-production demand instead.
export const XB_NOT_REMOVED = 'XB_NOT_REMOVED_AFTER_INVESTIGATION';
export function validateXbRetention({ ccc, investigationCompleted, daysSinceCompletion, disputeBasis } = {}) {
  if (String(ccc || '').toUpperCase() !== 'XB') return null;
  if (disputeBasis === 'FDCPA') {
    return {
      type: 'XB_RETENTION_POLICY_DEMAND',
      isViolation: false,
      field: `Field ${METRO2_FIELDS.COMPLIANCE_CONDITION_CODE.num} (${METRO2_FIELDS.COMPLIANCE_CONDITION_CODE.name})`,
      demand: 'Produce the written policy or procedure stating the duration for which Compliance Condition Code XB is retained on FDCPA-disputed accounts, as required to substantiate continued reporting of the code under Regulation V, 12 C.F.R. §1022.42.',
      statute: '12 C.F.R. §1022.42 (Reg V); ' + CCC_2024,
    };
  }
  if (disputeBasis === 'FCRA_DIRECT' && investigationCompleted && Number(daysSinceCompletion) > 45) {
    return {
      type: XB_NOT_REMOVED,
      isViolation: true,
      field: `Field ${METRO2_FIELDS.COMPLIANCE_CONDITION_CODE.num} (${METRO2_FIELDS.COMPLIANCE_CONDITION_CODE.name})`,
      issue: `Compliance Condition Code XB remains reported ${daysSinceCompletion} days after the furnisher completed its investigation. Per the CRRG, XB should no longer be reported once the investigation is complete — it must be removed via the removal code (XR) or changed to another code.`,
      statute: CCC_2024,
    };
  }
  return null;
}

// ─── §6 — DOLP_INHERITED_FROM_ORIGINAL_CREDITOR ──────────────────────────
// Debt Buyer item 12: Date of Last Payment is the date payment was received
// BY the debt buyer or collection agency. A DOLP predating the purchase is
// inherited from the original creditor.
export const DOLP_INHERITED = 'DOLP_INHERITED_FROM_ORIGINAL_CREDITOR';
export function validateDateOfLastPayment({ furnisherClass, dateOfLastPayment, accountPurchaseDate } = {}) {
  if (!isCollector(furnisherClass)) return null;
  if (!dateOfLastPayment || !accountPurchaseDate) return null;
  const dolp = new Date(dateOfLastPayment), buy = new Date(accountPurchaseDate);
  if (isNaN(dolp) || isNaN(buy) || dolp >= buy) return null;
  return {
    type: DOLP_INHERITED,
    isViolation: true,
    field: `Field ${METRO2_FIELDS.DATE_OF_LAST_PAYMENT.num} (${METRO2_FIELDS.DATE_OF_LAST_PAYMENT.name})`,
    found: String(dateOfLastPayment),
    issue: `Date of Last Payment (${dateOfLastPayment}) predates the date this furnisher acquired the account (${accountPurchaseDate}). Per the CRRG Debt Buyer module, Field 27 reports the date payment was received BY the debt buyer or collection agency — a date before acquisition is inherited from the original creditor and is not a payment this furnisher received.`,
    statute: 'CRRG Dec. 2024, Debt Buyer item 12',
  };
}

// ─── §7 — Debt-buyer / collection-agency conformity ──────────────────────
// CRRG 2003 Debt Buyer module items 1–9. Active, but every rule is tagged
// PENDING_CURRENT_EDITION because the Dec. 2024 excerpt only covers items
// 10–13 — these five have not been re-verified against the current edition.
export const DEBT_PURCHASER_RULES = {
  permittedAccountStatus: ['93', '62', 'DA'],
  permittedPortfolioType: ['O'],
  permittedAccountType: ['48', '77', '0C'],
  accountTypeMeanings: { '0C': 'Factoring Co./Debt Purchaser', '48': 'Collection Agency/Attorney', '77': 'Returned Check' },
  source: 'CRRG 2003 Debt Buyer module, items 1-9',
  edition: '2003',
  verification_status: 'PENDING_CURRENT_EDITION',
};

export const DOFD_NOT_TRACED = 'DOFD_NOT_TRACED_TO_ORIGINAL_CREDITOR';

export function validateDebtPurchaserConformity({
  furnisherClass, accountStatus, portfolioType, accountType,
  dateOpened, originalCreditorOriginationDate, dofd, dofdSource,
} = {}) {
  const out = [];
  if (!isCollector(furnisherClass)) return out;
  const R = DEBT_PURCHASER_RULES;
  const tag = { statute: R.source, edition: R.edition, verification_status: R.verification_status };

  if (accountStatus && !R.permittedAccountStatus.includes(String(accountStatus).toUpperCase())) {
    out.push({ type: 'DEBT_PURCHASER_STATUS_NONCONFORMING', field: `Field ${METRO2_FIELDS.ACCOUNT_STATUS.num} (${METRO2_FIELDS.ACCOUNT_STATUS.name})`, found: String(accountStatus), expected: R.permittedAccountStatus.join(', '),
      issue: `A debt purchaser or collection agency may report Account Status ${R.permittedAccountStatus.join(', ')} only. Status ${accountStatus} is not permitted for this furnisher class.`, ...tag });
  }
  if (portfolioType && !R.permittedPortfolioType.includes(String(portfolioType).toUpperCase())) {
    out.push({ type: 'DEBT_PURCHASER_PORTFOLIO_TYPE_NONCONFORMING', field: `Field ${METRO2_FIELDS.PORTFOLIO_TYPE.num} (${METRO2_FIELDS.PORTFOLIO_TYPE.name})`, found: String(portfolioType), expected: 'O (Open)',
      issue: `A debt purchaser or collection agency must report Portfolio Type "O" (Open). "${portfolioType}" is nonconforming.`, ...tag });
  }
  if (accountType && !R.permittedAccountType.includes(String(accountType).toUpperCase())) {
    const allowed = R.permittedAccountType.map((c) => `${c} (${R.accountTypeMeanings[c]})`).join(', ');
    out.push({ type: 'DEBT_PURCHASER_ACCOUNT_TYPE_NONCONFORMING', field: `Field ${METRO2_FIELDS.ACCOUNT_TYPE.num} (${METRO2_FIELDS.ACCOUNT_TYPE.name})`, found: String(accountType), expected: allowed,
      issue: `A debt purchaser or collection agency must report Account Type ${allowed}. "${accountType}" is nonconforming.`, ...tag });
  }
  if (dateOpened && originalCreditorOriginationDate && String(dateOpened) === String(originalCreditorOriginationDate)) {
    out.push({ type: 'DEBT_PURCHASER_DATE_OPENED_IS_ORIGINATION', field: `Field ${METRO2_FIELDS.DATE_OPENED.num} (${METRO2_FIELDS.DATE_OPENED.name})`, found: String(dateOpened), expected: 'Date placed, assigned, or purchased',
      issue: `Date Opened reports the original creditor's origination date (${dateOpened}). For a debt purchaser or collection agency, Field 10 must report the date the account was placed, assigned, or purchased.`, ...tag });
  }
  if (dofd && dofdSource && String(dofdSource).toUpperCase() !== 'ORIGINAL_CREDITOR') {
    out.push({ type: DOFD_NOT_TRACED, field: `Field ${METRO2_FIELDS.DATE_FIRST_DELINQUENCY.num} (${METRO2_FIELDS.DATE_FIRST_DELINQUENCY.name})`, found: `${dofd} (derived from: ${dofdSource})`, expected: 'First delinquency with the ORIGINAL CREDITOR that led to placement or sale',
      issue: `The reported Date of First Delinquency is derived from the purchaser's own servicing file rather than the original creditor's records. DOFD must trace to the first delinquency with the original creditor that led to placement or sale — a purchaser cannot restart or re-derive this date at acquisition.`, ...tag });
  }
  return out;
}

// ─── §7 — Field 15 split rule ────────────────────────────────────────────
// The prior framing ("charge-off + a scheduled monthly payment = paradox")
// was status-driven. The CRRG's basis is PORTFOLIO-driven: Field 15 is zero
// fill for Open, minimum-due for Revolving/Line of Credit, and the regular
// monthly payment for Installment/Mortgage. Collection and debt-buyer
// accounts are Portfolio Type 'O', so the real, fully-sourced rule is the
// Open-portfolio one. The status-97 version is deliberately DEMOTED to a
// flag: an Installment tradeline at charge-off still carries a contractual
// monthly payment and the CRRG does not direct furnishers to zero it —
// asserting that in a letter as a Metro 2 violation would be overclaiming.
export const SCHEDULED_PAYMENT_ON_OPEN = 'SCHEDULED_PAYMENT_ON_OPEN_PORTFOLIO';
export function validateScheduledPayment({ portfolioType, accountStatus, scheduledMonthlyPayment } = {}) {
  if (scheduledMonthlyPayment === undefined || scheduledMonthlyPayment === null || scheduledMonthlyPayment === '') return null;
  const amt = Number(scheduledMonthlyPayment);
  if (Number.isNaN(amt) || amt === 0) return null;
  const pt = String(portfolioType || '').toUpperCase();

  if (pt === 'O') {
    return {
      type: SCHEDULED_PAYMENT_ON_OPEN,
      isViolation: true,
      field: `Field ${METRO2_FIELDS.SCHEDULED_MONTHLY_PMT.num} (${METRO2_FIELDS.SCHEDULED_MONTHLY_PMT.name})`,
      found: String(scheduledMonthlyPayment),
      expected: 'Zero fill',
      issue: `Portfolio Type is "O" (Open), for which the CRRG specifies Field 15 must be zero filled. A scheduled monthly payment of ${scheduledMonthlyPayment} is nonconforming. Collection and debt-buyer accounts are Portfolio Type O.`,
      statute: 'CRRG 2003 426 Base, Field 15 definition, p. 4-10',
      edition: '2003',
    };
  }

  if (String(accountStatus) === '97' && (pt === 'I' || pt === 'M')) {
    return {
      type: SCHEDULED_PAYMENT_ON_OPEN,
      isViolation: false,
      flagOnly: true,
      field: `Field ${METRO2_FIELDS.SCHEDULED_MONTHLY_PMT.num} (${METRO2_FIELDS.SCHEDULED_MONTHLY_PMT.name})`,
      found: String(scheduledMonthlyPayment),
      issue: `Charged-off ${pt === 'I' ? 'Installment' : 'Mortgage'} account still reports a scheduled monthly payment. Flagged for review only — the CRRG does not direct furnishers to zero Field 15 on a charged-off Installment/Mortgage tradeline, which retains a contractual monthly payment. Do NOT assert this as a Metro 2 violation in a letter.`,
      verification_status: 'PENDING_CURRENT_EDITION',
      edition: '2003',
    };
  }
  return null;
}

// ─── §8 — rebuttal for "balance equals past due is standard" ─────────────
export const BALANCE_EQUALS_PAST_DUE_REBUTTAL =
  "The Credit Reporting Resource Guide's Debt Buyer/Third Party Collection Agency module contains no provision requiring or authorizing Amount Past Due to equal Current Balance on a collection account. Item 11 addresses only the inclusion of fees and interest and the requirement that both figures decrease as payments are applied. The furnisher's assertion that its reporting is \"consistent with Metro 2 standards\" cites no field-guide provision because none exists.";

// ─── Enforcement ─────────────────────────────────────────────────────────
export function assertSourced(key) {
  const f = METRO2_FIELDS[key];
  if (!f) throw new Error(`Metro 2 field "${key}" is not in the verified field map.`);
  if (!f.source || !f.edition) throw new Error(`Metro 2 field "${key}" (Field ${f.num}) has no source citation — unsourced Metro 2 field numbers may not reach a generated letter.`);
  return f;
}

export function assertMapFullySourced() {
  const bad = [];
  for (const [k, v] of Object.entries(METRO2_FIELDS)) if (!v.source || !v.edition) bad.push(`METRO2_FIELDS.${k}`);
  for (const [k, v] of Object.entries(COMPLIANCE_CONDITION_CODES)) if (!v.source || !v.edition) bad.push(`COMPLIANCE_CONDITION_CODES.${k}`);
  for (const [k, v] of Object.entries(METRO2_STATUS_CODES)) if (!v.source || !v.edition) bad.push(`METRO2_STATUS_CODES['${k}']`);
  if (bad.length) throw new Error('Unsourced Metro 2 entries (every entry needs source + edition): ' + bad.join(', '));
  return true;
}

// Entries active but not yet tied to a cited page — surfaced so they can be
// resolved rather than quietly trusted.
export function pendingVerification() {
  const out = [];
  for (const [k, v] of Object.entries(METRO2_FIELDS)) if (v.verification_status) out.push(`METRO2_FIELDS.${k} (Field ${v.num}) — ${v.verification_status}`);
  for (const [k, v] of Object.entries(COMPLIANCE_CONDITION_CODES)) if (v.verification_status) out.push(`CCC.${k} — ${v.verification_status}`);
  if (DEBT_PURCHASER_RULES.verification_status) out.push(`DEBT_PURCHASER_RULES — ${DEBT_PURCHASER_RULES.verification_status}`);
  out.push('validateScheduledPayment() status-97 Installment/Mortgage branch — PENDING_CURRENT_EDITION (flag-only, never asserted as a violation)');
  return out;
}

const VALID_NUMS = new Set(Object.values(METRO2_FIELDS).map((f) => f.num.toUpperCase()));
function normalizeFieldLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/charge[\s-]?off/g, 'chargeoff')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NAME_TOKENS = Object.values(METRO2_FIELDS).map((f) => ({
  num: f.num.toUpperCase(),
  name: f.name,
  normalized: normalizeFieldLabel(f.name),
  head: normalizeFieldLabel(f.name).split(' ')[0],
}));

const FIELD_LABEL_ALIASES = [
  { num: '23', normalized: 'chargeoff amount' },
  { num: '25', normalized: 'date of first delinquency' },
  { num: '25', normalized: 'dofd' },
  { num: '27', normalized: 'last payment date' },
];

const CCC_VALUE_RE = /\bX[ABCDEFGHJR]\b/;

function pushCccOn19(problems, seen, label) {
  const key = 'ccc-value-on-19';
  if (seen.has(key)) return;
  seen.add(key);
  const shown = label || 'XB';
  problems.push(`Cites "Field 19 — ${shown}", but XA/XB/XC-style codes are Compliance Condition Code values, which live in Field ${METRO2_FIELDS.COMPLIANCE_CONDITION_CODE.num} (${METRO2_FIELDS.COMPLIANCE_CONDITION_CODE.name}). Field 19 is ${METRO2_FIELDS.SPECIAL_COMMENT.name}.`);
}

// Scans generated letter HTML for "Field N" citations. Catches the three
// failure modes seen in real shipped letters: a field number absent from
// the Base Segment ("Field 30 — Amount Past Due", "Field 4 — Date Opened"),
// a valid number paired with another field's name ("Field 19 — Compliance
// Condition Code", "Field 17A — Current Balance"), and CCC VALUES cited
// under Field 19 ("Field 19 — XB/XC"), which name-matching cannot catch.
export function validateFieldCitations(html) {
  if (!html) return [];
  const text = String(html).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
  const problems = [];
  const seen = new Set();

  for (const m of text.matchAll(/Field\s*(\d{1,2}[AB]?)\s*[—\-–:(]?\s*([A-Za-z][A-Za-z '\/]{0,45})?/g)) {
    const num = m[1].toUpperCase();
    const label = (m[2] || '').trim().replace(/\s+/g, ' ');

    if (!VALID_NUMS.has(num)) {
      const key = 'unknown:' + num;
      if (!seen.has(key)) { seen.add(key); problems.push(`Cites "Field ${num}"${label ? ` — ${label}` : ''}, which is not a Metro 2 Base Segment field number in the verified map.`); }
      continue;
    }

    // Field 19 + CCC value in the captured label (including bare "Field 19 — XB").
    if (num === '19' && label && CCC_VALUE_RE.test(label)) {
      pushCccOn19(problems, seen, label);
      continue;
    }

    // Bare / short forms the label group used to miss: "Field 19—XB", "Field 19 (XB)".
    if (num === '19' && !CCC_VALUE_RE.test(label || '')) {
      const window = text.slice(m.index, Math.min(text.length, m.index + m[0].length + 12));
      const code = window.match(CCC_VALUE_RE);
      if (code) {
        pushCccOn19(problems, seen, code[0]);
        continue;
      }
    }

    if (!label) continue;

    const normalizedLabel = normalizeFieldLabel(label);
    if (normalizedLabel.startsWith('date of last activity')) {
      const key = 'invalid-label:date-of-last-activity';
      if (!seen.has(key)) {
        seen.add(key);
        problems.push(`Cites "Field ${num} — ${label}", but "Date of Last Activity" is not a verified Metro 2 Base Segment field label. Date of Last Payment is Field 27.`);
      }
      continue;
    }

    const exactName = NAME_TOKENS.find((t) => normalizedLabel.startsWith(t.normalized));
    const aliasName = FIELD_LABEL_ALIASES.find((t) => normalizedLabel.startsWith(t.normalized));
    const claimedNum = exactName?.num || aliasName?.num;
    const actual = NAME_TOKENS.find((t) => t.num === num);
    if (claimedNum && claimedNum !== num) {
      const claimed = NAME_TOKENS.find((t) => t.num === claimedNum);
      const key = 'mislabel:' + num + ':' + claimedNum;
      if (!seen.has(key)) {
        seen.add(key);
        problems.push(`Cites "Field ${num} — ${label}", but Field ${num} is ${actual?.name || 'a different field'}; "${claimed?.name || label}" is Field ${claimedNum}.`);
      }
      continue;
    }
    if (claimedNum === num) continue;

    const labelHead = normalizedLabel.split(' ')[0];
    if (labelHead.length <= 4) continue;
    if (actual && labelHead === actual.head) continue;
    const claimsAnother = NAME_TOKENS.find((t) => t.num !== num && t.head === labelHead && t.head.length > 4);
    if (actual && claimsAnother) {
      const key = 'mislabel:' + num + ':' + claimsAnother.num;
      if (!seen.has(key)) { seen.add(key); problems.push(`Cites "Field ${num} — ${label}", but Field ${num} is ${actual.name}; "${claimsAnother.name}" is Field ${claimsAnother.num}.`); }
    }
  }
  return problems;
}

// Deterministic companion to validateFieldCitations: rewrites a "Field N —
// Label" citation in place when the label unambiguously belongs to a
// different, valid field number (the exact same match validateFieldCitations
// already uses to build its error message — reused here so "detected" and
// "fixed" never disagree). Only touches the number, never the label, since
// the label is what the writer actually meant to reference; the number is
// what gets transposed (21/22, 23/27, 17A/21, etc.).
//
// Deliberately conservative on three axes, each closing a specific way this
// was shown to corrupt or mask a citation error during review:
// 1. Never touches text inside an HTML tag (attribute, tag name) — the
//    label regex can't tell "Field 21" in prose from "Field 21" inside a
//    title="..." attribute the way validateFieldCitations can (it strips
//    tags first); this function instead checks, per match, whether the
//    nearest unclosed angle bracket behind it is "<" and bails if so.
// 2. Never lets the label capture swallow a SECOND "Field N" citation that
//    follows shortly after in the same sentence (e.g. "Field 21 — Amount
//    Past Due and Field 19 — Compliance Condition Code") — without this,
//    the label group's greedy character class treats "and Field" as more
//    label text, fusing the second citation into unparseable text
//    ("Field19") that neither this function nor validateFieldCitations can
//    see anymore, silently hiding a real citation error instead of fixing
//    or flagging it.
// 3. Never fixes a field number that's cited MORE than once anywhere in the
//    document. A single occurrence is safe to correct outright. Multiple
//    occurrences mean a bare back-reference elsewhere ("...as shown in
//    Field 21 above") could easily exist alongside the labeled citation
//    being fixed — rewriting only the labeled one would leave the letter
//    internally contradictory (one place says Field 22, another still says
//    Field 21) while validateFieldCitations reports it clean, since it has
//    no way to resolve unlabeled back-references either. Multi-occurrence
//    cases are left untouched so the full conversational retry/rebuild
//    sees every mention at once and can fix them consistently.
//
// An unknown field number (no valid field to map to) or an unrecognized
// label (e.g. "Date of Last Activity", which isn't a real Metro 2 field at
// all) is also left untouched — those still surface via
// validateFieldCitations for a human/model retry, never guessed at here.
//
// Only ever rewrites the field NUMBER, never the label text itself — the
// label is reinserted verbatim (untrimmed, unmodified) from what was
// actually captured, so no whitespace or wording is lost or altered.
export function autoFixFieldCitations(html) {
  if (!html) return { html, fixed: [] };
  const fixed = [];
  const raw = String(html);

  const occurrences = {};
  for (const m of raw.matchAll(/Field\s*(\d{1,2}[AB]?)\b/g)) {
    const n = m[1].toUpperCase();
    occurrences[n] = (occurrences[n] || 0) + 1;
  }

  const fixedHtml = raw.replace(
    /Field\s*(\d{1,2}[AB]?)(\s*[—\-–:(]?\s*)((?:(?!Field\b)[A-Za-z '\/]){0,45})/g,
    (full, num, sep, rawLabel, offset, string) => {
      const lastOpen = string.lastIndexOf('<', offset);
      const lastClose = string.lastIndexOf('>', offset);
      if (lastOpen > lastClose) return full; // inside an unclosed HTML tag/attribute — never touch

      const upperNum = num.toUpperCase();
      const label = (rawLabel || '').trim().replace(/\s+/g, ' ');
      const onlyOccurrence = occurrences[upperNum] === 1;

      // CCC value cited under Field 19 belongs in Field 20.
      if (upperNum === '19' && label && CCC_VALUE_RE.test(label)) {
        if (!onlyOccurrence) return full;
        fixed.push(`Field 19 → Field ${METRO2_FIELDS.COMPLIANCE_CONDITION_CODE.num} ("${label}" is a Compliance Condition Code value)`);
        return `Field ${METRO2_FIELDS.COMPLIANCE_CONDITION_CODE.num}${sep}${rawLabel || ''}`;
      }

      if (!VALID_NUMS.has(upperNum) || !label) return full;

      const normalizedLabel = normalizeFieldLabel(label);
      if (normalizedLabel.startsWith('date of last activity')) return full;

      const exactName = NAME_TOKENS.find((t) => normalizedLabel.startsWith(t.normalized));
      const aliasName = FIELD_LABEL_ALIASES.find((t) => normalizedLabel.startsWith(t.normalized));
      const claimedNum = exactName?.num || aliasName?.num;
      if (claimedNum && claimedNum !== upperNum) {
        if (!onlyOccurrence) return full;
        const claimed = NAME_TOKENS.find((t) => t.num === claimedNum);
        fixed.push(`Field ${upperNum} → Field ${claimedNum} ("${label}" is ${claimed?.name || `Field ${claimedNum}`})`);
        return `Field ${claimedNum}${sep}${rawLabel || ''}`;
      }
      if (claimedNum === upperNum) return full;

      const labelHead = normalizedLabel.split(' ')[0];
      if (labelHead.length <= 4) return full;
      const actual = NAME_TOKENS.find((t) => t.num === upperNum);
      if (actual && labelHead === actual.head) return full;
      // A truncated/abbreviated label (just the first word, e.g. "Account"
      // instead of "Account Status" — whether the model wrote it that way
      // or an inline tag split the phrase mid-label) can share its first
      // word with MORE THAN ONE real field (Account Type vs. Account
      // Status; Terms Duration vs. Terms Frequency; Payment Rating vs.
      // Payment History Profile). Guessing which one via array order would
      // silently mis-cite a different real field — only act when the head
      // word identifies exactly one other field, never when it's ambiguous.
      const headMatches = NAME_TOKENS.filter((t) => t.num !== upperNum && t.head === labelHead && t.head.length > 4);
      if (actual && headMatches.length === 1) {
        if (!onlyOccurrence) return full;
        const claimsAnother = headMatches[0];
        fixed.push(`Field ${upperNum} → Field ${claimsAnother.num} ("${label}" is ${claimsAnother.name})`);
        return `Field ${claimsAnother.num}${sep}${rawLabel || ''}`;
      }
      return full;
    }
  );
  return { html: fixedHtml, fixed };
}

function plainText(html) {
  return String(html || '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&sect;/gi, '§')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectPhase3SubstantiveProblems(html) {
  const text = plainText(html);
  if (!text) return [];

  const rules = [
    {
      pattern: /(?:charg(?:e|ed)[\s-]?off.{0,220}logical impossib|logical impossib.{0,220}charg(?:e|ed)[\s-]?off|charg(?:e|ed)[\s-]?off.{0,180}(?:uncollectible|written off for tax)|charg(?:e|ed)[\s-]?off.{0,180}(?:cannot|can not).{0,100}(?:current balance|past due|financial obligation))/i,
      problem: 'Claims that charge-off status cannot carry a balance or past-due amount. Status 97 is an unpaid charge-off and may legitimately report Fields 21/22; assert a conflict only when a supported paid status or other evidence makes the amount inaccurate.',
    },
    {
      pattern: /(?:Field\s*18|Payment History Profile).{0,220}(?:since (?:the )?(?:account )?(?:was )?opened|from (?:the )?(?:account )?(?:opening|date opened)|lifetime (?:payment )?history|entire (?:payment )?history)/i,
      problem: 'Demands lifetime payment history under Field 18. Field 18 is a rolling 24-month Payment History Profile, not history from account opening.',
    },
    {
      pattern: /(?:\bC\/O\b|charg(?:e|ed)[\s-]?off).{0,220}(?:months?\s+(?:after|following)|post[\s-]?closure).{0,100}(?:closure|closed)|(?:closure|closed).{0,220}(?:\bC\/O\b|charg(?:e|ed)[\s-]?off).{0,120}(?:inaccurate|unverif|correct|delete)/i,
      problem: 'Treats monthly C/O/charge-off reporting after Date Closed as inaccurate or suspect solely because it follows closure. An unpaid charge-off may continue reporting after closure; require a separate concrete inconsistency.',
    },
    {
      pattern: /(?:no provision.{0,100}(?:requiring|authorizing).{0,100}Amount Past Due.{0,60}(?:equal|equals).{0,60}Current Balance|Amount Past Due.{0,80}(?:equal|equals).{0,80}Current Balance.{0,180}(?:violation|not authorized|inaccurate))/i,
      problem: 'Treats Amount Past Due equaling Current Balance as a violation. That equality is common on collection/charged-off accounts and is not inaccurate by itself.',
    },
    {
      pattern: /(?:Fields?\s*17A\s*\/\s*21.{0,160}(?:Amount Past Due|Current Balance)|(?:Amount Past Due|Current Balance).{0,160}Fields?\s*17A\s*\/\s*21)/i,
      problem: 'Uses Fields 17A/21 as the balance/past-due pair. Field 17A is Account Status; Current Balance is Field 21 and Amount Past Due is Field 22.',
    },
    {
      pattern: /(?:Date of First Delinquency|DOFD).{0,420}(?:returned|dishonored) payment|(?:returned|dishonored) payment.{0,420}(?:Date of First Delinquency|DOFD)/i,
      problem: 'Uses a returned/dishonored payment date to establish or contradict DOFD without proving the uninterrupted delinquency that led to charge-off. A payment-return date alone is not the DOFD.',
    },
    {
      pattern: /(?:demand|require|must (?:provide|produce)|statutorily (?:must|required)|obligat(?:e|ed|ion).{0,30}(?:provide|produce)).{0,180}(?:\bUDF\b|Universal Data Form|original[- ]source documentation|source records|all furnisher documents)/i,
      problem: 'Treats UDF or source-document production as a CRA statutory duty. Request the §1681i(a)(6)(B)(iii)/(a)(7) description of the reinvestigation procedure; supporting records may be requested but are not guaranteed.',
    },
    {
      pattern: /(?:TransUnion|Experian|Equifax|the CRA)\s+must.{0,1200}(?:confirm|disclose).{0,220}(?:transaction-level records|every record reviewed|records reviewed by the furnisher|particular internal (?:document|record))/i,
      problem: 'Treats disclosure of the furnisher\'s transaction-level/internal records review as a mandatory CRA duty. The statutory entitlement is the §1681i(a)(6)(B)(iii)/(a)(7) procedure description and furnisher contact information.',
    },
    {
      pattern: /Johnson v\.?\s*MBNA.{0,180}(?:the CRA|the bureau|CRA reinvestigation|bureau reinvestigation)|(?:the CRA|the bureau).{0,180}Johnson v\.?\s*MBNA/i,
      problem: 'Uses Johnson v. MBNA as the CRA reinvestigation standard. Johnson addresses a furnisher investigation under §1681s-2(b) after CRA notice; the CRA duty comes from §1681i.',
    },
  ];

  return rules.filter(({ pattern }) => pattern.test(text)).map(({ problem }) => problem);
}

/** Statute, Metro 2, and substantive problems that block CRA Phase 3 letters. */
export function collectPhase3CitationProblems(html) {
  const problems = validateFieldCitations(html);
  if (html && String(html).includes('1681s-2(a)')) {
    problems.push('Cites 15 U.S.C. §1681s-2(a), which must never appear in a Phase 3 CRA letter — this is the furnisher\'s duty, not the CRA\'s. Rebuild on §1681s-2(b) materiality (Seamans v. Temple University) or §1681i(a)(5)(A) verify-or-delete instead.');
  }
  problems.push(...collectPhase3SubstantiveProblems(html));
  return problems;
}

/** Follow-up-specific lint, including the exact Lob enclosure contract. */
export function collectBureauFollowUpProblems(html) {
  const problems = collectPhase3CitationProblems(html);
  const text = plainText(html);
  if (/\bDear Sir or Madam\b/i.test(text)) {
    problems.push('Uses "Dear Sir or Madam"; follow-up letters must address the bureau directly without a generic salutation.');
  }
  if (/\bSincerely\b/i.test(text)) {
    problems.push('Uses "Sincerely"; follow-up letters must close with the exact consumer signature block and "Consumer — All Rights Reserved."');
  }
  const enclosureIndex = text.search(/\bEnclosures?\s*:/i);
  if (enclosureIndex < 0) {
    problems.push('Missing the required follow-up enclosures line for prior Phase 3, bureau response, and Limited Power of Attorney.');
    return problems;
  }

  const enclosures = text.slice(enclosureIndex);
  if (!/Exhibit A.{0,120}(?:Prior|Original).{0,60}Phase 3/i.test(enclosures)) {
    problems.push('Follow-up Exhibit A must be the prior Phase 3 CRA dispute letter.');
  }
  if (!/Exhibit B.{0,160}(?:Bureau|Equifax|Experian|TransUnion).{0,80}(?:Response|Investigation Results)/i.test(enclosures)) {
    problems.push('Follow-up Exhibit B must be the exact bureau response / investigation results.');
  }
  if (!/Exhibit C.{0,120}Limited Power of Attorney/i.test(enclosures)) {
    problems.push('Follow-up Exhibit C must be the Limited Power of Attorney.');
  }
  if (/(?:Phase 1|Direct Furnisher Dispute|Furnisher Response|Government-Issued Photo ID|Proof of (?:Current )?Address|Credit Report Excerpt)/i.test(enclosures)) {
    problems.push('Follow-up enclosures must not list Phase 1, a furnisher response, identity/address documents, or credit-report excerpts.');
  }
  return problems;
}

export function formatMetro2Field(key) {
  const f = assertSourced(key);
  return `Field ${f.num} (${f.name})`;
}

// Single source of truth for the field-reference block every letter-
// generation prompt needs. masterPrompt.js and phase3CitationRules.js used
// to hand-type this table separately — meaning they could drift from each
// other, AND from what validateFieldCitations/autoFixFieldCitations
// actually enforce, since neither hardcoded copy was ever generated from
// this file. A prompt that embeds this output can never cite a field
// number/name pair the lint would then reject.
export function renderMetro2FieldTable() {
  const rows = Object.values(METRO2_FIELDS)
    .map((f) => `| ${f.num} | ${f.name} | ${f.promptNote || '—'} |`)
    .join('\n');
  return `| Field | Name | Notes |\n|------|------|------|\n${rows}`;
}

export function renderMetro2StatusCodeTable() {
  return Object.entries(METRO2_STATUS_CODES)
    .map(([code, v]) => `${code}=${v.meaning}`)
    .join(', ');
}
