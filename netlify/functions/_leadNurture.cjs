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
    guideDownloaded: tags.includes('guide:downloaded'),
    consultationRequested: String(lead?.consultation_status || '').trim() === 'requested',
  };
}

function sourceAwareNurtureBody(day, context = {}) {
  const guideDownloaded = context.guideDownloaded === true;
  const consultationRequested = context.consultationRequested === true;
  if (Number(day) === 1) {
    if (guideDownloaded) {
      return `<p>Thanks for downloading our free dispute guide and reaching out. Here's exactly what happens next: we'll review your credit report for furnisher-level reporting errors — the kind that can be legally challenged directly with the company that reported them, not just the credit bureau.</p>
             <p>The fastest way to find out what's on your file is a free 15-minute call. No pressure, no cost.</p>`;
    }
    if (consultationRequested) {
      return `<p>Thanks for requesting a free consultation. It looks like you haven't selected a time yet, so we wanted to make it easy to pick up where you left off.</p>
             <p>Choose any available time below and we'll review your goals and the information on your credit report. No pressure, no cost.</p>`;
    }
    return `<p>Thanks for reaching out to Credit Comeback Club. We help identify furnisher-level reporting errors and explain the options available for addressing them.</p>
            <p>The fastest way to discuss your file is a free 15-minute call. No pressure, no cost.</p>`;
  }
  if (Number(day) === 3) {
    return `<p>Most people think disputing a credit report means arguing with Equifax, Experian, or TransUnion. That's rarely where the real leverage is.</p>
            <p>Every account on your report is reported by a furnisher — a bank, collector, or lender — who is legally required to report it accurately under the Fair Credit Reporting Act. When they don't (wrong balance, wrong status, mismatched dates between bureaus), that's a direct violation we can challenge at the source.</p>
            <p>${guideDownloaded ? "That's the strategy explained in the guide you downloaded, and" : "That's the strategy"} we use when reviewing a credit report.</p>`;
  }
  return null;
}

module.exports = { HUMAN_OWNED_STAGES, leadNurtureContext, shouldSuppressGenericNurture, sourceAwareNurtureBody };
