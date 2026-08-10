const PERSONAL_INFO_CLEANUP_PHASES = new Set([
  'Personal Info Cleanup',
  'Inquiry Removal',
  'Personal Info & Inquiries',
]);

export function isPersonalInfoCleanupLetter(letter) {
  return !!letter && typeof letter === 'object'
    && PERSONAL_INFO_CLEANUP_PHASES.has(String(letter.phase || ''));
}

export function isFileUpdateLetter(letter) {
  if (!letter || typeof letter !== 'object') return false;
  const kind = letter.letterKind || letter.letter_kind || '';
  return kind === 'file_update'
    || isPersonalInfoCleanupLetter(letter)
    || String(letter.phase || '') === 'Interim Letter';
}

/**
 * A bureau recipient does not automatically make a letter a Phase 3 account
 * dispute. PI, inquiry, and interim file-update letters intentionally have no
 * covered-furnisher list and must not inherit Phase 3 evidence requirements.
 */
export function isBureauAccountDisputeLetter(letter) {
  if (!letter || typeof letter !== 'object' || isFileUpdateLetter(letter)) return false;
  const targetType = letter.targetType || letter.target_type || '';
  return targetType === 'bureau' || String(letter.phase || '').startsWith('Phase 3');
}
