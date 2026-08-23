export const RESUMABLE_AUDIT_VERSION = 'resumable-audit-v1';

export const RESUMABLE_AUDIT_ACTIVE_STATUSES = Object.freeze([
  'queued', 'running', 'waiting', 'retryable', 'finalizing',
]);

export function isResumableAuditActive(status) {
  return RESUMABLE_AUDIT_ACTIVE_STATUSES.includes(String(status || ''));
}

export function auditJobCanDispatch(job) {
  if (!job || !isResumableAuditActive(job.status)) return false;
  if (job.status === 'running' || job.status === 'finalizing') {
    const leaseUntil = new Date(job.lease_expires_at || 0).getTime();
    return !Number.isFinite(leaseUntil) || leaseUntil <= Date.now();
  }
  const retryAt = new Date(job.next_retry_at || 0).getTime();
  return !Number.isFinite(retryAt) || retryAt <= Date.now();
}

export function auditRetryDelayMs(attemptCount) {
  const attempt = Math.max(1, Number(attemptCount) || 1);
  return Math.min(5 * 60 * 1000, 5000 * (2 ** Math.min(attempt - 1, 6)));
}

export async function fileSha256(file) {
  const bytes = await file.arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function auditMediaType(file) {
  const declared = String(file?.type || '').split(';', 1)[0].trim().toLowerCase();
  if (declared) return declared;
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.html') || name.endsWith('.htm')) return 'text/html';
  if (name.endsWith('.txt')) return 'text/plain';
  throw new Error('Could not identify this report format. Use a PDF, HTML, or TXT export.');
}

export async function buildAuditSourceMeta(file, bureau = null) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('A report file is required.');
  const bytes = Number(file.size);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('The uploaded report is empty.');
  return {
    bureau: bureau || null,
    type: auditMediaType(file),
    bytes,
    sha256: await fileSha256(file),
  };
}
