const crypto = require('crypto');

const CALENDLY_API_ORIGIN = 'https://api.calendly.com';
const CONSULTATION_EVENTS = ['invitee.created', 'invitee.canceled'];

function requireCalendlyToken() {
  const token = String(process.env.CALENDLY_ACCESS_TOKEN || '').trim();
  if (!token) throw new Error('CALENDLY_ACCESS_TOKEN is not configured.');
  return token;
}

function calendlyApiPath(input) {
  const value = String(input || '').trim();
  const url = value.startsWith('http')
    ? new URL(value)
    : new URL(value.startsWith('/') ? value : '/' + value, CALENDLY_API_ORIGIN);
  if (url.protocol !== 'https:' || url.origin !== CALENDLY_API_ORIGIN) {
    throw new Error('Calendly resource URI is not on the Calendly API origin.');
  }
  return url.pathname + url.search;
}

async function calendlyRequest(input, options = {}) {
  const token = requireCalendlyToken();
  const response = await fetch(CALENDLY_API_ORIGIN + calendlyApiPath(input), {
    method: options.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  if (!response.ok) {
    const providerMessage = body && (body.message || body.title);
    const error = new Error('Calendly API request failed (' + response.status + ')' + (providerMessage ? ': ' + providerMessage : '.'));
    error.statusCode = response.status;
    throw error;
  }
  return body || {};
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeWebhookEvent(input) {
  const event = String(input?.event || '').trim();
  const payload = input?.payload && typeof input.payload === 'object' ? input.payload : {};
  if (!CONSULTATION_EVENTS.includes(event)) throw new Error('Unsupported Calendly event.');
  const inviteeUri = String(payload.uri || '').trim();
  const eventUri = String(payload.event || payload.scheduled_event?.uri || '').trim();
  if (!inviteeUri || !eventUri) throw new Error('Calendly payload is missing its invitee or scheduled-event URI.');
  // Fail closed before the URI is ever used for a server-side request.
  const inviteePath = calendlyApiPath(inviteeUri).split('?')[0];
  const eventPath = calendlyApiPath(eventUri).split('?')[0];
  if (!/^\/scheduled_events\/[^/]+\/invitees\/[^/]+$/.test(inviteePath)) {
    throw new Error('Calendly invitee URI has an unexpected path.');
  }
  if (!/^\/scheduled_events\/[^/]+$/.test(eventPath)) {
    throw new Error('Calendly scheduled-event URI has an unexpected path.');
  }
  const occurredAt = String(input.created_at || payload.updated_at || payload.created_at || '').trim();
  return { event, payload, inviteeUri, eventUri, occurredAt };
}

function webhookEventKey(input) {
  const normalized = normalizeWebhookEvent(input);
  const material = JSON.stringify({
    event: normalized.event,
    inviteeUri: normalized.inviteeUri,
    eventUri: normalized.eventUri,
    occurredAt: normalized.occurredAt,
    status: normalized.payload.status || null,
    rescheduled: Boolean(normalized.payload.rescheduled),
  });
  return crypto.createHash('sha256').update(material).digest('hex');
}

async function verifyWebhookResources(input) {
  const normalized = normalizeWebhookEvent(input);
  const inviteeResponse = await calendlyRequest(normalized.inviteeUri);
  const invitee = inviteeResponse.resource;
  if (!invitee || String(invitee.uri || '') !== normalized.inviteeUri) {
    throw new Error('Calendly did not return the expected invitee resource.');
  }
  const verifiedEventUri = String(invitee.event || normalized.eventUri);
  if (verifiedEventUri !== normalized.eventUri) {
    throw new Error('Calendly invitee and scheduled-event resources do not match.');
  }
  const eventResponse = await calendlyRequest(verifiedEventUri);
  const scheduledEvent = eventResponse.resource;
  if (!scheduledEvent || String(scheduledEvent.uri || '') !== verifiedEventUri) {
    throw new Error('Calendly did not return the expected scheduled-event resource.');
  }
  const email = normalizeEmail(invitee.email || normalized.payload.email);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Verified Calendly invitee has no valid email address.');
  }
  if (!scheduledEvent.start_time || !Number.isFinite(Date.parse(scheduledEvent.start_time))) {
    throw new Error('Verified Calendly event has no valid start time.');
  }
  return { ...normalized, invitee, scheduledEvent, email };
}

function consultationTags(existingTags, status, markContacted) {
  const tags = Array.isArray(existingTags) ? existingTags.map(String) : [];
  const cleaned = tags.filter((tag) => !tag.startsWith('consultation:'));
  cleaned.push('consultation:' + status);
  if (markContacted) {
    const currentStage = cleaned.find((tag) => tag.startsWith('lead-stage:'));
    if (!currentStage || currentStage === 'lead-stage:new') {
      const withoutStage = cleaned.filter((tag) => !tag.startsWith('lead-stage:'));
      withoutStage.push('lead-stage:contacted');
      return [...new Set(withoutStage)];
    }
  }
  return [...new Set(cleaned)];
}

function chooseClient(rows, email, inviteeUri) {
  const candidates = (Array.isArray(rows) ? rows : []).filter((row) => normalizeEmail(row.email) === normalizeEmail(email));
  const linked = candidates.find((row) => row.calendly_invitee_uri && row.calendly_invitee_uri === inviteeUri);
  if (linked) return linked;
  const ranked = [...candidates].sort((a, b) => {
    const aLead = a.status === 'lead' ? 1 : 0;
    const bLead = b.status === 'lead' ? 1 : 0;
    if (aLead !== bLead) return bLead - aLead;
    const aTime = Date.parse(a.lead_created_at || a.created_at || '') || 0;
    const bTime = Date.parse(b.lead_created_at || b.created_at || '') || 0;
    return bTime - aTime;
  });
  return ranked[0] || null;
}

function isStaleBookingEvent(client, occurredAt) {
  const current = Date.parse(client?.calendly_booking_updated_at || '') || 0;
  const incoming = Date.parse(occurredAt || '') || 0;
  return Boolean(current && incoming && incoming < current);
}

function isConsultationEvent(scheduledEvent) {
  const expectedPrefix = String(process.env.CALENDLY_EVENT_NAME_PREFIX || 'Credit Repair Consultation').trim().toLowerCase();
  const actualName = String(scheduledEvent?.name || '').trim().toLowerCase();
  return Boolean(expectedPrefix && actualName.startsWith(expectedPrefix));
}

function webhookUrl() {
  const explicit = String(process.env.CALENDLY_WEBHOOK_URL || '').trim();
  if (explicit) {
    const url = new URL(explicit);
    if (url.protocol !== 'https:') throw new Error('CALENDLY_WEBHOOK_URL must use HTTPS.');
    return url.toString();
  }
  const base = String(process.env.URL || '').trim().replace(/\/$/, '');
  if (!base) throw new Error('Netlify URL is unavailable; set CALENDLY_WEBHOOK_URL explicitly.');
  return base + '/api/calendly-webhook';
}

function isActiveSubscription(subscription, callbackUrl) {
  const events = Array.isArray(subscription?.events) ? subscription.events : [];
  return subscription?.state === 'active'
    && subscription?.url === callbackUrl
    && CONSULTATION_EVENTS.every((event) => events.includes(event));
}

async function subscriptionStatus() {
  requireCalendlyToken();
  const me = await calendlyRequest('/users/me');
  const user = me.resource;
  if (!user?.uri || !user.current_organization) throw new Error('Calendly current-user response is incomplete.');
  const callbackUrl = webhookUrl();
  const params = new URLSearchParams({
    organization: user.current_organization,
    scope: 'user',
    user: user.uri,
    count: '100',
  });
  const list = await calendlyRequest('/webhook_subscriptions?' + params.toString());
  const subscriptions = Array.isArray(list.collection) ? list.collection : [];
  const active = subscriptions.find((subscription) => isActiveSubscription(subscription, callbackUrl)) || null;
  return { user, callbackUrl, active, subscriptions };
}

async function ensureSubscription() {
  const status = await subscriptionStatus();
  if (status.active) return { created: false, subscription: status.active, callbackUrl: status.callbackUrl };
  const created = await calendlyRequest('/webhook_subscriptions', {
    method: 'POST',
    body: {
      url: status.callbackUrl,
      events: CONSULTATION_EVENTS,
      organization: status.user.current_organization,
      user: status.user.uri,
      scope: 'user',
    },
  });
  if (!created.resource || !isActiveSubscription(created.resource, status.callbackUrl)) {
    throw new Error('Calendly did not return an active webhook subscription.');
  }
  return { created: true, subscription: created.resource, callbackUrl: status.callbackUrl };
}

module.exports = {
  CONSULTATION_EVENTS,
  calendlyRequest,
  chooseClient,
  consultationTags,
  ensureSubscription,
  isActiveSubscription,
  isConsultationEvent,
  isStaleBookingEvent,
  normalizeEmail,
  normalizeWebhookEvent,
  requireCalendlyToken,
  subscriptionStatus,
  verifyWebhookResources,
  webhookEventKey,
  webhookUrl,
};
