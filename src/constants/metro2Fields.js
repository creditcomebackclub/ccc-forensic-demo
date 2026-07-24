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

export const METRO2_FIELDS = {
  CONSUMER_ACCOUNT_NUMBER:   { num: '7',   name: 'Consumer Account Number',                        source: B2003('43-72'),   edition: '2003' }, // packed 37-66
  PORTFOLIO_TYPE:            { num: '8',   name: 'Portfolio Type',                                 source: B2003('73'),      edition: '2003' }, // packed 67
  ACCOUNT_TYPE:              { num: '9',   name: 'Account Type',                                   source: B2003('74-75'),   edition: '2003' }, // packed 68-69
  DATE_OPENED:               { num: '10',  name: 'Date Opened',                                    source: B2003('76-83'),   edition: '2003' }, // packed 70-74
  CREDIT_LIMIT:              { num: '11',  name: 'Credit Limit',                                   source: B2003('84-92'),   edition: '2003' }, // packed 75-79
  HIGHEST_CREDIT:            { num: '12',  name: 'Highest Credit or Original Loan Amount',         source: B2003('93-101'),  edition: '2003' }, // packed 80-84
  TERMS_DURATION:            { num: '13',  name: 'Terms Duration',                                 source: B2003('102-104'), edition: '2003' }, // packed 85-87

  TERMS_FREQUENCY:           { num: '14',  name: 'Terms Frequency',                                source: B2003('105'),     edition: '2003' }, // packed 88
  SCHEDULED_MONTHLY_PMT:     { num: '15',  name: 'Scheduled Monthly Payment Amount',               source: B2003('106-114'), edition: '2003' }, // packed 89-93
  ACTUAL_PAYMENT_AMOUNT:     { num: '16',  name: 'Actual Payment Amount',                          source: B2003('115-123'), edition: '2003' }, // packed 94-98

  ACCOUNT_STATUS:            { num: '17A', name: 'Account Status',                                 source: B2003('124-125'), edition: '2003' }, // packed 99-100
  PAYMENT_RATING:            { num: '17B', name: 'Payment Rating',                                 source: B2003('126'),     edition: '2003' }, // packed 101
  PAYMENT_HISTORY_PROFILE:   { num: '18',  name: 'Payment History Profile',                        source: B2003('127-150'), edition: '2003' }, // packed 102-125
  SPECIAL_COMMENT:           { num: '19',  name: 'Special Comment',                                source: B2003('151-152'), edition: '2003' }, // packed 126-127
  COMPLIANCE_CONDITION_CODE: { num: '20',  name: 'Compliance Condition Code',                      source: 'CRRG Dec. 2024, Exhibit 8, p. 5-32',  edition: '2024' },
  CURRENT_BALANCE:           { num: '21',  name: 'Current Balance',                                source: 'CRRG Dec. 2024, Debt Buyer item 11',  edition: '2024' },
  AMOUNT_PAST_DUE:           { num: '22',  name: 'Amount Past Due',                                source: 'CRRG Dec. 2024, Debt Buyer item 11',  edition: '2024' },
  ORIGINAL_CHARGE_OFF_AMT:   { num: '23',  name: 'Original Charge-off Amount',                     source: B2003('173-181'), edition: '2003' },
  // Renamed "Date of Account Information" in later editions — keep the 2003
  // name while citing the 2003 edition.
  BILLING_DATE:              { num: '24',  name: 'Billing Date',                                   source: B2003('182-189'), edition: '2003' },
  DATE_FIRST_DELINQUENCY:    { num: '25',  name: 'FCRA Compliance/Date of First Delinquency',      source: B2003('190-197'), edition: '2003' },
  DATE_CLOSED:               { num: '26',  name: 'Date Closed',                                    source: B2003('198-205'), edition: '2003' },
  DATE_OF_LAST_PAYMENT:      { num: '27',  name: 'Date of Last Payment',                           source: 'CRRG Dec. 2024, Debt Buyer item 12',  edition: '2024' },
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
const NAME_TOKENS = Object.values(METRO2_FIELDS).map((f) => ({
  num: f.num.toUpperCase(), name: f.name,
  head: f.name.toLowerCase().replace(/[^a-z ]/g, '').split(' ')[0],
}));

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

  for (const m of text.matchAll(/Field\s*(\d{1,2}[AB]?)\s*[—\-–:(]?\s*([A-Za-z][A-Za-z '\/]{2,45})?/g)) {
    const num = m[1].toUpperCase();
    const label = (m[2] || '').trim().replace(/\s+/g, ' ');

    if (!VALID_NUMS.has(num)) {
      const key = 'unknown:' + num;
      if (!seen.has(key)) { seen.add(key); problems.push(`Cites "Field ${num}"${label ? ` — ${label}` : ''}, which is not a Metro 2 Base Segment field number in the verified map.`); }
      continue;
    }
    if (!label) continue;

    // Must run before the generic-label guard: "XB/XC" reduces to a 4-char
    // token and would otherwise be skipped as prose.
    if (num === '19' && /\bX[ABCDEFGHJR]\b/.test(label)) {
      const key = 'ccc-value-on-19';
      if (!seen.has(key)) { seen.add(key); problems.push(`Cites "Field 19 — ${label}", but XA/XB/XC-style codes are Compliance Condition Code values, which live in Field ${METRO2_FIELDS.COMPLIANCE_CONDITION_CODE.num} (${METRO2_FIELDS.COMPLIANCE_CONDITION_CODE.name}). Field 19 is ${METRO2_FIELDS.SPECIAL_COMMENT.name}.`); }
      continue;
    }

    const labelHead = label.toLowerCase().replace(/[^a-z ]/g, '').split(' ')[0];
    if (labelHead.length <= 4) continue;
    const actual = NAME_TOKENS.find((t) => t.num === num);
    if (actual && labelHead === actual.head) continue;
    const claimsAnother = NAME_TOKENS.find((t) => t.num !== num && t.head === labelHead && t.head.length > 4);
    if (actual && claimsAnother) {
      const key = 'mislabel:' + num + ':' + claimsAnother.num;
      if (!seen.has(key)) { seen.add(key); problems.push(`Cites "Field ${num} — ${label}", but Field ${num} is ${actual.name}; "${claimsAnother.name}" is Field ${claimsAnother.num}.`); }
    }
  }
  return problems;
}

export function formatMetro2Field(key) {
  const f = assertSourced(key);
  return `Field ${f.num} (${f.name})`;
}
