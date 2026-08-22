const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const STATE_RE = /^[A-Z]{2}$/;
const ZIP_RE = /^\d{5}(?:-\d{4})?$/;

export const CCC_LETTER_IDENTITY_KEYS = Object.freeze([
  'revision', 'userId', 'clientId', 'firstName', 'lastName',
  'addressLine1', 'addressLine2', 'city', 'state', 'zip',
  'identityDocumentId', 'identityDocumentSha256', 'identityDocumentStoragePath',
  'addressDocumentId', 'addressDocumentSha256', 'addressDocumentStoragePath',
  'verifiedBy', 'verifiedAt',
]);

function field(row, camel, snake) {
  return row?.[camel] ?? row?.[snake] ?? null;
}

function clean(value) {
  return String(value ?? '').trim();
}

export function formatCccLetterAddress(identity = {}) {
  const street = [clean(identity.addressLine1), clean(identity.addressLine2)].filter(Boolean).join('\n');
  const locality = [clean(identity.city), [clean(identity.state), clean(identity.zip)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [street, locality].filter(Boolean).join('\n');
}

export function normalizeCccLetterIdentity(row) {
  if (!row) return null;
  return {
    revision: Number(field(row, 'revision', 'revision')),
    userId: clean(field(row, 'userId', 'user_id')).toLowerCase(),
    clientId: clean(field(row, 'clientId', 'client_id')).toLowerCase(),
    firstName: clean(field(row, 'firstName', 'first_name')),
    lastName: clean(field(row, 'lastName', 'last_name')),
    addressLine1: clean(field(row, 'addressLine1', 'address_line1')),
    addressLine2: clean(field(row, 'addressLine2', 'address_line2')),
    city: clean(field(row, 'city', 'city')),
    state: clean(field(row, 'state', 'state')).toUpperCase(),
    zip: clean(field(row, 'zip', 'zip')),
    identityDocumentId: clean(field(row, 'identityDocumentId', 'identity_document_id')).toLowerCase(),
    identityDocumentSha256: clean(field(row, 'identityDocumentSha256', 'identity_document_sha256')).toLowerCase(),
    identityDocumentStoragePath: clean(field(row, 'identityDocumentStoragePath', 'identity_document_storage_path')),
    addressDocumentId: clean(field(row, 'addressDocumentId', 'address_document_id')).toLowerCase(),
    addressDocumentSha256: clean(field(row, 'addressDocumentSha256', 'address_document_sha256')).toLowerCase(),
    addressDocumentStoragePath: clean(field(row, 'addressDocumentStoragePath', 'address_document_storage_path')),
    verifiedBy: clean(field(row, 'verifiedBy', 'verified_by')).toLowerCase(),
    verifiedAt: clean(field(row, 'verifiedAt', 'verified_at')),
  };
}

export function cccLetterIdentityIssues(value, { allowEmpty = false } = {}) {
  if (!value || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)) {
    return allowEmpty ? [] : ['A staff-confirmed CCC letter identity is required.'];
  }
  if (typeof value !== 'object' || Array.isArray(value)) return ['The CCC letter identity is malformed.'];
  const identity = normalizeCccLetterIdentity(value);
  const issues = [];
  const keys = Object.keys(value).sort();
  const expectedKeys = [...CCC_LETTER_IDENTITY_KEYS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) issues.push('The CCC letter identity fields are incomplete or unexpected.');
  if (!Number.isInteger(identity.revision) || identity.revision < 1) issues.push('The CCC letter identity revision is invalid.');
  if (!UUID_RE.test(identity.userId) || !UUID_RE.test(identity.clientId) || !UUID_RE.test(identity.verifiedBy)) {
    issues.push('The CCC letter identity owner, client, or verifier is invalid.');
  }
  if (!identity.firstName || identity.firstName.length > 100 || /[{}\r\n]/.test(identity.firstName)) issues.push('Enter the exact legal first name shown on the client ID.');
  if (!identity.lastName || identity.lastName.length > 150 || /[{}\r\n]/.test(identity.lastName)) issues.push('Enter the exact legal last name shown on the client ID.');
  if (!identity.addressLine1 || identity.addressLine1.length > 200 || /[{}\r\n]/.test(identity.addressLine1)) issues.push('Enter the exact current street address shown by the proof document.');
  if (identity.addressLine2.length > 200 || /[{}\r\n]/.test(identity.addressLine2)) issues.push('The second address line is invalid.');
  if (!identity.city || identity.city.length > 100 || /[{}\r\n]/.test(identity.city)) issues.push('Enter the current city shown by the proof document.');
  if (!STATE_RE.test(identity.state)) issues.push('Enter a two-letter state code.');
  if (!ZIP_RE.test(identity.zip)) issues.push('Enter a five-digit ZIP or ZIP+4.');
  if (!UUID_RE.test(identity.identityDocumentId) || !UUID_RE.test(identity.addressDocumentId)) issues.push('The exact ID and proof-of-address records are required.');
  if (!SHA256_RE.test(identity.identityDocumentSha256) || !SHA256_RE.test(identity.addressDocumentSha256)) issues.push('The identity documents need verified SHA-256 evidence. Re-upload them through Documents.');
  if (!identity.identityDocumentStoragePath || !identity.addressDocumentStoragePath) issues.push('The identity-document storage evidence is incomplete.');
  if (!identity.verifiedAt || Number.isNaN(Date.parse(identity.verifiedAt))) issues.push('The CCC letter identity verification time is invalid.');
  return [...new Set(issues)];
}

export function buildCccLetterIdentitySnapshot(row) {
  const snapshot = normalizeCccLetterIdentity(row);
  const issues = cccLetterIdentityIssues(snapshot);
  if (issues.length) throw new Error(issues.join(' '));
  return snapshot;
}

export function cccLetterIdentityAutomaticValues(row) {
  const identity = buildCccLetterIdentitySnapshot(row);
  return {
    firstName: identity.firstName,
    lastName: identity.lastName,
    name: `${identity.firstName} ${identity.lastName}`.trim(),
    address: formatCccLetterAddress(identity),
  };
}

export function cccLetterIdentityDocumentIssues(row, documents = []) {
  let identity;
  try {
    identity = buildCccLetterIdentitySnapshot(row);
  } catch (error) {
    return [error.message];
  }
  const idDocument = documents.find((document) => String(document?.id || '').toLowerCase() === identity.identityDocumentId);
  const addressDocument = documents.find((document) => String(document?.id || '').toLowerCase() === identity.addressDocumentId);
  const issues = [];
  if (!idDocument
    || idDocument.doc_type !== 'id'
    || String(idDocument.sha256 || '').toLowerCase() !== identity.identityDocumentSha256
    || String(idDocument.storage_path || '') !== identity.identityDocumentStoragePath
    || Number(idDocument.byte_size || 0) <= 0) issues.push('The verified government ID changed or is missing. Review the current document and confirm the letter identity again.');
  if (!addressDocument
    || addressDocument.doc_type !== 'address'
    || String(addressDocument.sha256 || '').toLowerCase() !== identity.addressDocumentSha256
    || String(addressDocument.storage_path || '') !== identity.addressDocumentStoragePath
    || Number(addressDocument.byte_size || 0) <= 0) issues.push('The verified proof of address changed or is missing. Review the current document and confirm the letter identity again.');
  return issues;
}

export function sameCccLetterIdentity(left, right) {
  try {
    return JSON.stringify(buildCccLetterIdentitySnapshot(left)) === JSON.stringify(buildCccLetterIdentitySnapshot(right));
  } catch {
    return false;
  }
}
