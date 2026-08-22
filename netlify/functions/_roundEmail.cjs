const { createClient } = require('@supabase/supabase-js');
const crypto = require('node:crypto');
const ws = require('ws');
const { escapeHtml, sendEmail, wrapClientEmail } = require('./_email.cjs');

const RETIRED_TEMPLATE_COPY = /\bcertified(?:\s+mail)?\b|\bmonitor (?:each )?delivery\b|\bresponse window\b|\bdirect-furnisher\b|\bfirst step in your campaign\b|\bMetro\s*2\b|\bLPOA\b/i;

const EVENT_COPY = {
  file_cleanup_mailed: {
    subject: () => 'Your credit-file update mailing has been recorded',
    body: ({ firstName, letters }) => `Hi ${firstName},\n\nYour personal-information or inquiry correspondence has been mailed by USPS First-Class Mail (${letters.length} ${letters.length === 1 ? 'letter' : 'letters'}). CCC recorded the send date separately from your account-specific dispute paths.\n\nFirst-Class Mail does not include delivery confirmation or a signed receipt. If a response or updated report arrives, please upload every page through your portal so the team can document what happened.`,
  },
  next_round_prepared: {
    subject: ({ round }) => `Round ${round.round_number} is prepared for review`,
    body: ({ firstName, round }) => `Hi ${firstName},\n\nWe prepared the letter set for Round ${round.round_number} from the saved account paths in your campaign. Our team will review the personalized facts, required personal statement when applicable, and packet enclosures before anything is sent.\n\nYou do not need to take action right now.`,
  },
  round_mailed: {
    subject: ({ round }) => `Round ${round.round_number} has been mailed`,
    body: ({ firstName, round, letters }) => `Hi ${firstName},\n\nEvery letter in Round ${round.round_number} has now been mailed by USPS First-Class Mail (${letters.length} ${letters.length === 1 ? 'letter' : 'letters'}). CCC recorded the send date for each letter. First-Class Mail does not include delivery confirmation or a signed receipt.\n\nIf a response or updated report arrives, please upload every page in your portal. The team will record the documented outcome before selecting any next step.`,
  },
  first_response_received: {
    subject: ({ round }) => `We received a response for Round ${round.round_number}`,
    body: ({ firstName, round }) => `Hi ${firstName},\n\nA response connected to Round ${round.round_number} has been received. Our staff review will compare it with the exact correspondence and evidence in that round before any outcome or next step is recorded.\n\nNo action is needed unless we ask for a specific document.`,
  },
  documents_needed: {
    subject: ({ round }) => `Documents needed for Round ${round.round_number}`,
    body: ({ firstName, round }) => `Hi ${firstName},\n\nOur review of Round ${round.round_number} identified documents we need from you before we can make the next decision. Please open your portal for the request and upload only the requested items.`,
  },
  round_resolved: {
    subject: ({ round }) => `Round ${round.round_number} review is complete`,
    body: ({ firstName, round }) => `Hi ${firstName},\n\nWe completed our review of every response and nonresponse in Round ${round.round_number}. This account's dispute campaign is now marked resolved. You can view the current status in your portal.`,
  },
  round_review_complete: {
    subject: ({ round }) => `Round ${round.round_number} review is complete`,
    body: ({ firstName, round }) => `Hi ${firstName},\n\nWe completed the account-by-account response review for Round ${round.round_number}. Resolved accounts are complete, and any unresolved accounts have been placed on their approved next path.\n\nYou can view the current packet and account progress in your portal. No action is needed unless a document request is shown there.`,
  },
  escalation_ready: {
    subject: ({ round }) => `Round ${round.round_number} is ready for escalation review`,
    body: ({ firstName, round }) => `Hi ${firstName},\n\nWe completed the response review for Round ${round.round_number} and marked the record ready for escalation review. This does not mean a complaint or legal filing has been submitted. Our team will review the available path and contact you if anything is needed.`,
  },
};

function plainTextHtml(bodyText, eyebrow) {
  const paragraphs = String(bodyText || '').split(/\n{2,}/).map((value) => value.trim()).filter(Boolean)
    .map((value) => `<p style="margin:0 0 14px;">${escapeHtml(value).replace(/\n/g, '<br>')}</p>`).join('');
  return wrapClientEmail({ eyebrow, bodyHtml: paragraphs, cta: undefined });
}

function dbClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server configuration is required for round emails.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: ws } });
}

