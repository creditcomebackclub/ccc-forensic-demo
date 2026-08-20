// Pure selection logic lives outside the Supabase CRUD module so course-flow
// fallbacks remain independently testable.
export function templatesForRecommendation(templates, recommendation, bureauCode) {
  const round = Number(recommendation?.round || 1);
  const allowedFlows = recommendation?.flow === 'combo' && [5, 6, 7].includes(round)
    ? new Set(['combo', 'accuracy'])
    : new Set([recommendation?.flow]);
  return (templates || [])
    .filter((template) => template.active
      && allowedFlows.has(template.flow)
      && Number(template.round) === round
      && (template.bureau === bureauCode || template.bureau === 'ALL'))
    .sort((a, b) => {
      const exactFlowDelta = Number(b.flow === recommendation?.flow) - Number(a.flow === recommendation?.flow);
      if (exactFlowDelta) return exactFlowDelta;
      const bureauDelta = Number(b.bureau === bureauCode) - Number(a.bureau === bureauCode);
      if (bureauDelta) return bureauDelta;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
}

export function nextTemplateVersionLabel(current) {
  const match = String(current || '').trim().match(/^v(\d+)$/i);
  return match ? `v${Number(match[1]) + 1}` : 'v2';
}

export function dateAfterDays(dateValue, days) {
  const date = dateValue ? new Date(`${dateValue}T12:00:00Z`) : new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
