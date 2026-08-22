import {
  isBureauCampaign,
  isCccDisputeCampaign,
  isFileUpdateCampaign,
} from './clientCampaignCopy.js';

const CURRENT_FIRST_CLASS = 'usps_first_class';
const LEGACY_CERTIFIED = 'usps_first_class_certified_return_receipt';
const TERMINAL_MAIL_STATUSES = new Set(['Failed', 'Cancelled', 'Returned to Sender']);

export function isPortalMailTerminal(letter = {}) {
  return TERMINAL_MAIL_STATUSES.has(String(letter.tracking_status || ''));
}

/**
 * Mail copy shown to a client must be evidence-based. A missing service value
 * is not proof that a historical item was certified.
 */
export function portalMailPresentation(letter = {}) {
  if (letter.mail_service === CURRENT_FIRST_CLASS) {
    return {
      label: 'USPS First Class',
      timelineLabel: 'USPS First Class',
      currentFirstClass: true,
      legacyCertified: false,
      unknown: false,
      untracked: true,
    };
  }
  if (letter.mail_service === LEGACY_CERTIFIED) {
    return {
      label: 'Certified Mail (legacy history)',
      timelineLabel: 'Certified Mail (legacy history)',
      currentFirstClass: false,
      legacyCertified: true,
      unknown: false,
      untracked: false,
    };
  }
  return {
    label: 'Mail service not recorded',
    timelineLabel: 'mail (service not recorded)',
    currentFirstClass: false,
    legacyCertified: false,
    unknown: true,
    untracked: true,
  };
}

/** Plain First-Class scans are operational hints, not proof of delivery. */
export function hasClientVisibleDelivery(letter = {}) {
  return portalMailPresentation(letter).legacyCertified
    && letter.tracking_status === 'Delivered'
    && Boolean(letter.delivered_at);
}

/** Current CCC review timing uses the saved expected-delivery date. */
export function portalReviewStartDate(letter = {}) {
  const mail = portalMailPresentation(letter);
  if (mail.currentFirstClass) {
    if (!letter.mailed_date || !letter.expected_delivery_date || isPortalMailTerminal(letter)) return null;
    return String(letter.expected_delivery_date).slice(0, 10);
  }
  if (hasClientVisibleDelivery(letter)) return String(letter.delivered_at).slice(0, 10);
  return null;
}

export function hasPortalReviewStarted(letter = {}, today = new Date()) {
  const start = portalReviewStartDate(letter);
  if (!start) return false;
  const startDate = new Date(`${String(start).slice(0, 10)}T00:00:00Z`);
  const todayDate = new Date(today);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(todayDate.getTime())) return false;
  const todayUtc = Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), todayDate.getUTCDate());
  return startDate.getTime() <= todayUtc;
}

export function isCurrentCccLetter(letter) {
  return isCccDisputeCampaign(letter?.phase);
}

export function clientTrackStatusLabel(status) {
  switch (String(status || '')) {
    case 'active': return 'Casework in progress';
    case 'staff_review': return 'Staff review underway';
    case 'removed': return 'Removal confirmed';
    case 'complete': return 'Review complete';
    default: return 'Status being prepared';
  }
}

export function visiblePortalTracks(tracks = []) {
  return (tracks || []).filter((track) => (
    track?.channel !== 'direct_account' || track?.status !== 'not_started'
  ));
}

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
    return { key: `campaign:${letter.campaign_id}:cleanup`, label: 'Report preparation' };
  }
  if (letter?.campaign_id) {
    const roundNumber = campaign?.round_number || letter.round_number;
    return { key: `campaign:${letter.campaign_id}:account`, label: `Round ${roundNumber} · Account casework` };
  }
  if (letter?.round_id) {
    return {
      key: letter.round_id,
      label: `Round ${letter.round_number} · ${isPortalBureauDispute(letter) ? 'Credit bureau case' : 'Direct account correspondence'}`,
    };
  }
  return { key: `legacy:${letter?.phase || 'Campaign letter'}`, label: letter?.phase || 'Campaign letter' };
}

function countLetters(letters) {
  return {
    letterCount: letters.length,
    mailedCount: letters.filter((letter) => letter.mailed_date).length,
    deliveredCount: letters.filter(hasClientVisibleDelivery).length,
    reviewScheduledCount: letters.filter((letter) => Boolean(portalReviewStartDate(letter))).length,
    reviewStartedCount: letters.filter((letter) => hasPortalReviewStarted(letter)).length,
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
        : cleanup.reviewStartedCount === cleanup.letterCount
          ? 'Case review window active'
          : cleanup.mailedCount === cleanup.letterCount
            ? cleanup.reviewScheduledCount === cleanup.letterCount
              ? 'Mailed · case review scheduled'
              : 'Mailed · review schedule pending'
            : 'Preparation and mailing in progress';

      account.status = account.letterCount === 0
        ? (accountSelected > 0 ? 'Coming next' : 'Not included')
        : campaignRounds.some((round) => round.status === 'closed') && campaignRounds.every((round) => round.status === 'closed')
          ? 'Case review complete'
          : account.reviewedCount > 0
            ? 'Staff review in progress'
            : account.reviewStartedCount > 0
              ? 'Review window in progress'
              : account.mailedCount === account.letterCount
                ? account.reviewScheduledCount === account.letterCount
                  ? 'Mailed · case review scheduled'
                  : 'Mailed · review schedule pending'
                : 'Preparation and mailing in progress';

      return { ...campaign, cleanup, account };
    })
    .sort((a, b) => Number(b.round_number || 0) - Number(a.round_number || 0));
}
