// Retired public browser callback. A raw CRM lead id is not proof that a
// Calendly booking occurred. netlify/functions/calendly-webhook.cjs verifies
// the provider resource and remains the only booking/email authority.
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed.' }) };
  }
  return {
    statusCode: 410,
    headers,
    body: JSON.stringify({
      error: 'Browser booking confirmation is retired. Verified Calendly webhooks process bookings automatically.',
    }),
  };
};
