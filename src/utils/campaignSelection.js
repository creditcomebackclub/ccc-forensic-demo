export function isCampaignSelectionLocked(workspace) {
  const routes = workspace?.routes || [];
  const letters = workspace?.letters || [];
  return letters.length > 0 || routes.some((route) =>
    (route.letterIds || route.letter_ids || []).length > 0
    || Boolean(route.disputeRoundId || route.dispute_round_id)
  );
}
