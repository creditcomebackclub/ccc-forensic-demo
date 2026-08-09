function roundId(round) {
  return round?.id || round?.round_id || null;
}

export function getLetterRound(client, letter) {
  const id = letter?.roundId || letter?.round_id || null;
  if (!id) return null;
  return (client?.rounds || []).find((round) => roundId(round) === id) || null;
}

export function isOpenRoundLetter(client, letter) {
  if (!(letter?.roundId || letter?.round_id)) return true;
  const round = getLetterRound(client, letter);
  return !round || round.status === 'open';
}

export function hasLaterLegacyFollowup(client, letter) {
  const sourceSavedAt = new Date(letter?.savedAt || letter?.saved_at || 0).getTime();
  const sourceFurnisher = String(letter?.furnisher || '').trim().toLowerCase();
  if (!sourceFurnisher || !Number.isFinite(sourceSavedAt)) return false;
  return (client?.letters || []).some((candidate) => {
    const candidateSavedAt = new Date(candidate.savedAt || candidate.saved_at || 0).getTime();
    const phase = String(candidate.phase || '');
    const directMatch = String(candidate.furnisher || '').trim().toLowerCase() === sourceFurnisher;
    const coveredMatch = (candidate.coveredFurnishers || candidate.covered_furnishers || [])
      .some((furnisher) => String(furnisher || '').trim().toLowerCase() === sourceFurnisher);
    return phase.startsWith('Phase 3') && candidateSavedAt > sourceSavedAt && (directMatch || coveredMatch);
  });
}

export function isPendingRoundReview(client, letter) {
  if (!isOpenRoundLetter(client, letter)) return false;
  if (hasLaterLegacyFollowup(client, letter)) return false;
  return !letter?.roundReviewStatus || letter.roundReviewStatus === 'not_reviewed';
}
