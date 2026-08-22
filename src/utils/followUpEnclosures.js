const RETIRED_FOLLOW_UP_MESSAGE =
  'Historical Phase 3 follow-up packets are read-only. Start new work in the CCC Consent / Accuracy / Collection flow.';

function value(record, camel, snake) {
  return record?.[camel] ?? record?.[snake] ?? null;
}

/** Historical discriminator retained so saved records can still be labeled. */
export function isPhase3FollowUpLetter(letter) {
  const phase = typeof letter === 'string' ? letter : letter?.phase;
  const hasSourceMetadata = typeof letter === 'object' && !!(
    value(letter, 'sourcePhase3LetterId', 'source_phase3_letter_id')
    || value(letter, 'sourceBureauResponseEvidenceId', 'source_bureau_response_evidence_id')
  );
  return /^Phase 3\b.*\(Follow-up\)/i.test(String(phase || '')) || hasSourceMetadata;
}

/** Historical source IDs remain readable for audit/evidence presentation. */
export function getFollowUpSourceIds(letter) {
  return {
    sourcePhase3LetterId: value(letter, 'sourcePhase3LetterId', 'source_phase3_letter_id'),
    sourceBureauResponseEvidenceId: value(
      letter,
      'sourceBureauResponseEvidenceId',
      'source_bureau_response_evidence_id',
    ),
  };
}

// These former packet-building entry points intentionally fail closed. Keeping
// the exports prevents an old lazy-loaded module from crashing at import time,
// while ensuring it cannot assemble or send new legacy correspondence.
export function assertFollowUpEnclosureContract() {
  throw new Error(RETIRED_FOLLOW_UP_MESSAGE);
}

export function validateFollowUpSourceRelationships() {
  throw new Error(RETIRED_FOLLOW_UP_MESSAGE);
}

export function buildFollowUpEnclosurePlan() {
  throw new Error(RETIRED_FOLLOW_UP_MESSAGE);
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
