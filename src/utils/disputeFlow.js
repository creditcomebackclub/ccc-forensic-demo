import { CCC_METHOD_VERSION, concreteTemplateStep } from './disputeState.js';
import { routingFactForBureau } from './disputeRoutingFacts.js';

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
export const CLASSIFICATION_REVIEW_METHOD_VERSION = CCC_METHOD_VERSION;

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

function normalizedLateCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

function normalizeBureauCode(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (key === 'eq' || key === 'equifax') return 'EQ';
  if (key === 'exp' || key === 'experian') return 'EXP';
  if (key === 'tu' || key === 'transunion') return 'TU';
  return null;
}

function normalizedAccountBureaus(account) {
  const raw = Array.isArray(account?.bureaus) ? account.bureaus : [];
  const normalized = raw.map(normalizeBureauCode);
  if (!normalized.length || normalized.some((code) => !code) || new Set(normalized).size !== normalized.length) {
    throw new Error('Every audit account requires a unique, recognized reported-bureau list.');
  }
  return normalized.sort();
}

export function classifyAccountForR1(account, overrides = {}, bureauCode = null) {
  const normalizedBureau = bureauCode ? normalizeBureauCode(bureauCode) : null;
  const routing = routingFactForBureau(account, normalizedBureau);
  const kind = normalizeKind(routing.accountKind);
  let bureaus = [];
  try { bureaus = normalizedAccountBureaus(account); } catch { bureaus = []; }
  const bureauLate = routing.bureauFact || null;
  const latePaymentCount = normalizedLateCount(bureauLate?.latePaymentCount);
  const latePaymentBand = String(bureauLate?.latePaymentBand || '').toLowerCase();
  const base = {
    account,
    kind: kind || 'other',
    bureauCode: routing.bureauCode,
    latePaymentCount,
    latePaymentBand,
    routingFactsVersion: account?.routingFacts?.version || null,
  };

  if (routing.status !== 'confirmed' || routing.blockingCodes.length || !kind || kind === 'other') {
    return {
      ...base,
      flow: null,
      needsReview: true,
      reason: routing.blockingCodes.length
        ? `Classification review required: ${routing.blockingCodes.join(', ')}.`
        : 'The report did not expose enough confirmed account facts to select a flow deterministically.',
    };
  }

  // A file-level override changes the starting flow for derogatory accounts;
  // it must never pull healthy tradelines into a dispute.
  if (kind === 'positive') {
    return { ...base, flow: null, excluded: true, reason: 'Healthy accounts are excluded from the dispute campaign.' };
  }
  if (kind === 'late_payment' && (
    !bureauLate
    || bureauLate.latePaymentStatus !== 'confirmed'
    || latePaymentCount === null
    || latePaymentCount < 1
    || !['two_or_fewer', 'three_or_more', 'mixed'].includes(latePaymentBand)
  )) {
    return { ...base, flow: null, needsReview: true, reason: 'The selected bureau must show at least one confirmed late marker and a matching non-zero pattern before routing.' };
  }
  // Repossessions have their own owner-confirmed logical path and cannot be
  // absorbed into a file-level Consent/Late Pay override.
  if (kind === 'repossession') {
    return { ...base, flow: 'collection', specialRule: 'repo', reason: 'Repossession starts on Repo logical R1 using the Collection R1 template.' };
  }
  if (overrides.forceConsent) {
    return { ...base, flow: 'consent', override: 'student_loan_majority', reason: 'Student loans are the only or majority account type, so every account starts on Consent R1.' };
  }
  if (kind === 'late_payment' && overrides.forceLatePayForLates) {
    return { ...base, flow: 'late_pay', override: 'mixed_late_stretches', reason: 'A mixed late-payment pattern on the file routes all late-pay accounts to Late Pay R1.' };
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
    if (!routing.reportCoverage?.complete) {
      return { ...base, flow: null, needsReview: true, reason: 'A complete one-of-each 3B report is required before deciding whether a charge-off is bureau-solo.' };
    }
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

function accountIdentity(account) {
  return account?.clientAccountId || account?.id || account?.accountId || null;
}

function canonicalClientAccountId(account) {
  return account?.clientAccountId || account?.client_account_id || null;
}

function normalizedReviewRoute(route = {}) {
  return {
    accountKind: normalizeKind(route.accountKind ?? route.account_kind),
    bureauCode: normalizeBureauCode(route.bureauCode ?? route.bureau_code) || '',
    clientAccountId: String(route.clientAccountId ?? route.client_account_id ?? '').trim(),
    nativeFlow: String(route.nativeFlow ?? route.native_flow ?? '').trim().toLowerCase(),
  };
}

export function canonicalClassificationRoutes(routes = []) {
  if (!Array.isArray(routes)) throw new Error('Classification review routes must be an array.');
  const normalized = routes.map(normalizedReviewRoute).sort((left, right) => (
    left.clientAccountId.localeCompare(right.clientAccountId)
    || left.bureauCode.localeCompare(right.bureauCode)
    || left.accountKind.localeCompare(right.accountKind)
    || left.nativeFlow.localeCompare(right.nativeFlow)
  ));
  const identities = new Set();
  for (const route of normalized) {
    if (!route.clientAccountId || !DISPUTE_BUREAUS.some((bureau) => bureau.code === route.bureauCode)) {
      throw new Error('Every reviewed route requires an exact client account and bureau.');
    }
    if (!['charge_off', 'collection', 'repossession', 'bankruptcy', 'student_loan', 'late_payment'].includes(route.accountKind)) {
      throw new Error(`Unsupported reviewed account kind: ${route.accountKind || 'missing'}.`);
    }
    if (!['accuracy', 'collection', 'consent', 'late_pay', 'repo'].includes(route.nativeFlow)) {
      throw new Error(`Unsupported reviewed native flow: ${route.nativeFlow || 'missing'}.`);
    }
    const identity = `${route.clientAccountId}:${route.bureauCode}`;
    if (identities.has(identity)) throw new Error(`Duplicate reviewed route: ${identity}.`);
    identities.add(identity);
  }
  return normalized;
}

export function canonicalClassificationRoutesJson(routes = []) {
  return JSON.stringify(canonicalClassificationRoutes(routes));
}

export function classificationRoutesFromStates(states = []) {
  return canonicalClassificationRoutes(states.map((state) => ({
    accountKind: state.accountKind,
    bureauCode: state.bureauCode,
    clientAccountId: state.clientAccountId,
    nativeFlow: state.nativeFlow,
  })));
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, stableJsonValue(value[key])]));
  }
  return value;
}

