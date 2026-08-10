export function summarizeStructuredRoundWorkload(clients = []) {
  let openDisputeRounds = 0;
  let activeRoundClients = 0;

  for (const client of clients) {
    if (client?.status === 'lead') continue;
    const openRounds = (client?.rounds || []).filter((round) => round.status === 'open');
    openDisputeRounds += openRounds.length;
    if (openRounds.length > 0) activeRoundClients++;
  }

  return { openDisputeRounds, activeRoundClients };
}

export function calculateDeletionShare(deletedOutcomes, recordedOutcomes) {
  if (!recordedOutcomes) return null;
  return Math.round((deletedOutcomes / recordedOutcomes) * 100);
}
