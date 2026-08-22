#!/usr/bin/env node
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const {
  chooseClient,
  consultationTags,
  ensureSubscription,
  isConsultationEvent,
  isStaleBookingEvent,
  normalizeWebhookEvent,
  webhookEventKey,
} = require('../netlify/functions/_calendly.cjs');
const { leadNurtureContext, shouldSuppressGenericNurture, sourceAwareNurtureBody } = require('../netlify/functions/_leadNurture.cjs');
const { createGuideDownloadToken, verifyGuideDownloadToken } = require('../netlify/functions/_guideDownloadToken.cjs');
const { _test: { intakeLeadFields, normalizeIntent } } = require('../netlify/functions/public-intake.cjs');
const { handler: guideDownloadHandler } = require('../netlify/functions/guide-download.cjs');
const { bookedEmail } = require('../netlify/functions/_consultationBooking.cjs');
const { handler: calendlyWebhookHandler, _test: { bookingPatch } } = require('../netlify/functions/calendly-webhook.cjs');

let failed = 0;
function assert(condition, message) {
  if (condition) console.log('ok:', message);
  else { failed += 1; console.error('FAIL:', message); }
}

const payload = {
  created_at: '2026-08-11T01:00:00.000Z',
  event: 'invitee.created',
  payload: {
    uri: 'https://api.calendly.com/scheduled_events/event-1/invitees/invitee-1',
    event: 'https://api.calendly.com/scheduled_events/event-1',
    status: 'active',
    rescheduled: false,
  },
};

const normalized = normalizeWebhookEvent(payload);
assert(normalized.inviteeUri.endsWith('/invitees/invitee-1'), 'normalizes a supported invitee webhook');
assert(webhookEventKey(payload) === webhookEventKey(structuredClone(payload)), 'webhook event key is deterministic');

let rejectedForeignUri = false;
try {
  normalizeWebhookEvent({ ...payload, payload: { ...payload.payload, uri: 'https://example.com/private' } });
} catch { rejectedForeignUri = true; }
assert(rejectedForeignUri, 'rejects non-Calendly resource URIs before server fetch');

const rows = [
  { id: 'old-lead', status: 'lead', email: 'person@example.com', lead_created_at: '2026-08-01T00:00:00Z' },
  { id: 'client', status: 'active', email: 'person@example.com', created_at: '2026-08-10T00:00:00Z' },
  { id: 'new-lead', status: 'lead', email: 'person@example.com', lead_created_at: '2026-08-09T00:00:00Z' },
];
assert(chooseClient(rows, 'PERSON@example.com', normalized.inviteeUri)?.id === 'new-lead', 'matches the newest lead before an active client');
rows[0].calendly_invitee_uri = normalized.inviteeUri;
assert(chooseClient(rows, 'person@example.com', normalized.inviteeUri)?.id === 'old-lead', 'prefers an exact invitee URI link');

const tags = consultationTags(['lead-stage:new', 'source:web', 'consultation:canceled'], 'scheduled', true);
assert(tags.includes('lead-stage:contacted') && !tags.includes('lead-stage:new'), 'booking moves a new lead to contacted');
assert(tags.includes('consultation:scheduled') && !tags.includes('consultation:canceled'), 'booking replaces the consultation lifecycle tag');

assert(!shouldSuppressGenericNurture({ consultation_status: 'requested', tags: ['lead-stage:new'] }), 'an unbooked request remains nurture eligible');
assert(shouldSuppressGenericNurture({ consultation_status: 'scheduled', tags: [] }), 'a booking suppresses generic nurture');
assert(shouldSuppressGenericNurture({ consultation_status: 'canceled', tags: [] }), 'a canceled consultation stays suppressed');
assert(shouldSuppressGenericNurture({ consultation_status: 'requested', tags: ['lead-stage:contacted'] }), 'staff contact suppresses generic nurture');
assert(shouldSuppressGenericNurture({ consultation_status: null, tags: ['lead-stage:audit'] }), 'audit stage suppresses generic nurture');
assert(leadNurtureContext({ consultation_status: 'requested', tags: [] }).consultationRequested, 'requested consultation carries abandonment context');
assert(leadNurtureContext({ tags: ['guide:viewed'] }).guideDownloaded, 'recorded guide view carries source context');
assert(leadNurtureContext({ tags: ['guide:downloaded'] }).guideDownloaded, 'historic guide tags remain compatible');

