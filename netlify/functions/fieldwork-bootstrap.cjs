/**
 * Upsert Fieldwork subscriber + return workspace snapshot.
 * Isolated from CCC client_profiles / clients CRM.
 */
const {
  requireFieldworkUser,
  getOrCreateSubscriber,
  fwRest,
  json,
  planCredits,
} = require('./_fieldworkAuth.cjs');
const { fieldworkSupabase } = require('./_fieldworkEnv.cjs');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type' } };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'POST only' });
  }

  try {
    const caller = await requireFieldworkUser(event);
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) { body = {}; }

    const subscriber = await getOrCreateSubscriber(caller, {
      email: body.email || caller.email,
      full_name: body.full_name,
      address_line1: body.address_line1,
      address_city: body.address_city,
      address_state: body.address_state,
      address_zip: body.address_zip,
      plan_id: body.plan_id,
    });

    // Optional profile patch (never touches CCC tables)
    const hasSignaturePatch = Object.prototype.hasOwnProperty.call(body, 'signature_data');
    if (body.full_name || body.address_line1 || body.plan_id || body.email || hasSignaturePatch) {
      const { url, serviceKey } = fieldworkSupabase();
      const patch = {
        updated_at: new Date().toISOString(),
      };
      if (body.full_name != null) patch.full_name = body.full_name;
      if (body.email != null) patch.email = body.email;
      if (body.address_line1 != null) patch.address_line1 = body.address_line1;
      if (body.address_city != null) patch.address_city = body.address_city;
      if (body.address_state != null) patch.address_state = body.address_state;
      if (body.address_zip != null) patch.address_zip = body.address_zip;
      if (hasSignaturePatch) patch.signature_data = body.signature_data || null;
      if (body.plan_id) {
        const credits = planCredits(body.plan_id);
        patch.plan_id = body.plan_id;
        patch.mail_credits = credits.mail;
        patch.audit_credits = credits.audit;
        patch.expert_chat_credits = credits.expert;
      }
      const updated = await fwRest(
        `/rest/v1/fieldwork_subscribers?id=eq.${subscriber.id}`,
        'PATCH',
        serviceKey,
        url,
        patch,
      );
      if (updated.status >= 400) {
        const detail = (updated.body && (updated.body.message || updated.body.error)) || 'Profile update failed';
        const err = new Error(
          /signature_data/i.test(String(detail))
            ? 'Signature column missing — run migration 20260802030000_fieldwork_signature_data.sql on Fieldwork Supabase.'
            : detail,
        );
        err.statusCode = updated.status;
        throw err;
      }
      if (Array.isArray(updated.body) && updated.body[0]) {
        Object.assign(subscriber, updated.body[0]);
      } else {
        // Prefer:return=representation sometimes empty — re-read so plan switches stick.
        const refreshed = await fwRest(
          `/rest/v1/fieldwork_subscribers?id=eq.${subscriber.id}&select=*`,
          'GET',
          serviceKey,
          url,
        );
        if (Array.isArray(refreshed.body) && refreshed.body[0]) {
          Object.assign(subscriber, refreshed.body[0]);
        }
      }
      if (body.plan_id && subscriber.plan_id !== body.plan_id) {
        const err = new Error(`Plan did not persist (still ${subscriber.plan_id}). Try again.`);
        err.statusCode = 500;
        throw err;
      }
    }

    const { url, serviceKey } = fieldworkSupabase();
    const campaigns = await fwRest(
      `/rest/v1/fieldwork_campaigns?subscriber_id=eq.${subscriber.id}&select=*&order=created_at.desc&limit=20`,
      'GET',
      serviceKey,
      url,
    );
    const billing = await fwRest(
      `/rest/v1/fieldwork_billing_events?subscriber_id=eq.${subscriber.id}&select=*&order=created_at.desc&limit=20`,
      'GET',
      serviceKey,
      url,
    );
    const documents = await fwRest(
      `/rest/v1/fieldwork_documents?subscriber_id=eq.${subscriber.id}&select=*&order=created_at.desc&limit=50`,
      'GET',
      serviceKey,
      url,
    );

    return json(200, {
      product: 'fieldwork',
      isolated: true,
      subscriber,
      campaigns: Array.isArray(campaigns.body) ? campaigns.body : [],
      billing: Array.isArray(billing.body) ? billing.body : [],
      documents: Array.isArray(documents.body) ? documents.body : [],
    });
  } catch (e) {
    return json(e.statusCode || 500, { error: e.message || 'Fieldwork bootstrap failed' });
  }
};