function renderTemplate(value, context) {
  const fields = {
    'client.name': context.client.name || '',
    'client.address': context.client.address || '',
    'account.furnisher': context.letters[0]?.furnisher || '',
    'round.number': String(context.round.round_number),
    'round.targetType': context.round.target_type === 'bureau' ? 'Credit Bureau' : 'Direct Furnisher',
    'round.status': context.round.status || '',
  };
  return String(value || '').replace(/{{\s*([^{}]+?)\s*}}/g, (_match, key) => {
    const normalized = String(key).trim();
    if (!Object.prototype.hasOwnProperty.call(fields, normalized)) throw new Error(`Unknown client email merge field: ${normalized}`);
    return fields[normalized];
  });
}

function isCurrentMethodEmailTemplate(template) {
  if (!template) return false;
  return !RETIRED_TEMPLATE_COPY.test(`${template.subject_template || ''}\n${template.body_template || ''}`);
}

// A client campaign may open one account-level dispute_round per route.  The
// "prepared" notice is a campaign milestone, however: clients should hear
// once only after every selected route in that campaign has a completed draft.
function preparedEventKey(round) {
  return round?.campaign_id
    ? `campaign:${round.campaign_id}:next_round_prepared`
    : `${round?.id}:next_round_prepared`;
}

function roundEventKey(round, eventType) {
  return round?.campaign_id && ['next_round_prepared', 'round_mailed', 'first_response_received', 'documents_needed', 'round_review_complete'].includes(eventType)
    ? `campaign:${round.campaign_id}:${eventType}`
    : `${round?.id}:${eventType}`;
}

function campaignReadyForPreparedEmail(routes) {
  return Array.isArray(routes) && routes.length > 0
    && routes.every((route) => route.status === 'generated');
}

function campaignReadyForMailedEmail(letters) {
  return Array.isArray(letters) && letters.length > 0
    && letters.every((letter) => !!letter.mailed_date);
}

function campaignCleanupReadyForEmail({ items, routes, letters }) {
  const cleanupIds = new Set((items || [])
    .filter((item) => item.selection_state === 'selected' && ['personal_info', 'inquiry'].includes(item.item_kind))
    .map((item) => item.id));
  const cleanupRoutes = (routes || []).filter((route) => cleanupIds.has(route.item_id)
    || (route.item_ids || []).some((id) => cleanupIds.has(id)));
  return cleanupIds.size > 0 && cleanupRoutes.length > 0
    && cleanupRoutes.every((route) => route.status === 'generated' && (route.letter_ids || []).length > 0)
    && campaignReadyForMailedEmail(letters);
}

async function loadContext(db, roundId) {
  const { data: round, error: roundError } = await db.from('dispute_rounds').select('*').eq('id', roundId).single();
  if (roundError || !round) throw new Error('Round email could not resolve the dispute round.');
  const [{ data: client, error: clientError }, { data: letters, error: lettersError }] = await Promise.all([
    db.from('clients').select('id,name,email,address').eq('id', round.client_id).single(),
    db.from('letters').select('id,html,mailed_date,response_outcome,round_next_action,target_type,target_bureau,furnisher').eq('round_id', round.id).order('target_bureau'),
  ]);
  if (clientError || !client?.email) throw new Error('The client has no deliverable email address.');
  if (lettersError || !letters?.length) throw new Error('The round has no letters.');
  if (round.campaign_id) {
    const [{ data: campaignLetters, error: campaignLettersError }, { data: campaign, error: campaignError }] = await Promise.all([
      db.from('letters')
        .select('id,html,mailed_date,response_outcome,round_next_action,target_type,target_bureau,furnisher')
        .eq('campaign_id', round.campaign_id).eq('letter_kind', 'dispute'),
      db.from('client_campaigns').select('id,user_id,client_id,round_number').eq('id', round.campaign_id).single(),
    ]);
    if (campaignLettersError || campaignError || campaign?.user_id !== round.user_id || campaign?.client_id !== round.client_id) {
      throw new Error('Could not load the campaign for its milestone email.');
    }
    return { round: { ...round, round_number: campaign.round_number }, client, letters: campaignLetters || [] };
  }
  return { round, client, letters };
}

