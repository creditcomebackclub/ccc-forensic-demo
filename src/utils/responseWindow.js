import {
  isPortalMailTerminal,
  portalMailPresentation,
  portalReviewStartDate,
} from './portalCampaigns.js';

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
  const normalized = {
    ...letter,
    mail_service: letter?.mail_service || letter?.mailService,
    mailed_date: letter?.mailed_date || letter?.mailedDate,
    expected_delivery_date: letter?.expected_delivery_date || letter?.expectedDeliveryDate,
    delivered_at: letter?.delivered_at || letter?.deliveredAt,
    tracking_status: letter?.tracking_status || letter?.trackingStatus,
  };
  const mail = portalMailPresentation(normalized);
  const reviewStart = portalReviewStartDate(normalized);
  if (mail.currentFirstClass) {
    if (!reviewStart) return null;
    return new Date(new Date(`${reviewStart}T00:00:00Z`).getTime() + responseWindowDays(letter) * 86400000);
  }
  if (!mail.legacyCertified || !reviewStart) return null;
  const stored = letter?.responseDueAt || letter?.response_due_at;
  if (stored) return new Date(stored);
  const delivered = normalized.delivered_at;
  return new Date(new Date(delivered).getTime() + responseWindowDays(letter) * 86400000);
}

export function letterStatus(letter, now = new Date()) {
  const outcome = letter?.responseOutcome || letter?.response_outcome;
  if (outcome === 'deleted') return { code: 'deleted', label: 'Deleted', deadline: null, daysRemaining: null };
  if (outcome === 'received') return { code: 'received', label: 'Response received', deadline: null, daysRemaining: null };
  if (outcome === 'no_response') return { code: 'no_response', label: 'No response recorded', deadline: null, daysRemaining: null };
  if (!(letter?.mailedDate || letter?.mailed_date)) return { code: 'draft', label: 'Draft', deadline: null, daysRemaining: null };
  if (isPortalMailTerminal({ ...letter, tracking_status: letter?.tracking_status || letter?.trackingStatus })) {
    return { code: 'mail_issue', label: 'Mailing issue recorded', deadline: null, daysRemaining: null };
  }
  const normalized = {
    ...letter,
    mail_service: letter?.mail_service || letter?.mailService,
    mailed_date: letter?.mailed_date || letter?.mailedDate,
    expected_delivery_date: letter?.expected_delivery_date || letter?.expectedDeliveryDate,
    delivered_at: letter?.delivered_at || letter?.deliveredAt,
    tracking_status: letter?.tracking_status || letter?.trackingStatus,
  };
  const mail = portalMailPresentation(normalized);
  const reviewStart = portalReviewStartDate(normalized);
  if (mail.currentFirstClass && reviewStart) {
    const startTime = new Date(`${reviewStart}T00:00:00Z`).getTime();
    const nowDate = new Date(now);
    const nowUtc = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate());
    if (startTime > nowUtc) {
      return { code: 'review_scheduled', label: 'Review start scheduled', deadline: null, daysRemaining: null };
    }
  }
  const deadline = responseDeadline(letter);
  if (!deadline) {
    return {
      code: 'mailed',
      label: mail.legacyCertified ? 'Mailed — delivery confirmation pending' : 'Mailed — review schedule pending',
      deadline: null,
      daysRemaining: null,
    };
  }
  const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / 86400000);
  if (daysRemaining <= 0) return { code: 'window_closed', label: 'Response window closed', deadline: dateOnly(deadline), daysRemaining };
  if (daysRemaining <= 5) return { code: 'due_soon', label: `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining`, deadline: dateOnly(deadline), daysRemaining };
  return { code: 'awaiting', label: `${daysRemaining} days remaining`, deadline: dateOnly(deadline), daysRemaining };
}
