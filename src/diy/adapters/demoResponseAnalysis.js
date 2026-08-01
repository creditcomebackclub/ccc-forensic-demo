/**
 * Canned Midland-style form-letter analysis for demo mode (no Anthropic key).
 */

export const DEMO_RESPONSE_ANALYSIS = {
  classification: 'FORM_LETTER',
  summary:
    'Midland sent a short “account verified” letter that never engages the specific Metro 2 Field 25 DOFD or Field 20 XB issues you raised. Under Johnson v. MBNA, parroting their own file is not a reasonable investigation.',
  demandAnalysis: [
    {
      demand: 'Correct Metro 2 Field 25 (DOFD) to original Synchrony delinquency chronology',
      outcome: 'IGNORED',
      notes: 'Response does not mention DOFD, acquisition dates, or original-creditor chronology.',
    },
    {
      demand: 'Produce written XB retention policy or update Field 20 (XR/XH after investigation)',
      outcome: 'IGNORED',
      notes: 'No policy citation; XB is not addressed.',
    },
    {
      demand: 'Identify records reviewed and produce source documentation relied upon',
      outcome: 'IGNORED',
      notes: 'Generic verification language only — no list of records reviewed.',
    },
    {
      demand: 'Update all CRAs with corrected Metro 2 values and confirm in writing',
      outcome: 'IGNORED',
      notes: 'No confirmation of CRA updates.',
    },
  ],
  admissions: [
    'The letter acknowledges receipt of a dispute on this account number.',
  ],
  talkingPoints: [
    'Quote their “verified accurate” line next to each Metro 2 field they never named.',
    'Restate Field 25 DOFD as a trace-to-original-creditor demand — not a debt-buyer servicing date.',
    'Demand the written XB retention policy or an XR/XH update on Field 20.',
    'Cite Johnson v. MBNA: matching their own database is not an investigation.',
    'Give a hard 30-day deadline and list the follow-up packet enclosures you are sending.',
    'Keep the tone factual — you are documenting a second inadequate investigation trail.',
  ],
  followUpLeverage:
    'Their form-letter verification that ignores every cited Metro 2 field is itself evidence that no reasonable reinvestigation occurred.',
  documentQuality: {
    enclosureLegible: true,
    issues: [],
  },
};

export const CLASSIFICATION_LABELS = {
  FORM_LETTER: 'Form letter / verified without substance',
  STATEMENT_COPY: 'Statements only — not source documents',
  PARTIAL_FIX: 'Partial correction',
  WRONG_FRAMEWORK: 'Treated as bureau e-OSCAR, not direct dispute',
  NON_RESPONSE: 'No response in the window',
  ADEQUATE: 'Appears adequate',
};

export const OUTCOME_LABELS = {
  ADDRESSED: 'Addressed',
  IGNORED: 'Ignored',
  PARTIALLY_ADDRESSED: 'Partially addressed',
  ADMITTED: 'Admission',
};
