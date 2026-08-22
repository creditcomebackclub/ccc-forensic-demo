import { disputeAccountKey } from './disputeTrackingRules.js';

export const DISPUTE_SCREENSHOT_BUCKET = 'documents';
export const DISPUTE_SCREENSHOT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export const DISPUTE_SCREENSHOT_POLICIES = Object.freeze({
  none: Object.freeze({
    label: 'No credit-report screenshots',
    required: false,
    defaultInstructions: '',
  }),
  cross_bureau_mismatch: Object.freeze({
    label: 'Cross-bureau mismatch evidence',
    required: true,
    defaultInstructions: 'For every disputed account, upload reviewed credit-report evidence showing the exact field values that conflict across bureaus.',
  }),
  inaccurate_accounts: Object.freeze({
    label: 'Inaccurate-account evidence',
    required: true,
    defaultInstructions: 'For every disputed account, upload a reviewed screenshot from the current credit report showing the inaccurate reporting addressed in this round.',
  }),
  prior_consumer_statement_comments: Object.freeze({
    label: 'Prior Consumer Statement comments',
    required: true,
    defaultInstructions: 'For every disputed account, upload the current report’s comments section showing that the prior Consumer Statement is missing or incomplete.',
  }),
  mismatching_accounts: Object.freeze({
    label: 'Mismatching-account evidence',
    required: true,
    defaultInstructions: 'For every disputed account, upload reviewed report evidence showing the values that still mismatch across bureaus.',
  }),
  closure_status: Object.freeze({
    label: 'Consumer-closure status evidence',
    required: true,
    defaultInstructions: 'For every disputed account, upload the current report’s status or comments section showing that it does not indicate the consumer voluntarily closed the account.',
  }),
  dispute_comments: Object.freeze({
    label: 'Dispute/comments evidence',
    required: true,
    defaultInstructions: 'For every disputed account, upload the current report’s comments section showing that the account is not marked as disputed.',
  }),
  legacy_template_token: Object.freeze({
    label: 'Legacy template screenshot requirement',
    required: true,
    defaultInstructions: 'This saved letter predates course-policy snapshots. Its stored template contains the screenshot placement token, so reviewed account screenshots remain required.',
  }),
});

export function normalizeDisputeScreenshotPolicyCode(value, fallback = 'none') {
  const code = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(DISPUTE_SCREENSHOT_POLICIES, code) ? code : fallback;
}

export function disputeScreenshotPolicyDetails(code, staffInstructions = '') {
  const normalizedCode = normalizeDisputeScreenshotPolicyCode(code);
  const definition = DISPUTE_SCREENSHOT_POLICIES[normalizedCode];
  return {
    code: normalizedCode,
    label: definition.label,
    required: definition.required,
    staffInstructions: definition.required
      ? String(staffInstructions || definition.defaultInstructions).trim()
      : '',
  };
}

export function buildDisputeScreenshotPolicySnapshot(template = {}) {
  return {
    version: 1,
    ...disputeScreenshotPolicyDetails(
      template.screenshotPolicyCode,
      template.screenshotStaffInstructions,
    ),
  };
}

export function hasDisputeScreenshotPolicySnapshot(snapshot) {
  return Boolean(snapshot
    && typeof snapshot === 'object'
    && !Array.isArray(snapshot)
    && Object.prototype.hasOwnProperty.call(snapshot, 'code'));
}

export function resolveDisputeScreenshotPolicy({ snapshot, templateText = '' } = {}) {
  if (hasDisputeScreenshotPolicySnapshot(snapshot)) {
    return {
      version: Number(snapshot.version || 1),
      ...disputeScreenshotPolicyDetails(snapshot.code, snapshot.staffInstructions),
    };
  }
  if (templateRequiresScreenshots(templateText)) {
    return {
      version: 0,
      ...disputeScreenshotPolicyDetails('legacy_template_token'),
    };
  }
  return { version: 0, ...disputeScreenshotPolicyDetails('none') };
}

export function screenshotPolicyRequiresUploads(policy) {
  if (typeof policy === 'string') return disputeScreenshotPolicyDetails(policy).required;
  if (policy && typeof policy === 'object') return disputeScreenshotPolicyDetails(policy.code).required;
  return false;
}

function cleanSegment(value, fallback = 'unknown') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || fallback;
}

export function templateRequiresScreenshots(templateText) {
  return /\{\{?\s*screenshots\s*\}?\}/i.test(String(templateText || ''));
}

export function screenshotAccountLabel(account = {}) {
  const furnisher = account.furnisher || 'Unknown furnisher';
  const accountNumber = account.accountNumberMasked || 'account number not shown';
  return `${furnisher} — ${accountNumber}`;
}

export function disputeScreenshotStoragePrefix(userId, clientId) {
  if (!userId || !clientId) throw new Error('A staff owner and canonical client are required for screenshot storage.');
  return `${userId}/${clientId}/dispute-screenshots/`;
}

