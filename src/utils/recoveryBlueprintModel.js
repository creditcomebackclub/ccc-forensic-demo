export const RECOVERY_BLUEPRINT_TEMPLATE_VERSION = 'recovery_blueprint_v1';

const BUREAU_LABELS = { EQ: 'Equifax', EXP: 'Experian', TU: 'TransUnion' };

function finiteNumber(value) {
  const number = typeof value === 'string'
    ? Number(value.replace(/[$,]/g, ''))
    : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function cleanText(value, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function bureauLabels(bureaus) {
  return unique((Array.isArray(bureaus) ? bureaus : [])
    .map((bureau) => BUREAU_LABELS[String(bureau || '').toUpperCase()] || cleanText(bureau)))
    .join(', ');
}

function reportDateLabel(value) {
  if (!value) return 'Date not provided';
  const raw = String(value);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00`)
    : new Date(raw);
  return Number.isNaN(parsed.getTime())
    ? raw
    : parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function normalizeAccount(account, index) {
  const violations = Array.isArray(account?.violations) ? account.violations : [];
  const primaryChallenge = cleanText(
    account?.primaryChallengeStatement
      || violations[0]?.challengeStatement
      || account?.primaryViolation
      || violations[0]?.issue
      || 'Reporting accuracy issue documented in the forensic audit.',
  );
  return {
    id: cleanText(account?.id, `account-${index + 1}`),
    furnisher: cleanText(account?.furnisher, 'Account under review'),
    originalCreditor: cleanText(account?.originalCreditor),
    accountNumberMasked: cleanText(account?.accountNumberMasked, 'Not shown'),
    type: cleanText(account?.type),
    status: cleanText(account?.status, 'Reported status unavailable'),
    balance: Math.max(0, finiteNumber(account?.balance)),
    bureaus: Array.isArray(account?.bureaus) ? account.bureaus : [],
    bureauLabel: bureauLabels(account?.bureaus) || 'Bureau not identified',
    batch: Number(account?.batch) === 1 ? 1 : 2,
    priorityScore: finiteNumber(account?.priorityScore),
    violations: violations.map((violation) => ({
      field: cleanText(violation?.field, 'Reporting accuracy'),
      issue: cleanText(violation?.issue, 'The reporting requires documented review.'),
      challengeStatement: cleanText(
        violation?.challengeStatement,
        violation?.issue || 'The reporting requires documented review.',
      ),
      statute: cleanText(violation?.statute),
      severity: cleanText(violation?.severity, 'med'),
      evidenceQuality: cleanText(violation?.evidenceQuality, ''),
    })),
    primaryViolation: cleanText(
      account?.primaryViolation,
      violations[0]?.issue || 'Reporting accuracy issue documented in the forensic audit.',
    ),
    // Rule-aware client-facing challenge language (still fully deterministic).
    primaryChallengeStatement: primaryChallenge,
    strategy: cleanText(
      account?.strategy,
      'Challenge the documented reporting discrepancy with account-specific evidence.',
    ),
  };
}

/**
 * Presentation-only mapping from the reviewed forensic audit to the Recovery
 * Blueprint. This function deliberately contains no credit-analysis logic:
 * it preserves the deterministic audit's account order, batches, violations,
 * priority scores, and challenge statements.
 */
export function buildRecoveryBlueprintModel(audit, options = {}) {
  if (!audit || typeof audit !== 'object') throw new Error('A saved forensic audit is required.');

  let accounts = (Array.isArray(audit.accounts) ? audit.accounts : []).map(normalizeAccount);
  // Prefer the audit's already-ranked order (priorityScore). If scores are
  // present, re-sort defensively so opening move stays consistent.
  if (accounts.some((a) => a.priorityScore > 0)) {
    accounts = [...accounts].sort((a, b) => (b.priorityScore - a.priorityScore) || (b.violations.length - a.violations.length));
  }
  const targets = accounts.filter((account) => account.violations.length > 0);
  const effectiveTargets = targets.length ? targets : accounts;
  const batch1Accounts = accounts.filter((account) => account.batch === 1);
  const openingMove = batch1Accounts[0] || effectiveTargets[0] || null;
  const violationCount = accounts.reduce((total, account) => total + account.violations.length, 0);
  const allBureaus = unique(accounts.flatMap((account) => account.bureaus));
  const citationDebtCount = Math.max(0, finiteNumber(audit.citationDebt?.count));

  const clientName = cleanText(audit.client?.name, 'Client');
  const reportDate = cleanText(audit.client?.reportDate || options.reportDate);
  const firstName = clientName.split(' ')[0] || 'Client';

  return {
    templateVersion: RECOVERY_BLUEPRINT_TEMPLATE_VERSION,
    client: {
      id: audit.client?.id || options.clientId || null,
      name: clientName,
      firstName,
      location: cleanText(audit.client?.address).split(',').slice(-2).join(',').trim(),
      reportDate,
      reportDateLabel: reportDateLabel(reportDate),
    },
    scores: {
      equifax: audit.scores?.equifax ?? null,
      experian: audit.scores?.experian ?? null,
      transunion: audit.scores?.transunion ?? null,
    },
    executiveSummary: cleanText(
      audit.executiveSummary,
      'Your reports contain account-level reporting issues that warrant a documented, evidence-led recovery strategy.',
    ),
    metrics: {
      accountsScanned: Math.max(0, finiteNumber(audit.accountsScanned)),
      priorityTargetCount: effectiveTargets.length,
      accuracyIssueCount: violationCount,
      targetedNegativeBalance: effectiveTargets.reduce((sum, account) => sum + account.balance, 0),
      batch1StrikeZone: batch1Accounts.reduce((sum, account) => sum + account.balance, 0),
      bureauCoverage: allBureaus.length || Object.values(audit.scores || {}).filter((score) => score != null).length,
      citationDebtCount,
    },
    citationDebt: {
      count: citationDebtCount,
      // Staff-facing only; never render raw pending items to the client PDF.
      items: Array.isArray(audit.citationDebt?.items) ? audit.citationDebt.items : [],
    },
    openingMove,
    batch1Accounts,
    recoveryPath: [
      {
        number: '01',
        title: 'Verify the file',
        body: 'Confirm identity details, current addresses, account numbers, and the evidence supporting each documented reporting issue.',
      },
      {
        number: '02',
        title: 'Challenge at the source',
        body: 'Send account-specific correspondence to the furnishers responsible for the highest-priority reporting.',
      },
      {
        number: '03',
        title: 'Escalate with a record',
        body: 'Use the original mailing, delivery record, and any response to build the next bureau-facing escalation when warranted.',
      },
      {
        number: '04',
        title: 'Measure the outcome',
        body: 'Pull a fresh report on schedule, compare every target across all bureaus, and determine the next documented action.',
      },
    ],
    disclaimer: 'Credit Comeback Club provides credit education and document-preparation services. Results vary, and no specific score increase, deletion, or outcome is guaranteed. Credit bureaus and data furnishers make the final reporting decisions.',
  };
}

export function recoveryBlueprintFilename(auditOrModel) {
  const model = auditOrModel?.templateVersion
    ? auditOrModel
    : buildRecoveryBlueprintModel(auditOrModel);
  const slug = model.client.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'client';
  const date = model.client.reportDate || new Date().toISOString().slice(0, 10);
  return `ccc-recovery-blueprint-${slug}-${date}.pdf`;
}

