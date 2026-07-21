import crypto from 'crypto';

function verifyLobSignature(rawBody, timestamp, signature, secret) {
  if (!signature || !timestamp) return false;
  try {
    const computed = crypto.createHmac('sha256', secret).update(timestamp + '.' + rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
  } catch (e) {
    return false;
  }
}

const secret = 'dummy_secret_123';
const timestamp = '1787017052'; // Some timestamp
const rawBody = JSON.stringify({ id: 'evt_123', type: 'letter.delivered' });

// Simulate Lob creating the signature
const signature = crypto.createHmac('sha256', secret).update(timestamp + '.' + rawBody).digest('hex');

console.log('Generated Signature:', signature);
console.log('Verify:', verifyLobSignature(rawBody, timestamp, signature, secret));
