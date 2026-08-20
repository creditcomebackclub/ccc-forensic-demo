export const DISPUTE_BUREAUS = [
  {
    code: 'EQ',
    slug: 'equifax',
    name: 'Equifax',
    address: 'Equifax Information Services LLC\nP.O. Box 740256\nAtlanta, GA 30374-0256',
  },
  {
    code: 'EXP',
    slug: 'experian',
    name: 'Experian',
    address: 'Experian Information Solutions Inc.\nP.O. Box 4500\nAllen, TX 75013',
  },
  {
    code: 'TU',
    slug: 'transunion',
    name: 'TransUnion',
    address: 'TransUnion LLC\nConsumer Dispute Center\nP.O. Box 2000\nChester, PA 19016',
  },
];

export const FLOW_LABELS = {
  accuracy: 'Accuracy',
  collection: 'Collection',
  combo: 'Accuracy + Collection Combo',
  consent: 'Consent',
  late_pay: 'Late Pay',
  direct: 'Direct to Collector',
  accuracy_solo: 'Accuracy Solo',
};

export const FLOW_LETTER_ROUNDS = {
  accuracy: 12,
  collection: 10,
  combo: 12,
  consent: 3,
  late_pay: 2,
  direct: 2,
  accuracy_solo: 1,
};

// Migration boundary: legacy Setup & Spike, Dispute Fox, Metro 2, and manual
// letters remain historical evidence only. They never advance a client into
// a later CCC round; every client enters this method at a newly classified R1.
export const CCC_TRANSITION_START_ROUND = 1;

export function cccTransitionStartRound(_legacyLetters = []) {
  return CCC_TRANSITION_START_ROUND;
}

export const FLOW_SEQUENCES = {
  accuracy: [
    'Factual Dispute',
    '15 USC 1681e(b)',
    '15 USC 1681i(a)(5)',
    '15 USC 1681i(a)(1)(a)',
    '15 USC 1681i(a)(7)',
    '15 USC 1681i(a)(6)(B)',
    '15 USC 1681i(c)',
    '15 USC 1681s-2(b)',
    '15 USC 1681(b) + 1681e(b) + 1681i(a)',
    '15 USC 1681c(e)',
    '15 USC 1681e(b) — discharged debt balance',
    '15 USC 1681o or 15 USC 1681n',
  ],
  collection: [
    '15 USC 1692g',
    '15 USC 1692g(b)',
    '15 USC 1692j',
    '15 USC 1681a(m)',
    '15 USC 1681(b)',
    '15 USC 1692e(10)',
    '15 USC 1681q',
    '15 USC 1692c(c)',
    '15 USC 1681b(a)(3)(a)',
    '15 USC 1692k',
  ],
  combo: [
    'Factual Dispute + 15 USC 1692g',
    '15 USC 1681e(b) + 15 USC 1692g(b)',
    '15 USC 1681i(a)(5) + 15 USC 1692j',
    '15 USC 1681i(a)(1)(a) + 15 USC 1681a(m)',
    '15 USC 1681i(a)(7) — all accounts',
    '15 USC 1681i(a)(6)(B) — all accounts',
    '15 USC 1681i(c) — all accounts',
    '15 USC 1681s-2(b) + 15 USC 1681(b)',
    '15 USC 1681(b) + 15 USC 1692e(10)',
    '15 USC 1681c(e) + 15 USC 1681q',
    'Legal dispute + 15 USC 1692c(c)',
    '15 USC 1681o or 15 USC 1681n',
  ],
  consent: [
    '15 USC 1681b(a)(2)',
    '15 USC 1681(a)(4)',
    '15 USC 1681a(d)(2)(b)',
    'Switch charge-offs/late pays to Accuracy and collections to Collection',
  ],
  late_pay: [
    '15 USC 1681a(d)(a)(2)(a)(i)',
    '15 USC 1681(a)(4)',
    'Switch to Accuracy if the late payment remains',
  ],
  direct: [
    '15 USC 1692g(b) — debt verification',
    '15 USC 1692g(b) + 15 USC 1692e(10)',
  ],
  accuracy_solo: [
    '15 USC 1681c(f) — incomplete dispute comments',
  ],
};