async function sendMilestoneEmail({ db, context, eventType, eventKey, roundId = null, templateEvent = eventType }) {
  const copy = EVENT_COPY[eventType];
  const firstName = String(context.client.name || 'there').trim().split(/\s+/)[0];
  const vars = { ...context, firstName };
  const templateEvents = [...new Set([templateEvent, eventType])];
  const { data: templates, error: templateError } = await db.from('client_email_templates').select('id,event_type,subject_template,body_template')
    .eq('user_id', context.round.user_id).eq('is_active', true).in('event_type', templateEvents);
  if (templateError) throw new Error('Could not load the client email template: ' + templateError.message);
  // Older installations may still have active seeded templates that describe
  // certified delivery and the retired phase workflow. Never let those rows
  // override the current First-Class Mail event copy. User-authored templates
  // remain eligible when they do not contain a retired-method marker.
  const compatibleTemplates = (templates || []).filter(isCurrentMethodEmailTemplate);
  const template = compatibleTemplates.find((item) => item.event_type === templateEvent)
    || compatibleTemplates.find((item) => item.event_type === eventType)
    || null;
  const subject = template ? renderTemplate(template.subject_template, context) : copy.subject(vars);
  const bodyText = template ? renderTemplate(template.body_template, context) : copy.body(vars);
  const bodyHtml = plainTextHtml(bodyText, 'Campaign Update');
  const idempotencyKey = `ccc-${eventKey}`;
  const { data: queued, error: queueError } = await db.from('client_emails').insert({
    user_id: context.round.user_id,
    client_id: context.client.id,
    round_id: roundId,
    template_id: template?.id || null,
    event_type: eventType,
    event_key: eventKey,
    subject,
    body_html: bodyHtml,
    body_text: bodyText,
    idempotency_key: idempotencyKey,
  }).select('*').single();
  if (queueError?.code === '23505') return { skipped: 'already_queued' };
  if (queueError || !queued) throw new Error('Could not queue client milestone email: ' + (queueError?.message || 'unknown error'));
  try {
    await db.from('client_emails').update({ send_status: 'sending', attempts: 1, last_attempt_at: new Date().toISOString() }).eq('id', queued.id);
    const resendId = await sendEmail({ to: context.client.email, subject, html: bodyHtml, text: bodyText, idempotencyKey, tags: { client_email_id: queued.id } });
    await db.from('client_emails').update({ send_status: 'sent', resend_email_id: resendId, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', queued.id);
    return { sent: true, emailId: queued.id, resendId };
  } catch (error) {
    await db.from('client_emails').update({ send_status: 'failed', delivery_error: String(error.message || error).slice(0, 1000), updated_at: new Date().toISOString() }).eq('id', queued.id);
    throw error;
  }
}

async function queueRoundEvent({ roundId, eventType, requireAllGenerated = false, requireAllMailed = false }) {
  const copy = EVENT_COPY[eventType];
  if (!copy) throw new Error('Unsupported round email event.');
  const db = dbClient();
  const context = await loadContext(db, roundId);
  if ((requireAllGenerated || eventType === 'next_round_prepared') && context.letters.some((letter) => !letter.html || letter.html === 'GENERATING...' || letter.html.startsWith('ERROR:'))) return { skipped: 'round_not_generated' };
  if (eventType === 'next_round_prepared' && context.round.campaign_id) {
    const [{ data: routes, error: routesError }, { data: items, error: itemsError }] = await Promise.all([
      db.from('campaign_letter_routes').select('status,item_id,item_ids').eq('campaign_id', context.round.campaign_id),
      db.from('campaign_items').select('id,item_kind').eq('campaign_id', context.round.campaign_id),
    ]);
    if (routesError || itemsError) throw new Error('Could not check campaign account-packet generation status.');
    const accountIds = new Set((items || []).filter((item) => item.item_kind === 'account').map((item) => item.id));
    const accountRoutes = (routes || []).filter((route) => accountIds.has(route.item_id)
      || (route.item_ids || []).some((id) => accountIds.has(id)));
    if (!campaignReadyForPreparedEmail(accountRoutes)) return { skipped: 'campaign_not_generated' };
  }
  if (eventType === 'round_mailed' && context.round.campaign_id) {
    const { data: campaignLetters, error: campaignLettersError } = await db.from('letters')
      .select('id,html,mailed_date,response_outcome,round_next_action,target_type,target_bureau,furnisher')
      .eq('campaign_id', context.round.campaign_id)
      .eq('letter_kind', 'dispute');
    if (campaignLettersError) throw new Error('Could not check campaign mailing status.');
    context.letters = campaignLetters || [];
  }
  if ((requireAllMailed || eventType === 'round_mailed') && context.letters.some((letter) => !letter.mailed_date)) return { skipped: 'round_not_fully_mailed' };
  if ((requireAllMailed || eventType === 'round_mailed') && !context.letters.length) return { skipped: 'round_has_no_letters' };
  if (eventType === 'first_response_received' && !context.letters.some((letter) => letter.response_outcome === 'received')) return { skipped: 'no_response_received' };
  if (context.round.campaign_id && ['documents_needed', 'round_review_complete'].includes(eventType)) {
    const { data: coverage, error: coverageError } = await db.from('letter_account_coverage')
      .select('id,response_status').eq('campaign_id', context.round.campaign_id);
    if (coverageError) throw new Error('Could not check packet response-review progress.');
    const coverageIds = (coverage || []).map((row) => row.id);
    const { data: assessments, error: assessmentError } = coverageIds.length
      ? await db.from('response_evidence_account_assessment')
        .select('coverage_id,review_status,next_action,reviewed_at').in('coverage_id', coverageIds)
      : { data: [], error: null };
    if (assessmentError) throw new Error('Could not check packet account decisions.');
    const latestByCoverage = new Map();
    for (const row of assessments || []) {
      const existing = latestByCoverage.get(row.coverage_id);
      if (!existing || String(row.reviewed_at || '') > String(existing.reviewed_at || '')) latestByCoverage.set(row.coverage_id, row);
    }
    if (eventType === 'documents_needed' && ![...latestByCoverage.values()].some((row) => row.review_status === 'reviewed' && row.next_action === 'needs_documents')) return { skipped: 'documents_not_requested' };
    if (eventType === 'round_review_complete' && (!(coverage || []).length || (coverage || []).some((row) => row.response_status !== 'reviewed'))) return { skipped: 'campaign_review_incomplete' };
  } else if (eventType === 'documents_needed' && !context.letters.some((letter) => letter.round_next_action === 'needs_documents')) return { skipped: 'documents_not_requested' };
  if (eventType === 'round_resolved' && (context.round.status !== 'closed' || context.round.final_disposition !== 'resolved')) return { skipped: 'round_not_resolved' };
  if (eventType === 'escalation_ready' && (context.round.status !== 'closed' || context.round.final_disposition !== 'escalate')) return { skipped: 'round_not_escalated' };
  const targetTypes = [...new Set(context.letters.map((letter) => letter.target_type).filter(Boolean))];
  const templateEvent = eventType === 'round_mailed' && targetTypes.length === 1 ? `round_mailed:${targetTypes[0]}` : eventType;
  return sendMilestoneEmail({
    db,
    context,
    eventType,
    eventKey: roundEventKey(context.round, eventType),
    roundId: context.round.id,
    templateEvent,
  });
}

async function queueCampaignCleanupMailed({ campaignId }) {
  if (!campaignId) return { skipped: 'campaign_missing' };
  const db = dbClient();
  const { data: campaign, error: campaignError } = await db.from('client_campaigns').select('id,user_id,client_id,round_number,stage').eq('id', campaignId).single();
  if (campaignError || !campaign) throw new Error('Cleanup email could not resolve the client campaign.');
  const [{ data: client, error: clientError }, { data: items, error: itemsError }, { data: routes, error: routesError }, { data: letters, error: lettersError }] = await Promise.all([
    db.from('clients').select('id,name,email,address').eq('id', campaign.client_id).single(),
    db.from('campaign_items').select('id,item_kind,selection_state').eq('campaign_id', campaign.id),
    db.from('campaign_letter_routes').select('id,item_id,item_ids,status,letter_ids').eq('campaign_id', campaign.id),
    db.from('letters').select('id,mailed_date,target_type,target_bureau,furnisher').eq('campaign_id', campaign.id).eq('letter_kind', 'file_update'),
  ]);
  if (clientError || !client?.email) throw new Error('The client has no deliverable email address.');
  if (itemsError || routesError || lettersError) throw new Error('Could not check the cleanup mailing milestone.');
  if (!campaignCleanupReadyForEmail({ items, routes, letters })) return { skipped: 'cleanup_not_fully_mailed' };
  const context = { round: campaign, client, letters };
  return sendMilestoneEmail({
    db,
    context,
    eventType: 'file_cleanup_mailed',
    eventKey: `campaign:${campaign.id}:file_cleanup_mailed`,
  });
}

async function sendCustomClientEmail({ staffUserId, clientId, roundId = null, templateId = null, subject, bodyText }) {
  const cleanSubject = String(subject || '').trim();
  const cleanBody = String(bodyText || '').trim();
  if (!cleanSubject || cleanSubject.length > 180) throw new Error('Subject is required and must be 180 characters or fewer.');
  if (!cleanBody || cleanBody.length > 10000) throw new Error('Message is required and must be 10,000 characters or fewer.');
  const db = dbClient();
  const { data: client, error } = await db.from('clients').select('id,user_id,name,email').eq('id', clientId).single();
  if (error || !client?.email) throw new Error('Client email could not be resolved.');
  if (roundId) {
    const { data: round, error: roundError } = await db.from('dispute_rounds').select('id,client_id,user_id').eq('id', roundId).single();
    if (roundError || !round || round.client_id !== client.id || round.user_id !== client.user_id) {
      throw new Error('The selected round does not belong to this client.');
    }
  }
  if (templateId) {
    const { data: template, error: templateError } = await db.from('client_email_templates').select('id,user_id').eq('id', templateId).single();
    if (templateError || !template || template.user_id !== client.user_id) throw new Error('The selected email template is not available for this client.');
  }
  const idempotencyKey = `ccc-custom-${crypto.randomUUID()}`;
  const bodyHtml = plainTextHtml(cleanBody, 'A Note From Your Team');
  const { data: row, error: insertError } = await db.from('client_emails').insert({ user_id: client.user_id, client_id: client.id, round_id: roundId, template_id: templateId, sent_by: staffUserId, event_type: templateId ? 'canned' : 'custom', subject: cleanSubject, body_html: bodyHtml, body_text: cleanBody, idempotency_key: idempotencyKey }).select('*').single();
  if (insertError) throw insertError;
  try {
    const resendId = await sendEmail({ to: client.email, subject: cleanSubject, html: bodyHtml, text: cleanBody, idempotencyKey, tags: { client_email_id: row.id } });
    await db.from('client_emails').update({ send_status: 'sent', attempts: 1, resend_email_id: resendId, last_attempt_at: new Date().toISOString(), sent_at: new Date().toISOString() }).eq('id', row.id);
    return { id: row.id, resendId };
  } catch (sendError) {
    await db.from('client_emails').update({ send_status: 'failed', attempts: 1, delivery_error: String(sendError.message || sendError).slice(0, 1000), last_attempt_at: new Date().toISOString() }).eq('id', row.id);
    throw sendError;
  }
}

async function sendQueuedClientEmails(limit = 25) {
  const db = dbClient();
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { error: staleError } = await db.from('client_emails').update({ send_status: 'failed', delivery_error: 'Recovered a stale sending attempt.', updated_at: new Date().toISOString() })
    .eq('send_status', 'sending').lt('last_attempt_at', staleBefore);
  if (staleError) throw staleError;
  const { data: rows, error } = await db.from('client_emails').select('id,client_id,subject,body_html,body_text,idempotency_key,attempts')
    .in('send_status', ['queued', 'failed']).lt('attempts', 5).order('created_at').limit(Math.max(1, Math.min(Number(limit) || 25, 100)));
  if (error) throw error;
  if (!rows?.length) return { processed: 0, sent: 0 };
  const clientIds = [...new Set(rows.map((row) => row.client_id))];
  const { data: clients, error: clientError } = await db.from('clients').select('id,email').in('id', clientIds);
  if (clientError) throw clientError;
  const emails = new Map((clients || []).map((client) => [client.id, client.email]));
  let sent = 0;
  for (const row of rows) {
    const recipient = emails.get(row.client_id);
    const attempts = Number(row.attempts || 0) + 1;
    if (!recipient) {
      await db.from('client_emails').update({ send_status: 'failed', attempts, delivery_error: 'Client email address is unavailable.', last_attempt_at: new Date().toISOString() }).eq('id', row.id);
      continue;
    }
    await db.from('client_emails').update({ send_status: 'sending', attempts, last_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', row.id);
    try {
      const resendId = await sendEmail({ to: recipient, subject: row.subject, html: row.body_html, text: row.body_text, idempotencyKey: row.idempotency_key, tags: { client_email_id: row.id } });
      await db.from('client_emails').update({ send_status: 'sent', resend_email_id: resendId, delivery_error: null, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', row.id);
      sent += 1;
    } catch (sendError) {
      await db.from('client_emails').update({ send_status: 'failed', delivery_error: String(sendError.message || sendError).slice(0, 1000), updated_at: new Date().toISOString() }).eq('id', row.id);
    }
  }
  return { processed: rows.length, sent };
}

module.exports = { EVENT_COPY, isCurrentMethodEmailTemplate, plainTextHtml, preparedEventKey, roundEventKey, campaignReadyForPreparedEmail, campaignReadyForMailedEmail, campaignCleanupReadyForEmail, queueRoundEvent, queueCampaignCleanupMailed, sendCustomClientEmail, sendQueuedClientEmails };
