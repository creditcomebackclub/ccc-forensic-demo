/**
 * A single-bureau audit is a useful, immutable source result, but it is not a
 * three-bureau operating baseline. Legacy audits that predate reportCoverage
 * remain readable/operational for compatibility; only rows explicitly marked
 * incomplete are excluded.
 */
export function isOperationalCreditAudit(value) {
  const audit = value?.audit && typeof value.audit === 'object' ? value.audit : value;
  if (!audit || typeof audit !== 'object') return false;
  return audit.kind !== 'single_bureau_audit'
    && audit.reportCoverage?.complete !== false;
}

export function operationalAudits(values) {
  return (values || []).filter(isOperationalCreditAudit);
}

export function compareOperationalAuditRows(a, b) {
  const operationalDelta = Number(isOperationalCreditAudit(b)) - Number(isOperationalCreditAudit(a));
  if (operationalDelta) return operationalDelta;
  const aDate = a?.saved_at || a?.savedAt || a?.report_date || a?.reportDate || '';
  const bDate = b?.saved_at || b?.savedAt || b?.report_date || b?.reportDate || '';
  return String(bDate).localeCompare(String(aDate));
}
