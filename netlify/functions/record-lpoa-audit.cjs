const RETIREMENT_GUIDANCE = 'This retired LPOA audit route is no longer available. Historical authorization evidence remains preserved for internal audit only.';

exports.handler = async () => ({
  statusCode: 410,
  headers: {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  },
  body: RETIREMENT_GUIDANCE,
});
