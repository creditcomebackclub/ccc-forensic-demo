function value(record, camel, snake) {
  return record?.[camel] ?? record?.[snake] ?? null;
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function bureauFromPhase(phase) {
  const value = String(phase || '').toLowerCase();
  if (value.includes('equifax')) return 'equifax';
  if (value.includes('experian')) return 'experian';
  if (value.includes('transunion') || value.includes('trans union')) return 'transunion';
  return null;
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || !right.length) return false;
  return JSON.stringify([...new Set(left.map(String))].sort())
    === JSON.stringify([...new Set(right.map(String))].sort());
}

export function isPhase3FollowUpLetter(letter) {
  const phase = typeof letter === 'string' ? letter : letter?.phase;
  const hasSourceMetadata = typeof letter === 'object' && !!(
    value(letter, 'sourcePhase3LetterId', 'source_phase3_letter_id')
    || value(letter, 'sourceBureauResponseEvidenceId', 'source_bureau_response_evidence_id')
  );
  return /^Phase 3\b.*\(Follow-up\)/i.test(String(phase || '')) || hasSourceMetadata;
}

export function getFollowUpSourceIds(letter) {
  return {
    sourcePhase3LetterId: value(letter, 'sourcePhase3LetterId', 'source_phase3_letter_id'),
    sourceBureauResponseEvidenceId: value(
      letter,
      'sourceBureauResponseEvidenceId',
      'source_bureau_response_evidence_id'
    ),
  };
}

export function assertFollowUpEnclosureContract(letter) {
  requireValue(isPhase3FollowUpLetter(letter), 'This is not a bureau follow-up letter.');
  const sources = getFollowUpSourceIds(letter);
  requireValue(
    sources.sourcePhase3LetterId && sources.sourceBureauResponseEvidenceId,
    'FOLLOW-UP SOURCE MISSING — regenerate this follow-up so its exact prior Phase 3 letter and bureau response are recorded. Nothing was sent.'
  );
  requireValue(
    sources.sourcePhase3LetterId !== letter?.id,
    'FOLLOW-UP SOURCE INVALID — a follow-up cannot enclose itself. Nothing was sent.'
  );
  requireValue(
    value(letter, 'clientId', 'client_id'),
    'FOLLOW-UP CLIENT ID MISSING — reconcile this letter to the correct client before mailing. Nothing was sent.'
  );
  requireValue(
    value(letter, 'userId', 'user_id'),
    'FOLLOW-UP OWNER MISSING — reload the letter before mailing. Nothing was sent.'
  );
  return sources;
}

export function validateFollowUpSourceRelationships({ followUp, priorLetter, evidence }) {
  const sources = assertFollowUpEnclosureContract(followUp);
  const followUpClientId = value(followUp, 'clientId', 'client_id');
  const followUpUserId = value(followUp, 'userId', 'user_id');

  requireValue(priorLetter, 'FOLLOW-UP EXHIBIT A MISSING — the recorded prior Phase 3 letter was not found. Nothing was sent.');
  requireValue(
    priorLetter.id === sources.sourcePhase3LetterId,
    'FOLLOW-UP EXHIBIT A MISMATCH — the loaded letter is not the recorded prior Phase 3 source. Nothing was sent.'
  );
  requireValue(
    String(priorLetter.phase || '').startsWith('Phase 3'),
    'FOLLOW-UP EXHIBIT A INVALID — the recorded source is not a Phase 3 CRA letter. Nothing was sent.'
  );
  requireValue(
    value(priorLetter, 'clientId', 'client_id') === followUpClientId
      && value(priorLetter, 'userId', 'user_id') === followUpUserId,
    'FOLLOW-UP EXHIBIT A CLIENT MISMATCH — the prior letter belongs to a different client or firm. Nothing was sent.'
  );
  requireValue(
    bureauFromPhase(priorLetter.phase) === bureauFromPhase(followUp.phase)
      && !!bureauFromPhase(followUp.phase),
    'FOLLOW-UP EXHIBIT A BUREAU MISMATCH — the prior letter is addressed to a different bureau. Nothing was sent.'
  );
  requireValue(
    sameStringSet(
      value(priorLetter, 'coveredFurnishers', 'covered_furnishers'),
      value(followUp, 'coveredFurnishers', 'covered_furnishers')
    ),
    'FOLLOW-UP EXHIBIT A COVERAGE MISMATCH — the follow-up does not cover the same furnisher set as the prior Phase 3 letter. Nothing was sent.'
  );
  requireValue(
    typeof priorLetter.html === 'string' && priorLetter.html.trim(),
    'FOLLOW-UP EXHIBIT A EMPTY — the prior Phase 3 letter has no printable HTML. Nothing was sent.'
  );

  requireValue(evidence, 'FOLLOW-UP EXHIBIT B MISSING — the recorded bureau response was not found. Nothing was sent.');
  requireValue(
    evidence.id === sources.sourceBureauResponseEvidenceId,
    'FOLLOW-UP EXHIBIT B MISMATCH — the loaded response is not the recorded source. Nothing was sent.'
  );
  requireValue(
    evidence.letter_id === priorLetter.id
      && evidence.response_kind === 'bureau'
      && evidence.upload_status === 'received',
    'FOLLOW-UP EXHIBIT B INVALID — the response is not a completed bureau response to the recorded Phase 3 letter. Nothing was sent.'
  );
  requireValue(
    evidence.client_id === followUpClientId && evidence.firm_user_id === followUpUserId,
    'FOLLOW-UP EXHIBIT B CLIENT MISMATCH — the response belongs to a different client or firm. Nothing was sent.'
  );
  requireValue(
    evidence.storage_bucket === 'responses',
    'FOLLOW-UP EXHIBIT B STORAGE INVALID — the response is not in the private responses archive. Nothing was sent.'
  );

  const paths = Array.isArray(evidence.storage_paths) ? evidence.storage_paths : [];
  const names = Array.isArray(evidence.file_names) ? evidence.file_names : [];
  const expectedPrefix = `${followUpUserId}/response-evidence/${evidence.id}/`;
  requireValue(
    paths.length > 0
      && paths.every((path) => typeof path === 'string' && path.startsWith(expectedPrefix)),
    'FOLLOW-UP EXHIBIT B FILES INVALID — one or more recorded response files are missing or outside the evidence archive. Nothing was sent.'
  );
  requireValue(
    names.length === paths.length && names.every((name) => typeof name === 'string' && name.trim()),
    'FOLLOW-UP EXHIBIT B FILENAMES INVALID — the response file manifest is incomplete. Nothing was sent.'
  );

  return { sources, paths, names };
}

export function buildFollowUpEnclosurePlan(letter) {
  const sources = assertFollowUpEnclosureContract(letter);
  return [
    {
      kind: 'prior_phase3',
      label: 'Exhibit A — Prior Phase 3 CRA Dispute Letter',
      sourceId: sources.sourcePhase3LetterId,
    },
    {
      kind: 'bureau_response',
      label: 'Exhibit B — Bureau Investigation Results',
      sourceId: sources.sourceBureauResponseEvidenceId,
    },
    {
      kind: 'lpoa',
      label: 'Exhibit C — Limited Power of Attorney',
      sourceId: null,
    },
  ];
}

export function extractHtmlBody(html) {
  const source = String(html || '');
  const body = source.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return (body ? body[1] : source).trim();
}

export function extractHtmlStyles(html) {
  return Array.from(String(html || '').matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi))
    .map((match) => match[0])
    .join('');
}
