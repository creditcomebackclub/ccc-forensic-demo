import { concreteTemplateStep } from './disputeState.js';

// Pure selection logic lives outside the Supabase CRUD module so course-flow
// fallbacks remain independently testable.
export function templatesForRecommendation(templates, recommendation, bureauCode) {
  const logicalRound = Number(recommendation?.round || 1);
  const logicalTrack = recommendation?.trackCode || recommendation?.flow;
  const concrete = concreteTemplateStep(logicalTrack, logicalRound);
  return (templates || [])
    .filter((template) => template.active
      && template.flow === concrete.flow
      && Number(template.round) === concrete.round
      && (template.bureau === bureauCode || template.bureau === 'ALL'))
    .sort((a, b) => {
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
