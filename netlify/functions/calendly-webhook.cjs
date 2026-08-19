const {
  chooseClient,
  consultationTags,
  isConsultationEvent,
  isVipCallEvent,
  isStaleBookingEvent,
  verifyWebhookResources,
  webhookEventKey,
} = require('./_calendly.cjs');
const { sendConsultationBookedOnce } = require('./_consultationBooking.cjs');

function dbHeaders(serviceKey, extra = {}) {
  return { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, ...extra };
}

async function readJson(response) {
  const raw = await response.text();
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

async function dbRequest(url, serviceKey, path, options = {}) {
  const response = await fetch(url + path, {
    method: options.method || 'GET',
    headers: dbHeaders(serviceKey, {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.prefer ? { Prefer: options.prefer } : {}),
    }),
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    const error = new Error('Database request failed (' + response.status + ').');
    error.statusCode = response.status;
    error.detail = body;
    throw error;
  }
  return body;
}

async function beginReceipt(input, normalized, eventKey, supabaseUrl, serviceKey) {
  const inserted = await dbRequest(
    supabaseUrl,
    serviceKey,
    '/rest/v1/calendly_webhook_events?on_conflict=event_key',
    {
      method: 'POST',
      prefer: 'resolution=ignore-duplicates,return=representation',
      body: {
        event_key: eventKey,
        event_type: normalized.event,
        invitee_uri: normalized.inviteeUri,
        scheduled_event_uri: normalized.eventUri,
        payload: input,
        processing_status: 'processing',
      },
    }
  );
  if (Array.isArray(inserted) && inserted[0]) return { row: inserted[0], duplicate: false };

  const existing = await dbRequest(
    supabaseUrl,
    serviceKey,
    '/rest/v1/calendly_webhook_events?event_key=eq.' + encodeURIComponent(eventKey) + '&select=*&limit=1'
  );
  const row = Array.isArray(existing) ? existing[0] : null;
  if (!row) throw new Error('Could not load the Calendly webhook receipt.');
  if (row.processing_status === 'processed' || row.processing_status === 'ignored') {
    return { row, duplicate: true };
  }
  await updateReceipt(row.id, { processing_status: 'processing', processing_error: null }, supabaseUrl, serviceKey);
  return { row, duplicate: false };
}

async function updateReceipt(id, patch, supabaseUrl, serviceKey) {
  await dbRequest(
    supabaseUrl,
    serviceKey,
    '/rest/v1/calendly_webhook_events?id=eq.' + encodeURIComponent(id),
    {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { ...patch, updated_at: new Date().toISOString() },
    }
  );
}

async function findClient(email, inviteeUri, supabaseUrl, serviceKey) {
  const fields = 'id,user_id,name,email,status,tags,lead_notes,lead_created_at,created_at,consultation_status,consultation_scheduled_at,calendly_event_uri,calendly_invitee_uri,calendly_booking_updated_at';
  const byInvitee = await dbRequest(
    supabaseUrl,
    serviceKey,
    '/rest/v1/clients?calendly_invitee_uri=eq.' + encodeURIComponent(inviteeUri) + '&select=' + fields + '&limit=1'
  );
  if (Array.isArray(byInvitee) && byInvitee[0]) return byInvitee[0];
  const byEmail = await dbRequest(
    supabaseUrl,
    serviceKey,
    '/rest/v1/clients?email=eq.' + encodeURIComponent(email) + '&select=' + fields
  );
  return chooseClient(byEmail, email, inviteeUri);
}

async function findVipCallClient(email, supabaseUrl, serviceKey) {
  const fields = 'id,user_id,name,email,is_vip,vip_call_status,vip_call_scheduled_at,vip_call_invitee_uri,vip_call_updated_at';
  const rows = await dbRequest(
    supabaseUrl,
    serviceKey,
    '/rest/v1/clients?email=eq.' + encodeURIComponent(email) + '&is_vip=eq.true&select=' + fields + '&order=created_at.desc.nullslast,id.asc'
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function createCalendlyLead(verified, supabaseUrl, serviceKey) {
  const profiles = await dbRequest(
    supabaseUrl,
    serviceKey,
    '/rest/v1/profiles?role=eq.admin&select=id&limit=1'
  );
  const adminId = Array.isArray(profiles) ? profiles[0]?.id : null;
  if (!adminId) throw new Error('No administrator is available to own the Calendly lead.');
  const created = await dbRequest(supabaseUrl, serviceKey, '/rest/v1/clients', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      user_id: adminId,
      name: String(verified.invitee.name || verified.email).trim(),
      email: verified.email,
      status: 'lead',
      lead_source: 'Calendly',
      lead_notes: 'Booked directly through Calendly',
      lead_created_at: verified.occurredAt || new Date().toISOString(),
      consultation_status: 'requested',
      tags: ['lead-stage:new'],
    },
  });
  return Array.isArray(created) ? created[0] : null;
}

function bookingPatch(client, verified) {
  const canceled = verified.event === 'invitee.canceled';
  const rescheduled = Boolean(verified.payload.rescheduled || verified.invitee.rescheduled);
  const occurredAt = verified.occurredAt || verified.invitee.updated_at || new Date().toISOString();
  const isDifferentInvitee = Boolean(client.calendly_invitee_uri && client.calendly_invitee_uri !== verified.inviteeUri);
  const canCompleteReschedule = !canceled && isDifferentInvitee && client.consultation_status === 'rescheduled';
  if (isStaleBookingEvent(client, occurredAt) && !canCompleteReschedule) return null;

  if (canceled) {
    // A reschedule produces one canceled webhook for the old invitee and one
    // created webhook for the new invitee. Never let the old cancellation
    // overwrite a newer booking already attached to the CRM row.
    if (isDifferentInvitee) return null;
    const status = rescheduled ? 'rescheduled' : 'canceled';
    return {
      consultation_status: status,
      consultation_canceled_at: verified.payload.canceled_at || verified.invitee.cancellation?.created_at || occurredAt,
      calendly_booking_updated_at: occurredAt,
      tags: consultationTags(client.tags, status, true),
    };
  }

  return {
    consultation_status: 'scheduled',
    consultation_scheduled_at: verified.scheduledEvent.start_time || null,
    consultation_canceled_at: null,
    calendly_event_uri: verified.eventUri,
    calendly_invitee_uri: verified.inviteeUri,
    calendly_booking_updated_at: occurredAt,
    tags: consultationTags(client.tags, 'scheduled', true),
  };
}

function vipCallBookingPatch(client, verified) {
  const canceled = verified.event === 'invitee.canceled';
  const rescheduled = Boolean(verified.payload.rescheduled || verified.invitee.rescheduled);
  const occurredAt = verified.occurredAt || verified.invitee.updated_at || new Date().toISOString();
  const isDifferentInvitee = Boolean(client.vip_call_invitee_uri && client.vip_call_invitee_uri !== verified.inviteeUri);
  const canCompleteReschedule = !canceled && isDifferentInvitee && client.vip_call_status === 'rescheduled';
  const priorUpdate = Date.parse(client.vip_call_updated_at || '') || 0;
  const incoming = Date.parse(occurredAt) || 0;
  const isStale = Boolean(priorUpdate && incoming && incoming < priorUpdate);
  if (isStale && !canCompleteReschedule) return null;

  if (canceled) {
    if (isDifferentInvitee) return null;
    return {
      vip_call_status: rescheduled ? 'rescheduled' : 'canceled',
      vip_call_updated_at: occurredAt,
    };
  }

  return {
    vip_call_status: 'scheduled',
    vip_call_scheduled_at: verified.scheduledEvent.start_time || null,
    vip_call_invitee_uri: verified.inviteeUri,
    vip_call_updated_at: occurredAt,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey || !process.env.CALENDLY_ACCESS_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Calendly webhook is not configured' }) };
  }

  let input;
  if (Buffer.byteLength(event.body || '', 'utf8') > 200000) {
    return { statusCode: 413, body: JSON.stringify({ error: 'Payload too large' }) };
  }
  try { input = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  let receipt = null;
  try {
    const eventKey = webhookEventKey(input);
    const preliminary = require('./_calendly.cjs').normalizeWebhookEvent(input);
    // Personal-access-token webhook subscriptions do not expose an OAuth
    // signing key. Verify both resource URIs through Calendly's authenticated
    // API before trusting or persisting any email, name, time, or lifecycle
    // value from the public request.
    const verified = await verifyWebhookResources(input);
    const isVip = isVipCallEvent(verified.scheduledEvent);
    if (!isConsultationEvent(verified.scheduledEvent) && !isVip) {
      return { statusCode: 200, body: JSON.stringify({ received: true, ignored: true, reason: 'not_consultation_event' }) };
    }
    const verifiedStatus = String(verified.invitee.status || '').toLowerCase();
    if (verified.event === 'invitee.created' && verifiedStatus !== 'active') {
      return { statusCode: 200, body: JSON.stringify({ received: true, ignored: true, reason: 'invitee_not_active' }) };
    }
    if (verified.event === 'invitee.canceled' && verifiedStatus !== 'canceled') {
      throw new Error('Calendly invitee is not canceled.');
    }
    receipt = await beginReceipt(input, preliminary, eventKey, supabaseUrl, serviceKey);
    if (receipt.duplicate) {
      return { statusCode: 200, body: JSON.stringify({ received: true, duplicate: true }) };
    }

    if (isVip) {
      const vipClient = await findVipCallClient(verified.email, supabaseUrl, serviceKey);
      if (!vipClient) {
        await updateReceipt(receipt.row.id, {
          processing_status: 'ignored',
          processed_at: new Date().toISOString(),
          processing_error: 'No matching VIP client for this booking.',
        }, supabaseUrl, serviceKey);
        return { statusCode: 200, body: JSON.stringify({ received: true, ignored: true }) };
      }
      const vipPatch = vipCallBookingPatch(vipClient, verified);
      if (vipPatch) {
        await dbRequest(
          supabaseUrl,
          serviceKey,
          '/rest/v1/clients?id=eq.' + encodeURIComponent(vipClient.id),
          { method: 'PATCH', prefer: 'return=minimal', body: vipPatch }
        );
      }
      await updateReceipt(receipt.row.id, {
        client_id: vipClient.id,
        processing_status: 'processed',
        processing_error: null,
        processed_at: new Date().toISOString(),
      }, supabaseUrl, serviceKey);
      return { statusCode: 200, body: JSON.stringify({ received: true }) };
    }

    let client = await findClient(verified.email, verified.inviteeUri, supabaseUrl, serviceKey);
    if (!client && verified.event === 'invitee.created') {
      client = await createCalendlyLead(verified, supabaseUrl, serviceKey);
    }
    if (!client) {
      await updateReceipt(receipt.row.id, {
        processing_status: 'ignored',
        processed_at: new Date().toISOString(),
        processing_error: 'No matching CRM record for canceled invitee.',
      }, supabaseUrl, serviceKey);
      return { statusCode: 200, body: JSON.stringify({ received: true, ignored: true }) };
    }

    const patch = bookingPatch(client, verified);
    if (patch) {
      await dbRequest(
        supabaseUrl,
        serviceKey,
        '/rest/v1/clients?id=eq.' + encodeURIComponent(client.id),
        { method: 'PATCH', prefer: 'return=minimal', body: patch }
      );
    }

    if (verified.event === 'invitee.created') {
      await sendConsultationBookedOnce({
        clientId: client.id,
        name: client.name || verified.invitee.name,
        email: client.email || verified.email,
        supabaseUrl,
        serviceKey,
      });
    }

    await updateReceipt(receipt.row.id, {
      client_id: client.id,
      processing_status: 'processed',
      processing_error: null,
      processed_at: new Date().toISOString(),
    }, supabaseUrl, serviceKey);
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (error) {
    console.error('Calendly webhook failed:', error.message || error);
    if (receipt?.row?.id) {
      await updateReceipt(receipt.row.id, {
        processing_status: 'failed',
        processing_error: String(error.message || error).slice(0, 1000),
      }, supabaseUrl, serviceKey).catch((updateError) => console.error('Could not record Calendly failure:', updateError.message));
    }
    const statusCode = error.statusCode === 401 || error.statusCode === 403 ? 502 : 500;
    return { statusCode, body: JSON.stringify({ error: 'Calendly event could not be processed' }) };
  }
};

module.exports._test = { bookingPatch, createCalendlyLead, findClient, vipCallBookingPatch, findVipCallClient };