const consultationDay1 = sourceAwareNurtureBody(1, { consultationRequested: true });
assert(/haven't selected a time/i.test(consultationDay1), 'unbooked consultation gets completion-specific day-one copy');
assert(!/download/i.test(consultationDay1), 'unbooked consultation copy never claims a guide download');
const guideDay1 = sourceAwareNurtureBody(1, { guideDownloaded: true });
assert(/reviewing our free credit report accuracy guide/i.test(guideDay1), 'recorded guide view gets guide-specific day-one copy');
assert(!/guide you downloaded/i.test(sourceAwareNurtureBody(3, {})), 'generic day-three copy never claims a guide download');

assert(normalizeIntent() === 'consultation' && normalizeIntent('guide_download') === 'guide_download', 'public intake recognizes consultation and guide intents');
assert(normalizeIntent('unknown') === null, 'public intake rejects unknown intent');
const guideFields = intakeLeadFields('guide_download', null, 'Guide Download');
assert(guideFields.consultation_status === null && guideFields.tags.includes('source:freeguide'), 'guide capture does not masquerade as a consultation request');
const consultationFields = intakeLeadFields('consultation', null, 'Consultation');
assert(consultationFields.consultation_status === 'requested', 'consultation capture remains a requested consultation');

const guideToken = createGuideDownloadToken('lead-1', 'secret', 1000);
assert(verifyGuideDownloadToken(guideToken, 'secret', 1001) === 'lead-1', 'guide download token verifies for its captured lead');
assert(verifyGuideDownloadToken(guideToken + 'x', 'secret', 1001) === null, 'guide download token rejects tampering');
assert(verifyGuideDownloadToken(guideToken, 'secret', 1000 + (31 * 24 * 60 * 60)) === null, 'guide download token expires');

assert(isStaleBookingEvent({ calendly_booking_updated_at: '2026-08-11T02:00:00Z' }, '2026-08-11T01:00:00Z'), 'detects an out-of-order booking event');
assert(!isStaleBookingEvent({ calendly_booking_updated_at: '2026-08-11T01:00:00Z' }, '2026-08-11T02:00:00Z'), 'accepts a newer booking event');
assert(isConsultationEvent({ name: 'Credit Repair Consultation - Credit Comeback Club' }), 'accepts the configured consultation event family');
assert(!isConsultationEvent({ name: 'Internal Team Meeting' }), 'ignores unrelated Calendly event types');

const completedReschedulePatch = bookingPatch(
  {
    consultation_status: 'rescheduled',
    calendly_invitee_uri: 'https://api.calendly.com/scheduled_events/old/invitees/old',
    calendly_booking_updated_at: '2026-08-11T02:00:00Z',
    tags: ['lead-stage:contacted', 'consultation:rescheduled'],
  },
  {
    event: 'invitee.created',
    occurredAt: '2026-08-11T01:59:59Z',
    inviteeUri: payload.payload.uri,
    eventUri: payload.payload.event,
    payload: {},
    invitee: {},
    scheduledEvent: { start_time: '2026-08-13T18:00:00Z' },
  }
);
assert(completedReschedulePatch?.consultation_status === 'scheduled', 'new invitee completes a reschedule even if webhook timestamps cross');

const message = bookedEmail('<Chris> Test');
assert(message.html.includes('&lt;Chris&gt;') && !message.html.includes('Hi <Chris>'), 'escapes invitee names in booking email HTML');
assert(message.subject.includes('<Chris>'), 'keeps the human-readable first name in the subject');

for (const file of ['public/home.html', 'public/freeguide.html', 'public/join.html', 'public/join-embed.js']) {
  const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  assert(source.includes('creditcomebackclub/consultation'), `${file} uses the consultation booking URL`);
  assert(!source.includes('creditcomebackclub/30min'), `${file} has no retired Calendly URL`);
  assert(source.includes('prefill'), `${file} prefills Calendly from the matching intake record`);
}
const guideSource = readFileSync(new URL('../public/freeguide.html', import.meta.url), 'utf8');
assert(!/no[ -]?email required/i.test(guideSource), 'guide page no longer claims that email is unnecessary');
assert(!/openIntake\('Guide Download'\)/.test(guideSource), 'the on-page guide does not pretend a download is required');
assert(!/href="downloads\/7-Metro2-Dispute-Templates\.pdf"/i.test(guideSource), 'guide PDF is no longer exposed through a direct untracked link');
assert(!guideSource.includes('intake.downloadUrl'), 'the current guide does not request a retired downloadable asset');
const guideEndpoint = readFileSync(new URL('../netlify/functions/guide-download.cjs', import.meta.url), 'utf8');
assert(guideEndpoint.includes("'guide:viewed'") && /statusCode:\s*302/.test(guideEndpoint), 'historic tracked links record a guide view and redirect to the current page');
assert(!/7-Metro2-Dispute-Templates/.test(guideEndpoint), 'the tracked endpoint cannot issue the retired PDF');

function response(body, status = 200) {
  return new Response(body == null || status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

process.env.CALENDLY_ACCESS_TOKEN = 'test-token';
process.env.VITE_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  calls.push({ url: target, options });
  if (target === payload.payload.uri) {
    return response({ resource: {
      uri: payload.payload.uri,
      event: payload.payload.event,
      email: 'person@example.com',
      name: 'Person Example',
      status: 'active',
      updated_at: payload.created_at,
    } });
  }
  if (target === payload.payload.event) {
    return response({ resource: {
      uri: payload.payload.event,
      name: 'Credit Repair Consultation',
      status: 'active',
      start_time: '2026-08-12T18:00:00.000Z',
    } });
  }
  if (target.includes('/rest/v1/calendly_webhook_events?on_conflict=')) {
    return response([{ id: 'receipt-1', processing_status: 'processing' }]);
  }
  if (target.includes('/rest/v1/clients?calendly_invitee_uri=')) return response([]);
  if (target.includes('/rest/v1/clients?email=eq.')) {
    return response([{
      id: 'client-1',
      name: 'Person Example',
      email: 'person@example.com',
      status: 'lead',
      tags: ['lead-stage:new'],
      lead_created_at: '2026-08-11T00:00:00.000Z',
    }]);
  }
  if (target.includes('/rest/v1/clients?id=eq.client-1')) return response(null, 204);
  if (target.endsWith('/rest/v1/rpc/claim_automated_email_send')) return response({ claimed: false });
  if (target.includes('/rest/v1/calendly_webhook_events?id=eq.receipt-1')) return response(null, 204);
  throw new Error('Unexpected mocked request: ' + target);
};

const handlerResult = await calendlyWebhookHandler({ httpMethod: 'POST', body: JSON.stringify(payload) });
assert(handlerResult.statusCode === 200, 'verified invitee.created webhook returns success');
const clientPatchCall = calls.find((call) => call.url.includes('/rest/v1/clients?id=eq.client-1'));
const clientPatch = clientPatchCall ? JSON.parse(clientPatchCall.options.body) : null;
assert(clientPatch?.consultation_status === 'scheduled', 'verified booking marks the CRM consultation scheduled');
assert(clientPatch?.consultation_scheduled_at === '2026-08-12T18:00:00.000Z', 'verified booking stores the Calendly start time');
assert(clientPatch?.tags?.includes('lead-stage:contacted'), 'verified booking moves the lead into human-owned follow-up');
assert(calls.filter((call) => call.url.endsWith('/rest/v1/rpc/claim_automated_email_send')).length === 1, 'verified booking claims exactly one preparation email');

calls.length = 0;
globalThis.fetch = async (url) => {
  const target = String(url);
  calls.push({ url: target });
  if (target === payload.payload.uri) {
    return response({ resource: {
      uri: payload.payload.uri,
      event: payload.payload.event,
      email: 'person@example.com',
      name: 'Person Example',
      status: 'active',
      updated_at: payload.created_at,
    } });
  }
  if (target === payload.payload.event) {
    return response({ resource: { uri: payload.payload.event, name: 'Credit Repair Consultation', start_time: '2026-08-12T18:00:00.000Z' } });
  }
  throw new Error('No database request should occur for a lifecycle mismatch.');
};
const spoofedCancel = structuredClone(payload);
spoofedCancel.event = 'invitee.canceled';
spoofedCancel.payload.status = 'canceled';
const spoofResult = await calendlyWebhookHandler({ httpMethod: 'POST', body: JSON.stringify(spoofedCancel) });
assert(spoofResult.statusCode === 500, 'rejects a canceled webhook when Calendly still reports the invitee active');
assert(calls.every((call) => call.url.startsWith('https://api.calendly.com/')), 'does not persist an unverified lifecycle event');

calls.length = 0;
process.env.URL = 'https://ccc-example.netlify.app';
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  calls.push({ url: target, options });
  if (target === 'https://api.calendly.com/users/me') {
    return response({ resource: {
      uri: 'https://api.calendly.com/users/user-1',
      current_organization: 'https://api.calendly.com/organizations/org-1',
    } });
  }
  if (target.startsWith('https://api.calendly.com/webhook_subscriptions?')) return response({ collection: [] });
  if (target === 'https://api.calendly.com/webhook_subscriptions' && options.method === 'POST') {
    const request = JSON.parse(options.body);
    return response({ resource: {
      uri: 'https://api.calendly.com/webhook_subscriptions/sub-1',
      state: 'active',
      callback_url: request.url,
      events: request.events,
    } }, 201);
  }
  throw new Error('Unexpected Calendly setup request: ' + target);
};
const subscriptionResult = await ensureSubscription();
assert(subscriptionResult.created, 'creates a Calendly webhook subscription when none exists');
const subscriptionPost = calls.find((call) => call.options.method === 'POST');
const subscriptionBody = subscriptionPost ? JSON.parse(subscriptionPost.options.body) : null;
assert(subscriptionBody?.scope === 'user', 'registers a least-privilege user-scoped webhook');
assert(subscriptionBody?.url === 'https://ccc-example.netlify.app/api/calendly-webhook', 'registers the stable production callback URL');
assert(subscriptionBody?.events?.join(',') === 'invitee.created,invitee.canceled', 'subscribes only to booking and cancellation events');

calls.length = 0;
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  calls.push({ url: target, options });
  if (target.includes('/rest/v1/clients?id=eq.lead-1&select=id,tags')) {
    return response([{ id: 'lead-1', tags: ['source:freeguide'] }]);
  }
  if (target.includes('/rest/v1/clients?id=eq.lead-1') && options.method === 'PATCH') return response(null, 204);
  throw new Error('Unexpected guide tracking request: ' + target);
};
const trackedGuideToken = createGuideDownloadToken('lead-1', 'test-service-key');
const guideDownloadResult = await guideDownloadHandler({ httpMethod: 'GET', queryStringParameters: { token: trackedGuideToken } });
assert(guideDownloadResult.statusCode === 302 && guideDownloadResult.headers.Location === '/freeguide.html', 'valid historic guide token redirects to the current guide');
const guideTrackingPatch = calls.find((call) => call.options.method === 'PATCH');
assert(JSON.parse(guideTrackingPatch?.options.body || '{}').tags?.includes('guide:viewed'), 'guide redirect records the current guide view');

globalThis.fetch = originalFetch;

if (failed) {
  console.error(`\n${failed} Calendly integration assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll Calendly integration assertions passed');
