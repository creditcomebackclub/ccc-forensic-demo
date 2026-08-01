// Shared citation rules for every CRA-addressed Phase 3 letter path
// (initial Phase 3 generation AND bureau follow-up). Keep this in sync with
// validateFieldCitations / METRO2_FIELDS — prompts that omit these rules
// will copy wrong Field N phrasing from Exhibit A / analysis JSON.

export const PHASE3_METRO2_FIELD_RULES = `METRO 2 FIELD CITATION RULES (NON-NEGOTIABLE — server lint will block the letter):
- Field 19 = Special Comment (e.g. AU = settled). NEVER put XA/XB/XC/XH/XR here.
- Field 20 = Compliance Condition Code. XA/XB/XC/XH/XR live ONLY in Field 20.
- Field 21 = Current Balance. Field 22 = Amount Past Due. Do not swap them.
- Field 17A = Account Status. Field 17B = Payment Rating. Field 18 = Payment History Profile.
- Prefer the phrasing "Compliance Condition Code XB (Metro 2 Field 20)" the first time XB is raised.
- NEVER write "Field 19 — Compliance Condition Code", "Field 19 — XB", or "Field 19 — XB/XC".
- If Exhibit A, Exhibit B, or the prior analysis JSON uses a wrong Field number/name, CORRECT it in this letter — do not copy the error.
- Only cite Base Segment field numbers that exist in the verified map (7–16, 17A, 17B, 18–27). Never invent Field 4, Field 30, etc.`;

export const PHASE3_STATUTE_CITATION_RULES = `STATUTE CITATION RULES (NON-NEGOTIABLE — server lint will block the letter):
- This letter is addressed to a CRA. It must NEVER contain the string "1681s-2(a)" in any subsection.
- §1681s-2(a) is the furnisher's duty (no private right of action). Do not copy (a) cites from Phase 1 framing, exhibits, or analysis JSON.
- Rebuild those arguments on §1681s-2(b) materiality (Seamans v. Temple University, 744 F.3d 853 (3d Cir. 2014)) or §1681i(a)(5)(A) verify-or-delete.
- Allowed: §1681i / §1681i(a)(1)(A) / §1681i(a)(2) / §1681i(a)(5)(A), §1681s-2(b), §1681n, Johnson v. MBNA, Seamans.`;

export const PHASE3_XB_DEMAND_RULES = `XB / COMPLIANCE CONDITION CODE DEMAND — GATED (CRRG Dec. 2024 Exhibit 8):
- If the furnisher is a debt purchaser, collection agency, or debt collector: you MAY raise XB, named as "Compliance Condition Code XB (Metro 2 Field 20)", framed under the FDCPA exception (§1692e(8)).
- If the furnisher is an original creditor, bank, or lender: SUPPRESS the XB demand entirely. Do not ask the bureau to require an XB notation on a non-collector.`;
