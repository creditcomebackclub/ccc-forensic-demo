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

function leadNurtureContext(lead) {
  const tags = Array.isArray(lead?.tags) ? lead.tags.map(String) : [];
  return {
    // Keep the historic tag readable so existing leads retain their context,
    // while all new tracked links record the truthful on-page guide view.
    guideDownloaded: tags.includes('guide:viewed') || tags.includes('guide:downloaded'),
    consultationRequested: String(lead?.consultation_status || '').trim() === 'requested',
  };
}

function sourceAwareNurtureBody(day, context = {}) {
  const guideDownloaded = context.guideDownloaded === true;
  const consultationRequested = context.consultationRequested === true;
  if (Number(day) === 1) {
    if (guideDownloaded) {
      return `<p>Thanks for reviewing our free credit report accuracy guide and reaching out. The next step is a free review of your current three-bureau report. Our team uses that review to prepare a Recovery Blueprint before you decide whether to become a client.</p>
             <p>Choose a consultation time when you are ready. There is no pressure and no cost for the review or Blueprint.</p>`;
    }
    if (consultationRequested) {
      return `<p>Thanks for requesting a free consultation. It looks like you haven't selected a time yet, so we wanted to make it easy to pick up where you left off.</p>
             <p>Choose any available time below. We will review your goals and current three-bureau report, then explain your Recovery Blueprint before you decide whether to engage us.</p>`;
    }
    return `<p>Thanks for reaching out to Credit Comeback Club. We review current three-bureau reports account by account and prepare a Recovery Blueprint showing the dispute path supported by the documented report facts.</p>
            <p>Choose a free consultation time when you are ready. The review and Blueprint come before any decision to become a client.</p>`;
  }
  if (Number(day) === 3) {
    return `<p>There is no single dispute route that fits every account. We build the Recovery Blueprint around three things: <strong>Your Story. The Facts. The Pressure.</strong></p>
            <p>Your Story captures the personal impact. The Facts identify the exact information that appears inaccurate, incomplete, or inconsistent across Equifax, Experian, and TransUnion. The Pressure is documented consumer-law and deadline follow-through with the correct recipient&mdash;not a threat or a promised result.</p>
            <p>A trained team member reviews the account path before it appears in the Blueprint. If you later become a client, that saved path determines whether personalized correspondence goes to a credit bureau, a furnisher, or both when applicable.</p>
            <p>${guideDownloaded ? 'The guide is educational; your' : 'Your'} own report still requires an individual review. No deletion, score change, outcome, or timeline is guaranteed.</p>`;
  }
  return null;
}

module.exports = { HUMAN_OWNED_STAGES, leadNurtureContext, shouldSuppressGenericNurture, sourceAwareNurtureBody };