export function canonicalClassificationReviewSnapshotJson(snapshot) {
  return JSON.stringify(stableJsonValue(snapshot));
}

export function buildClassificationReviewSnapshot(audit, routes, methodVersion = CLASSIFICATION_REVIEW_METHOD_VERSION) {
  const auditId = String(audit?.id || audit?.auditId || '').trim();
  const clientId = String(audit?.client?.id || '').trim();
  if (!auditId || !clientId) throw new Error('A classification snapshot requires the exact saved audit and client ids.');
  const seenAuditIds = new Set();
  const seenClientIds = new Set();
  const accounts = (Array.isArray(audit?.accounts) ? audit.accounts : []).map((account) => {
    const accountId = String(account?.id || '').trim();
    const clientAccountId = String(account?.clientAccountId || account?.client_account_id || '').trim();
    if (!accountId || seenAuditIds.has(accountId)) throw new Error('Every classification snapshot account requires a unique audit account id.');
    if (!clientAccountId || seenClientIds.has(clientAccountId)) throw new Error('Every classification snapshot account requires a unique canonical client account id.');
    seenAuditIds.add(accountId);
    seenClientIds.add(clientAccountId);
    const accountKind = normalizeKind(account?.routingFacts?.accountKind || account?.accountKind);
    return {
      accountId,
      accountKind,
      bureaus: normalizedAccountBureaus(account),
      clientAccountId,
      excluded: accountKind === 'positive',
      routingFacts: stableJsonValue(account?.routingFacts || null),
    };
  }).sort((left, right) => left.clientAccountId.localeCompare(right.clientAccountId) || left.accountId.localeCompare(right.accountId));
  return stableJsonValue({
    auditId,
    clientId,
    methodVersion,
    accounts,
    routes: canonicalClassificationRoutes(routes),
  });
}

