const BUREAU_CODES = Object.freeze({
  eq: 'EQ',
  equifax: 'EQ',
  exp: 'EXP',
  ex: 'EXP',
  experian: 'EXP',
  tu: 'TU',
  transunion: 'TU',
  'trans union': 'TU',
});

export function canonicalDeletionBureau(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper === 'EQ' || upper === 'EXP' || upper === 'TU') return upper;
  return BUREAU_CODES[raw.toLowerCase()] || null;
}

export function deletionBureauLabel(value) {
  const code = canonicalDeletionBureau(value);
  if (code === 'EQ') return 'Equifax';
  if (code === 'EXP') return 'Experian';
  if (code === 'TU') return 'TransUnion';
  return String(value || '').trim() || 'Credit bureau';
}

/**
 * Normalize both the staff table shape and the intentionally narrow portal
 * RPC shape. Financial fields and internal notes are deliberately omitted.
 */
export function normalizeDeletionOutcome(row = {}) {
  const bureauCode = canonicalDeletionBureau(
    row.bureauCode ?? row.bureau_code ?? row.bureau,
  );
  return {
    id: row.id ?? row.deletionId ?? row.deletion_id ?? null,
    clientId: row.clientId ?? row.client_id ?? null,
    clientAccountId: row.clientAccountId ?? row.client_account_id ?? null,
    furnisher: String(row.furnisher || '').trim() || 'Account',
    accountType: String(row.accountType ?? row.account_type ?? '').trim() || null,
    accountLast4: String(row.accountLast4 ?? row.account_last4 ?? '').trim() || null,
    bureauCode,
    bureauLabel: deletionBureauLabel(bureauCode || row.bureau),
    confirmedAt: row.confirmedAt ?? row.confirmed_at ?? row.deletion_confirmed_at ?? null,
    sourceKind: row.sourceKind ?? row.source_kind ?? null,
    sourceLetterId: row.sourceLetterId ?? row.source_letter_id ?? row.letter_id ?? null,
    sourceAuditId: row.sourceAuditId ?? row.source_audit_id ?? null,
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  };
}

function isDeletedLetter(letter) {
  return (letter?.responseOutcome ?? letter?.response_outcome) === 'deleted';
}

function letterId(letter) {
  return letter?.id ? String(letter.id) : null;
}

function letterDeletionResult(letter) {
  const id = letterId(letter);
  return {
    id: id ? `letter:${id}` : null,
    source: 'letter',
    sourceLetterId: id,
    clientAccountId: letter?.clientAccountId ?? letter?.client_account_id ?? null,
    furnisher: String(letter?.furnisher || '').trim() || 'Account',
    accountType: null,
    accountLast4: null,
    bureauCode: canonicalDeletionBureau(
      letter?.targetBureau
        ?? letter?.target_bureau
        ?? letter?.disputeBureauCode
        ?? letter?.dispute_bureau_code,
    ),
    confirmedAt: letter?.responseDate ?? letter?.response_date ?? letter?.savedAt ?? letter?.saved_at ?? null,
    responseUrl: letter?.responseFileUrl ?? letter?.response_file_url ?? null,
  };
}

function registryIdentity(result) {
  if (result.clientAccountId && result.bureauCode) {
    return `account:${result.clientAccountId}:${result.bureauCode}`;
  }
  return result.id ? `record:${result.id}` : null;
}

/**
 * Registry rows whose result is not already represented by a linked letter.
 * The database's client/account/bureau unique index is authoritative; this
 * local identity pass also prevents duplicate display during mixed-version
 * rollout or a stale browser response.
 */
export function standaloneDeletionResults(letters = [], deletionRows = []) {
  const deletedLetterIds = new Set(
    (letters || []).filter(isDeletedLetter).map(letterId).filter(Boolean),
  );
  const seen = new Set();
  const results = [];

  for (const row of deletionRows || []) {
    const result = normalizeDeletionOutcome(row);
    if (!result.confirmedAt) continue;
    if (result.sourceLetterId && deletedLetterIds.has(String(result.sourceLetterId))) continue;
    const identity = registryIdentity(result);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    results.push({ ...result, source: 'registry' });
  }

  return results;
}

export function combinedDeletionResults(letters = [], deletionRows = []) {
  const letterResults = (letters || []).filter(isDeletedLetter).map(letterDeletionResult);
  return [...letterResults, ...standaloneDeletionResults(letters, deletionRows)];
}
