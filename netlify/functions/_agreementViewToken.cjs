const crypto = require('crypto');

// Deliberately short: this token rides in a query string (window.open cannot
// send an Authorization header), and the document behind it is client PII —
// legal name, address, fee terms, and a signature image. It only has to
// survive the hop from "client clicked the button" to "new tab loaded".
const TOKEN_TTL_SECONDS = 120;

// Bound to the viewing user as well as the object, so a leaked link cannot be
// replayed against a different client's document by editing the payload —
// portal-agreement-view.cjs re-checks that the decoded userId still matches a
// client_profiles row that owns the decoded path.
function createAgreementViewToken(userId, bucket, path, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!userId || !bucket || !path || !secret) {
    throw new Error('Agreement view token requires a user, bucket, path, and server secret.');
  }
  const payload = Buffer.from(
    JSON.stringify({ userId, bucket, path, exp: nowSeconds + TOKEN_TTL_SECONDS })
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return payload + '.' + signature;
}

function verifyAgreementViewToken(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!token || !secret) return null;
  const [payload, signature, extra] = String(token).split('.');
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64url'); }
  catch { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded.userId || !decoded.bucket || !decoded.path || !decoded.exp) return null;
    if (decoded.exp < nowSeconds) return null;
    return decoded;
  } catch {
    return null;
  }
}

module.exports = { TOKEN_TTL_SECONDS, createAgreementViewToken, verifyAgreementViewToken };
