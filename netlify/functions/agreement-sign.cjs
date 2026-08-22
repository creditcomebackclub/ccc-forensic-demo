const RETIREMENT_GUIDANCE = 'This retired signing route is no longer available. Use the secure service-agreement onboarding wizard.';

exports.handler = async function handler() {
  return {
    statusCode: 410,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: RETIREMENT_GUIDANCE,
  };
};

exports.RETIREMENT_GUIDANCE = RETIREMENT_GUIDANCE;
