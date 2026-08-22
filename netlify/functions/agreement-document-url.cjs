const RETIREMENT_GUIDANCE = 'This retired agreement-link route is no longer available. Signed service-agreement artifacts are available only through the active portal document viewer.';

exports.handler = async () => ({
  statusCode: 410,
  headers: {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  },
  body: RETIREMENT_GUIDANCE,
});
