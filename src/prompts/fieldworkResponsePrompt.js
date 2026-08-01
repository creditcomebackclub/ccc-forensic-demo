/**
 * Fieldwork furnisher-response analysis — consumer product tone.
 * Reuses CCC Phase 2 forensic methodology without CCC branding or bureau letters.
 */

export const FIELDWORK_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    classification: {
      type: 'string',
      enum: [
        'FORM_LETTER',
        'STATEMENT_COPY',
        'PARTIAL_FIX',
        'WRONG_FRAMEWORK',
        'NON_RESPONSE',
        'ADEQUATE',
      ],
    },
    summary: { type: 'string' },
    demandAnalysis: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          demand: { type: 'string' },
          outcome: {
            type: 'string',
            enum: ['ADDRESSED', 'IGNORED', 'PARTIALLY_ADDRESSED', 'ADMITTED'],
          },
          notes: { type: 'string' },
        },
        required: ['demand', 'outcome', 'notes'],
      },
    },
    admissions: { type: 'array', items: { type: 'string' } },
    talkingPoints: {
      type: 'array',
      items: { type: 'string' },
      description: 'Plain-English bullets the consumer can use to write their own follow-up (Starter).',
    },
    followUpLeverage: {
      type: 'string',
      description: 'Single strongest angle for the next furnisher follow-up letter.',
    },
    documentQuality: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enclosureLegible: { type: 'boolean' },
        issues: { type: 'array', items: { type: 'string' } },
      },
      required: ['enclosureLegible', 'issues'],
    },
  },
  required: [
    'classification',
    'summary',
    'demandAnalysis',
    'admissions',
    'talkingPoints',
    'followUpLeverage',
    'documentQuality',
  ],
};

export function getFieldworkResponseSystemPrompt() {
  return `# FIELDWORK — FURNISHER RESPONSE ANALYSIS

You analyze a furnisher's reply (or non-response) against the consumer's prior direct dispute letter.
This is for a DIY credit-repair product. Never mention Credit Comeback Club, CCC, agency retainers, or "Phase 3 bureau letters."
Speak to the consumer in plain English in summary and talkingPoints.

## Legal standard (keep substance)
- Johnson v. MBNA America Bank, 357 F.3d 426 (4th Cir. 2004): reasonable reinvestigation requires more than parroting the same database.
- Seamans v. Temple University: once on notice, furnisher must maintain disputed-status notation where applicable.
- Direct furnisher dispute under 12 C.F.R. §1022.43 / 15 U.S.C. §1681s-2(a)(8) — not e-OSCAR alone.

## Classifications
- FORM_LETTER: Generic "verified accurate" without addressing cited Metro 2 fields / demands.
- STATEMENT_COPY: Enclosed their own statements/screen prints, not original source docs demanded.
- PARTIAL_FIX: Some violations corrected; others remain.
- WRONG_FRAMEWORK: Treated as bureau-forwarded e-OSCAR, not a direct furnisher dispute.
- NON_RESPONSE: Nothing within the 30-day window (or user marked no response).
- ADEQUATE: Investigated and corrected cited issues with real documentation.

## Document quality gate (first)
If the scan is mirrored, illegible, or rows/dates don't align, set documentQuality.enclosureLegible=false and list issues.
Do not assert specific dates/amounts from an illegible enclosure as fact.

## Analysis steps
1. Extract every demand / Metro 2 field challenge from the prior letter (and account JSON).
2. Map each demand to ADDRESSED | IGNORED | PARTIALLY_ADDRESSED | ADMITTED.
3. Classify the overall response.
4. List admissions that help the consumer.
5. Write 4–7 talkingPoints (actionable, plain English — what to say next).
6. Write followUpLeverage: one sharp sentence for the next letter's core argument.

## Output
Fill the JSON schema exactly. No HTML letters in this step. No markdown fences.`;
}

export function getFieldworkFollowUpLetterPrompt(tone = 'Standard') {
  const aggressive = tone === 'Aggressive';
  return `# FIELDWORK — FURNISHER FOLLOW-UP LETTER (HTML)

You write ONE follow-up dispute letter after an inadequate furnisher response.
The consumer is the sole sender. Never brand Fieldwork, CCC, or any company on the letter.

## Output format (HARD)
- Complete \`<!DOCTYPE html>\` with <head> and <body>.
- Do NOT include a <style> block — the server injects CSS.
- Use ONLY these classes: date-line, sender-block, recipient-block, re-line, section-header, id-table, list-table, demands-table, demand-num, closing-statement, signature-block, sig-line, printed-name, rights-line, mail-notation, enclosures, body-copy, label, reported, challenge, accent.
- Open date → sender → recipient (no product mark).
- Signature: "Sincerely," then empty \`sig-line\`, then printed name.

## Substance
- Reference the prior direct dispute date and that the response failed a reasonable investigation (Johnson v. MBNA).
- Rebuild ignored / partially addressed Metro 2 findings from the analysis JSON.
- Weaponize admissions when present.
- Do NOT claim §1681s-2(b) bureau duties attach yet from this letter alone.
- Tone: ${aggressive ? 'firm, deadline-driven' : 'firm, professional, factual, 30-day deadline'}.
- Enclosures line: photo ID, proof of address, prior dispute letter, furnisher response, return receipt.

Output ONLY the HTML.`;
}
