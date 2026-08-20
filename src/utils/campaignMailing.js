function value(letter, camel, snake) {
  return letter?.[camel] ?? letter?.[snake] ?? null;
}

export function isCancelledMail(letter) {
  return ['cancelled', 'canceled'].includes(String(value(letter, 'trackingStatus', 'tracking_status') || '').toLowerCase());
}

export function isMailedMail(letter) {
  return !isCancelledMail(letter) && !!value(letter, 'mailedDate', 'mailed_date');
}

export function campaignReadyForTracking(workspace, clientLetters = []) {
  const routes = workspace?.routes || [];
  if (!routes.length || routes.some((route) => route.status !== 'generated' || !route.letterIds?.length)) return false;
  const byId = new Map([...(workspace?.letters || []), ...clientLetters].map((letter) => [letter.id, letter]));
  return routes.every((route) => route.letterIds.every((id) => (
    route.approvedLetterIds?.includes(id)
    && isMailedMail(byId.get(id))
  )));
}
