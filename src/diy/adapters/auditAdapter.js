/**
 * Map CCC forensic audit JSON → Fieldwork UI model.
 * Display stays Fieldwork cards; CCC shape is kept on cccRaw for letter gen.
 */

const BUREAU_LABEL = {
  EQ: 'Equifax',
  EQUIFAX: 'Equifax',
  EXP: 'Experian',
  EXPERIAN: 'Experian',
  TU: 'TransUnion',
  TRANSUNION: 'TransUnion',
};

const TYPE_META = {
  A: { type: 'Collection', typeLabel: 'Type A — Debt buyer / collection' },
  B: { type: 'Revolving', typeLabel: 'Type B — Original creditor' },
  C: { type: 'Collection', typeLabel: 'Type C — Collection / FDCPA' },
};

function normalizeBureau(b) {
  const key = String(b || '').toUpperCase().replace(/\s+/g, '');
  return BUREAU_LABEL[key] || BUREAU_LABEL[String(b || '').toUpperCase()] || String(b || '');
}

function fieldNumber(field) {
  const m = String(field || '').match(/\b(\d{1,2})\b/);
  return m ? m[1] : String(field || '').trim() || '—';
}

function severityOf(v) {
  const s = String(v?.severity || '').toLowerCase();
  if (s === 'high' || s === 'critical') return 'critical';
  if (s === 'med' || s === 'medium') return 'high';
  if (s === 'low') return 'medium';
  return 'high';
}

function titleFrom(account, v) {
  const primary = account.primaryViolation && String(account.primaryViolation).trim();
  if (primary && (!account.violations?.[1] || v === account.violations[0])) return primary;
  const issue = String(v.issue || '').trim();
  if (!issue) return `Field ${fieldNumber(v.field)} accuracy defect`;
  // Prefer a short headline — first sentence / clause
  const short = issue.split(/[.\n]/)[0].trim();
  return short.length > 90 ? `${short.slice(0, 87)}…` : short;
}

/** Rewrite engine copy so the readout says "your report", not the consumer's name. */
function personalizeMethodologyNote(text) {
  const fallback =
    'Fieldwork audits Metro 2 base-segment fields against FCRA accuracy duties — then aims your first dispute at the furnisher (the source), not the bureaus.';
  if (!text || !String(text).trim()) return fallback;
  let out = String(text).trim();
  // "of Jeffrey Kirkland's three-bureau report" → "of your three-bureau report"
  out = out.replace(
    /\bof\s+[A-Z][A-Za-z'’.\-]+(?:\s+[A-Z][A-Za-z'’.\-]+){0,3}['’]s\s+((?:three[-\s]?bureau\s+)?)report\b/gi,
    'of your $1report',
  );
  // lingering "Name's report" without leading "of"
  out = out.replace(
    /\b[A-Z][A-Za-z'’.\-]+(?:\s+[A-Z][A-Za-z'’.\-]+){0,3}['’]s\s+((?:three[-\s]?bureau\s+)?)report\b/g,
    'your $1report',
  );
  return out;
}

function whyFurnisherFirst(account) {
  const strategy = String(account.strategy || '').trim();
  if (strategy) return strategy;

  const fields = (account.violations || [])
    .map((v) => fieldNumber(v.field))
    .filter((f) => f && f !== '—');
  const uniq = [...new Set(fields)].slice(0, 3);
  const fieldBit = uniq.length ? `Field ${uniq.join(' / ')}` : 'these Metro 2 fields';

  if (String(account.type).toUpperCase() === 'A' || /collection|debt buyer/i.test(account.status || '')) {
    return `The furnisher controls Metro 2 reporting. Fixing ${fieldBit} at the source forces bureau updates downstream — bureau-only disputes often bounce as “verified.”`;
  }
  if ((account.bureaus || []).length >= 2) {
    return `Cross-bureau conflicts mean at least one file is wrong. The furnisher must reconcile maximum possible accuracy under §607(b) / §623 — ${fieldBit} starts there.`;
  }
  return `Dispute the furnisher first. They own the Metro 2 feed; fixing ${fieldBit} at the source is how bureau files actually change.`;
}

