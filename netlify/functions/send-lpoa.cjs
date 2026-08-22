const { sendEmail, isConfigured, wrapClientEmail, escapeHtml, BRAND } = require('./_email.cjs');
const { sourceAwareNurtureBody } = require('./_leadNurture.cjs');

const CONSULTATION_URL = 'https://calendly.com/creditcomebackclub/consultation?hide_gdpr_banner=1';

async function sendMail(to, subject, htmlBody, attachments) {
  return sendEmail({ to, subject, html: htmlBody, attachments });
}

/** Branded shell for client-facing send-lpoa templates. */
function branded(eyebrow, bodyHtml, cta) {
  return wrapClientEmail({
    eyebrow,
    bodyHtml,
    cta: cta === undefined
      ? { href: BRAND.portalUrl, label: 'Open your portal →' }
      : cta,
  });
}

// An affiliate may request an internal "new referral" alert, but the email
// must be built from records the server verifies—not names, companies, or
// client details supplied by the browser. This keeps the endpoint useful
// without turning it into a generic authenticated email relay.
async function loadVerifiedAffiliateReferral(userId, clientEmail) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey || !clientEmail) return null;

  const headers = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey };
  const affiliateUrl = supabaseUrl + '/rest/v1/affiliates?user_id=eq.'
    + encodeURIComponent(userId) + '&select=id,name,company&limit=1';
  const affiliateResponse = await fetch(affiliateUrl, { headers });
  if (!affiliateResponse.ok) return null;
  const affiliates = await affiliateResponse.json();
  const affiliate = Array.isArray(affiliates) ? affiliates[0] : null;
  if (!affiliate?.id) return null;

  const clientUrl = supabaseUrl + '/rest/v1/clients?referred_by=eq.'
    + encodeURIComponent(affiliate.id) + '&email=eq.' + encodeURIComponent(String(clientEmail).trim().toLowerCase())
    + '&select=name,email,phone,notes,created_at&order=created_at.desc&limit=1';
  const clientResponse = await fetch(clientUrl, { headers });
  if (!clientResponse.ok) return null;
  const clients = await clientResponse.json();
  const client = Array.isArray(clients) ? clients[0] : null;
  return client ? { affiliate, client } : null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };

  const emailConfigured = isConfigured();

  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { action } = payload;

  // This function sends privileged email. Client response uploads are now
  // recorded by response-evidence.cjs and surfaced in the admin action queue;
  // do not leave a generic client-authenticated email endpoint that can be
  // used to spoof arbitrary client/furnisher details to staff.
  const STAFF_ACTIONS = ['send_audit_email', 'send_phase_notification'];
  const ADMIN_ACTIONS = ['send', 'send_consultation_booked', 'send_onboarding_welcome', 'send_campaign_update', 'send_lead_drip', 'send_onboarding_reminder', 'send_lead_nurture', 'send_report_refresh', 'admin_new_lead', 'send_educational', 'affiliate_welcome'];
  const AFFILIATE_ACTIONS = ['affiliate_new_referral'];
  if (!STAFF_ACTIONS.includes(action) && !ADMIN_ACTIONS.includes(action) && !AFFILIATE_ACTIONS.includes(action)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  }
  if (STAFF_ACTIONS.includes(action)) {
    const { requireStaffOrSystem } = require('./_requireAuth.cjs');
    try { await requireStaffOrSystem(event); }
    catch (e) { if (e.statusCode) return e; throw e; }
  } else if (ADMIN_ACTIONS.includes(action)) {
    const { requireAdmin } = require('./_requireAdmin.cjs');
    try { await requireAdmin(event); }
    catch (e) { if (e.statusCode) return e; throw e; }
  } else {
    const { requireAuth } = require('./_requireAuth.cjs');
    let caller;
    try { caller = await requireAuth(event); }
    catch (e) { if (e.statusCode) return e; throw e; }
    if (caller.isSystem) return { statusCode: 403, body: JSON.stringify({ error: 'Affiliate session required' }) };
    const referral = await loadVerifiedAffiliateReferral(caller.userId, payload.clientEmail);
    if (!referral) return { statusCode: 403, body: JSON.stringify({ error: 'Verified affiliate referral required' }) };
    payload._verifiedAffiliateReferral = referral;
  }

  if (action === 'send') {
    const { clientName, clientEmail, tier } = payload;
    if (!clientEmail) return { statusCode: 400, body: JSON.stringify({ error: 'clientEmail required' }) };
    if (!emailConfigured) return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY not configured — add to Netlify env vars' }) };
    const enrollment = tier && tier !== 'Consultation';
    const subject = enrollment ? 'Next Step: Choose Your Credit Comeback Club Consultation Time' : 'Your Free Consultation Request — Choose a Time';
    const intro = enrollment
      ? `Thanks for your interest in <strong>${escapeHtml(tier)}</strong>. Your request is in. The next step is a free review of your current three-bureau report so our team can prepare a Recovery Blueprint before you decide whether to enroll.`
      : 'Thanks for requesting a free consultation. Choose a time below and have your current three-bureau report ready. Our team will review the report and prepare a Recovery Blueprint before you decide whether to become a client.';
    const html = branded('Consultation Request Received',
      `<p style="margin:0 0 14px;">Hi ${escapeHtml(clientName)},</p>`
      + `<p style="margin:0 0 14px;">${intro}</p>`
      + `<p style="margin:0;font-size:12px;color:#6B7280;">No portal account, service agreement, or payment is created from this request. We send the secure service-agreement and document wizard only if you choose to move forward after reviewing the Blueprint.</p>`
      + `<p style="margin:14px 0 0;font-size:12px;color:#6B7280;">Questions? Reply to this email or call ${BRAND.phone}.</p>`,
      { href: CONSULTATION_URL, label: 'Choose Your Time →' });

    try {
      await sendMail(clientEmail, subject, html);
      return { statusCode: 200, body: JSON.stringify({ sent: true }) };
    } catch (e) {
      console.error('Email error:', e.message);
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  if (action === 'send_consultation_booked') {
    const { clientName, clientEmail } = payload;
    if (!clientEmail) return { statusCode: 400, body: JSON.stringify({ error: 'clientEmail required' }) };
    if (!emailConfigured) return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) };
    const firstName = String(clientName || 'there').split(' ')[0];
    const subject = `You're Booked, ${firstName} — How to Prepare for Your Credit Review`;
    const html = branded('Your Consultation Is Booked',
      `<p style="margin:0 0 14px;">Hi ${escapeHtml(firstName)},</p>`
      + `<p style="margin:0 0 14px;">Your consultation is on the calendar, and we&rsquo;re eager to take a close look at your file.</p>`
      + `<p style="margin:0 0 14px;">Please have a copy of your newest credit report available&mdash;ideally a current three-bureau report showing Equifax, Experian, and TransUnion. Bring any relevant recent correspondence from creditors, collectors, or the credit bureaus.</p>`
      + `<p style="margin:0 0 14px;">We&rsquo;ll use your current three-bureau report to understand your goals and prepare a free Recovery Blueprint. A team member reviews the account classifications before we explain the plan to you.</p>`
      + `<p style="margin:0 0 14px;">Booking does not create a payment, service agreement, or client portal. Only if you decide to become a client after reviewing the Blueprint will we send the secure service-agreement and document-upload wizard.</p>`
      + `<p style="margin:14px 0;">Calendly&rsquo;s calendar invitation contains the confirmed date, time, and meeting details. If you need to reschedule, use the link in that invitation.</p>`
      + `<p style="margin:0;">Questions before the call? Reply to this email or call ${BRAND.phone}.</p>`,
      null);
    try {
      await sendMail(clientEmail, subject, html);
      return { statusCode: 200, body: JSON.stringify({ sent: true }) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  if (action === 'send_onboarding_welcome') {
    const { clientName, clientEmail, magicLink } = payload;
    if (!clientEmail || !magicLink) return { statusCode: 400, body: JSON.stringify({ error: 'clientEmail and magicLink required' }) };
    if (!emailConfigured) return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) };
    const html = branded('Your secure onboarding is ready',
      `<p style="margin:0 0 14px;">Hi ${escapeHtml(clientName)},</p>`
      + `<p style="margin:0 0 14px;">Use the secure link below to create or access your account, review the required consumer disclosure and service agreement, upload your government ID and proof of address, sign, and confirm your onboarding.</p>`
      + `<p style="margin:0 0 14px;">After those steps are complete, the wizard will open your client portal so you can follow your campaign and upload correspondence.</p>`
      + `<p style="margin:0;font-size:12px;color:#6B7280;">For your security, access is protected by a sign-in link sent to this email address.</p>`,
      { href: magicLink, label: 'Open Your Portal →' });
    try {
      await sendMail(clientEmail, 'Welcome to Your Credit Comeback Club Portal', html);
      return { statusCode: 200, body: JSON.stringify({ sent: true }) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  // Send audit to client — auditor-reviewed subject/body from the
  // "Email Audit to Client" modal, with the audit PDF attached.
  if (action === 'send_audit_email') {
    const { clientEmail, subject, bodyText, attachmentBase64, attachmentFilename } = payload;
    if (!clientEmail) return { statusCode: 400, body: JSON.stringify({ error: 'clientEmail required' }) };
    if (!subject || !bodyText) return { statusCode: 400, body: JSON.stringify({ error: 'subject and bodyText required' }) };
    if (!emailConfigured) return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) };

    // Auditor-edited plain text, wrapped in the same branded shell as every
    // other CCC email — paragraphs split on blank lines, single line breaks
    // preserved within a paragraph.
    const paragraphs = String(bodyText).split(/\n{2,}/).map((p) =>
      `<p style="margin:0 0 14px;">${p.split('\n').map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('<br>')}</p>`
    ).join('');

    const html = branded('Your Three-Bureau Review Is Ready', paragraphs, null);

    const attachments = attachmentBase64 ? [{
      content: attachmentBase64,
      filename: attachmentFilename || 'recovery-blueprint.pdf',
      type: 'application/pdf',
      disposition: 'attachment',
    }] : undefined;

    try {
      await sendMail(clientEmail, subject, html, attachments);
      return { statusCode: 200, body: JSON.stringify({ sent: true }) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  // Automated phase notification emails
  if (action === 'send_phase_notification') {
    const { clientName, clientEmail, phase, furnisher, trackingNumber, details } = payload;
    if (!clientEmail) return { statusCode: 400, body: JSON.stringify({ error: 'clientEmail required' }) };
    if (!emailConfigured) return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) };

    const recipient = escapeHtml(furnisher || 'the selected recipient');
    const safeDetails = details ? escapeHtml(details) : null;
    const subjects = {
      ccc_dispute_mailed: 'Your CCC Dispute Letter Has Been Mailed — ' + (furnisher || 'Campaign Update'),
      phase1_mailed: 'Historical Campaign Mailing Recorded — ' + (furnisher || 'Campaign Update'),
      phase1_delivered: 'Historical Campaign Delivery Record Updated — ' + (furnisher || 'Campaign Update'),
      phase2_analyzed: 'Historical Campaign Response Reviewed — ' + (furnisher || 'Campaign Update'),
      phase3_mailed: 'Historical Campaign Mailing Recorded — ' + (furnisher || 'Campaign Update'),
    };

    const bodies = {
      ccc_dispute_mailed: `<p>Your <strong>${safeDetails || 'CCC dispute letter'}</strong> to <strong>${recipient}</strong> has been mailed by USPS First-Class Mail.</p>
        <p>CCC recorded the send date. First-Class Mail does not include delivery confirmation or a signed receipt, and a Lob mailpiece scan is not proof of USPS delivery. Upload any response or updated report so the team can document the outcome before selecting a next step.</p>`,
      phase1_mailed: `<p>This update belongs to a grandfathered campaign created under an earlier CCC workflow. The mailing to <strong>${recipient}</strong> remains in the historical record.</p>
        ${trackingNumber ? `<p>Historical USPS reference: <a href="https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(trackingNumber)}" style="color:#1B2A4A;">${escapeHtml(String(trackingNumber).slice(-8))}</a></p>` : ''}
        <p>This older event does not describe CCC&rsquo;s current First-Class Mail process or create a guaranteed response date or outcome.</p>`,
      phase1_delivered: `<p>This delivery entry belongs to a grandfathered campaign created under an earlier CCC workflow for <strong>${recipient}</strong>.</p>
        <p>The team will preserve the historical record and review any response that is uploaded. No response date or result is guaranteed.</p>`,
      phase2_analyzed: `<p>A team member reviewed the historical campaign response from <strong>${recipient}</strong>.</p>
        <p>${safeDetails || 'The documented result and any applicable next step have been added to the grandfathered campaign record.'}</p>`,
      phase3_mailed: `<p>This bureau-mailing entry belongs to a grandfathered campaign created under an earlier CCC workflow for <strong>${recipient}</strong>.</p>
        <p>The team will preserve its mailing and response records without treating the older phase labels as the current CCC method.</p>`,
    };

    const html = branded('Campaign Update',
      `<p style="margin:0 0 14px;">Hi ${escapeHtml(clientName)},</p>`
      + (bodies[phase] || '<p style="margin:0 0 14px;">' + escapeHtml(details || 'Your dispute campaign has been updated.') + '</p>')
      + `<p style="margin:0 0 14px;">Questions? Reply to this email or call ${BRAND.phone}.</p>`);

    try {
      await sendMail(clientEmail, subjects[phase] || 'Credit Comeback Club Update', html);
      return { statusCode: 200, body: JSON.stringify({ sent: true }) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  // Onboarding Reminder Drip (Day 1, 3, 5)
  if (action === 'send_onboarding_reminder') {
    const { clientName, clientEmail, day, furnisher } = payload;
    if (!clientEmail) return { statusCode: 400, body: JSON.stringify({ error: 'clientEmail required' }) };
    if (!emailConfigured) return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) };

    const firstName = String(clientName || 'there').split(' ')[0] || 'there';
    const configs = {
      ccc_day7_checkin: {
        subject: 'Your CCC Dispute Campaign — Mailing Update',
        headline: 'Your mailing record is saved.',
        body: 'Your USPS First-Class Mail correspondence to ' + (furnisher || 'the selected recipient') + ' has a recorded send date. First-Class Mail does not include delivery confirmation or a signed receipt.',
        action: 'Keep any bureau mail or updated credit report you receive and upload it to your CCC portal.',
        tone: '#EFF6FF',
        borderColor: '#BFDBFE',
      },
      ccc_day30_review: {
        subject: 'Your CCC Campaign Is Ready for Review',
        headline: 'CCC is reviewing the documented result.',
        body: 'The scheduled operational review checkpoint for ' + (furnisher || 'this letter') + ' has arrived. It is not a guaranteed response date, and CCC will not assume a result that is not documented.',
        action: 'Upload every page of any bureau response or updated report so the team can record wins, failures, and the correct next round.',
        tone: '#FFFBEB',
        borderColor: '#FDE68A',
      },
      1: {
        subject: 'Next Step: Finish Setting Up Your CCC Account',
        body: `<p>Your Credit Comeback Club portal is ready. Open the secure wizard to review your consumer-rights disclosure and service agreement, upload your government ID and proof of address, and sign your agreement.</p>`,
      },
      2: {
        subject: 'Quick Reminder — Your Portal Is Waiting',
        body: `<p>Just a friendly nudge — your account is set up, but your agreement-and-documents wizard is still incomplete. Use the secure portal link to pick up where you left off.</p>`,
      },
      4: {
        subject: 'Don\'t Lose Momentum — Finish Onboarding',
        body: `<p>It's been a few days since we sent your portal access. Log in to review the disclosure and agreement, upload your ID and address proof, and complete your signature so your client portal can open.</p>`,
      },
      7: {
        subject: 'Final Notice: Your File Is On Hold',
        body: `<p>Your onboarding wizard is still incomplete, so your client portal remains on hold. If something is in the way — a question, a technical issue, anything — reply to this email and we'll help. Otherwise, log in and complete the remaining agreement and document steps.</p>`,
      },
    };

    const config = configs[day] || configs[1];

    const html = branded('Onboarding Action Required',
      `<p style="margin:0 0 14px;">Hi ${escapeHtml(firstName)},</p>`
      + config.body
      + `<p style="margin:0;">Questions? Reply to this email or call ${BRAND.phone}.</p>`,
      { href: BRAND.portalUrl + '/login', label: 'Access Client Portal →' });

    try {
      await sendMail(clientEmail, config.subject, html);
      return { statusCode: 200, body: JSON.stringify({ sent: true }) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  // Pre-invite lead nurture (Track A) — for leads who submitted the intake
  // form or were added manually but have never been sent portal access.
  // Unlike send_onboarding_reminder (Track B), this never tells someone to
  // "log in" or "finish signing" — they have nothing to log into yet.
  if (action === 'send_lead_nurture') {
    const { clientName, clientEmail, day, auditSummary, leadContext } = payload;
    if (!clientEmail) return { statusCode: 400, body: JSON.stringify({ error: 'clientEmail required' }) };
    if (!emailConfigured) return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) };

    const firstName = (clientName || '').split(' ')[0] || 'there';
    const hasAudit = !!(auditSummary && auditSummary.totalViolations != null);
    const findings = hasAudit ? auditSummary.totalViolations : null;
    const accountsForReview = hasAudit ? auditSummary.accountsTargeted : null;
    const accountsReviewed = hasAudit ? auditSummary.accountsScanned : null;

    const bookBtn = (label) => `<div style="text-align:center;margin:32px 0;">
        <a href="${CONSULTATION_URL}" style="background:#1B2A4A;color:#C9A84C;padding:14px 32px;text-decoration:none;border-radius:4px;font-weight:bold;font-size:14px;display:inline-block;">${label} &#8594;</a>
      </div>`;

    const complianceFooter = `<p style="font-size:10.5px;color:#999;line-height:1.5;">CCC provides non-attorney credit repair services and does not provide legal advice. No deletion, score change, outcome, or timeline is guaranteed. The three-bureau review and Recovery Blueprint are free before engagement. If you choose to become a client, your exact selected plan, fees, and terms appear in the secure service agreement; signing alone does not create a payment.</p>`;

    const configs = {
      1: {
        subject: hasAudit ? `We're Already Reviewing Your Report, ${firstName}` : 'Thanks for Reaching Out to Credit Comeback Club',
        body: hasAudit
          ? `<p>Our team has started reviewing the current three-bureau report you shared. The initial pass surfaced ${findings} review finding${findings === 1 ? '' : 's'} for a team member to confirm.</p>
             <p>A review finding is not a promised error, legal violation, or outcome. Once the classifications are checked, we will walk you through the free Recovery Blueprint before you decide whether to become a client.</p>`
          : sourceAwareNurtureBody(1, leadContext),
      },
      3: {
        subject: 'How CCC Chooses the Right Dispute Path',
        body: sourceAwareNurtureBody(3, leadContext),
      },
      6: {
        subject: `${firstName}, How CCC Personalizes Each Letter`,
        body: `<p>If you later become a client, the Recovery Blueprint does not turn into a generic mail merge. CCC starts from a controlled template tied to the saved account path and correct recipient.</p>
             <p>The letter is organized around <strong>Your Story. The Facts. The Pressure.</strong> That means the real personal impact, the exact information that appears inaccurate, incomplete, or inconsistent, and documented consumer-law and deadline follow-through&mdash;not a threat or promised result.</p>
             <p>A team member reviews the supported account facts, personalizes the client statement, and checks the required ID, proof of address, account screenshots, and other enclosures before correspondence is approved. Depending on the saved route, a letter may go to a bureau, a furnisher, or both when applicable.</p>
             <p>The goal is a clear, documented record tailored to the report—not a promised deletion, score change, outcome, or timeline.</p>`,
      },
      10: {
        subject: hasAudit ? `Your Report Review Is In, ${firstName}` : `${firstName}, Ready to See What's On Your Report?`,
        body: hasAudit
          ? `<p>Our team finished the first review of your three-bureau report. Here is the Recovery Blueprint summary:</p>
             <ul style="line-height:1.8;">
               <li><strong>${accountsReviewed ?? '—'}</strong> accounts reviewed</li>
               <li><strong>${accountsForReview ?? '—'}</strong> account${accountsForReview === 1 ? '' : 's'} requiring closer review</li>
               <li><strong>${findings}</strong> documented review finding${findings === 1 ? '' : 's'}</li>
             </ul>
             <p>These counts are review findings, not legal conclusions or promised results. We would like to explain the account classifications and the supported opening path for each bureau.</p>`
          : `<p>We have not received a current three-bureau report to review yet. That report lets the team compare the same account across Equifax, Experian, and TransUnion and prepare a Recovery Blueprint based on the documented facts.</p>
             <p>Choose a free consultation time when you are ready. The review comes before any decision to engage CCC.</p>`,
        cta: hasAudit ? 'Review Your Blueprint' : 'Schedule Your Free Review',
      },
      15: {
        subject: 'What Happens Before You Become a CCC Client',
        body: `<p>The current three-bureau review and Recovery Blueprint happen before engagement. We explain the documented account classifications and answer questions without creating a portal account, service agreement, or payment.</p>
             <p>If you choose to become a client, one secure wizard shows the required consumer disclosure and your service agreement, including the exact plan, fees, and terms selected for your file. The wizard also collects your government ID, proof of address, and electronic signature.</p>
             <p>Signing alone does not create a payment. If you have questions about the agreement or process, we are happy to answer them before you continue.</p>`,
      },
      21: {
        subject: 'How CCC Documents What Happens Next',
        body: `<p>If you engage CCC, each approved letter is linked to its template version, account path, personalized facts, enclosures, and mailing record. Current correspondence is sent by USPS First-Class Mail, and CCC records the send date rather than describing it as delivery confirmation.</p>
             <p>When a response or updated report arrives, a team member records the documented result for each account. Silence is not treated as proof of a deletion or correction, and the next letter is not selected until the saved evidence supports it.</p>
             <p>This recordkeeping helps the team track wins, unresolved items, and the next applicable step without promising a result or deadline.</p>`,
      },
      30: {
        subject: `Last Check-In, ${firstName}`,
        body: `<p>This is the last email in this series, so we'll keep it simple: the offer to review your credit report for free hasn't gone anywhere, and neither has our team.</p>
             <p>If now isn't the right time, no hard feelings — reply to this email any time down the road and we'll pick up right where we left off. If you'd like to talk now, the calendar link below always has open slots.</p>`,
      },
    };

    const config = configs[day] || configs[1];

    const html = branded('Your Recovery Blueprint',
      `<p style="margin:0 0 14px;">Hi ${escapeHtml(firstName)},</p>`
      + config.body
      + bookBtn(config.cta || 'Book Your Free Consultation')
      + `<p style="margin:14px 0 0;">Questions? Just reply to this email or call ${BRAND.phone}.</p>`
      + complianceFooter,
      null);

    try {
      await sendMail(clientEmail, config.subject, html);
      return { statusCode: 200, body: JSON.stringify({ sent: true }) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  // Current-report refresh reminder. Scheduling is controlled by the caller;
  // the email does not imply a guaranteed response or reporting timeline.
  if (action === 'send_report_refresh') {
    const { clientName, clientEmail } = payload;
    if (!clientEmail) return { statusCode: 400, body: JSON.stringify({ error: 'clientEmail required' }) };
    if (!emailConfigured) return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) };

    const firstName = String(clientName || 'there').split(' ')[0] || 'there';
    const html = branded('Action Requested: Upload a Current Credit Report',
      `<p style="margin:0 0 14px;">Hi ${escapeHtml(firstName)},</p>`
      + `<p style="margin:0 0 14px;">A current three-bureau report lets CCC compare the latest file with the report saved for your campaign and document what actually changed.</p>`
      + `<p style="margin:0 0 14px;">Download a new report from the provider you choose and upload the complete file through your client portal. Please include all pages for Equifax, Experian, and TransUnion.</p>`
      + `<p style="margin:0 0 14px;">An account is not treated as corrected, deleted, or unchanged until the team reviews the current report or recipient correspondence and records the documented result.</p>`
      + `<p style="margin:0;">Questions? Reply to this email or call ${BRAND.phone}.</p>`,
      { href: BRAND.portalUrl + '/login', label: 'Open Client Portal to Upload →' });

    try {
      await sendMail(clientEmail, 'Action Requested: Upload your current three-bureau report', html);
      return { statusCode: 200, body: JSON.stringify({ sent: true }) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  // Admin Notification: New Lead
  if (action === 'admin_new_lead') {
    const { leadName, leadEmail, leadPhone, tier } = payload;
    if (!emailConfigured) return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) };
    
    const adminEmail = 'chris@cccpartners.co';
    const { wrapStaffEmail } = require('./_email.cjs');
    const html = wrapStaffEmail({
      eyebrow: 'New Lead Alert',
      title: 'You have a new lead from the website!',
      rows: [
        ['Name', leadName],
        ['Email', leadEmail],
        ['Phone', leadPhone || 'Not provided'],
        ['Tier', tier || 'Not provided'],
      ],
      footer: '<p style="font-size:13px;color:#4B5563;margin:0;">They have been added to your CRM. Their preparation email will send after Calendly confirms the booking.</p>',
    });

    try {
      await sendMail(adminEmail, `🚨 New Lead: ${leadName}`, html);
      return { statusCode: 200, body: JSON.stringify({ sent: true }) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  // Automated campaign update emails
  if (action === 'send_campaign_update') {
    const { clientName, clientEmail, updateType, furnisher, details, daysElapsed } = payload;
    if (!clientEmail) return { statusCode: 400, body: JSON.stringify({ error: 'clientEmail required' }) };
    if (!emailConfigured) return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) };

    const firstName = String(clientName || 'there').split(' ')[0] || 'there';
    const recipient = escapeHtml(furnisher || 'the selected recipient');
    const configs = {
      day7_checkin: {
        subject: 'Historical Campaign — Week 1 Record',
        headline: 'A grandfathered mailing remains in review.',
        body: 'This update belongs to an earlier CCC workflow for ' + recipient + '. Its historical mailing record remains available, but this event does not describe CCC\'s current First-Class Mail process or guarantee delivery, a response date, or an outcome.',
        action: 'If you receive correspondence or an updated report, upload every page through your portal so the team can add it to the historical campaign record.',
        tone: '#EFF6FF',
        borderColor: '#BFDBFE',
      },
      day30_approaching: {
        subject: 'Historical Campaign Review Checkpoint — ' + (furnisher || 'Campaign Update'),
        headline: 'The grandfathered campaign record is ready for review.',
        body: 'This is an internal review checkpoint for the earlier mailing to ' + recipient + ', not a promised legal deadline. If no response is recorded, the team will document only that CCC has not received one; it will not infer a deletion, correction, or failure.',
        action: 'Upload every page of any correspondence or updated report so it can be compared with the original historical record.',
        tone: '#FFFBEB',
        borderColor: '#FDE68A',
      },
      day35_escalation: {
        subject: 'Historical Campaign Record — Review Underway',
        headline: 'No response is recorded from ' + recipient + '.',
        body: 'This update belongs to a grandfathered campaign. No response in CCC\'s file does not prove that none was sent and does not trigger an automatic complaint or escalation. A team member will review the available record before documenting any next step.',
        action: 'If you received correspondence CCC does not have, upload every page so the historical review is complete.',
        tone: '#F0FDF4',
        borderColor: '#BBF7D0',
      },
      ccc_day7_checkin: {
        subject: 'Your CCC Dispute Campaign — Mailing Update',
        headline: 'The mailing record has been saved.',
        body: 'Your current-method correspondence to ' + recipient + ' was sent by USPS First-Class Mail, and CCC recorded the send date. First-Class Mail does not include delivery confirmation or a signed receipt.',
        action: 'Keep any correspondence or updated report you receive and upload every page through your CCC portal.',
        tone: '#EFF6FF',
        borderColor: '#BFDBFE',
      },
      ccc_day30_review: {
        subject: 'Your CCC Campaign — Review Checkpoint',
        headline: 'CCC is reviewing the documented record.',
        body: 'This is an operational review checkpoint for the letter to ' + recipient + ', not a guaranteed response date or outcome. CCC will not infer a result from silence or a mailing scan.',
        action: 'Upload every page of any response or current report so the team can record the documented outcome and choose an applicable next step.',
        tone: '#FFFBEB',
        borderColor: '#FDE68A',
      },
    };

    const cfg = configs[updateType];
    if (!cfg) return { statusCode: 400, body: JSON.stringify({ error: 'Unknown updateType: ' + updateType }) };

    const html = branded('Campaign Update',
      `<h1 style="font-size:20px;color:#1B2A4A;margin:0 0 16px;">${escapeHtml(cfg.headline)}</h1>`
      + `<p style="font-size:13px;color:#374151;margin:0 0 16px;">${cfg.body}</p>`
      + `<div style="background:${cfg.tone};border:1px solid ${cfg.borderColor};border-radius:6px;padding:14px 16px;margin:0 0 8px;">`
      + `<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#374151;font-weight:600;margin-bottom:4px;">Your Action</div>`
      + `<p style="font-size:12px;color:#374151;margin:0;">${cfg.action}</p></div>`
      + `<p style="font-size:12px;color:#6B7280;margin:16px 0 0;">Questions? Reply to this email or call ${BRAND.phone}.</p>`);

    try {
      await sendMail(clientEmail, cfg.subject, html);
      return { statusCode: 200, body: JSON.stringify({ sent: true }) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  // Educational email series
  if (action === 'send_lead_drip') {
    const { leadName, leadEmail, emailNumber } = payload;
    if (!leadEmail) return { statusCode: 400, body: JSON.stringify({ error: 'leadEmail required' }) };
    if (!emailConfigured) return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) };

    const firstName = String(leadName || 'there').split(' ')[0] || 'there';

    const drips = {
      1: {
        subject: 'Thanks for reaching out to Credit Comeback Club',
        headline: 'Your free three-bureau review comes first.',
        content: '<p>Hi ' + escapeHtml(firstName) + ', thank you for your interest in Credit Comeback Club.</p>'
          + '<p>Before engagement, CCC reviews a current report containing Equifax, Experian, and TransUnion and prepares a Recovery Blueprint. A team member checks the account classifications before explaining the supported opening path.</p>'
          + '<p>The review and Blueprint are free, and they do not create a portal account, service agreement, or payment.</p>'
          + '<p>Reply to this email or call ' + BRAND.phone + ' with any questions.</p>',
      },
      2: {
        subject: 'How CCC Chooses an Account-Specific Path',
        headline: 'The report facts determine the route.',
        content: '<p>There is no single dispute path for every account. CCC compares the reporting across all three bureaus and builds the Recovery Blueprint around <strong>Your Story. The Facts. The Pressure.</strong></p>'
          + '<p>Your Story captures the real personal impact. The Facts identify the exact information that appears inaccurate, incomplete, or inconsistent. The Pressure is documented consumer-law and deadline follow-through with the correct recipient—not a threat or a promised result.</p>'
          + '<p>If you engage CCC, that saved route determines whether correspondence goes to a bureau, a furnisher, or both when applicable. A team member works from controlled templates, personalizes the supported facts and client statement, and checks the required enclosures before approval.</p>'
          + '<p>No deletion, score change, outcome, or timeline is guaranteed.</p>',
      },
      3: {
        subject: 'What the CCC Process Looks Like',
        headline: 'From report review to a documented outcome.',
        content: '<p><strong>First:</strong> CCC reviews your current three-bureau report and prepares a staff-reviewed Recovery Blueprint before engagement.</p>'
          + '<p><strong>If you choose to enroll:</strong> One secure wizard presents the required consumer disclosure and service agreement, collects your ID and proof of address, and records your signature.</p>'
          + '<p><strong>During service:</strong> The team prepares personalized correspondence from the saved account paths, reviews each mailing packet, sends approved letters by USPS First-Class Mail, and records send dates.</p>'
          + '<p><strong>Afterward:</strong> Uploaded responses and current reports are reviewed account by account. CCC documents what happened before choosing another applicable step.</p>',
      },
      4: {
        subject: 'Ready for Your Free Three-Bureau Review?',
        headline: 'A current report is the starting point.',
        content: '<p>' + escapeHtml(firstName) + ', when you are ready, provide your most recent complete three-bureau credit report showing Equifax, Experian, and TransUnion.</p>'
          + '<p>CCC uses that report to prepare a free Recovery Blueprint. Secure onboarding is sent only if you decide to become a client after the team explains the Blueprint.</p>'
          + '<p>Reply to this email or call ' + BRAND.phone + ' with questions.</p>',
      },
      5: {
        subject: 'Still Thinking It Over?',
        headline: 'No pressure — just here when you\'re ready.',
        content: '<p>Hi ' + escapeHtml(firstName) + ', this is one last check-in. The free three-bureau review and Recovery Blueprint are available whenever the timing is right for you.</p>'
          + '<p>If you later enroll, CCC preserves the template version, account path, personalized letter, packet enclosures, send date, and documented response or report result. First-Class Mail does not include delivery confirmation, and CCC does not infer an outcome from silence.</p>'
          + '<p>Reply to this email or call ' + BRAND.phone + ' if you have questions. No deletion, score change, outcome, or timeline is guaranteed.</p>',
      },
    };

    const drip = drips[emailNumber];
    if (!drip) return { statusCode: 400, body: JSON.stringify({ error: 'Unknown emailNumber: ' + emailNumber }) };

    const html = branded('Credit Comeback Club',
      `<h1 style="font-size:20px;color:#1B2A4A;margin:0 0 20px;line-height:1.3;">${drip.headline}</h1>`
      + `<div style="font-size:13px;color:#374151;line-height:1.7;">${drip.content}</div>`,
      null);

    try {
      await sendMail(leadEmail, drip.subject, html);
      return { statusCode: 200, body: JSON.stringify({ sent: true }) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  if (action === 'send_educational') {
    const { clientName, clientEmail, emailNumber } = payload;
    if (!clientEmail) return { statusCode: 400, body: JSON.stringify({ error: 'clientEmail required' }) };
    if (!emailConfigured) return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) };

    const firstName = String(clientName || 'there').split(' ')[0] || 'there';

    const emails = {
      1: {
        subject: 'How CCC Reads a Three-Bureau Credit Report',
        headline: 'The same account can tell three different stories.',
        content: '<p>A complete three-bureau report lets the team compare how an account appears with Equifax, Experian, and TransUnion. We review identity information, account type, ownership, status, balance, dates, payment history, remarks, and collection details in context.</p>'
          + '<p>A difference is a review lead, not automatically an error or legal violation. A team member checks the report facts before the account classification becomes part of the Recovery Blueprint.</p>'
          + '<p>The goal is to start from documented information, connect it to the real personal impact, and choose the supported account path and recipient.</p>',
      },
      2: {
        subject: 'Why the Dispute Route Matters',
        headline: 'The recipient and account facts must match.',
        content: '<p>A bureau dispute and direct correspondence to a furnisher serve different purposes. The saved Recovery Blueprint tells the team which recipient and path apply to each account and bureau.</p>'
          + '<p>CCC uses controlled templates tied to the saved account path and recipient. A staff member personalizes the supported facts and client statement, then checks the required ID, proof of address, account screenshots, and other enclosures before approval.</p>'
          + '<p>That staff-reviewed record makes follow-up consistent without turning the letter into a generic form or promising a result.</p>',
      },
      3: {
        subject: 'What Happens After a CCC Letter Is Mailed',
        headline: 'Send dates and documented responses guide the next step.',
        content: '<p>Current CCC correspondence is sent by USPS First-Class Mail. CCC records the send date for each letter, but First-Class Mail does not include delivery confirmation or a signed receipt.</p>'
          + '<p>If correspondence or an updated report arrives, upload every page through the portal. A team member compares it with the exact letter, account facts, enclosures, and template version saved for that mailing.</p>'
          + '<p>No response recorded in CCC does not prove that no response was sent and does not automatically trigger a complaint, escalation, deletion, or correction. The available evidence is reviewed before any next step is selected.</p>',
      },
      4: {
        subject: 'Your Credit Score: What Moves It and What Doesn\'t',
        headline: 'A score is one model\'s reading of one report at one time.',
        content: '<p>Credit scores can differ because lenders and consumer services may use different reports, scoring models, versions, and dates.</p>'
          + '<p>Payment history, balances and utilization, account age, account mix, and recent applications can matter, but the weight and effect of any one change vary by file and model.</p>'
          + '<p>A dispute, correction, or deletion does not guarantee a particular score movement. CCC records documented report outcomes; it does not predict the score a specific lender will use.</p>',
      },
      5: {
        subject: 'Credit Habits You Control During a Dispute Campaign',
        headline: 'The dispute record is only one part of the file.',
        content: '<p>While CCC documents your dispute campaign, continue managing the parts of your credit profile you control.</p>'
          + '<ul><li>Pay current obligations on time.</li><li>Review balances and available credit before making new applications.</li><li>Read statements and report correspondence carefully.</li><li>Keep copies of documents you upload to CCC.</li><li>Check that any credit product fits your budget and goals before applying.</li></ul>'
          + '<p>This is general education, not financial or legal advice. No product, account, dispute, or report change guarantees a score outcome.</p>',
      },
    };

    const email = emails[emailNumber];
    if (!email) return { statusCode: 400, body: JSON.stringify({ error: 'Unknown emailNumber: ' + emailNumber }) };

    const html = branded('Credit Education Series',
      `<p style="color:#9CA3AF;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin:0 0 4px;">Hi ${escapeHtml(firstName)},</p>`
      + `<h1 style="font-size:20px;color:#1B2A4A;margin:0 0 20px;line-height:1.3;">${email.headline}</h1>`
      + `<div style="font-size:13px;color:#374151;line-height:1.7;">${email.content}</div>`
      + `<p style="font-size:12px;color:#6B7280;margin:16px 0 0;">Questions? Reply here or call ${BRAND.phone}.</p>`);

    try {
      await sendMail(clientEmail, email.subject, html);
      return { statusCode: 200, body: JSON.stringify({ sent: true }) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  if (action === 'affiliate_welcome') {
    const { affiliateName, affiliateEmail, companyName, commissionRate } = payload;
    if (!emailConfigured || !affiliateEmail) return { statusCode: 400, body: JSON.stringify({ error: 'Missing fields' }) };
    const subject = 'Welcome to the Credit Comeback Club Partner Program';
    const commPct = Math.round((commissionRate || 0.20) * 100);
    const html = branded('Partner Program',
      `<p style="margin:0 0 14px;">Hi ${escapeHtml(affiliateName)},</p>`
      + `<p style="margin:0 0 14px;">Welcome to the Credit Comeback Club partner program${companyName ? ' on behalf of ' + escapeHtml(companyName) : ''}. We&rsquo;re excited to work with you.</p>`
      + `<h3 style="color:#1B2A4A;font-size:14px;margin:24px 0 8px;">How it works:</h3>`
      + `<ol style="padding-left:18px;line-height:1.8;font-size:13px;color:#444;"><li>Submit a referral through your partner portal</li><li>CCC offers the prospect a free current three-bureau review and staff-reviewed Recovery Blueprint before engagement</li><li>If the prospect chooses to become a client, CCC sends the secure service-agreement and document wizard</li><li>During service, staff reviews personalized correspondence built around the client&rsquo;s story, exact report facts, and documented follow-through; sends approved letters by USPS First-Class Mail; and records responses and report outcomes</li><li>Track referrals and commission status in your portal</li></ol>`
      + `<h3 style="color:#1B2A4A;font-size:14px;margin:24px 0 8px;">Plans and commission:</h3>`
      + `<p style="font-size:13px;color:#444;margin:0 0 14px;">Each client&rsquo;s exact selected plan, fees, and terms appear in that client&rsquo;s secure service agreement. Do not quote a plan or price from this email.</p>`
      + `<p style="font-size:13px;color:#444;margin:0 0 14px;">Your saved partner terms currently use a ${commPct}% rate for eligible revenue that clears. The partner portal is the authoritative record of eligible transactions, earned commission, and payouts.</p>`
      + `<p style="font-size:12px;color:#6B7280;margin:0 0 14px;">CCC does not guarantee a deletion, score change, outcome, or timeline for any referred prospect or client.</p>`
      + `<p style="font-size:13px;color:#444;margin:0 0 14px;">Your portal access link was sent separately via magic link.</p>`
      + `<p style="font-size:13px;color:#444;margin:0;">Questions? Reply to this email or reach CCC at <a href="mailto:info@creditcomebackclub.com" style="color:#1B2A4A;">info@creditcomebackclub.com</a> or ${BRAND.phone}.</p>`,
      null);
    await sendMail(affiliateEmail, subject, html);
    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  }

  if (action === 'affiliate_new_referral') {
    const referral = payload._verifiedAffiliateReferral;
    const affiliateName = referral.affiliate.name || 'Affiliate';
    const companyName = referral.affiliate.company || null;
    const clientName = referral.client.name || 'New client';
    const clientEmail = referral.client.email || '';
    const clientPhone = referral.client.phone || null;
    const clientNotes = referral.client.notes || null;
    if (!emailConfigured) return { statusCode: 400, body: JSON.stringify({ error: 'Missing RESEND_API_KEY' }) };
    const subject = 'New Referral from ' + (companyName || affiliateName) + ' — ' + clientName;
    const { wrapStaffEmail } = require('./_email.cjs');
    const html = wrapStaffEmail({
      eyebrow: (companyName || affiliateName) + ' → Credit Comeback Club',
      title: 'New Partner Referral',
      rows: [
        ['From', affiliateName + (companyName ? ' (' + companyName + ')' : '')],
        ['Name', clientName],
        ['Email', clientEmail],
        ['Phone', clientPhone || '—'],
        ['Notes', clientNotes || '—'],
      ],
      footer: '<p style="font-size:13px;color:#444;margin:0;">Log in to the admin dashboard to prepare the free three-bureau review and Recovery Blueprint. Send secure onboarding only if the prospect chooses to become a client after the Blueprint is explained.</p>',
    });
    await sendMail('creditcomebackclub@gmail.com', subject, html);
    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action: ' + action }) };
};
