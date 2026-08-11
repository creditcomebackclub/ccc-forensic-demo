const { sendEmail, wrapClientEmail, escapeHtml, BRAND } = require('./_email.cjs');

function bookedEmail(name) {
  const firstName = (String(name || 'there').trim().split(/\s+/)[0] || 'there')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .slice(0, 80) || 'there';
  return {
    subject: `You're Booked, ${firstName} — How to Prepare for Your Credit Review`,
    html: wrapClientEmail({
      eyebrow: 'Your Consultation Is Booked',
      bodyHtml: `<p style="margin:0 0 14px;">Hi ${escapeHtml(firstName)},</p>`
        + `<p style="margin:0 0 14px;">Your consultation is on the calendar, and we&rsquo;re eager to take a close look at your file.</p>`
        + `<p style="margin:0 0 14px;">Please have a copy of your newest credit report available&mdash;ideally a current three-bureau report showing Equifax, Experian, and TransUnion. Bring any relevant recent correspondence from creditors, collectors, or the credit bureaus.</p>`
        + `<p style="margin:0 0 14px;">We&rsquo;ll use the consultation to understand your goals, review what is happening in your file, and explain the most appropriate next step. Booking does not create a payment, service agreement, or client portal. If you choose to move forward, we&rsquo;ll send the secure agreement and onboarding steps afterward.</p>`
        + `<p style="margin:14px 0;">Calendly&rsquo;s calendar invitation contains the confirmed date, time, and meeting details. If you need to reschedule, use the link in that invitation.</p>`
        + `<p style="margin:0;">Questions before the call? Reply to this email or call ${BRAND.phone}.</p>`,
      cta: null,
    }),
  };
}

async function parseResponse(response) {
  const raw = await response.text();
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

async function updateSendRecord({ id, patch, supabaseUrl, serviceKey }) {
  const response = await fetch(`${supabaseUrl}/rest/v1/automated_email_sends?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error('Could not update the automated email receipt.');
}

async function sendConsultationBookedOnce({ clientId, name, email, supabaseUrl, serviceKey }) {
  if (!clientId || !email) throw new Error('Client id and email are required for the booking email.');
  const eventKey = 'consultation_booked:' + clientId;
  const claimResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_automated_email_send`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_event_key: eventKey,
      p_event_type: 'consultation_booked',
      p_recipient: String(email).trim().toLowerCase(),
      p_client_id: clientId,
    }),
  });
  const claim = await parseResponse(claimResponse);
  if (!claimResponse.ok) throw new Error('Could not claim the consultation booking email.');
  if (!claim?.claimed) return { sent: false, duplicate: true };

  const message = bookedEmail(name);
  try {
    const resendId = await sendEmail({
      to: email,
      subject: message.subject,
      html: message.html,
      idempotencyKey: claim.idempotency_key,
      tags: { automated_email_send_id: claim.id, email_category: 'consultation' },
    });
    await updateSendRecord({
      id: claim.id,
      supabaseUrl,
      serviceKey,
      patch: { send_status: 'sent', resend_email_id: resendId, sent_at: new Date().toISOString(), delivery_error: null },
    });
    return { sent: true, resendId };
  } catch (error) {
    await updateSendRecord({
      id: claim.id,
      supabaseUrl,
      serviceKey,
      patch: { send_status: 'failed', delivery_error: String(error.message || error).slice(0, 1000) },
    }).catch((updateError) => console.error('Could not record booking email failure:', updateError.message));
    throw error;
  }
}

module.exports = { bookedEmail, sendConsultationBookedOnce };
