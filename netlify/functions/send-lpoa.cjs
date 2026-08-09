const { sendEmail, isConfigured, wrapClientEmail, escapeHtml, BRAND } = require('./_email.cjs');

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
      ? `Thanks for your interest in <strong>${tier}</strong>. Your request is in, and the next step is a free consultation so we can review your file, answer questions, and confirm the best path before enrollment.`
      : 'Thanks for requesting a free consultation. Choose a time below and we\'ll review your goals and the information on your credit report with you.';
    const html = branded('Consultation Request Received',
      `<p style="margin:0 0 14px;">Hi ${escapeHtml(clientName)},</p>`
      + `<p style="margin:0 0 14px;">${intro}</p>`
      + `<p style="margin:0;font-size:12px;color:#6B7280;">No portal account, authorization, or payment is created from this request. We'll send secure onboarding steps only if you choose to move forward after the consultation.</p>`
      + `<p style="margin:14px 0 0;font-size:12px;color:#6B7280;">Questions? Reply to this email or call ${BRAND.phone}.</p>`,
      { href: 'https://calendly.com/creditcomebackclub/30min', label: 'Choose Your Time →' });

    try {
      await sendMail(clientEmail, subject, html);
      return { statusCode: 200, body: JSON.stringify({ sent: true }) };
    } catch (e) {
      console.error('Email error:', e.message);
      return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
  }

  if (action === 'send_consultation_booked') {
    const { clientName, clientEmail, tier, portalInvited } = payload;
    if (!clientEmail) return { statusCode: 400, body: JSON.stringify({ error: 'clientEmail required' }) };
    if (!emailConfigured) return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) };
    const firstName = String(clientName || 'there').split(' ')[0];
    const enrollment = tier && tier !== 'Consultation';
    const subject = enrollment
      ? `You're Booked, ${firstName} — Let's Get Your File Ready`
      : `You're Booked, ${firstName} — How to Prepare for Your Credit Review`;
    const preparation = enrollment
      ? `<p>We know you&rsquo;re ready to get moving. Before any campaign begins, we first complete a detailed forensic audit so you can see the FCRA compliance issues, Metro 2 reporting errors, and the exact strategy we recommend.</p>
         ${portalInvited ? `<p>We sent a separate secure portal invitation. If you want to hit the ground running before the call, you can:</p>
         <ol style="line-height:1.8;"><li>Upload your newest three-bureau credit report.</li><li>Connect your credit-monitoring account so we can review current data and track future changes.</li><li>Review the Limited Power of Attorney (LPOA). It is a limited authorization allowing Credit Comeback Club to communicate and prepare dispute correspondence on your behalf if you choose to proceed; it does not give us control of your money, credit accounts, or financial decisions.</li></ol>
         <p>These steps are optional before the call, but completing them early lets us spend more of the consultation on findings and strategy.</p>` : `<p>Please have your newest three-bureau credit report ready. We&rsquo;ll send secure portal-onboarding instructions separately.</p>`}`
      : `<p>We&rsquo;re looking forward to reviewing your file. Please have a copy of your newest credit report available&mdash;ideally a current three-bureau report showing Equifax, Experian, and TransUnion.</p>
         <p>During the consultation, we&rsquo;ll walk through the file at a forensic level: potential FCRA compliance issues, Metro 2 reporting errors, which items may warrant documented disputes, and how Credit Comeback Club may be able to help. Bring any questions and recent correspondence you&rsquo;ve received from creditors, collectors, or the bureaus.</p>`;
    const html = branded('Your Consultation Is Booked',
      `<p style="margin:0 0 14px;">Hi ${escapeHtml(firstName)},</p>`
      + `<p style="margin:0 0 14px;">Your consultation is on the calendar, and we&rsquo;re eager to take a close look at your file.</p>`
      + preparation
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
    const html = branded('Welcome to your client portal',
      `<p style="margin:0 0 14px;">Hi ${escapeHtml(clientName)},</p>`
      + `<p style="margin:0 0 14px;">Your client portal is ready. Use the secure sign-in link below to complete onboarding, review your audit, and follow your campaign.</p>`
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

    const html = branded('Your Forensic Audit is Ready', paragraphs, null);

    const attachments = attachmentBase64 ? [{
      content: attachmentBase64,
      filename: attachmentFilename || 'forensic-audit.pdf',
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

    const subjects = {
      phase1_mailed: 'Your Dispute Letter Has Been Mailed — ' + furnisher,
      phase1_delivered: 'Dispute Letter Delivered — ' + furnisher + ' Has 30 Days to Respond',
      phase2_analyzed: 'Response Analysis Complete — ' + furnisher,
      phase3_mailed: 'Credit Bureau Dispute Mailed — ' + furnisher,
    };

    const bodies = {
      phase1_mailed: `<p>Your direct dispute letter to <strong>${furnisher}</strong> has been mailed via USPS Certified Mail.</p>
        ${trackingNumber ? `<p>Track your letter: <a href="https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}" style="color:#1B2A4A;">USPS Tracking ${trackingNumber.slice(-8)}</a></p>` : ''}
        <p>The furnisher has 30 days from delivery to respond. We will monitor the response and notify you of next steps.</p>`,
      phase1_delivered: `<p>Your dispute letter to <strong>${furnisher}</strong> has been delivered. Their 30-day response window has begun.</p>
        <p>We will monitor for a response. A trained reviewer will evaluate the evidence and decide the appropriate next step.</p>`,
      phase2_analyzed: `<p>We have analyzed <strong>${furnisher}</strong>'s response to your dispute letter.</p>
        <p>${details || 'A trained reviewer is documenting the result and the appropriate next campaign step.'}</p>`,
      phase3_mailed: `<p>Credit bureau dispute letters have been mailed to the bureaus selected for this account regarding <strong>${furnisher}</strong>.</p>
        <p>We will track each response window and review the evidence before choosing another step.</p>`,
    };

    const html = branded('Campaign Update',
      `<p style="margin:0 0 14px;">Hi ${escapeHtml(clientName)},</p>`
      + (bodies[phase] || '<p style="margin:0 0 14px;">' + (details || 'Your dispute campaign has been updated.') + '</p>')
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
    const { clientName, clientEmail, day } = payload;
    if (!clientEmail) return { statusCode: 400, body: JSON.stringify({ error: 'clientEmail required' }) };
    if (!emailConfigured) return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) };

    const firstName = clientName.split(' ')[0] || clientName;
    const configs = {
      1: {
        subject: 'Next Step: Finish Setting Up Your CCC Account',
        body: `<p>Your Credit Comeback Club portal is ready. The only thing standing between you and your forensic audit is two quick steps: sign your LPOA and connect your credit monitoring so we can pull your report.</p>`,
      },
      2: {
        subject: 'Quick Reminder — Your Portal Is Waiting',
        body: `<p>Just a friendly nudge — your account is set up, but we still need your signed LPOA and monitoring credentials before your file can move forward. It takes about five minutes.</p>`,
      },
      4: {
        subject: 'Don\'t Lose Momentum — Finish Onboarding',
        body: `<p>It's been a few days since we sent your portal access. Every day this sits unfinished is a day we can't start your audit. Log in and knock out the last two steps — LPOA and monitoring — so we can get to work.</p>`,
      },
      7: {
        subject: 'Final Notice: Your File Is On Hold',
        body: `<p>We still haven't received your signed LPOA or monitoring connection, so your file is on hold. If something's in the way — a question, a technical issue, anything — just reply to this email and we'll sort it out together. Otherwise, please log in and finish these two steps so we can begin.</p>`,
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
    const { clientName, clientEmail, day, auditSummary } = payload;
    if (!clientEmail) return { statusCode: 400, body: JSON.stringify({ error: 'clientEmail required' }) };
    if (!emailConfigured) return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) };

    const firstName = (clientName || '').split(' ')[0] || clientName;
    const hasAudit = !!(auditSummary && auditSummary.totalViolations != null);
    const v = hasAudit ? auditSummary.totalViolations : null;
    const targeted = hasAudit ? auditSummary.accountsTargeted : null;
    const scanned = hasAudit ? auditSummary.accountsScanned : null;

    const bookBtn = (label) => `<div style="text-align:center;margin:32px 0;">
        <a href="https://calendly.com/creditcomebackclub/30min" style="background:#1B2A4A;color:#C9A84C;padding:14px 32px;text-decoration:none;border-radius:4px;font-weight:bold;font-size:14px;display:inline-block;">${label} &#8594;</a>
      </div>`;

    const testimonial = (quote, name, result) => `<div style="background:#F5F9FD;border-left:3px solid #C9A84C;padding:16px 20px;margin:20px 0;border-radius:0 4px 4px 0;">
        <p style="font-style:italic;color:#333;margin:0 0 10px;font-size:14px;line-height:1.6;">"${quote}"</p>
        <p style="margin:0;font-size:12.5px;font-weight:bold;color:#1B2A4A;">${name} <span style="font-weight:normal;color:#666;">— ${result}</span></p>
      </div>`;

    const complianceFooter = `<p style="font-size:10.5px;color:#999;line-height:1.5;">Individual results vary. No specific outcome is guaranteed and results depend on your credit history, furnisher responses, and other factors outside our control. We do not charge until after your free consultation and a service agreement is executed.</p>`;

    const configs = {
      1: {
        subject: hasAudit ? `We're Already Reviewing Your Report, ${firstName}` : 'Thanks for Reaching Out to Credit Comeback Club',
        body: hasAudit
          ? `<p>Good news — our team has already started reviewing the credit report you shared. So far we've flagged ${v} potential furnisher-level issue${v === 1 ? '' : 's'} worth a closer look.</p>
             <p>Before we go further, we'd like to walk you through exactly what we found and what your options are — no cost, no obligation.</p>`
          : `<p>Thanks for downloading our free dispute guide and reaching out. Here's exactly what happens next: we'll review your credit report for furnisher-level reporting errors — the kind that can be legally challenged directly with the company that reported them, not just the credit bureau.</p>
             <p>The fastest way to find out what's on your file is a free 15-minute call. No pressure, no cost.</p>`,
      },
      3: {
        subject: 'Why We Go After the Furnisher, Not the Bureau',
        body: `<p>Most people think disputing a credit report means arguing with Equifax, Experian, or TransUnion. That's rarely where the real leverage is.</p>
             <p>Every account on your report is reported by a furnisher — a bank, collector, or lender — who is legally required to report it accurately under the Fair Credit Reporting Act. When they don't (wrong balance, wrong status, mismatched dates between bureaus), that's a direct violation we can challenge at the source.</p>
             <p>That's the entire strategy behind our free guide, and it's what we look for on every report we review.</p>`,
      },
      6: {
        subject: `${firstName}, Here's What Results Actually Look Like`,
        body: `<p>We know it's fair to be skeptical of credit repair — there's a lot of noise in this industry. So instead of telling you, here's what a couple of real clients said:</p>
             ${testimonial('Went from a 498 to a 641 in under 6 months. I\'ve used two other credit repair services before and neither came close. Chris goes after the creditors directly — that\'s what makes the difference.', 'Robert Carter', '498 → 641 in 6 Months')}
             ${testimonial('What made Credit Comeback Club different was the education piece. Chris doesn\'t just send letters and collect a check — he explains what creditors are doing wrong and why they\'re obligated to fix it.', 'Jasmine Wallace', '110 Points — and the Knowledge Too')}
             <p>If you'd like to see what your own report shows, we're happy to take a look — free of charge.</p>`,
      },
      10: {
        subject: hasAudit ? `Your Report Review Is In, ${firstName}` : `${firstName}, Ready to See What's On Your Report?`,
        body: hasAudit
          ? `<p>Our team finished reviewing your credit report. Here's the summary:</p>
             <ul style="line-height:1.8;">
               <li><strong>${scanned || '—'}</strong> accounts scanned</li>
               <li><strong>${targeted || '—'}</strong> account${targeted === 1 ? '' : 's'} identified as a dispute target</li>
               <li><strong>${v}</strong> specific violation${v === 1 ? '' : 's'} found</li>
             </ul>
             <p>A "violation" here means a furnisher reported something — a balance, a status, a date — that's inaccurate or inconsistent between bureaus. Those are exactly the kind of errors we can challenge directly with the company that reported them.</p>
             <p>We'd like to walk you through what we found and what a strategy for your specific file would look like.</p>`
          : `<p>We haven't had a chance to look at your credit report yet — and we'd genuinely like to. Most reports we review have at least a handful of furnisher-level errors that most people never notice.</p>
             <p>It takes 15 minutes on the phone to find out what's really on your file.</p>`,
        cta: 'See What We Found',
      },
      15: {
        subject: 'The Question Everyone Asks Before Signing Up',
        body: `<p>The most common thing we hear from people considering credit repair is some version of: "How do I know this actually works, and how do I know I'm not wasting money?"</p>
             <p>Fair question. Under federal law (the Telemarketing Sales Rule), credit repair companies like ours legally cannot charge you until after services are delivered. We don't get paid up front for promises — we do the work first. You can also cancel anytime, no long-term contract.</p>
             <p>If you've been on the fence, this is usually the piece that changes people's minds. Happy to answer any other questions on a free call.</p>`,
      },
      21: {
        subject: 'One More Reason to Stop Waiting',
        body: `<p>Errors on a credit report don't fix themselves — they sit there, month after month, unless someone actually challenges them. Here's what that challenge looked like for two more clients:</p>
             ${testimonial('In less than six months, Chris helped me boost my credit score by over 150 points. If you\'re looking for someone who truly cares and delivers results, Chris Holland is the real deal.', 'Elizabeth Holland', '150+ Points in 6 Months')}
             ${testimonial('My husband and I both signed up because we\'re trying to buy our first home. Chris worked both files simultaneously. We\'re both now over 680 and meeting with a mortgage lender next month.', 'Darius & Monique Barnes', 'Both Over 680')}
             <p>Every month those errors stay unchallenged is a month they can keep affecting you. Let's talk about your file.</p>`,
      },
      30: {
        subject: `Last Check-In, ${firstName}`,
        body: `<p>This is the last email in this series, so we'll keep it simple: the offer to review your credit report for free hasn't gone anywhere, and neither has our team.</p>
             <p>If now isn't the right time, no hard feelings — reply to this email any time down the road and we'll pick up right where we left off. If you'd like to talk now, the calendar link below always has open slots.</p>`,
      },
    };

    const config = configs[day] || configs[1];

    const html = branded('Strategic Credit Repair',
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

  // 35-Day Report Refresh Reminder
  if (action === 'send_report_refresh') {
    const { clientName, clientEmail } = payload;
    if (!clientEmail) return { statusCode: 400, body: JSON.stringify({ error: 'clientEmail required' }) };
    if (!emailConfigured) return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) };

    const firstName = clientName.split(' ')[0] || clientName;
    const html = branded('Action Required: New Credit Report Due',
      `<p style="margin:0 0 14px;">Hi ${escapeHtml(firstName)},</p>`
      + `<p style="margin:0 0 14px;">It's been 35 days since your last credit report audit! To keep your dispute campaign moving forward and check for any deleted negative items, we need you to upload your newest credit report.</p>`
      + `<p style="margin:0 0 14px;">Please log into your SmartCredit or IdentityIQ account, download your new 3-bureau report, and upload it directly into your client portal.</p>`
      + `<p style="margin:0 0 14px;">If you're having trouble downloading your report, you can also update your credentials in the portal and we will pull it for you.</p>`
      + `<p style="margin:0;">Questions? Reply to this email or call ${BRAND.phone}.</p>`,
      { href: BRAND.portalUrl + '/login', label: 'Open Client Portal to Upload →' });

    try {
      await sendMail(clientEmail, 'Action Required: Upload your new credit report', html);
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

    const firstName = clientName.split(' ')[0] || clientName;
    const configs = {
      day7_checkin: {
        subject: 'Your Dispute Campaign — Week 1 Update',
        headline: 'Your letters are in transit.',
        body: 'Your certified dispute letters are currently in transit to ' + (furnisher || 'your creditors') + '. The furnisher has 30 days from delivery to respond with a substantive investigation. No action is needed on your part right now.',
        action: 'Do nothing. If a creditor contacts you directly, do not respond — forward any correspondence to creditcomebackclub@gmail.com.',
        tone: '#EFF6FF',
        borderColor: '#BFDBFE',
      },
      day30_approaching: {
        subject: 'Response Deadline Approaching — ' + (furnisher || 'Your Dispute'),
        headline: 'The 30-day response window is closing.',
        body: furnisher + ' has approximately ' + Math.max(0, 30 - (daysElapsed || 28)) + ' days remaining in the tracked response window. If no response is logged, staff will document the nonresponse and review the account evidence.',
        action: 'No action is needed unless you receive correspondence. If you do, send us every page so it can be reviewed with the original dispute.',
        tone: '#FFFBEB',
        borderColor: '#FDE68A',
      },
      day35_escalation: {
        subject: 'Response Window Closed — Review Underway',
        headline: 'No response has been logged from ' + furnisher + '.',
        body: 'The tracked response window has closed without a response in your file. We are documenting that nonresponse and reviewing the original dispute, delivery record, and account evidence before selecting any next step.',
        action: 'No action is needed unless you received correspondence we do not have. If so, send us every page so the review is complete.',
        tone: '#F0FDF4',
        borderColor: '#BBF7D0',
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

    const firstName = leadName.split(' ')[0] || leadName;

    const drips = {
      1: {
        subject: 'Thanks for reaching out to Credit Comeback Club',
        headline: 'We received your request — here\'s what happens next.',
        content: '<p>Hi ' + firstName + ', thank you for your interest in Credit Comeback Club. We prepare evidence-specific credit disputes rather than generic templates.</p>'
          + '<p>We perform a line-by-line forensic review of your credit report, including consistency checks informed by the Metro 2 industry reporting standard. A Metro 2 difference is not automatically a legal violation, so staff reviews the report facts and applicable law before building a dispute strategy.</p>'
          + '<p><strong>What\'s next:</strong> If you haven\'t already, upload your 3-bureau credit report and we\'ll walk you through what we find — no cost, no obligation.</p>'
          + '<p>Reply to this email or call 970-644-0063 with any questions.</p>',
      },
      2: {
        subject: 'What Makes a Dispute Actually Work',
        headline: 'Why most credit repair fails — and what we do differently.',
        content: '<p>Credit-report disputes can follow different legal paths. A dispute sent to a consumer reporting agency and a direct dispute sent to the company furnishing the information are not interchangeable, and each path has its own duties and evidence requirements.</p>'
          + '<p>Repeating a generic letter without addressing the account data or the recipient\'s response can weaken the record.</p>'
          + '<p><strong>Our approach is evidence-first.</strong> We compare the reporting across bureaus, identify supported factual inconsistencies, and choose the recipient for each round based on the reviewed record. A direct furnisher dispute is framed under the direct-dispute rules; a bureau dispute is framed under the CRA reinvestigation rules.</p>'
          + '<p>If a bureau later notifies a furnisher of a dispute, the furnisher\'s separate duties under 15 U.S.C. §1681s-2(b) may apply. We document what was sent, what came back, and what the evidence supports before recommending another step.</p>',
      },
      3: {
        subject: 'A Real Example: How the Process Works',
        headline: 'From audit to dispute to resolution.',
        content: '<p>Here\'s what the process actually looks like once you start:</p>'
          + '<p><strong>Step 1 — Forensic Audit.</strong> We analyze your 3-bureau report field by field, identifying specific Metro 2 violations — things like charge-off accounts still reporting active past-due balances (a logical impossibility), cross-bureau data conflicts, or missing dispute flags.</p>'
          + '<p><strong>Step 2 — Staff-selected dispute round.</strong> We prepare account-specific letters for the furnisher or selected credit bureaus, preserve the evidence sent, and track a 30-day review window.</p>'
          + '<p><strong>Step 3 — Forensic response review.</strong> We compare any response or documented nonresponse with the exact letter and supporting record. Staff then decides whether the account is resolved, needs documents, warrants another round, or is ready for a separately reviewed escalation.</p>'
          + '<p>Every step is documented, tracked, and visible to you in a client portal built specifically for this process.</p>',
      },
      4: {
        subject: 'Ready to Start Your Case?',
        headline: 'Let\'s get your forensic audit built.',
        content: '<p>' + firstName + ', if you\'re ready to move forward, here\'s what we need:</p>'
          + '<ul><li>Your most recent 3-bureau credit report (Equifax, Experian, TransUnion)</li><li>A signed Limited Power of Attorney authorizing us to act on your behalf for credit dispute purposes only</li></ul>'
          + '<p>Once we have both, we build your forensic audit, identify supported issues in your file, and prepare the first staff-selected dispute round.</p>'
          + '<p>Reply to this email or call 970-644-0063 and we\'ll get you started today.</p>',
      },
      5: {
        subject: 'Still Thinking It Over?',
        headline: 'No pressure — just here when you\'re ready.',
        content: '<p>Hi ' + firstName + ', wanted to check in one more time. When a dispute round is mailed, we preserve the mailing record and track its response-review window so later decisions are based on a documented timeline.</p>'
          + '<p>There\'s no cost to get your forensic audit built and reviewed with you. If you have questions about the process, your specific accounts, or anything else — just reply to this email or call 970-644-0063.</p>'
          + '<p>We\'re here whenever you\'re ready.</p>',
      },
    };

    const drip = drips[emailNumber];
    if (!drip) return { statusCode: 400, body: JSON.stringify({ error: 'Unknown emailNumber: ' + emailNumber }) };

    const html = branded('Forensic Credit Dispute Services',
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

    const firstName = clientName.split(' ')[0] || clientName;

    const emails = {
      1: {
        subject: 'What Is Metro 2 and Why Does It Matter For Your Credit?',
        headline: 'The reporting standard creditors are supposed to follow — but often don\'t.',
        content: '<p>Metro 2 is an industry reporting format used to organize account data furnished to Equifax, Experian, and TransUnion.</p>'
          + '<p>Its fields and relationships help trained reviewers spot information that may be incomplete, internally inconsistent, or inconsistent across bureaus.</p>'
          + '<p><strong>Why context matters:</strong> A Metro 2 formatting or consistency issue is not automatically an FCRA violation. We compare the reported fields with the rest of the file and any available account evidence before deciding whether a factual or legal dispute is supported.</p>'
          + '<p><strong>What this means for you:</strong> Findings from the forensic audit are review leads. Staff verifies the support, selects the correct dispute route, and asks the recipient to investigate the specific information identified.</p>',
      },
      2: {
        subject: 'Why Generic Credit Repair Doesn\'t Work',
        headline: 'Why evidence-specific disputes matter.',
        content: '<p>Credit bureaus and furnishers process a high volume of disputes, and a generic letter may not clearly identify the account-level facts that require investigation.</p>'
          + '<p>A useful record ties each issue to the reporting, states what is disputed, preserves the documents sent, and evaluates the recipient\'s actual response.</p>'
          + '<p><strong>What we do:</strong> Staff chooses whether a round goes to the furnisher or selected credit bureaus. Direct disputes use the applicable direct-dispute framework; CRA disputes use the bureau reinvestigation framework. We do not treat those duties as interchangeable.</p>'
          + '<p>Our forensic review compares the reporting, the account evidence, and the response received. We use the legal framework that applies to the actual dispute route and facts rather than promising a predetermined result.</p>'
          + '<p>That evidence-first review is the foundation of every letter we send on your behalf.</p>',
      },
      3: {
        subject: 'Understanding Your 30-Day Window',
        headline: 'What happens after your letters are delivered.',
        content: '<p>Once your certified dispute letters are delivered, we track a 30-day response-review window and preserve the delivery record with the account file.</p>'
          + '<p><strong>Our response review asks:</strong></p>'
          + '<ul><li>Did the response address the specific facts raised?</li><li>Does it identify meaningful support for the stated result?</li><li>Did any reported information change?</li><li>Is more documentation needed before staff can choose a next step?</li></ul>'
          + '<p><strong>What usually happens:</strong></p>'
          + '<ul><li><strong>Form letter response:</strong> We compare its statements and support to each issue raised in the dispute.</li><li><strong>No response:</strong> We document the closed response window and review the evidence before selecting any next step.</li><li><strong>Partial correction:</strong> We verify what changed and identify anything that still requires review.</li><li><strong>Full correction/deletion:</strong> We document the result and determine whether the account can be closed.</li></ul>'
          + '<p>We monitor every letter and will notify you when responses come in or when windows close.</p>',
      },
      4: {
        subject: 'Your Credit Score: What Moves It and What Doesn\'t',
        headline: 'The mechanics behind the number.',
        content: '<p>Your credit score is a snapshot — it reflects what\'s in your credit file at this exact moment. As inaccurate negative accounts are removed or corrected, the score recalculates.</p>'
          + '<p><strong>What can affect a score:</strong> payment history, amounts owed, account age, account mix, recent applications, and the particular scoring model being used. The weight and effect of any one change vary by file and model.</p>'
          + '<p><strong>What to expect during your campaign:</strong> Scores can fluctuate as reported data changes. A correction or deletion does not guarantee a particular score increase, and different lenders may use different reports or scoring models.</p>'
          + '<p>Keep pulling your reports monthly through Privacy Guard. Every deletion confirmed is a win.</p>',
      },
      5: {
        subject: 'After the Deletions: Building What Comes Next',
        headline: 'Your credit is a foundation, not a destination.',
        content: '<p>When negative accounts are deleted, your score improves — but the real opportunity is what you build on top of that foundation.</p>'
          + '<p><strong>Personal credit next steps:</strong></p>'
          + '<ul><li>Secured credit cards from Capital One or Discover to build positive payment history</li><li>Credit-builder loans from local credit unions</li><li>Becoming an authorized user on a long-standing account with a trusted family member</li></ul>'
          + '<p><strong>Business credit — the bigger opportunity:</strong></p>'
          + '<p>Business credit is completely separate from personal credit. You can start building it now, regardless of where your personal scores are. A properly structured business entity with an EIN and business bank account can begin establishing trade lines immediately.</p>'
          + '<p>Our VIP clients get access to our business credit roadmap and a direct introduction to our funding partner, Swiftedly, who specializes in business funding for entrepreneurs building from scratch.</p>'
          + '<p>Ask about upgrading to VIP membership during your next strategy touchpoint.</p>'
          + '<p><strong>You started this process to come back. The comeback is the beginning.</strong></p>',
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
      + `<ol style="padding-left:18px;line-height:1.8;font-size:13px;color:#444;"><li>Log in to your partner portal to submit client referrals</li><li>We handle the full credit repair process &mdash; forensic audit, certified dispute letters, follow-up, and monitoring</li><li>You earn ${commPct}% of the First Work Fee AND every ongoing monthly payment for as long as your referred client remains active &mdash; not a one-time bonus</li><li>Track your referrals and commission status in real time from your portal</li></ol>`
      + `<h3 style="color:#1B2A4A;font-size:14px;margin:24px 0 8px;">Client Plans:</h3>`
      + `<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px;"><tr style="background:#f8f9fa;"><td style="padding:8px 12px;font-weight:600;">Standard</td><td style="padding:8px 12px;">$79/mo &mdash; Up to 3 letters/mo. $75 one-time First Work Fee.</td></tr><tr><td style="padding:8px 12px;font-weight:600;">VIP</td><td style="padding:8px 12px;">$149/mo &mdash; Up to 5 letters/mo, priority service &amp; strategy call. $99 First Work Fee.</td></tr><tr style="background:#f8f9fa;"><td style="padding:8px 12px;font-weight:600;">Paid in Full</td><td style="padding:8px 12px;">$499 flat for 6 months of Standard service (First Work Fee waived).</td></tr></table>`
      + `<p style="font-size:13px;color:#444;margin:0 0 14px;">Your commission is paid on the First Work Fee at enrollment, and again every month your referred client's recurring service payment clears.</p>`
      + `<p style="font-size:13px;color:#444;margin:0 0 14px;">Your portal access link was sent separately via magic link.</p>`
      + `<p style="font-size:13px;color:#444;margin:0;">Questions? Reply to this email or reach Chris at <a href="mailto:info@creditcomebackclub.com" style="color:#1B2A4A;">info@creditcomebackclub.com</a> or 480-913-9172.</p>`,
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
      footer: '<p style="font-size:13px;color:#444;margin:0;">Log in to your admin dashboard to run their audit and kick off onboarding.</p>',
    });
    await sendMail('creditcomebackclub@gmail.com', subject, html);
    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action: ' + action }) };
};
