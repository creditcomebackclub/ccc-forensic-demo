const crypto = require('node:crypto');

const MAX_NOTIFICATION_BODY_BYTES = 1_024;
const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_INTENTS = new Set(['consultation', 'guide_download']);

function exactNotificationPayload(input) {
  if (!input || Array.isArray(input) || typeof input !== 'object') throw new TypeError('invalid notification');
  const allowedKeys = new Set(['leadId', 'affiliateId', 'intent']);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) throw new TypeError('invalid notification');

  const leadId = typeof input.leadId === 'string' ? input.leadId.trim().toLowerCase() : '';
  const affiliateId = input.affiliateId == null
    ? null
    : (typeof input.affiliateId === 'string' ? input.affiliateId.trim().toLowerCase() : '');
  const intent = typeof input.intent === 'string' ? input.intent.trim().toLowerCase() : '';
  if (!UUID_PATTERN.test(leadId) || (affiliateId !== null && !UUID_PATTERN.test(affiliateId)) || !ALLOWED_INTENTS.has(intent)) {
    throw new TypeError('invalid notification');
  }
  return { leadId, affiliateId, intent };
}

function signatureValue(rawBody, secret, timestampSeconds) {
  return crypto.createHmac('sha256', secret)
    .update(`ccc-public-intake-notification-v1\n${timestampSeconds}.${rawBody}`)
    .digest('hex');
}

function signNotification(rawBody, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret || typeof rawBody !== 'string' || !rawBody || Buffer.byteLength(rawBody) > MAX_NOTIFICATION_BODY_BYTES) {
    throw new Error('Notification signature input is invalid.');
  }
  return `t=${nowSeconds},v1=${signatureValue(rawBody, secret, nowSeconds)}`;
}

function verifyNotification(rawBody, signatureHeader, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret || typeof rawBody !== 'string' || !rawBody || Buffer.byteLength(rawBody) > MAX_NOTIFICATION_BODY_BYTES) return false;
  const match = /^t=(\d{10}),v1=([0-9a-f]{64})$/i.exec(String(signatureHeader || '').trim());
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > MAX_SIGNATURE_AGE_SECONDS) return false;
  const expected = Buffer.from(signatureValue(rawBody, secret, timestamp), 'hex');
  const supplied = Buffer.from(match[2], 'hex');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

module.exports = {
  MAX_NOTIFICATION_BODY_BYTES,
  MAX_SIGNATURE_AGE_SECONDS,
  exactNotificationPayload,
  signNotification,
  verifyNotification,
};