function expectedRouteMap(audit) {
  const expected = new Map();
  const seenClientAccounts = new Set();
  for (const account of Array.isArray(audit?.accounts) ? audit.accounts : []) {
    const clientAccountId = canonicalClientAccountId(account);
    if (!clientAccountId) throw new Error('CCC state initialization requires each audit account to have an exact clientAccountId. Furnisher/name fallback is not allowed.');
    if (seenClientAccounts.has(clientAccountId)) throw new Error(`Canonical client account ${clientAccountId} appears more than once in the audit.`);
    seenClientAccounts.add(clientAccountId);
    const kind = normalizeKind(account?.routingFacts?.accountKind || account?.accountKind);
    if (kind === 'positive') continue;
    if (!['charge_off', 'collection', 'repossession', 'bankruptcy', 'student_loan', 'late_payment'].includes(kind)) {
      throw new Error(`Account ${clientAccountId} does not have a supported confirmed classification.`);
    }
    for (const bureauCode of normalizedAccountBureaus(account)) {
      const key = `${clientAccountId}:${bureauCode}`;
      if (expected.has(key)) throw new Error(`Duplicate expected account/bureau route: ${key}.`);
      expected.set(key, { clientAccountId, bureauCode, accountKind: kind });
    }
  }
  return expected;
}

function makeRecommendation(flow, accounts, accountRoles = {}, { trackCode = flow, label = FLOW_LABELS[flow] } = {}) {
  const template = concreteTemplateStep(trackCode, 1);
  return {
    flow,
    trackCode,
    label,
    round: 1,
    law: trackCode === 'repo' ? REPO_SEQUENCE[0] : FLOW_SEQUENCES[flow][0],
    templateFlow: template.flow,
    templateRound: template.round,
    accounts,
    accountIds: accounts.map(accountIdentity).filter(Boolean),
    accountRoles,
  };
}

export function deriveFileRoutingOverrides(accounts = []) {
  // These are file-level course rules. Resolve them once from every exact
  // account/bureau pair, then pass the same immutable decision to all three
  // bureau planners. A bureau-scoped majority would produce contradictory R1
  // starts for the same 3B file.
  const uniqueAccounts = [];
  let forceLatePayForLates = false;

  for (const account of accounts) {
    let bureaus;
    try { bureaus = normalizedAccountBureaus(account); }
    catch {
      return { forceConsent: false, forceLatePayForLates: false, reviewBlocked: true };
    }
    const classifications = bureaus.map((bureauCode) => classifyAccountForR1(account, {}, bureauCode));
    if (classifications.some((item) => item.needsReview)) {
      return { forceConsent: false, forceLatePayForLates: false, reviewBlocked: true };
    }
    const routed = classifications.filter((item) => !item.excluded && item.kind && item.kind !== 'other');
    if (!routed.length) continue;
    const kinds = new Set(routed.map((item) => item.kind));
    if (kinds.size !== 1) {
      return { forceConsent: false, forceLatePayForLates: false, reviewBlocked: true };
    }
    const kind = routed[0].kind;
    uniqueAccounts.push({ kind });
    if (kind === 'late_payment' && routed.some((item) => item.latePaymentBand === 'mixed')) {
      forceLatePayForLates = true;
    }
  }

  const studentLoanCount = uniqueAccounts.filter((item) => item.kind === 'student_loan').length;
  const forceConsent = studentLoanCount > 0
    && (studentLoanCount === uniqueAccounts.length || studentLoanCount > uniqueAccounts.length / 2);
  return { forceConsent, forceLatePayForLates, reviewBlocked: false };
}