function priorityOf(account) {
  const batch = account.batch;
  if (batch === 1) return 'high';
  if (batch === 2) return 'medium';
  const hasCritical = (account.violations || []).some((v) => severityOf(v) === 'critical');
  if (hasCritical) return 'high';
  if ((account.violations || []).length > 1) return 'medium';
  return 'low';
}

function countCrossBureau(accounts) {
  let n = 0;
  for (const a of accounts || []) {
    for (const v of a.violations || []) {
      const blob = `${v.issue || ''} ${v.field || ''} ${v.statute || ''}`;
      if (/cross[- ]bureau|§\s*607|607\(b\)|across bureaus|bureau conflict/i.test(blob)) n += 1;
    }
  }
  return n;
}

export function adaptCccAuditToFieldwork(cccAudit, opts = {}) {
  const accountsIn = Array.isArray(cccAudit?.accounts) ? cccAudit.accounts : [];
  const accounts = accountsIn
    .filter((a) => a && Array.isArray(a.violations) && a.violations.length > 0)
    .map((account, ai) => {
      const typeKey = String(account.type || 'B').toUpperCase().slice(0, 1);
      const meta = TYPE_META[typeKey] || TYPE_META.B;
      const violations = account.violations.map((v, vi) => ({
        id: `${account.id || `acc_${ai}`}_v${vi + 1}`,
        code: String(v.issue || v.field || `V${vi + 1}`)
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '_')
          .slice(0, 48),
        field: fieldNumber(v.field),
        fieldName: String(v.field || 'Metro 2 field').trim(),
        statute: String(v.statute || 'FCRA §623').trim(),
        severity: severityOf(v),
        title: titleFrom(account, v),
        plain: String(v.issue || '').trim() || 'Accuracy defect identified in Metro 2 reporting.',
        reported: String(v.currentlyReports || '—').trim(),
        expected: String(v.shouldReport || '—').trim(),
        cccRaw: v,
      }));

      return {
        id: account.id || `acc_${ai + 1}`,
        furnisher: account.furnisher || 'Unknown furnisher',
        originalCreditor: account.originalCreditor || account.furnisher || '—',
        accountMask: account.accountNumberMasked || '••••',
        type: meta.type,
        balance: typeof account.balance === 'number' ? account.balance : null,
        status: account.status || '—',
        bureaus: (account.bureaus || []).map(normalizeBureau).filter(Boolean),
        priority: priorityOf(account),
        typeLabel: meta.typeLabel,
        whyFurnisherFirst: whyFurnisherFirst(account),
        violations,
        cccRaw: account,
      };
    });

  const scores = cccAudit?.scores || {};
  const totalViolations = accounts.reduce((n, a) => n + a.violations.length, 0);

  return {
    id: opts.id || cccAudit?.id || `audit_${Date.now()}`,
    generatedAt: opts.generatedAt || new Date().toISOString(),
    reportSource: opts.reportSource || 'Uploaded credit report',
    scoreSnapshot: {
      experian: scores.experian ?? scores.Experian ?? null,
      equifax: scores.equifax ?? scores.Equifax ?? null,
      transunion: scores.transunion ?? scores.TransUnion ?? scores.TU ?? null,
    },
    summary: {
      accountsReviewed: cccAudit?.accountsScanned ?? accountsIn.length,
      actionableAccounts: cccAudit?.accountsTargeted ?? accounts.length,
      totalViolations: cccAudit?.totalViolations ?? totalViolations,
      crossBureauConflicts: countCrossBureau(accountsIn),
      furnisherFirst: true,
    },
    methodologyNote: personalizeMethodologyNote(cccAudit?.executiveSummary),
    accounts,
    cccRaw: cccAudit,
  };
}