export const REPO_SEQUENCE = [
  '15 USC 1692g',
  '15 USC 1692g(b)',
  '15 USC 1692e(10) — use for the repossession and collections',
  'Split: repossession moves to Accuracy; remaining collections continue at Collection R4',
];

const KIND_ALIASES = {
  chargeoff: 'charge_off',
  charged_off: 'charge_off',
  collection_account: 'collection',
  repo: 'repossession',
  late: 'late_payment',
};

function normalizeKind(value) {
  const key = String(value || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  return KIND_ALIASES[key] || key;
}

function accountText(account) {
  return [
    account?.status,
    account?.paymentRating,
    account?.remarks,
    account?.primaryViolation,
    account?.strategy,
  ].filter(Boolean).join(' ').toLowerCase();
}

function normalizedLateCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

export function classifyAccountForR1(account, overrides = {}) {
  const text = accountText(account);
  let kind = normalizeKind(account?.accountKind);
  if (!kind || kind === 'other') {
    if (/repossession|repossessed|\brepo\b/.test(text)) kind = 'repossession';
    else if (account?.type === 'C' || /collection|debt collector/.test(text)) kind = 'collection';
    else if (/student\s+loan|dept\.?\s+of\s+education|navient|nelnet|mohela/.test(text)) kind = 'student_loan';
    else if (/bankruptcy|chapter\s+(7|11|13)/.test(text)) kind = 'bankruptcy';
    else if (/charge[ -]?off|charged off/.test(text)) kind = 'charge_off';
    else if (/\blate\b|30 days|60 days|90 days|120 days/.test(text)) kind = 'late_payment';
  }

  const bureaus = Array.isArray(account?.bureaus) ? account.bureaus.filter(Boolean) : [];
  const latePaymentCount = normalizedLateCount(account?.latePaymentCount);
  const latePaymentBand = String(account?.latePaymentBand || '').toLowerCase();
  const base = { account, kind: kind || 'other', latePaymentCount, latePaymentBand };

  // A file-level override changes the starting flow for derogatory accounts;
  // it must never pull healthy tradelines into a dispute.
  if (kind === 'positive') {
    return { ...base, flow: null, excluded: true, reason: 'Healthy accounts are excluded from the dispute campaign.' };
  }
  if (overrides.forceConsent) {
    return { ...base, flow: 'consent', override: 'student_loan_majority', reason: 'Student loans are the only or majority account type, so every account starts on Consent R1.' };
  }
  if (kind === 'late_payment' && overrides.forceLatePayForLates) {
    return { ...base, flow: 'late_pay', override: 'mixed_late_stretches', reason: 'A mixed late-payment pattern on the file routes all late-pay accounts to Late Pay R1.' };
  }

  if (kind === 'repossession') {
    return { ...base, flow: 'collection', specialRule: 'repo', reason: 'Repossession starts on Collection R1.' };
  }
  if (kind === 'collection') {
    return { ...base, flow: 'collection', reason: 'Collection account starts on Collection R1.' };
  }
  if (kind === 'bankruptcy') {
    return { ...base, flow: 'accuracy', reason: 'Bankruptcy reporting starts on Accuracy R1.' };
  }
  if (kind === 'student_loan') {
    return { ...base, flow: 'consent', reason: 'Student-loan reporting starts on Consent R1.' };
  }
  if (kind === 'charge_off') {
    if (bureaus.length === 1) {
      return { ...base, flow: 'consent', reason: 'Charge-off reports on one bureau, so it starts on Consent R1.' };
    }
    return { ...base, flow: 'accuracy', reason: 'Charge-off reports across bureaus, so it starts on Accuracy R1.' };
  }
  if (kind === 'late_payment') {
    if (latePaymentBand === 'mixed' || latePaymentBand === 'two_or_fewer') {
      return { ...base, flow: 'late_pay', reason: latePaymentBand === 'mixed' ? 'Mixed late-payment stretches start on Late Pay R1.' : 'Two or fewer late payments starts on Late Pay R1.' };
    }
    if (latePaymentBand === 'three_or_more') {
      return { ...base, flow: 'accuracy', reason: 'Three or more late payments starts on Accuracy R1.' };
    }
    if (latePaymentCount === null) {
      return { ...base, flow: null, needsReview: true, reason: 'Late-payment count is missing; confirm whether the account has two or fewer lates.' };
    }
    if (latePaymentCount <= 2) {
      return { ...base, flow: 'late_pay', reason: `${latePaymentCount} late payment${latePaymentCount === 1 ? '' : 's'} starts on Late Pay R1.` };
    }
    return { ...base, flow: 'accuracy', reason: `${latePaymentCount} late payments starts on Accuracy R1.` };
  }
  return {
    ...base,
    flow: null,
    needsReview: true,
    reason: 'The report did not expose enough category data to select a flow deterministically.',
  };
}

function makeRecommendation(flow, accounts) {
  return {
    flow,
    label: FLOW_LABELS[flow],
    round: 1,
    law: FLOW_SEQUENCES[flow][0],
    accounts,
    accountIds: accounts.map((account) => account.id).filter(Boolean),
  };
}

function planOverrides(accounts) {
  const classified = (accounts || []).map((account) => ({ account, kind: classifyAccountForR1(account).kind }));
  const routedAccounts = classified.filter((item) => item.kind && item.kind !== 'positive' && item.kind !== 'other');
  const studentLoanCount = routedAccounts.filter((item) => item.kind === 'student_loan').length;
  const forceConsent = studentLoanCount > 0 && (studentLoanCount === routedAccounts.length || studentLoanCount > routedAccounts.length / 2);
  const forceLatePayForLates = routedAccounts.some((item) => (
    item.kind === 'late_payment' && String(item.account?.latePaymentBand || '').toLowerCase() === 'mixed'
  ));
  return { forceConsent, forceLatePayForLates };
}

export function buildBureauR1Recommendation(audit, bureauCode, overrides = planOverrides(audit?.accounts || [])) {
  const bureau = DISPUTE_BUREAUS.find((item) => item.code === bureauCode);
  if (!bureau) throw new Error(`Unknown bureau code: ${bureauCode}`);

  const eligibleAccounts = (Array.isArray(audit?.accounts) ? audit.accounts : [])
    .filter((account) => (account.bureaus || []).includes(bureauCode));
  const classifications = eligibleAccounts.map((account) => classifyAccountForR1(account, overrides));
  const byFlow = (flow) => classifications.filter((item) => item.flow === flow).map((item) => item.account);
  const accuracy = byFlow('accuracy');
  const collection = byFlow('collection');
  const consent = byFlow('consent');
  const latePay = byFlow('late_pay');
  const recommendations = [];

  if (accuracy.length && collection.length) recommendations.push(makeRecommendation('combo', [...accuracy, ...collection]));
  else if (accuracy.length) recommendations.push(makeRecommendation('accuracy', accuracy));
  else if (collection.length) recommendations.push(makeRecommendation('collection', collection));
  else if (latePay.length) recommendations.push(makeRecommendation('late_pay', latePay));
  else if (consent.length) recommendations.push(makeRecommendation('consent', consent));

  const routedIds = new Set((recommendations[0]?.accounts || []).map((account) => account.id));
  const deferred = classifications.filter((item) => item.flow && !routedIds.has(item.account.id));

  return {
    bureau,
    recommendations,
    primary: recommendations[0] || null,
    classifications,
    needsReview: classifications.filter((item) => item.needsReview),
    excluded: classifications.filter((item) => item.excluded),
    deferred,
    overrides,
    accountCount: eligibleAccounts.length,
  };
}

export function buildR1CampaignPlan(audit) {
  const accounts = Array.isArray(audit?.accounts) ? audit.accounts : [];
  const overrides = planOverrides(accounts);
  const bureaus = DISPUTE_BUREAUS.map((bureau) => buildBureauR1Recommendation(audit, bureau.code, overrides));
  const allClassifications = accounts.map((account) => classifyAccountForR1(account, overrides));
  return {
    bureaus,
    accountClassifications: allClassifications,
    needsReview: allClassifications.filter((item) => item.needsReview),
    recommendedLetterCount: bureaus.reduce((total, item) => total + item.recommendations.length, 0),
    overrides,
  };
}

export function flowRoundLabel(flow, round = 1) {
  return `${FLOW_LABELS[flow] || flow} R${round} — ${FLOW_SEQUENCES[flow]?.[round - 1] || 'Template required'}`;
}
