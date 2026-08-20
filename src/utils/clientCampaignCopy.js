// Client portals intentionally use a simple case narrative rather than the
// firm's internal Phase 1–4 labels. A phase can be conditional/internal and
// is not a promise that every client will see a separate mailed letter.
//
// Client-facing tracks:
//   - File update: personal info / inquiry cleanup to a bureau
//   - Account dispute: direct furnisher correspondence (Phase 1 / Phase 2)
//   - Credit Bureau Review: Phase 3 / Phase 4 bureau reinvestigation
//   - CCC bureau dispute: current Consent / Accuracy / Collection sequence

const FILE_UPDATE_PHASES = new Set([
  'Personal Info & Inquiries',
  'Personal Info Cleanup',
  'Inquiry Removal',
]);

export function isBureauCampaign(phase) {
  return /^phase\s*[34]\b/i.test(String(phase || ''));
}

export function isCccDisputeCampaign(phase) {
  return String(phase || '').startsWith('CCC Dispute —');
}

export function isFileUpdateCampaign(phase) {
  return FILE_UPDATE_PHASES.has(String(phase || '').trim());
}

export function isAccountDisputeCampaign(phase) {
  return !isBureauCampaign(phase) && !isFileUpdateCampaign(phase);
}

export function clientCampaignLabel(phase) {
  if (isCccDisputeCampaign(phase)) return 'CCC bureau dispute';
  if (isBureauCampaign(phase)) return 'Credit Bureau Review';
  if (isFileUpdateCampaign(phase)) return 'File update';
  return 'Account dispute';
}

export function clientCampaignDetail(phase) {
  if (isCccDisputeCampaign(phase)) return 'Consent, accuracy, or collection round with the credit bureau';
  if (isBureauCampaign(phase)) return 'Bureau-level reinvestigation';
  if (isFileUpdateCampaign(phase)) return 'Personal info & inquiry cleanup';
  return 'Evidence-backed direct correspondence';
}
