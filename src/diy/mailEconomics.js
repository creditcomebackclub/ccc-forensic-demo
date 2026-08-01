/**
 * Real Lob economics for Fieldwork mail credits.
 *
 * Operator reality (CCC-style certified packets today):
 *   Phase 1 ≈ letter + ID docs          → ~$12–15 / Lob send
 *   Phase 2 ≈ letter + response + return
 *             receipt + Phase 1 letter
 *             + ID docs                 → still one Lob send, usually
 *                                         at the high end of that range
 *
 * Product rule: 1 mail credit = 1 certified Lob packet (any phase).
 * Credits are priced so postage is covered with a thin buffer — software
 * margin lives in the subscription, not by undercounting stamps.
 */

export const MAIL_COST_USD = {
  min: 12,
  max: 15,
  /** Used for UI estimates (mid / slightly conservative). */
  typical: 14,
  /** Consumer credit face value (covers Lob + buffer). */
  creditFace: 15,
};

export const MAIL_PHASES = {
  phase1: {
    id: 'phase1',
    label: 'Phase 1',
    title: 'Furnisher dispute',
    blurb: 'Opening certified packet to the furnisher.',
    credits: 1,
    costHint: '$12–14 typical',
    enclosures: [
      { id: 'letter', name: 'Dispute letter', required: true },
      { id: 'id', name: 'Photo ID', required: true },
      { id: 'address', name: 'Proof of address', required: true },
    ],
  },
  phase2: {
    id: 'phase2',
    label: 'Phase 2',
    title: 'Response / follow-up packet',
    blurb: 'Heavier packet after a furnisher reply (or non-response follow-up).',
    credits: 1,
    costHint: '$14–15 typical',
    enclosures: [
      { id: 'letter', name: 'Phase 2 dispute letter', required: true },
      { id: 'response', name: 'Furnisher response (copy)', required: true },
      { id: 'receipt', name: 'Certified mail return receipt', required: true },
      { id: 'phase1', name: 'Prior Phase 1 letter (copy)', required: true },
      { id: 'id', name: 'Photo ID', required: true },
      { id: 'address', name: 'Proof of address', required: true },
    ],
  },
};

export function estimatePostageUsd(letterCount, { phase = 'phase1' } = {}) {
  const per = phase === 'phase2' ? MAIL_COST_USD.max : MAIL_COST_USD.typical;
  return letterCount * per;
}

export function formatCreditCostRange() {
  return `$${MAIL_COST_USD.min}–$${MAIL_COST_USD.max}`;
}

/** Extra credit packs (top-ups) — postage pass-through with small buffer. */
export const CREDIT_PACKS = [
  { id: 'pack_3', credits: 3, price: 45, label: '3 sends' },
  { id: 'pack_6', credits: 6, price: 84, label: '6 sends' },
  { id: 'pack_12', credits: 12, price: 156, label: '12 sends' },
];
