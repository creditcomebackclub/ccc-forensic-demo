export function summarizeOperations(items) {
  const summary = {
    total: items.length,
    critical: 0,
    warning: 0,
    audit: 0,
    response: 0,
    mail: 0,
    delivery: 0,
    onboarding: 0,
  };

  for (const item of items) {
    if (item.severity === 'critical') summary.critical++;
    else summary.warning++;

    if (item.source === 'audit_job') summary.audit++;
    else if (item.source === 'phase2_job' || item.source === 'phase4_job' || item.source === 'response_evidence') summary.response++;
    else if (item.source === 'mail_submission') summary.mail++;
    else if (item.source === 'recovery_blueprint') summary.delivery++;
    else if (item.source === 'onboarding') summary.onboarding++;
  }

  return summary;
}

export function operationArea(source) {
  if (source === 'audit_job') return 'Audits';
  if (source === 'phase2_job' || source === 'phase4_job' || source === 'response_evidence') return 'Responses';
  if (source === 'mail_submission') return 'Mailing';
  if (source === 'recovery_blueprint') return 'Blueprints';
  if (source === 'onboarding') return 'Onboarding';
  return 'Other';
}
