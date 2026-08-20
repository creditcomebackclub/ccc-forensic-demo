export const RECOVERY_BLUEPRINT_TEMPLATE_VERSION = 'recovery_blueprint_v2';

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

function scoreBand(score) {
  if (score == null || !Number.isFinite(Number(score))) return null;
  const n = Number(score);
  if (n >= 800) return 'Exceptional';
  if (n >= 740) return 'Very Good';
  if (n >= 670) return 'Good';
  if (n >= 580) return 'Fair';
  return 'Poor';
}

/**
 * Presentation-only route label for the client PDF.
 * Does not change campaign routing — mirrors staff-facing guidance only.
 */
function routeLabelFor(account) {
  const type = String(account?.type || '').toUpperCase();
  const status = String(account?.status || '').toLowerCase();
  const name = String(account?.furnisher || '').toLowerCase();
  const isCollector = type === 'C' || type === '0C' || type === '48' || type === '77'
    || status.includes('collection')
    || /lvnv|midland|portfolio|resurgent|jefferson|jeffcap|credence/.test(name);
  if (isCollector) return 'FDCPA + Bureau';
  if (status.includes('charge') || status.includes('charge-off') || status.includes('charged')) {
    return 'Direct + Bureau';
  }
  if ((account?.bureaus || []).length >= 2) return 'Bureau packet';
  return 'Direct + Bureau';
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
  const normalized = {
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
    primaryChallengeStatement: primaryChallenge,
    strategy: cleanText(
      account?.strategy,
      'Challenge the documented reporting discrepancy with account-specific evidence.',
    ),
  };
  normalized.routeLabel = cleanText(account?.routeLabel, routeLabelFor(normalized));
  return normalized;
}

function buildScoreGap(scores) {
  const values = [
    { key: 'equifax', label: 'Equifax', score: scores?.equifax },
    { key: 'experian', label: 'Experian', score: scores?.experian },
    { key: 'transunion', label: 'TransUnion', score: scores?.transunion },
  ].filter((entry) => entry.score != null && Number.isFinite(Number(entry.score)));

  if (values.length < 2) {
    return { points: 0, high: null, low: null, narrative: null };
  }

  const sorted = [...values].sort((a, b) => Number(b.score) - Number(a.score));
  const high = sorted[0];
  const low = sorted[sorted.length - 1];
  const points = Math.round(Number(high.score) - Number(low.score));
  if (points < 15) {
    return {
      points,
      high,
      low,
      narrative: 'Scores are relatively aligned across bureaus. Priority is still the documented accuracy conflicts below.',
    };
  }
  return {
    points,
    high: { ...high, band: scoreBand(high.score) },
    low: { ...low, band: scoreBand(low.score) },
    narrative: `${high.label} is reading a stronger file than ${low.label} by about ${points} points. That gap is the map — the accounts and accuracy failures below are where it lives.`,
  };
}

function buildAccuracyIssues(accounts) {
  const issues = [];
  for (const account of accounts) {
    for (const violation of account.violations) {
      issues.push({
        title: cleanText(
          `${account.furnisher} — ${violation.field}`,
          account.furnisher,
        ),
        body: cleanText(
          violation.challengeStatement || violation.issue,
          'Documented reporting accuracy issue.',
        ),
        severity: violation.severity || 'med',
        accountId: account.id,
      });
    }
  }
  // Cap for client PDF readability; full set remains on the audit.
  return issues.slice(0, 12);
}

function buildIdentity(audit) {
  const personal = audit?.personalInfo || {};
  const formerAddresses = unique(Array.isArray(personal.formerAddresses) ? personal.formerAddresses : []);
  const nameVariants = unique(Array.isArray(personal.nameVariants) ? personal.nameVariants : []);
  const currentAddress = cleanText(personal.currentAddress || audit?.client?.address);
  const flags = [];
  if (formerAddresses.length) {
    flags.push({
      title: 'Address history',
      body: 'Former or alternate addresses appear on file. Confirm the current primary address before Batch 1 mails so letters do not bounce.',
    });
  }
  if (nameVariants.length) {
    flags.push({
      title: 'Name variants',
      body: 'More than one name variation is present across bureau files. Align the legal name used on disputes before mailing.',
    });
  }
  if (!flags.length) {
    flags.push({
      title: 'Identity hygiene',
      body: 'Confirm current address and legal name on each bureau before the first mailing. Dirty header data is the quietest way letters fail.',
    });
  }
  return {
    currentAddress,
    formerAddresses,
    nameVariants,
    flags,
    hasMaterialFlags: formerAddresses.length > 0 || nameVariants.length > 0,
  };
}

