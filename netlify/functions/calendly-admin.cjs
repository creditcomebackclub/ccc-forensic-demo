const { requireAdmin } = require('./_requireAdmin.cjs');
const { ensureSubscription, subscriptionStatus } = require('./_calendly.cjs');

function publicSubscription(subscription) {
  if (!subscription) return null;
  return {
    uri: subscription.uri || null,
    state: subscription.state || null,
    events: Array.isArray(subscription.events) ? subscription.events : [],
    callbackUrl: subscription.url || null,
    createdAt: subscription.created_at || null,
  };
}

exports.handler = async (event) => {
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  try { await requireAdmin(event); }
  catch (error) { if (error.statusCode) return error; throw error; }

  if (!process.env.CALENDLY_ACCESS_TOKEN) {
    return { statusCode: 409, body: JSON.stringify({ configured: false, connected: false, error: 'Calendly token is not configured for this deploy context.' }) };
  }

  try {
    if (event.httpMethod === 'POST') {
      const result = await ensureSubscription();
      return {
        statusCode: result.created ? 201 : 200,
        body: JSON.stringify({
          configured: true,
          connected: true,
          created: result.created,
          subscription: publicSubscription(result.subscription),
        }),
      };
    }
    const status = await subscriptionStatus();
    return {
      statusCode: 200,
      body: JSON.stringify({
        configured: true,
        connected: Boolean(status.active),
        subscription: publicSubscription(status.active),
      }),
    };
  } catch (error) {
    console.error('Calendly admin integration failed:', error.message || error);
    const statusCode = error.statusCode === 401 || error.statusCode === 403 ? 409 : 502;
    return {
      statusCode,
      body: JSON.stringify({
        configured: true,
        connected: false,
        error: error.statusCode === 403
          ? 'Calendly rejected the token permissions. Confirm users:read, scheduled_events:read, and webhooks:write.'
          : 'Could not connect to Calendly. Check the token and try again.',
        detail: String(error.message || error).slice(0, 300),
      }),
    };
  }
};