export function buildBureauR1Recommendation(audit, bureauCode, overrides = deriveFileRoutingOverrides(audit?.accounts || [])) {
  const normalizedBureau = normalizeBureauCode(bureauCode);
  const bureau = DISPUTE_BUREAUS.find((item) => item.code === normalizedBureau);
  if (!bureau) throw new Error(`Unknown bureau code: ${bureauCode}`);

  const eligibleAccounts = (Array.isArray(audit?.accounts) ? audit.accounts : [])
    .filter((account) => {
      try { return normalizedAccountBureaus(account).includes(normalizedBureau); }
      catch { return true; }
    });
  const classifications = eligibleAccounts.map((account) => classifyAccountForR1(account, overrides, normalizedBureau));
  const byFlow = (flow) => classifications.filter((item) => item.flow === flow).map((item) => item.account);
  const accuracy = byFlow('accuracy');
  const repo = classifications.filter((item) => item.flow === 'collection' && item.specialRule === 'repo').map((item) => item.account);
  const collection = classifications.filter((item) => item.flow === 'collection' && item.specialRule !== 'repo').map((item) => item.account);
  const consent = byFlow('consent');
  const latePay = byFlow('late_pay');
  const recommendations = [];

  if (repo.length) {
    const repoRoles = Object.fromEntries([
      ...repo.map((account) => [accountIdentity(account), 'repo_primary']),
      ...collection.map((account) => [accountIdentity(account), 'repo_companion']),
    ].filter(([key]) => key));
    recommendations.push(makeRecommendation('collection', [...repo, ...collection], repoRoles, {
      trackCode: 'repo',
      label: 'Repossession',
    }));
    if (accuracy.length) recommendations.push(makeRecommendation('accuracy', accuracy));
  } else if (accuracy.length && collection.length) {
    recommendations.push(makeRecommendation('combo', [...accuracy, ...collection]));
  } else if (accuracy.length) {
    recommendations.push(makeRecommendation('accuracy', accuracy));
  } else if (collection.length) {
    recommendations.push(makeRecommendation('collection', collection));
  }
  // These are independent R1 letters. They are never silently deferred just
  // because the same bureau also needs an Accuracy/Collection/Repo letter.
  if (latePay.length) recommendations.push(makeRecommendation('late_pay', latePay));
  if (consent.length) recommendations.push(makeRecommendation('consent', consent));

  const routedIds = new Set(recommendations.flatMap((recommendation) => recommendation.accounts.map(accountIdentity)).filter(Boolean));
  const deferred = classifications.filter((item) => item.flow && !routedIds.has(accountIdentity(item.account)));

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

export function buildInitialAccountTrackStates(audit, methodVersion = CCC_METHOD_VERSION) {
  const plan = buildR1CampaignPlan(audit);
  if (plan.needsReview.length) throw new Error('Every expected account/bureau route must be resolved before CCC state initialization.');
  const states = plan.bureaus.flatMap((bureauPlan) => bureauPlan.recommendations.flatMap((recommendation) => (
    recommendation.accounts.map((account) => {
      const identity = canonicalClientAccountId(account);
      if (!identity) {
        throw new Error('CCC state initialization requires each audit account to have an exact clientAccountId. Furnisher/name fallback is not allowed.');
      }
      const classification = bureauPlan.classifications.find((item) => canonicalClientAccountId(item.account) === identity);
      return {
        methodVersion,
        bureauCode: bureauPlan.bureau.code,
        clientAccountId: identity,
        accountKind: classification?.kind || 'other',
        nativeFlow: classification?.specialRule === 'repo' ? 'repo' : classification?.flow,
        currentFlow: recommendation.trackCode,
        currentRound: 1,
        pathRole: recommendation.accountRoles[identity] || 'standard',
        status: 'active',
        cycle: 1,
        revision: 0,
        classificationSnapshot: {
          kind: classification?.kind || 'other',
          reason: classification?.reason || '',
          override: classification?.override || null,
          specialRule: classification?.specialRule || null,
        },
      };
    })
  )));
  const expected = expectedRouteMap(audit);
  const actual = new Map();
  for (const state of states) {
    const key = `${state.clientAccountId}:${normalizeBureauCode(state.bureauCode) || ''}`;
    if (actual.has(key)) throw new Error(`CCC produced more than one route for ${key}.`);
    actual.set(key, state);
  }
  const missing = [...expected.keys()].filter((key) => !actual.has(key));
  const unexpected = [...actual.keys()].filter((key) => !expected.has(key));
  const mismatched = [...expected].filter(([key, route]) => actual.get(key)?.accountKind !== route.accountKind);
  if (missing.length || unexpected.length || mismatched.length || actual.size !== expected.size) {
    throw new Error('CCC must produce exactly one normalized route for every non-excluded account/bureau pair.');
  }
  return states;
}

/**
 * After staff saves/reviews deterministic classifications:
 *
 *   const args = buildCccInitializationRpcArgs(savedAudit);
 *   const { data, error } = await supabase.rpc('initialize_ccc_account_tracks', args);
 *
 * Direct-track creation is intentionally rejected at this CRA-only boundary.
 * Every routed audit account must already carry the canonical clientAccountId
 * assigned by client_accounts reconciliation. This intentionally has no
 * furnisher, account-number, report-id, or client-name fallback.
 */
export function buildCccInitializationRpcArgs(audit, {
  clientId = audit?.client?.id,
  auditId = audit?.id,
  directAccountIds = [],
  methodVersion = CCC_METHOD_VERSION,
} = {}) {
  if (!clientId) throw new Error('CCC state initialization requires the canonical client id.');
  if (!auditId) throw new Error('CCC state initialization requires the saved source audit id.');
  if (directAccountIds.length) {
    throw new Error('Direct debt-verification tracks are gated and cannot be created from the CRA classification review.');
  }
  const review = audit?.classificationReview;
  if (review?.status !== 'confirmed'
    || review?.methodVersion !== methodVersion
    || review?.auditId !== auditId
    || review?.clientId !== clientId
    || !Number.isInteger(Number(review?.version))
    || Number(review.version) < 1
    || !/^[a-f0-9]{64}$/.test(String(review?.routesSha256 || ''))
    || !/^[a-f0-9]{64}$/.test(String(review?.routingSnapshotSha256 || ''))
    || typeof review?.routingSnapshotCanonical !== 'string'
    || !review?.reviewedAt
    || !review?.reviewedBy) {
    throw new Error('Confirm and save the exact staff classification review before initializing CRA account tracks.');
  }
  const states = buildInitialAccountTrackStates(audit, methodVersion);
  const expectedRoutes = classificationRoutesFromStates(states);
  const reviewedRoutes = canonicalClassificationRoutes(review.routes);
  if (JSON.stringify(expectedRoutes) !== JSON.stringify(reviewedRoutes)) {
    throw new Error('The account classifications changed after the saved staff review. Save a new review before initializing CRA account tracks.');
  }
  const expectedSnapshot = buildClassificationReviewSnapshot(audit, reviewedRoutes, methodVersion);
  const expectedSnapshotCanonical = canonicalClassificationReviewSnapshotJson(expectedSnapshot);
  if (review.routingSnapshotCanonical !== expectedSnapshotCanonical
    || canonicalClassificationReviewSnapshotJson(review.routingSnapshot) !== expectedSnapshotCanonical) {
    throw new Error('The full routing facts changed after the saved staff review. Save a new review before initializing CRA account tracks.');
  }
  const stateByRoute = new Map(states.map((state) => [`${state.clientAccountId}:${state.bureauCode}`, state]));
  return {
    p_client_id: clientId,
    p_audit_id: auditId,
    p_review_version: Number(review.version),
    p_review_snapshot_sha256: review.routingSnapshotSha256,
    p_classifications: reviewedRoutes.map((route) => {
      const state = stateByRoute.get(`${route.clientAccountId}:${route.bureauCode}`);
      if (!state) throw new Error('A reviewed route has no matching deterministic CRA state.');
      return {
      client_account_id: state.clientAccountId,
      account_kind: state.accountKind,
      native_flow: state.nativeFlow,
      bureaus: [state.bureauCode],
      direct_track: false,
      classification: state.classificationSnapshot,
      };
    }),
    p_method_version: methodVersion,
  };
}

export function buildR1CampaignPlan(audit) {
  const accounts = Array.isArray(audit?.accounts) ? audit.accounts : [];
  const overrides = deriveFileRoutingOverrides(accounts);
  const bureaus = DISPUTE_BUREAUS.map((bureau) => buildBureauR1Recommendation(audit, bureau.code, overrides));
  const allClassifications = bureaus.flatMap((bureauPlan) => bureauPlan.classifications);
  return {
    bureaus,
    accountClassifications: allClassifications,
    needsReview: allClassifications.filter((item) => item.needsReview),
    recommendedLetterCount: bureaus.reduce((total, item) => total + item.recommendations.length, 0),
    overrides,
    overridesByBureau: Object.fromEntries(bureaus.map((item) => [item.bureau.code, item.overrides])),
  };
}

export function flowRoundLabel(flow, round = 1) {
  return `${FLOW_LABELS[flow] || flow} R${round} — ${FLOW_SEQUENCES[flow]?.[round - 1] || 'Template required'}`;
}
