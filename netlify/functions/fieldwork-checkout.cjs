/**
 * Stripe Checkout session for Fieldwork plans.
 * Uses FIELDWORK_STRIPE_* only — never CCC billing/ledger.
 * If Stripe is not configured, returns a demo acknowledgment so the UI
 * can keep working without touching any live payments.
 */
const https = require('https');
const {
  requireFieldworkUser,
  getOrCreateSubscriber,
  fwRest,
  json,
  PLAN_CREDITS,
  planCredits,
} = require('./_fieldworkAuth.cjs');
const { fieldworkStripe, fieldworkSupabase } = require('./_fieldworkEnv.cjs');

const PLAN_AMOUNT = { starter: 4900, pro: 9900, unlimited: 14900 };

function stripeForm(path, secretKey, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const req = https.request({
      hostname: 'api.stripe.com',
      path,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  try {
    const caller = await requireFieldworkUser(event);
    const body = JSON.parse(event.body || '{}');
    const planId = body.plan_id || 'pro';
    if (!PLAN_CREDITS[planId]) return json(400, { error: 'Invalid plan_id' });

    const credits = planCredits(planId);
    const subscriber = await getOrCreateSubscriber(caller, { plan_id: planId, email: caller.email });
    const stripe = fieldworkStripe();

    // Demo / not-configured path — update credits in Fieldwork tables only.
    if (!stripe.secretKey) {
      const { url, serviceKey } = fieldworkSupabase();
      const patch = {
        plan_id: planId,
        mail_credits: credits.mail,
        audit_credits: credits.audit,
        expert_chat_credits: credits.expert,
        updated_at: new Date().toISOString(),
      };
      await fwRest(`/rest/v1/fieldwork_subscribers?id=eq.${subscriber.id}`, 'PATCH', serviceKey, url, patch);
      await fwRest('/rest/v1/fieldwork_billing_events', 'POST', serviceKey, url, {
        subscriber_id: subscriber.id,
        label: `${planId} plan · demo checkout`,
        amount_cents: PLAN_AMOUNT[planId],
        status: 'demo',
      });
      return json(200, {
        mode: 'demo',
        isolated: true,
        message: 'FIELDWORK_STRIPE_SECRET_KEY not set — applied plan in Fieldwork DB only.',
        plan_id: planId,
        mail_credits: credits.mail,
        audit_credits: credits.audit,
        expert_chat_credits: credits.expert,
      });
    }

    const priceEnv = {
      starter: stripe.priceStarter,
      pro: stripe.pricePro,
      unlimited: stripe.priceUnlimited,
    }[planId];

    if (!priceEnv) {
      return json(503, { error: `Missing FIELDWORK_STRIPE_PRICE_${planId.toUpperCase()}` });
    }

    const successUrl = body.success_url || 'https://example.com/diy.html#/app/billing?ok=1';
    const cancelUrl = body.cancel_url || 'https://example.com/diy.html#/app/billing?cancelled=1';

    const session = await stripeForm('/v1/checkout/sessions', stripe.secretKey, {
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: subscriber.id,
      customer_email: subscriber.email,
      'line_items[0][price]': priceEnv,
      'line_items[0][quantity]': '1',
      'metadata[fieldwork_subscriber_id]': subscriber.id,
      'metadata[plan_id]': planId,
      'metadata[product]': 'fieldwork',
    });

    if (session.status >= 400) {
      return json(502, { error: session.body?.error?.message || 'Stripe error' });
    }

    return json(200, {
      mode: 'stripe',
      isolated: true,
      url: session.body.url,
      session_id: session.body.id,
    });
  } catch (e) {
    return json(e.statusCode || 500, { error: e.message || 'Checkout failed' });
  }
};
