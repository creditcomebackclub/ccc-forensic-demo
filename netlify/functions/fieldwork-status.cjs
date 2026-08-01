/**
 * Public readiness probe for the Fieldwork lane.
 * Does not read or expose CCC credentials.
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
        ? 'Fieldwork backend credentials detected (FIELDWORK_* only).'
        : anthropicConfigured
          ? 'Fieldwork Anthropic key present — live audits/letters available; storage still local demo.'
          : 'Demo mode — localStorage + canned sample. CCC agency keys are never used.',
      usesCccKeys: false,
    }),
  };
};
