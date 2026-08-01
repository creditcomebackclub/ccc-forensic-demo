/**
 * Public readiness probe for the Fieldwork lane.
 * Only reports Fieldwork credential presence — never other product keys.
 */
const { isFieldworkConfigured } = require('./_fieldworkEnv.cjs');

exports.handler = async () => {
  const configured = isFieldworkConfigured();
  const anthropicConfigured = Boolean(process.env.FIELDWORK_ANTHROPIC_API_KEY);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      product: 'fieldwork',
      isolated: true,
      mode: configured ? 'cloud' : (anthropicConfigured ? 'engine-demo' : 'demo'),
      anthropicConfigured,
      message: configured
        ? 'Fieldwork cloud credentials connected.'
        : anthropicConfigured
          ? 'Live audits/letters available; subscriber storage still local until Supabase is connected.'
          : 'Demo mode — sample audit on this device.',
    }),
  };
};
