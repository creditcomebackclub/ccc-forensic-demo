/**
 * Upsert Fieldwork subscriber + return workspace snapshot.
 * Isolated from CCC client_profiles / clients CRM.
 */
const {
  requireFieldworkUser,
  getOrCreateSubscriber,
  fwRest,
  json,
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
    if (body.full_name || body.address_line1 || body.plan_id) {
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
      if (body.plan_id) {
        patch.plan_id = body.plan_id;
        patch.mail_credits = body.plan_id === 'starter' ? 3 : body.plan_id === 'unlimited' ? 30 : 12;
      }
      const updated = await fwRest(
        `/rest/v1/fieldwork_subscribers?id=eq.${subscriber.id}`,
        'PATCH',
        serviceKey,
        url,
        patch,
      );
      if (Array.isArray(updated.body) && updated.body[0]) {
        Object.assign(subscriber, updated.body[0]);
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
