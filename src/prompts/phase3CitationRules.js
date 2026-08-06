// Shared citation rules for every CRA-addressed Phase 3 letter path
// (initial Phase 3 generation AND bureau follow-up). Keep this in sync with
// validateFieldCitations / METRO2_FIELDS — prompts that omit these rules
// will copy wrong Field N phrasing from Exhibit A / analysis JSON.
//
// The bullets below are curated behavioral gotchas (the fields that
// actually get confused in practice), not a full field list — the
// generated table appended at the end IS the full list, pulled directly
// from src/constants/metro2Fields.js so it can never drift from what
// validateFieldCitations/autoFixFieldCitations actually enforce.
import { renderMetro2FieldTable } from '../constants/metro2Fields.js';

export const PHASE3_METRO2_FIELD_RULES = `METRO 2 FIELD CITATION RULES (NON-NEGOTIABLE — server lint will block the letter):
- Field 19 = Special Comment (e.g. AU = settled). NEVER put XA/XB/XC/XH/XR here.
- Field 20 = Compliance Condition Code. XA/XB/XC/XH/XR live ONLY in Field 20.
- Field 21 = Current Balance. Field 22 = Amount Past Due. Do not swap them.
- Field 23 = Original Charge-off Amount. Field 27 = Date of Last Payment. NEVER cite Date of Last Payment as Field 23.
- Field 17A = Account Status. Field 17B = Payment Rating. Field 18 = Payment History Profile.
- Field 18 is a rolling 24-month profile, not a lifetime history. Never demand history from account opening through the present.
- Prefer the phrasing "Compliance Condition Code XB (Metro 2 Field 20)" the first time XB is raised.
- NEVER write "Field 19 — Compliance Condition Code", "Field 19 — XB", or "Field 19 — XB/XC".
- If Exhibit A, Exhibit B, or the prior analysis JSON uses a wrong Field number/name, CORRECT it in this letter — do not copy the error.
- Only cite Base Segment field numbers that exist in the verified map (7–16, 17A, 17B, 18–27). Never invent Field 4, Field 30, etc.

FULL FIELD REFERENCE (authoritative — generated from src/constants/metro2Fields.js):
${renderMetro2FieldTable()}`;

export const PHASE3_STATUTE_CITATION_RULES = `STATUTE CITATION RULES (NON-NEGOTIABLE — server lint will block the letter):
- This letter is addressed to a CRA. It must NEVER contain the string "1681s-2(a)" in any subsection.
- §1681s-2(a) is the furnisher's duty (no private right of action). Do not copy (a) cites from Phase 1 framing, exhibits, or analysis JSON.
- The CRA's duties arise under §1681i. The furnisher's separate §1681s-2(b) investigation duty attaches after CRA notice under §1681i(a)(2).
- Johnson v. MBNA addresses the furnisher's §1681s-2(b) investigation, not the CRA's §1681i reinvestigation. Do not say Johnson directly defines the CRA's duty.
- Seamans v. Temple University concerns the materiality of disputed-status reporting. Cite it only for a supported dispute-flag/status issue, not as a generic hook for every Metro 2 issue.
- Allowed: §1681i / §1681i(a)(1)(A) / §1681i(a)(2) / §1681i(a)(5)(A) / §1681i(a)(6)(B)(iii) / §1681i(a)(7), §1681s-2(b), §1681n, §1681o.`;

export const PHASE3_SUBSTANTIVE_RULES = `SUBSTANTIVE ACCURACY RULES (NON-NEGOTIABLE — server lint will block the letter):
- Account Status 97 means an UNPAID balance reported as a loss (charge-off). A status-97 account may legitimately report Current Balance (Field 21) and Amount Past Due (Field 22). Charge-off is accounting treatment; it does not extinguish the debt. NEVER call that combination a "logical impossibility," "uncollectible," or incompatible merely because it is charged off.
- A balance or past-due amount may be inconsistent when the account is reported PAID — e.g. Status 13 or 61–65, including Status 64 (paid in full, was a charge-off). Assert that only when the evidence actually shows the paid status.
- Current Balance (Field 21) equaling Amount Past Due (Field 22) is common on collection/charged-off accounts and is not a violation by itself. Field 17A is Account Status; never label Fields 17A/21 as the balance/past-due pair.
- Field 18 is a rolling 24-month Payment History Profile. Challenge a concrete blank, suppression, or internal inconsistency in that 24-month window; never demand lifetime history or history from Date Opened forward.
- A Date Closed does not by itself make later monthly C/O/charge-off entries inaccurate while an unpaid charge-off remains reportable. Never challenge post-closure C/O entries solely because they follow the closure date; require a separate concrete inconsistency.
- A returned/dishonored payment date does not by itself establish the Date of First Delinquency. DOFD is the first delinquency in the uninterrupted chain that led to charge-off; account for cure and the contractual due date. Never call a reported DOFD invented merely because that raw date was not displayed on a consumer report.
- A cross-bureau date conflict warrants verification against original-source records, but it does not prove which bureau's date is correct. Demand verification and correction of whichever value is inaccurate; do not assume another bureau is authoritative.
- A CRA must reasonably reinvestigate and delete/modify unverifiable information under §1681i(a)(5)(A). It is not generally required to provide a UDF or all furnisher/source documents to the consumer. Request the statutory description of the procedure used under §1681i(a)(6)(B)(iii) and (a)(7), including furnisher contact information. You may request supporting documents, but never state that producing a UDF or source records is the CRA's statutory obligation.
- The §1681i(a)(6)(B)(iii)/(a)(7) procedure description does not guarantee disclosure of transaction-level records, every record reviewed by the furnisher, or whether the furnisher reviewed a particular internal document. Do not put those disclosures in a mandatory "TransUnion/Experian/Equifax must" demand.
- Do not copy an unsupported premise from a prior letter or analysis. Correct it or omit it.`;

export const PHASE3_XB_DEMAND_RULES = `XB / COMPLIANCE CONDITION CODE DEMAND — GATED (CRRG Dec. 2024 Exhibit 8):
- If the furnisher is a debt purchaser, collection agency, or debt collector: you MAY raise XB, named as "Compliance Condition Code XB (Metro 2 Field 20)", framed under the FDCPA exception (§1692e(8)).
- If the furnisher is an original creditor, bank, or lender: SUPPRESS the XB demand entirely. Do not ask the bureau to require an XB notation on a non-collector.`;

export const BUREAU_FOLLOW_UP_ENCLOSURE_RULES = `FOLLOW-UP ENCLOSURES (EXACT — the Lob packet is built from these source IDs):
- Enclosures line must list exactly: "Exhibit A: Prior Phase 3 CRA Dispute Letter (dated [date]); Exhibit B: [Bureau] Investigation Results (dated [date]); Exhibit C: Limited Power of Attorney."
- Do not list the original Phase 1 letter, furnisher response, credit-report excerpts, ID, proof of address, or any other enclosure.
- The body may refer only to Exhibit A (prior Phase 3) and Exhibit B (bureau response). Exhibit C is authority to act, not factual evidence.`;
