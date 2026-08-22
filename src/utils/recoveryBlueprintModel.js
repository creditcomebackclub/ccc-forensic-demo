import {
  buildCccInitializationRpcArgs,
  buildR1CampaignPlan,
  CLASSIFICATION_REVIEW_METHOD_VERSION,
  FLOW_LABELS,
} from './disputeFlow.js';

export const RECOVERY_BLUEPRINT_TEMPLATE_VERSION = 'recovery_blueprint_v3';

const BUREAU_LABELS = { EQ: 'Equifax', EXP: 'Experian', TU: 'TransUnion' };

function cleanText(value, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'string' ? Number(value.replace(/[$,]/g, '')) : Number(value);
  return Number.isFinite(number) ? number : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function reportDateLabel(value) {
  if (!value) return 'Date not provided';
  const raw = String(value);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00`) : new Date(raw);
  return Number.isNaN(parsed.getTime())
    ? raw
    : parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function normalizeScores(scores = {}) {
  return {
    equifax: finiteNumberOrNull(scores.equifax),
    experian: finiteNumberOrNull(scores.experian),
    transunion: finiteNumberOrNull(scores.transunion),
  };
}

function scoreObservation(scores) {
  const rows = [
    { bureau: 'Equifax', score: scores.equifax },
    { bureau: 'Experian', score: scores.experian },
    { bureau: 'TransUnion', score: scores.transunion },
  ].filter((row) => row.score !== null);
  if (rows.length < 2) return null;
  const sorted = [...rows].sort((left, right) => right.score - left.score);
  return {
    high: sorted[0],
    low: sorted[sorted.length - 1],
    points: sorted[0].score - sorted[sorted.length - 1].score,
  };
}

function exactAccountId(account) {
  return cleanText(account?.id);
}

function exactClientAccountId(account) {
  return cleanText(account?.clientAccountId || account?.client_account_id);
}

function normalizeEvidence(account) {
  return (Array.isArray(account?.routingFacts?.evidence) ? account.routingFacts.evidence : [])
    .map((item) => ({
      bureauCode: cleanText(item?.bureau).toUpperCase(),
      field: cleanText(item?.field),
      value: cleanText(item?.value ?? item?.rawValue),
      page: Number.isInteger(Number(item?.page)) && Number(item.page) > 0 ? Number(item.page) : null,
      source: cleanText(item?.source, item?.autoEligible ? 'structured_report' : 'reviewed_report'),
    }))
    .filter((item) => item.field || item.value);
}

function normalizeFindings(account) {
  const source = Array.isArray(account?.violations) && account.violations.length
    ? account.violations
    : (Array.isArray(account?.findings) ? account.findings : []);
  return source.map((finding, index) => {
    const firstPageRef = (Array.isArray(finding?.evidenceRefs) ? finding.evidenceRefs : [])
      .find((reference) => Number.isInteger(Number(reference?.page)) && Number(reference.page) > 0);
    const page = finding?.page ?? firstPageRef?.page;
    return {
      id: cleanText(finding?.id || finding?.ruleId || finding?.type, `${exactAccountId(account)}-finding-${index + 1}`),
      field: cleanText(finding?.field, 'Report field'),
      issue: cleanText(finding?.issue || finding?.reason || finding?.challengeStatement),
      statute: cleanText(finding?.statute),
      outcome: cleanText(finding?.outcome || finding?.adjudication),
      page: Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : null,
    };
  }).filter((finding) => finding.issue);
}

function normalizeAccount(account, index) {
  const id = exactAccountId(account);
  const clientAccountId = exactClientAccountId(account);
  if (!id || !clientAccountId) {
    throw new Error(`Blueprint account ${index + 1} is missing its exact audit or canonical account id.`);
  }
  const bureaus = unique((Array.isArray(account?.bureaus) ? account.bureaus : []).map((code) => cleanText(code).toUpperCase()));
  return {
    id,
    clientAccountId,
    furnisher: cleanText(account?.furnisher, 'Furnisher not extracted'),
    originalCreditor: cleanText(account?.originalCreditor),
    accountNumberMasked: cleanText(account?.accountNumberMasked, 'Not extracted'),
    accountKind: cleanText(account?.accountKind || account?.routingFacts?.accountKind),
    status: cleanText(account?.status, 'Not extracted'),
    balance: finiteNumberOrNull(account?.balance),
    bureaus,
    bureauLabel: bureaus.map((code) => BUREAU_LABELS[code] || code).join(', '),
    findings: normalizeFindings(account),
    evidence: normalizeEvidence(account),
  };
}

function validateReviewIdentity(audit, options = {}) {
  const auditId = cleanText(audit?.id || audit?.auditId || options.auditId);
  const clientId = cleanText(audit?.client?.id || options.clientId);
  const review = audit?.classificationReview;
  if (!auditId || !clientId) throw new Error('Blueprint requires the exact saved audit and canonical client ids.');
  if (review?.status !== 'confirmed'
    || review?.auditId !== auditId
    || review?.clientId !== clientId
    || review?.methodVersion !== CLASSIFICATION_REVIEW_METHOD_VERSION
    || !Number.isInteger(Number(review?.version))
    || Number(review.version) < 1) {
    throw new Error('Confirm and save the exact deterministic classification review before generating a Recovery Blueprint.');
  }
  return { auditId, clientId, review };
}

/**
 * Fail-closed readiness check shared by the server and PDF model. It rebuilds
 * the deterministic states and compares them to the immutable saved review;
 * no model/API call participates in classification or R1 selection.
 */
export function assertRecoveryBlueprintReady(audit, options = {}) {
  if (!audit || typeof audit !== 'object') throw new Error('A saved audit is required.');
  const identity = validateReviewIdentity(audit, options);
  const exactAudit = {
    ...audit,
    id: identity.auditId,
    client: { ...(audit.client || {}), id: identity.clientId },
  };
  const initialization = buildCccInitializationRpcArgs(exactAudit, {
    auditId: identity.auditId,
    clientId: identity.clientId,
  });
  const plan = buildR1CampaignPlan(exactAudit);
  const deferredCount = plan.bureaus.reduce((total, bureau) => total + bureau.deferred.length, 0);
  if (plan.needsReview.length || deferredCount || !plan.recommendedLetterCount) {
    throw new Error('Blueprint generation is blocked until every account/bureau route is complete and at least one R1 letter is recommended.');
  }
  return { ...identity, exactAudit, initialization, plan };
}

export function buildRecoveryBlueprintModel(audit, options = {}) {
  const ready = assertRecoveryBlueprintReady(audit, options);
  const accounts = ready.exactAudit.accounts.map(normalizeAccount);
  const accountByClientId = new Map(accounts.map((account) => [account.clientAccountId, account]));
  const recommendations = ready.plan.bureaus.flatMap((bureauPlan) => bureauPlan.recommendations.map((recommendation, index) => {
    const routedAccounts = recommendation.accountIds.map((clientAccountId) => accountByClientId.get(clientAccountId));
    if (routedAccounts.some((account) => !account)) {
      throw new Error(`Blueprint route ${bureauPlan.bureau.code}/${recommendation.trackCode} does not match the reviewed canonical accounts.`);
    }
    return {
      id: `${bureauPlan.bureau.code}:${recommendation.trackCode}:${recommendation.round}:${index + 1}`,
      bureauCode: bureauPlan.bureau.code,
      bureauName: bureauPlan.bureau.name,
      flow: recommendation.trackCode,
      flowLabel: recommendation.label || FLOW_LABELS[recommendation.flow] || recommendation.flow,
      round: recommendation.round,
      law: recommendation.law,
      templateFlow: recommendation.templateFlow,
      templateRound: recommendation.templateRound,
      accountIds: [...recommendation.accountIds],
      accounts: routedAccounts,
    };
  }));
  const routedPairCount = recommendations.reduce((total, recommendation) => total + recommendation.accountIds.length, 0);
  const routedAccountIds = unique(recommendations.flatMap((recommendation) => recommendation.accountIds));
  const routedAccounts = routedAccountIds.map((id) => accountByClientId.get(id));
  const documentedFindings = routedAccounts.flatMap((account) => account.findings.map((finding) => ({
    ...finding,
    accountId: account.id,
    clientAccountId: account.clientAccountId,
    furnisher: account.furnisher,
  })));
  const clientName = cleanText(ready.exactAudit.client?.name, 'Client');
  const reportDate = cleanText(ready.exactAudit.client?.reportDate || options.reportDate);
  const scores = normalizeScores(ready.exactAudit.scores);
  const coverage = ready.exactAudit.reportCoverage || {};

  return {
    templateVersion: RECOVERY_BLUEPRINT_TEMPLATE_VERSION,
    pageCount: 7,
    client: {
      id: ready.clientId,
      name: clientName,
      firstName: clientName.split(' ')[0] || 'Client',
      address: cleanText(ready.exactAudit.client?.address || ready.exactAudit.personalInfo?.currentAddress),
      reportDate,
      reportDateLabel: reportDateLabel(reportDate),
    },
    scores,
    scoreObservation: scoreObservation(scores),
    executiveSummary: cleanText(
      ready.exactAudit.executiveSummary,
      'This Blueprint maps the confirmed report facts to the deterministic CCC R1 mailing plan.',
    ),
    metrics: {
      accountsReviewed: accounts.length,
      disputeEligibleAccounts: routedAccounts.length,
      recommendedLetters: recommendations.length,
      routedAccountBureauPairs: routedPairCount,
      documentedFindings: documentedFindings.length,
    },
    reportCoverage: {
      complete: coverage.complete === true,
      counts: { EQ: Number(coverage?.counts?.EQ || 0), EXP: Number(coverage?.counts?.EXP || 0), TU: Number(coverage?.counts?.TU || 0) },
    },
    accounts,
    routedAccounts,
    recommendations,
    documentedFindings,
    provenance: {
      auditId: ready.auditId,
      clientId: ready.clientId,
      auditRevision: cleanText(options.auditRevision || ready.exactAudit.auditRevision || ready.exactAudit.savedAt),
      auditSha256: cleanText(options.auditSha256 || ready.exactAudit.auditSha256),
      classificationReviewVersion: Number(ready.review.version),
      classificationReviewedAt: cleanText(ready.review.reviewedAt),
      classificationReviewedBy: cleanText(ready.review.reviewedBy),
      classificationMethodVersion: ready.review.methodVersion,
      routesSha256: cleanText(ready.review.routesSha256),
      routingSnapshotSha256: cleanText(ready.review.routingSnapshotSha256),
      ruleAuthority: 'Skool flow documents/original course letters + explicit CCC owner policies',
    },
    nextSteps: [
      'Confirm the client identity documents, proof of address, and required account screenshots for each mailing packet.',
      'Prepare every listed R1 letter separately for the bureau shown; do not collapse independent recommendations.',
      'Mail the approved packets by USPS First-Class Mail and record the exact sent date.',
      'Record the response outcome for each account. Outcomes - not elapsed time alone - control the next deterministic state.',
      'If CCC returns a review hold, stop. Direct, Solo, and unconfirmed end-cycle decisions require owner/course clarification.',
    ],
    disclaimer: 'This Blueprint summarizes report facts and the saved CCC classification review. It does not guarantee a deletion, score increase, or specific result. Accurate information cannot be promised for removal. This is not legal advice.',
  };
}

export function recoveryBlueprintFilename(auditOrModel) {
  const model = auditOrModel?.templateVersion ? auditOrModel : buildRecoveryBlueprintModel(auditOrModel);
  const slug = model.client.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'client';
  const date = model.client.reportDate || new Date().toISOString().slice(0, 10);
  return `ccc-recovery-blueprint-${slug}-${date}.pdf`;
}
