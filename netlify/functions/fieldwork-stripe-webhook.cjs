/**
 * Stripe webhook for Fieldwork billing.
 * Syncs subscription status + resets monthly credits on paid invoices.
 */
const crypto = require('crypto');
const { fwRest, json, planCredits } = require('./_fieldworkAuth.cjs');
const { fieldworkSupabase, fieldworkStripe } = require('./_fieldworkEnv.cjs');

function readRawBody(event) {
  if (!event?.body) return '';
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64').toString('utf8');
  }
  return event.body;
}

function verifyStripeSignature(rawBody, signatureHeader, webhookSecret) {
  if (!signatureHeader || !webhookSecret) return false;
  const parts = String(signatureHeader).split(',').map((s) => s.trim());
  const ts = parts.find((p) => p.startsWith('t='))?.slice(2);
  const v1 = parts.find((p) => p.startsWith('v1='))?.slice(3);
  if (!ts || !v1) return false;
  const signedPayload = `${ts}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(signedPayload, 'utf8')
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'));
  } catch {
    return false;
  }
}

function planFromPrice(priceId, stripe) {
  if (!priceId) return null;
  if (priceId === stripe.priceStarter) return 'starter';
  if (priceId === stripe.pricePro) return 'pro';
  if (priceId === stripe.priceUnlimited) return 'unlimited';
  return null;
}

async function findSubscriber({ subscriberId, customerId }) {
  const { url, serviceKey } = fieldworkSupabase();
  if (subscriberId) {
    const byId = await fwRest(
      `/rest/v1/fieldwork_subscribers?id=eq.${encodeURIComponent(subscriberId)}&select=*`,
      'GET',
      serviceKey,
      url,
    );
    if (Array.isArray(byId.body) && byId.body[0]) return byId.body[0];
  }
  if (customerId) {
    const byCustomer = await fwRest(
      `/rest/v1/fieldwork_subscribers?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=*`,
      'GET',
      serviceKey,
      url,
    );
    if (Array.isArray(byCustomer.body) && byCustomer.body[0]) return byCustomer.body[0];
  }
  return null;
}

async function patchSubscriber(id, patch) {
  const { url, serviceKey } = fieldworkSupabase();
  return fwRest(
    `/rest/v1/fieldwork_subscribers?id=eq.${encodeURIComponent(id)}`,
    'PATCH',
    serviceKey,
    url,
    { ...patch, updated_at: new Date().toISOString() },
  );
}

async function billingEventExists(subscriberId, externalRef) {
  if (!externalRef) return false;
  const { url, serviceKey } = fieldworkSupabase();
  const got = await fwRest(
    `/rest/v1/fieldwork_billing_events?subscriber_id=eq.${encodeURIComponent(subscriberId)}&stripe_session_id=eq.${encodeURIComponent(externalRef)}&select=id&limit=1`,
    'GET',
    serviceKey,
    url,
  );
  return Array.isArray(got.body) && got.body.length > 0;
}

async function insertBillingEvent(subscriberId, row) {
  const { url, serviceKey } = fieldworkSupabase();
  return fwRest('/rest/v1/fieldwork_billing_events', 'POST', serviceKey, url, {
    subscriber_id: subscriberId,
    ...row,
  });
}

async function handleCheckoutCompleted(eventObj, stripe) {
  const subscriberId = eventObj?.client_reference_id || eventObj?.metadata?.fieldwork_subscriber_id || null;
  const customerId = eventObj?.customer || null;
  const planId = eventObj?.metadata?.plan_id || null;
  const sub = await findSubscriber({ subscriberId, customerId });
  if (!sub) return { ignored: true, reason: 'subscriber_not_found' };

  await patchSubscriber(sub.id, {
    stripe_customer_id: customerId || sub.stripe_customer_id || null,
    stripe_subscription_id: eventObj?.subscription || sub.stripe_subscription_id || null,
    stripe_subscription_status: 'checkout_completed',
    stripe_latest_event_id: eventObj?.id || null,
  });

  const sessionRef = eventObj?.id || null;
  if (sessionRef && !(await billingEventExists(sub.id, sessionRef))) {
    await insertBillingEvent(sub.id, {
      label: `${planId || sub.plan_id} checkout completed`,
      amount_cents: 0,
      status: 'pending_activation',
      stripe_session_id: sessionRef,
    });
  }
  return { ignored: false, subscriber_id: sub.id };
}

async function handleSubscriptionUpdated(eventObj, stripe) {
  const customerId = eventObj?.customer || null;
  const metadataSubId = eventObj?.metadata?.fieldwork_subscriber_id || null;
  const sub = await findSubscriber({ subscriberId: metadataSubId, customerId });
  if (!sub) return { ignored: true, reason: 'subscriber_not_found' };

  const priceId = eventObj?.items?.data?.[0]?.price?.id || null;
  const metadataPlan = eventObj?.metadata?.plan_id || null;
  const planId = metadataPlan || planFromPrice(priceId, stripe) || sub.plan_id;

  const patch = {
    stripe_customer_id: customerId || sub.stripe_customer_id || null,
    stripe_subscription_id: eventObj?.id || sub.stripe_subscription_id || null,
    stripe_subscription_status: eventObj?.status || null,
    stripe_price_id: priceId || null,
    stripe_current_period_end: eventObj?.current_period_end
      ? new Date(eventObj.current_period_end * 1000).toISOString()
      : null,
    stripe_latest_event_id: eventObj?.id || null,
  };
  if (planId) patch.plan_id = planId;
  await patchSubscriber(sub.id, patch);
  return { ignored: false, subscriber_id: sub.id, plan_id: planId };
}

async function handleInvoicePaid(eventObj, stripe) {
  const customerId = eventObj?.customer || null;
  const sub = await findSubscriber({ customerId });
  if (!sub) return { ignored: true, reason: 'subscriber_not_found' };

  const invoiceRef = eventObj?.id || null;
  if (invoiceRef && (await billingEventExists(sub.id, invoiceRef))) {
    return { ignored: true, reason: 'duplicate_invoice' };
  }

  const linePriceId = eventObj?.lines?.data?.[0]?.price?.id || null;
  const planId = planFromPrice(linePriceId, stripe) || sub.plan_id;
  const credits = planCredits(planId);

  await patchSubscriber(sub.id, {
    plan_id: planId,
    mail_credits: credits.mail,
    audit_credits: credits.audit,
    expert_chat_credits: credits.expert,
    credits_reset_at: new Date().toISOString(),
    stripe_customer_id: customerId || sub.stripe_customer_id || null,
    stripe_subscription_id: eventObj?.subscription || sub.stripe_subscription_id || null,
    stripe_subscription_status: 'active',
    stripe_price_id: linePriceId || null,
    stripe_latest_invoice_id: invoiceRef,
  });

  await insertBillingEvent(sub.id, {
    label: `${planId} subscription invoice paid`,
    amount_cents: Number(eventObj?.amount_paid || 0),
    status: 'paid',
    stripe_session_id: invoiceRef,
  });
  return { ignored: false, subscriber_id: sub.id, plan_id: planId };
}

async function handleInvoiceFailed(eventObj) {
  const customerId = eventObj?.customer || null;
  const sub = await findSubscriber({ customerId });
  if (!sub) return { ignored: true, reason: 'subscriber_not_found' };
  const invoiceRef = eventObj?.id || null;
  if (invoiceRef && (await billingEventExists(sub.id, invoiceRef))) {
    return { ignored: true, reason: 'duplicate_invoice' };
  }
  await insertBillingEvent(sub.id, {
    label: `${sub.plan_id} subscription invoice failed`,
    amount_cents: Number(eventObj?.amount_due || 0),
    status: 'failed',
    stripe_session_id: invoiceRef,
  });
  return { ignored: false, subscriber_id: sub.id };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const stripe = fieldworkStripe();
  if (!stripe.secretKey || !stripe.webhookSecret) {
    return json(503, { error: 'FIELDWORK_STRIPE_SECRET_KEY/WEBHOOK_SECRET required' });
  }

  const raw = readRawBody(event);
  const sig = event.headers?.['stripe-signature'] || event.headers?.['Stripe-Signature'];
  const valid = verifyStripeSignature(raw, sig, stripe.webhookSecret);
  if (!valid) return json(400, { error: 'Invalid Stripe signature' });

  let parsed;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    return json(400, { error: 'Invalid payload JSON' });
  }

  const type = parsed?.type || '';
  const obj = parsed?.data?.object || {};
  try {
    if (type === 'checkout.session.completed') {
      const out = await handleCheckoutCompleted(obj, stripe);
      return json(200, { ok: true, type, ...out });
    }
    if (type === 'customer.subscription.created' || type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
      const out = await handleSubscriptionUpdated(obj, stripe);
      return json(200, { ok: true, type, ...out });
    }
    if (type === 'invoice.paid') {
      const out = await handleInvoicePaid(obj, stripe);
      return json(200, { ok: true, type, ...out });
    }
    if (type === 'invoice.payment_failed') {
      const out = await handleInvoiceFailed(obj, stripe);
      return json(200, { ok: true, type, ...out });
    }
    return json(200, { ok: true, ignored: true, type });
  } catch (err) {
    console.error('fieldwork-stripe-webhook error', err);
    return json(500, { error: err.message || 'Webhook processing failed', type });
  }
};
