export const DEFAULT_RESPONSE_WINDOW_DAYS = 30;
export const RESPONSE_WINDOW_EXTENSION_DAYS = 15;

function dateOnly(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : null;
}

export function responseWindowDays(letterOrTarget) {
  if (typeof letterOrTarget === 'object' && letterOrTarget) {
    const structuredTarget = letterOrTarget.targetType || letterOrTarget.target_type;
    const legacyBureau = !structuredTarget && String(letterOrTarget.phase || '').startsWith('Phase 3');
    const baseDays = legacyBureau ? 45 : DEFAULT_RESPONSE_WINDOW_DAYS;
    return baseDays + Number(letterOrTarget.responseWindowExtensionDays || letterOrTarget.response_window_extension_days || 0);
  }
  return DEFAULT_RESPONSE_WINDOW_DAYS;
}

export function responseDeadline(letter) {
  const stored = letter?.responseDueAt || letter?.response_due_at;
  if (stored) return new Date(stored);
  const delivered = letter?.deliveredAt || letter?.delivered_at;
  if (!delivered) return null;
  return new Date(new Date(delivered).getTime() + responseWindowDays(letter) * 86400000);
}

export function letterStatus(letter, now = new Date()) {
  const outcome = letter?.responseOutcome || letter?.response_outcome;
  if (outcome === 'deleted') return { code: 'deleted', label: 'Deleted', deadline: null, daysRemaining: null };
  if (outcome === 'received') return { code: 'received', label: 'Response received', deadline: null, daysRemaining: null };
  if (outcome === 'no_response') return { code: 'no_response', label: 'No response recorded', deadline: null, daysRemaining: null };
  if (!(letter?.mailedDate || letter?.mailed_date)) return { code: 'draft', label: 'Draft', deadline: null, daysRemaining: null };
  const deadline = responseDeadline(letter);
  if (!deadline) return { code: 'in_transit', label: 'In transit', deadline: null, daysRemaining: null };
  const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / 86400000);
  if (daysRemaining <= 0) return { code: 'window_closed', label: 'Response window closed', deadline: dateOnly(deadline), daysRemaining };
  if (daysRemaining <= 5) return { code: 'due_soon', label: `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining`, deadline: dateOnly(deadline), daysRemaining };
  return { code: 'awaiting', label: `${daysRemaining} days remaining`, deadline: dateOnly(deadline), daysRemaining };
}