export function disputeScreenshotStoragePath({ userId, clientId, batchId, account, id, mediaType }) {
  const extension = mediaType === 'image/png' ? 'png' : mediaType === 'image/webp' ? 'webp' : 'jpg';
  const accountSlug = cleanSegment(disputeAccountKey(account), 'account');
  return `${disputeScreenshotStoragePrefix(userId, clientId)}${cleanSegment(batchId, 'batch')}/${accountSlug}/${cleanSegment(id, 'image')}.${extension}`;
}

export function buildDisputeScreenshotManifest(screenshots = []) {
  return screenshots.map((item) => ({
    id: String(item.id || ''),
    accountKey: disputeAccountKey(item),
    clientAccountId: item.clientAccountId || null,
    accountId: item.accountId || null,
    furnisher: item.furnisher || 'Unknown furnisher',
    accountNumberMasked: item.accountNumberMasked || null,
    fileName: item.fileName || item.name || 'Credit report screenshot',
    storagePath: item.storagePath || '',
    mediaType: item.mediaType || '',
    size: Number(item.size || 0),
    sha256: String(item.sha256 || '').toLowerCase(),
    uploadedAt: item.uploadedAt || null,
  }));
}

export function missingScreenshotAccounts(accounts = [], screenshots = []) {
  const covered = new Set(screenshots.map((item) => disputeAccountKey(item)));
  return accounts.filter((account) => !covered.has(disputeAccountKey(account)));
}

export function validateDisputeScreenshotManifest({
  accounts = [],
  manifest = [],
  required = false,
  policy,
  userId = '',
  clientId = '',
} = {}) {
  const issues = [];
  const items = Array.isArray(manifest) ? manifest : [];
  const screenshotsRequired = policy === undefined ? required : screenshotPolicyRequiresUploads(policy);
  if (!screenshotsRequired && items.length === 0) return issues;
  if (screenshotsRequired && items.length === 0) issues.push('The selected template requires account screenshots.');
  if (items.length > 10) issues.push('A letter may contain no more than 10 account screenshots.');

  const accountKeys = accounts.map((account) => disputeAccountKey(account));
  const expectedKeys = new Set(accountKeys);
  if (expectedKeys.size !== accountKeys.length) issues.push('Every disputed account must have a unique canonical account identifier before screenshots can be assigned.');
  const expectedByKey = new Map(accounts.map((account) => [disputeAccountKey(account), account]));
  const seenIds = new Set();
  const seenPaths = new Set();
  const expectedPrefix = userId && clientId ? disputeScreenshotStoragePrefix(userId, clientId) : '';
  for (const item of items) {
    const accountKey = disputeAccountKey(item);
    if (!expectedKeys.has(accountKey)) issues.push(`Screenshot ${item.fileName || item.id || 'file'} is assigned to an account outside this letter.`);
    const expectedAccount = expectedByKey.get(accountKey);
    if (expectedAccount && [
      ['clientAccountId', expectedAccount.clientAccountId || null],
      ['accountId', expectedAccount.accountId || expectedAccount.id || null],
      ['furnisher', expectedAccount.furnisher || 'Unknown furnisher'],
      ['accountNumberMasked', expectedAccount.accountNumberMasked || null],
    ].some(([field, expected]) => (item[field] || null) !== expected)) {
      issues.push(`Screenshot ${item.fileName || item.id || 'file'} does not match its saved account identity.`);
    }
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(String(item.id || '')) || seenIds.has(item.id)) issues.push('Every screenshot must have a unique saved identifier.');
    if (item.id) seenIds.add(item.id);
    if (!item.storagePath || seenPaths.has(item.storagePath)) issues.push('Every screenshot must have a unique private storage path.');
    if (item.storagePath) seenPaths.add(item.storagePath);
    if (expectedPrefix && !String(item.storagePath || '').startsWith(expectedPrefix)) issues.push('A screenshot storage path is outside this client’s private dispute folder.');
    if (/(?:^|\/)\.\.(?:\/|$)|\\|[\u0000-\u001f]/.test(String(item.storagePath || ''))) issues.push('A screenshot storage path contains prohibited traversal characters.');
    if (!DISPUTE_SCREENSHOT_TYPES.has(item.mediaType)) issues.push('Screenshots must be saved as PNG, JPEG, or WebP images.');
    if (!Number.isFinite(Number(item.size)) || Number(item.size) <= 0 || Number(item.size) > 8 * 1024 * 1024) issues.push('Each screenshot must be between 1 byte and 8 MB.');
    if (!/^[a-f0-9]{64}$/.test(String(item.sha256 || ''))) issues.push('Every screenshot must retain its SHA-256 review fingerprint.');
    if (!item.uploadedAt || !Number.isFinite(Date.parse(item.uploadedAt))) issues.push('Every screenshot must retain its upload timestamp.');
  }

  if (screenshotsRequired) {
    for (const account of missingScreenshotAccounts(accounts, items)) {
      issues.push(`Missing a reviewed screenshot for ${screenshotAccountLabel(account)}.`);
    }
  }
  return [...new Set(issues)];
}
