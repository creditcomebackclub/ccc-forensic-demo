/**
 * Fieldwork-only environment resolution.
 *
 * IMPORTANT: These helpers NEVER fall back to CCC agency keys
 * (VITE_SUPABASE_*, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, LOB_*).
 * Fieldwork must be configured with FIELDWORK_* vars so DIY traffic cannot
 * touch or bill the Forensic Suite accounts by accident.
 */

function required(name) {
  const v = process.env[name];
  if (!v) {
    const err = new Error(`Missing ${name}. Fieldwork uses isolated FIELDWORK_* credentials only.`);
    err.statusCode = 503;
    throw err;
  }
  return v;
}

function optional(name) {
  return process.env[name] || null;
}

function fieldworkSupabase() {
  return {
    url: required('FIELDWORK_SUPABASE_URL'),
    anonKey: required('FIELDWORK_SUPABASE_ANON_KEY'),
    serviceKey: required('FIELDWORK_SUPABASE_SERVICE_ROLE_KEY'),
  };
}

function fieldworkAnthropicKey() {
  return required('FIELDWORK_ANTHROPIC_API_KEY');
}

function fieldworkLob() {
  const mode = (process.env.FIELDWORK_LOB_MODE || 'test').toLowerCase();
  const key = mode === 'live'
    ? required('FIELDWORK_LOB_LIVE_KEY')
    : required('FIELDWORK_LOB_TEST_KEY');
  return { mode, key };
}

function fieldworkStripe() {
  return {
    secretKey: optional('FIELDWORK_STRIPE_SECRET_KEY'),
    webhookSecret: optional('FIELDWORK_STRIPE_WEBHOOK_SECRET'),
    priceStarter: optional('FIELDWORK_STRIPE_PRICE_STARTER'),
    pricePro: optional('FIELDWORK_STRIPE_PRICE_PRO'),
    priceUnlimited: optional('FIELDWORK_STRIPE_PRICE_UNLIMITED'),
  };
}

function isFieldworkConfigured() {
  return Boolean(
    process.env.FIELDWORK_SUPABASE_URL
    && process.env.FIELDWORK_SUPABASE_ANON_KEY
    && process.env.FIELDWORK_SUPABASE_SERVICE_ROLE_KEY,
  );
}

module.exports = {
  fieldworkSupabase,
  fieldworkAnthropicKey,
  fieldworkLob,
  fieldworkStripe,
  isFieldworkConfigured,
};
