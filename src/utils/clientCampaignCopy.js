// Client portals intentionally use a simple case narrative rather than the
// firm's internal Phase 1–4 labels. A phase can be conditional/internal and
// is not a promise that every client will see a separate mailed letter.
export function isBureauCampaign(phase) {
  return /^phase\s*[34]\b/i.test(String(phase || ''));
}

export function clientCampaignLabel(phase) {
  return isBureauCampaign(phase) ? 'Credit Bureau Review' : 'Direct Dispute';
}

export function clientCampaignDetail(phase) {
  return isBureauCampaign(phase)
    ? 'Bureau-level reinvestigation'
    : 'Evidence-backed direct correspondence';
}
