const crypto = require('crypto');

const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

function createGuideDownloadToken(leadId, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!leadId || !secret) throw new Error('Guide download token requires a lead and server secret.');
  const payload = Buffer.from(JSON.stringify({ leadId, exp: nowSeconds + TOKEN_TTL_SECONDS })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return payload + '.' + signature;
}

function verifyGuideDownloadToken(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
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
    if (!decoded.leadId || !decoded.exp || decoded.exp < nowSeconds) return null;
    return decoded.leadId;
  } catch {
    return null;
  }
}

module.exports = { TOKEN_TTL_SECONDS, createGuideDownloadToken, verifyGuideDownloadToken };
