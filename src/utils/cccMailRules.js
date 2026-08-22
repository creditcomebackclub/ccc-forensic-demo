export const USPS_FIRST_CLASS = 'usps_first_class';
// Historical records may still contain this value. It is not an available
// service for a new CCC mailpiece.
export const USPS_CERTIFIED_RETURN_RECEIPT = 'usps_first_class_certified_return_receipt';

export function isCccDisputePhase(phase) {
  return String(phase || '').startsWith('CCC Dispute —');
}

export function cccRoundNumber(letterOrPhase) {
  if (letterOrPhase && typeof letterOrPhase === 'object') {
    const explicit = Number(letterOrPhase.disputeRoundNumber ?? letterOrPhase.dispute_round_number);
    if (Number.isInteger(explicit) && explicit > 0) return explicit;
    return cccRoundNumber(letterOrPhase.phase);
  }

  const match = String(letterOrPhase || '').match(/\bR(\d{1,2})\b/i);
  return match ? Number(match[1]) : null;
}

export function requiresCccR1IdentityDocuments(letter) {
  return isCccDisputePhase(letter?.phase) && cccRoundNumber(letter) === 1;
}

export function mailServiceForLetter(letter) {
  return isCccDisputePhase(letter?.phase)
    ? USPS_FIRST_CLASS
    : null;
}

export function isFirstClassCccLetter(letter) {
  return isCccDisputePhase(letter?.phase)
    && (letter?.mailService ?? letter?.mail_service) === USPS_FIRST_CLASS;
}

export function cccReviewClock(letter) {
  if (!isFirstClassCccLetter(letter)) return { start: null, basis: null };
  const mailed = letter?.mailedDate ?? letter?.mailed_date;
  const expected = letter?.expectedDeliveryDate ?? letter?.expected_delivery_date;
  const status = letter?.trackingStatus ?? letter?.tracking_status;
  const terminal = ['Failed', 'Cancelled', 'Returned to Sender'].includes(status);
  if (mailed && expected && !terminal) return { start: String(expected).slice(0, 10), basis: 'expected_delivery' };
  return { start: null, basis: null };
}
