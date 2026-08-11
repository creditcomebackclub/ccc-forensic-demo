const HUMAN_OWNED_STAGES = new Set(['contacted', 'audit', 'ready']);

function shouldSuppressGenericNurture(lead) {
  const consultationStatus = String(lead?.consultation_status || '').trim();
  // A requested time is still an unbooked lead. Every later consultation
  // state means the person has interacted with the calendar and generic
  // acquisition copy must not restart—even after a cancellation or no-show.
  if (consultationStatus && consultationStatus !== 'requested') return true;
  const tags = Array.isArray(lead?.tags) ? lead.tags.map(String) : [];
  return tags.some((tag) => tag.startsWith('lead-stage:') && HUMAN_OWNED_STAGES.has(tag.slice('lead-stage:'.length)));
}

module.exports = { HUMAN_OWNED_STAGES, shouldSuppressGenericNurture };
