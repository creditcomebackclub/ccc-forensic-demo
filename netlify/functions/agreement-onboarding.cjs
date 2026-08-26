const { createClient } = require('@supabase/supabase-js');
const { requireAdmin } = require('./_requireAdmin.cjs');
const { sendEmail, isConfigured, wrapClientEmail, escapeHtml } = require('./_email.cjs');
const {
  ACTIVE_PRICING_VERSION,
  AGREEMENT_TEMPLATE_VERSION,
  sha256,
  planSnapshot,
  templateLiveReadiness,
} = require('./_serviceAgreement.cjs');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function rest(path, method, body, url, key, prefer = 'return=representation') {
  const res = await fetch(url + path, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: prefer },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!res.ok) throw new Error(typeof data === 'object' && data?.message ? data.message : `Database request failed (${res.status})`);
  return data;
}

async function loadPricingSettings(url, key) {
  const path = '/storage/v1/object/authenticated/client-docs/admin/settings.json';
  const res = await fetch(url + path, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const raw = await res.text();
  if (res.status === 404 || (!res.ok && /(?:object\s+)?not\s+found/i.test(raw))) {
    return { version: ACTIVE_PRICING_VERSION, tiers: {}, source: 'default_settings', settingsHash: null };
  }
  if (!res.ok) throw new Error(`Could not load saved pricing settings (${res.status}).`);
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('Saved pricing settings are malformed JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Saved pricing settings must be an object.');
  const pricing = parsed.pricing == null ? {} : parsed.pricing;
  if (typeof pricing !== 'object' || Array.isArray(pricing)) throw new Error('Saved pricing settings are malformed.');
  const tiers = pricing.tiers == null ? {} : pricing.tiers;
  if (typeof tiers !== 'object' || Array.isArray(tiers)) throw new Error('Saved tier pricing settings are malformed.');
  const version = String(pricing.version || '');
  if (version !== ACTIVE_PRICING_VERSION) {
    return {
      version: ACTIVE_PRICING_VERSION,
      tiers: {},
      source: 'owner_approved_defaults_retired_legacy_settings',
      settingsHash: sha256(raw),
    };
  }
  return { version, tiers, source: 'admin_settings_file', settingsHash: sha256(raw) };
}

async function recordEvent({ agreementId, eventType, actorType, actorId, eventData }, url, key) {
  await rest('/rest/v1/client_service_agreement_events', 'POST', {
    agreement_id: agreementId, event_type: eventType, actor_type: actorType,
    actor_id: actorId || null, event_data: eventData || {},
  }, url, key, 'return=minimal');
}

async function preparePortalMagicLink({ client, url, key, origin }) {
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = String(client.email || '').trim().toLowerCase();
  const { error: createError } = await sb.auth.admin.createUser({
    email, email_confirm: true, user_metadata: { full_name: client.name },
  });
  if (createError && !/already\s+(been\s+)?(registered|exists)|email[_ ]exists/i.test(createError.message || '')) {
    throw new Error(createError.message);
  }
  const { data: linkData, error: linkError } = await sb.auth.admin.generateLink({
    type: 'magiclink', email, options: { redirectTo: `${origin.replace(/\/$/, '')}/login` },
  });
  if (linkError || !linkData?.user?.id || !linkData?.properties?.action_link) {
    throw new Error(linkError?.message || 'Could not generate the secure portal link.');
  }
  const linkedProfileId = await rest('/rest/v1/rpc/ccc_link_portal_profile_for_onboarding', 'POST', {
    p_portal_user_id: linkData.user.id,
    p_client_id: client.id,
    p_email: email,
    p_full_name: client.name,
  }, url, key, 'return=representation');
  if (!linkedProfileId) throw new Error('Could not securely link the client portal identity.');
  return { portalUserId: linkData.user.id, profileId: linkedProfileId, actionLink: linkData.properties.action_link };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  let caller;
  try { caller = await requireAdmin(event); }
  catch (error) { return error.statusCode ? error : json(500, { error: error.message || 'Authorization failed' }); }

  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json(500, { error: 'Server not configured' });
  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  const clientId = String(payload.clientId || '');
  const action = payload.action || 'prepare';
  const requestedTemplateVersion = String(payload.templateVersion || AGREEMENT_TEMPLATE_VERSION);
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return json(400, { error: 'A valid client is required.' });
  if (!['prepare', 'start'].includes(action)) return json(400, { error: 'Unknown onboarding action.' });
  if (requestedTemplateVersion !== AGREEMENT_TEMPLATE_VERSION) return json(409, { error: 'Select the current service-agreement-only template before onboarding.' });

  try {
    const clients = await rest('/rest/v1/clients?id=eq.' + encodeURIComponent(clientId)
      + '&select=id,user_id,name,email,phone,address,billing_tier,billing_type,billing_recurring_amount,service_agreement_mode,service_agreement_label,service_agreement_amount,service_agreement_fee_text,engagement_status', 'GET', undefined, url, key);
    const client = clients?.[0];
    if (!client?.user_id) return json(409, { error: 'This client is not linked to a firm account.' });
    if (!client.email) return json(409, { error: 'Add the client email before starting onboarding.' });
    const templates = await rest('/rest/v1/service_agreement_templates?version=eq.' + encodeURIComponent(requestedTemplateVersion)
      + '&select=id,version,title,legal_status,packet_kind,body_html,consumer_disclosure_html,cancellation_notice_html,cancellation_calendar_kind&limit=1', 'GET', undefined, url, key);
    const template = templates?.[0];
    if (!template) return json(409, { error: 'Agreement template is not installed.' });
    const pricing = await loadPricingSettings(url, key);
    let plan;
    try { plan = planSnapshot(client, pricing); }
    catch (planError) { return json(409, { error: planError.message }); }
    if (plan.mode === 'tier' && plan.billingType !== plan.expectedBillingType) {
      return json(409, {
        error: `${plan.billingTier} requires Billing Type “${plan.expectedBillingType}” before onboarding can start.`,
      });
    }

    const clientSnapshot = {
      name: String(client.name || '').trim(),
      email: String(client.email || '').trim().toLowerCase(),
      phone: String(client.phone || '').trim() || null,
      address: client.address || null,
    };
    if (!clientSnapshot.name) return json(409, { error: 'Add the client legal name before starting onboarding.' });
    const documentSnapshot = {
      templateVersion: template.version,
      packetKind: template.packet_kind,
      agreementBodyHtml: String(template.body_html || ''),
      consumerDisclosureHtml: String(template.consumer_disclosure_html || ''),
      cancellationNoticeHtml: String(template.cancellation_notice_html || ''),
      cancellationCalendarKind: String(template.cancellation_calendar_kind || ''),
      agreementBodyHash: sha256(String(template.body_html || '')),
      consumerDisclosureHash: sha256(String(template.consumer_disclosure_html || '')),
      cancellationNoticeHash: sha256(String(template.cancellation_notice_html || '')),
      planSnapshotHash: sha256(JSON.stringify(plan)),
      pricingSource: plan.pricingSource,
      pricingSettingsHash: plan.pricingSettingsHash,
      preparedAt: new Date().toISOString(),
    };
    const readiness = templateLiveReadiness(template);
    if (!readiness.ready) {
      return json(action === 'start' ? 409 : 200, {
        status: template.legal_status,
        sendBlocked: true,
        blockers: readiness.blockers,
        templateVersion: template.version,
        clientName: clientSnapshot.name,
        planSnapshot: plan,
        message: 'Onboarding is blocked until the service agreement and separate disclosure receive final approval.',
      });
    }
    if (action === 'start' && !isConfigured()) {
      return json(409, { error: 'Email delivery is not configured. Onboarding was not started.' });
    }

    // A new packet is a new snapshot. Existing unsigned packets can never be
    // silently edited after staff change a plan.
    const openPackets = await rest('/rest/v1/client_service_agreements?client_id=eq.' + encodeURIComponent(clientId)
      + '&user_id=eq.' + encodeURIComponent(client.user_id)
      + '&status=in.(draft,sent)&select=id,status', 'GET', undefined, url, key);
    for (const packet of openPackets || []) {
      await rest('/rest/v1/client_service_agreements?id=eq.' + encodeURIComponent(packet.id), 'PATCH', { status: 'superseded', superseded_at: new Date().toISOString() }, url, key, 'return=minimal');
      await recordEvent({ agreementId: packet.id, eventType: 'superseded', actorType: 'staff', actorId: caller.userId, eventData: { reason: 'A new service-plan snapshot was prepared.' } }, url, key);
    }

    const inserted = await rest('/rest/v1/client_service_agreements', 'POST', {
      user_id: client.user_id, client_id: client.id, template_id: template.id, template_version: template.version,
      plan_snapshot: plan, client_snapshot: clientSnapshot, document_snapshot: documentSnapshot,
      cancellation_calendar_kind: template.cancellation_calendar_kind, created_by: caller.userId,
    }, url, key);
    const agreement = inserted?.[0];
    if (!agreement) throw new Error('Agreement packet was not created.');
    await recordEvent({ agreementId: agreement.id, eventType: 'prepared', actorType: 'staff', actorId: caller.userId, eventData: {
      templateVersion: template.version,
      plan,
      clientName: clientSnapshot.name,
      agreementBodyHash: documentSnapshot.agreementBodyHash,
      consumerDisclosureHash: documentSnapshot.consumerDisclosureHash,
      cancellationNoticeHash: documentSnapshot.cancellationNoticeHash,
    } }, url, key);

    if (action === 'prepare') return json(200, {
      agreementId: agreement.id, status: 'draft', sendBlocked: false,
      templateVersion: template.version, clientName: clientSnapshot.name, planSnapshot: plan,
      message: 'Packet prepared and ready to send.',
    });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const base = (process.env.APP_URL || event.headers.origin || 'https://credit-comeback-club.netlify.app').replace(/\/$/, '');
    const portal = await preparePortalMagicLink({ client: { id: client.id, name: clientSnapshot.name, email: clientSnapshot.email }, url, key, origin: base });
    const sentRows = await rest('/rest/v1/client_service_agreements?id=eq.' + encodeURIComponent(agreement.id) + '&status=eq.draft', 'PATCH', {
      status: 'sent', signing_token_hash: null, signing_expires_at: expiresAt, sent_at: new Date().toISOString(),
    }, url, key);
    if (!sentRows?.[0]) throw new Error('Packet was changed before it could be sent. Prepare it again.');
    await sendEmail({
      to: client.email,
      subject: 'Complete your Credit Comeback Club onboarding',
      html: wrapClientEmail({
        eyebrow: 'Secure Client Onboarding',
        bodyHtml: `<p>Hi ${escapeHtml(clientSnapshot.name)},</p><p>Use your secure portal to upload your government ID and proof of address, review your personalized Client Service Agreement, separately acknowledge your Consumer Credit File Rights disclosure, receive both copies of the Notice of Cancellation, and sign.</p><p>This magic link expires according to the secure login provider's policy. Your prepared agreement packet is available for seven days.</p><p style="font-size:12px;color:#6B7280;">No payment is created by completing this signing process.</p>`,
        cta: { href: portal.actionLink, label: 'Continue secure onboarding →' },
      }),
      tags: { kind: 'portal_onboarding_invite', agreement_id: agreement.id },
    });
    await recordEvent({ agreementId: agreement.id, eventType: 'sent', actorType: 'staff', actorId: caller.userId, eventData: {
      expiresAt, delivery: 'portal_magic_link', portalUserId: portal.portalUserId, portalProfileId: portal.profileId,
      templateVersion: template.version, planSnapshot: plan, clientName: clientSnapshot.name,
    } }, url, key);
    return json(200, {
      agreementId: agreement.id, status: 'sent', sendBlocked: false, expiresAt,
      templateVersion: template.version, clientName: clientSnapshot.name, planSnapshot: plan,
    });
  } catch (error) {
    console.error('agreement-onboarding:', error.message);
    return json(500, { error: error.message || 'Could not prepare onboarding.' });
  }
};

exports._test = { loadPricingSettings, preparePortalMagicLink };
