/**
 * Public readiness probe for the Fieldwork lane.
 * Does not read or expose CCC credentials.
 */
const { isFieldworkConfigured } = require('./_fieldworkEnv.cjs');

exports.handler = async () => {
  const configured = isFieldworkConfigured();
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      product: 'fieldwork',
      isolated: true,
      mode: configured ? 'cloud' : 'demo',
      message: configured
        ? 'Fieldwork backend credentials detected (FIELDWORK_* only).'
        : 'Demo mode — localStorage only. CCC agency keys are never used.',
      usesCccKeys: false,
    }),
  };
};
