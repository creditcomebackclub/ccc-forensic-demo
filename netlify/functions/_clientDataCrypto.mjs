import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const VERSION_CONTEXT = 'ccc-dispute-story-notes-version-v1';

function getClientDataKey() {
  const encoded = process.env.CLIENT_DATA_ENCRYPTION_KEY;
  if (!encoded) throw new Error('CLIENT_DATA_ENCRYPTION_KEY not configured');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('CLIENT_DATA_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

// Keep the exact IV + auth tag + ciphertext layout used by the original
// client-sensitive-data function so every existing SSN/password decrypts
// after moving the crypto boundary into this shared server-only module.
export function encryptClientData(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getClientDataKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decryptClientData(blob) {
  if (!blob) return null;
  const bytes = Buffer.from(String(blob), 'base64');
  if (bytes.length <= IV_BYTES + AUTH_TAG_BYTES) {
    throw new Error('Encrypted client data is malformed');
  }
  const iv = bytes.subarray(0, IV_BYTES);
  const authTag = bytes.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = bytes.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGORITHM, getClientDataKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// An opaque, server-keyed version binds staff approval to the exact plaintext
// notes without exposing a reusable hash of those notes to the browser.
export function versionClientData(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  return crypto
    .createHmac('sha256', getClientDataKey())
    .update(VERSION_CONTEXT)
    .update('\0')
    .update(String(plaintext), 'utf8')
    .digest('hex');
}

export function matchesClientDataVersion(plaintext, expectedVersion) {
  const actualVersion = versionClientData(plaintext);
  if (!actualVersion || typeof expectedVersion !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedVersion)) return false;
  return crypto.timingSafeEqual(Buffer.from(actualVersion, 'hex'), Buffer.from(expectedVersion, 'hex'));
}
