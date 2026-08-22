const RETIREMENT_GUIDANCE = 'This retired enrollment-completion route is no longer available. Complete onboarding through the secure service-agreement wizard.';

exports.handler = async () => ({
  statusCode: 410,
  headers: {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  },
  body: RETIREMENT_GUIDANCE,
});
