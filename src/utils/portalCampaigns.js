import { isBureauCampaign, isFileUpdateCampaign } from './clientCampaignCopy.js';

export function isPortalFileUpdate(letter) {
  return String(letter?.letter_kind || '') === 'file_update' || isFileUpdateCampaign(letter?.phase);
}

export function isPortalBureauDispute(letter) {
  return !isPortalFileUpdate(letter)
    && (letter?.target_type === 'bureau' || isBureauCampaign(letter?.phase));
}

export function portalLetterGroup(letter, campaignById = new Map()) {
  const campaign = letter?.campaign_id ? campaignById.get(letter.campaign_id) : null;
  if (letter?.campaign_id && isPortalFileUpdate(letter)) {
    return { key: `campaign:${letter.campaign_id}:cleanup`, label: 'Step 1 · Credit-file cleanup' };
  }
  if (letter?.campaign_id) {
    const roundNumber = campaign?.round_number || letter.round_number;
    return { key: `campaign:${letter.campaign_id}:account`, label: `Round ${roundNumber} · Account disputes` };
  }
  if (letter?.round_id) {
    return {
      key: letter.round_id,
      label: `Round ${letter.round_number} · ${isPortalBureauDispute(letter) ? 'Credit Bureau Dispute' : 'Direct Furnisher Dispute'}`,
    };
  }
  return { key: `legacy:${letter?.phase || 'Campaign letter'}`, label: letter?.phase || 'Campaign letter' };
}

function countLetters(letters) {
  return {
    letterCount: letters.length,
    mailedCount: letters.filter((letter) => letter.mailed_date).length,
    deliveredCount: letters.filter((letter) => letter.tracking_status === 'Delivered').length,
    reviewedCount: letters.filter((letter) => letter.round_review_status && letter.round_review_status !== 'not_reviewed').length,
  };
}

export function buildPortalCampaignJourneys(campaigns = [], letters = [], rounds = []) {
  return campaigns
    .filter((campaign) => campaign.stage !== 'cancelled' && campaign.stage !== 'legacy')
    .map((campaign) => {
      const campaignLetters = letters.filter((letter) => letter.campaign_id === campaign.campaign_id);
      const cleanupLetters = campaignLetters.filter(isPortalFileUpdate);
      const accountLetters = campaignLetters.filter((letter) => !isPortalFileUpdate(letter));
      const campaignRounds = rounds.filter((round) => round.campaign_id === campaign.campaign_id && round.status !== 'cancelled');
      const cleanup = countLetters(cleanupLetters);
      const account = countLetters(accountLetters);
      const cleanupSelected = Number(campaign.selected_cleanup_count || 0);
      const accountSelected = Number(campaign.selected_account_count || 0);

      cleanup.status = cleanup.letterCount === 0
        ? (cleanupSelected > 0 ? 'Preparing' : 'Not included')
        : cleanup.deliveredCount === cleanup.letterCount
          ? 'Delivered · response monitoring active'
          : cleanup.mailedCount === cleanup.letterCount
            ? 'Mailed · delivery tracking active'
            : 'Preparation and mailing in progress';

      account.status = account.letterCount === 0
        ? (accountSelected > 0 ? 'Coming next' : 'Not included')
        : campaignRounds.some((round) => round.status === 'closed') && campaignRounds.every((round) => round.status === 'closed')
          ? 'Round review complete'
          : account.reviewedCount > 0
            ? 'Staff review in progress'
            : account.mailedCount === account.letterCount
              ? 'Response window in progress'
              : 'Preparation and mailing in progress';

      return { ...campaign, cleanup, account };
    })
    .sort((a, b) => Number(b.round_number || 0) - Number(a.round_number || 0));
}
