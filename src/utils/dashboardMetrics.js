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

export function countOngoingDisputeClients(clients = []) {
  return clients.filter((client) => {
    if (client?.status === 'lead') return false;

    const lifecycle = client?.billingStatus || 'Active';
    if (lifecycle === 'Graduated' || lifecycle === 'Inactive') return false;

    return Boolean(
      client?.activeCampaign ||
      (client?.rounds || []).length > 0 ||
      (client?.letters || []).length > 0 ||
      (client?.audits || []).length > 0
    );
  }).length;
}

export function selectVipClients(clients = []) {
  return clients.filter((client) => client?.status !== 'lead' && client?.isVip === true);
}

export function calculateDeletionShare(deletedOutcomes, recordedOutcomes) {
  if (!recordedOutcomes) return null;
  return Math.round((deletedOutcomes / recordedOutcomes) * 100);
}