/**
 * Presentation-only mapping from the reviewed forensic audit to the Recovery
 * Blueprint / Client Audit. Contains no credit-analysis logic: it preserves
 * the deterministic audit's account order, batches, violations, priority
 * scores, and challenge statements.
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
  const batch2Accounts = accounts.filter((account) => account.batch === 2 && account.violations.length > 0);
  const openingMove = batch1Accounts[0] || effectiveTargets[0] || null;
  const violationCount = accounts.reduce((total, account) => total + account.violations.length, 0);
  const allBureaus = unique(accounts.flatMap((account) => account.bureaus));
  const citationDebtCount = Math.max(0, finiteNumber(audit.citationDebt?.count));

  const clientName = cleanText(audit.client?.name, 'Client');
  const reportDate = cleanText(audit.client?.reportDate || options.reportDate);
  const firstName = clientName.split(' ')[0] || 'Client';
  const scores = {
    equifax: audit.scores?.equifax ?? null,
    experian: audit.scores?.experian ?? null,
    transunion: audit.scores?.transunion ?? null,
  };
  const scoreGap = buildScoreGap(scores);
  const accuracyIssues = buildAccuracyIssues(effectiveTargets);
  const identity = buildIdentity(audit);

  const batch1Names = batch1Accounts.map((a) => a.furnisher).filter(Boolean);
  const batch1Label = batch1Names.length
    ? batch1Names.slice(0, 4).join(', ') + (batch1Names.length > 4 ? ', and additional targets' : '')
    : 'highest-priority accounts';

  return {
    templateVersion: RECOVERY_BLUEPRINT_TEMPLATE_VERSION,
    pageCount: 9,
    client: {
      id: audit.client?.id || options.clientId || null,
      name: clientName,
      firstName,
      location: cleanText(audit.client?.address).split(',').slice(-2).join(',').trim(),
      reportDate,
      reportDateLabel: reportDateLabel(reportDate),
    },
    scores,
    scoreGap,
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
      bureauCoverage: allBureaus.length || Object.values(scores).filter((score) => score != null).length,
      citationDebtCount,
    },
    citationDebt: {
      count: citationDebtCount,
      // Staff-facing only; never render raw pending items to the client PDF.
      items: Array.isArray(audit.citationDebt?.items) ? audit.citationDebt.items : [],
    },
    openingMove,
    batch1Accounts,
    batch2Accounts,
    accuracyIssues,
    identity,
    recoveryPath: [
      {
        number: '01',
        title: 'Forensic audit — done',
        body: `Three-bureau disclosure pulled apart. ${effectiveTargets.length} priority target${effectiveTargets.length === 1 ? '' : 's'} ranked. ${violationCount} accuracy issue${violationCount === 1 ? '' : 's'} documented. Identity cleanup queued before the first mailing.`,
      },
      {
        number: '02',
        title: 'Batch 1 — the heavy hitters',
        body: `Opening disputes focused on ${batch1Label}. Mix of direct, bureau packets, and FDCPA-first where the collector profile fits — concentrated firepower, not spray-and-pray.`,
      },
      {
        number: '03',
        title: 'Batch 2 — clean the rest',
        body: batch2Accounts.length
          ? `Remaining targets (${batch2Accounts.map((a) => a.furnisher).slice(0, 3).join(', ')}${batch2Accounts.length > 3 ? ', and others' : ''}) sequenced after Batch 1 responses land so leverage is not diluted.`
          : 'Remaining lower-priority items and personal-info cleanup are sequenced after Batch 1 responses land so we do not dilute leverage.',
      },
      {
        number: '04',
        title: 'Rebuild & protect',
        body: 'As negatives fall, guide positive tradeline strategy and watch for re-aging or reinsertion. The goal is a file lenders trust — not a temporary bump.',
      },
    ],
    disclaimer: 'This audit is a working forensic package from your bureau disclosures for client presentation and campaign scoping. Results vary; credit repair companies cannot guarantee removal of accurate information. Production dispute letters should be generated from the live CCC engine before mailing. Not legal advice.',
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
