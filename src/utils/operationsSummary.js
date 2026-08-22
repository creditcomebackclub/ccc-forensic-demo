export function summarizeOperations(items) {
  const summary = {
    total: items.length,
    critical: 0,
    warning: 0,
    audit: 0,
    classification: 0,
    letter: 0,
    mail: 0,
    outcome: 0,
    delivery: 0,
    onboarding: 0,
  };

  for (const item of items) {
    if (item.severity === 'critical') summary.critical++;
    else summary.warning++;

    if (item.source === 'audit_job') summary.audit++;
    else if (item.source === 'classification_review' || item.source === 'r1_tracks') summary.classification++;
    else if (item.source === 'letter_snapshot' || item.source === 'template_review') summary.letter++;
    else if (item.source === 'mail_submission' || item.source === 'mail_method') summary.mail++;
    else if (item.source === 'course_outcome' || item.source === 'account_track_state') summary.outcome++;
    else if (item.source === 'recovery_blueprint') summary.delivery++;
    else if (item.source === 'onboarding' || item.source === 'service_authorization') summary.onboarding++;
  }

  return summary;
}

export function operationArea(source) {
  if (source === 'audit_job') return 'Audits';
  if (source === 'classification_review' || source === 'r1_tracks') return 'Classification';
  if (source === 'letter_snapshot' || source === 'template_review') return 'Letters';
  if (source === 'mail_submission' || source === 'mail_method') return 'Mailing';
  if (source === 'course_outcome' || source === 'account_track_state') return 'Outcomes';
  if (source === 'recovery_blueprint') return 'Blueprints';
  if (source === 'onboarding' || source === 'service_authorization') return 'Onboarding';
  return 'Other';
}
