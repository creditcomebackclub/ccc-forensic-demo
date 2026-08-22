import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildDisputeScreenshotPolicySnapshot,
  buildDisputeScreenshotManifest,
  disputeScreenshotPolicyDetails,
  disputeScreenshotStoragePath,
  hasDisputeScreenshotPolicySnapshot,
  missingScreenshotAccounts,
  resolveDisputeScreenshotPolicy,
  screenshotPolicyRequiresUploads,
  templateRequiresScreenshots,
  validateDisputeScreenshotManifest,
} from '../src/utils/disputeScreenshots.js';

const accounts = [
  { clientAccountId: 'ca-1', furnisher: 'Alpha Bank', accountNumberMasked: '****1111' },
  { accountId: 'audit-2', furnisher: 'Beta Collections', accountNumberMasked: '****2222' },
];
const first = {
  id: 'image-1',
  clientAccountId: 'ca-1',
  furnisher: 'Alpha Bank',
  accountNumberMasked: '****1111',
  name: 'alpha.png',
  storagePath: 'staff-1/client-1/dispute-screenshots/batch-1/client-account-ca-1/image-1.png',
  mediaType: 'image/png',
  size: 1024,
  sha256: 'a'.repeat(64),
  uploadedAt: '2026-08-20T12:00:00.000Z',
};
const second = {
  id: 'image-2',
  accountId: 'audit-2',
  furnisher: 'Beta Collections',
  accountNumberMasked: '****2222',
  name: 'beta.jpg',
  storagePath: 'staff-1/client-1/dispute-screenshots/batch-1/account-audit-2/image-2.jpg',
  mediaType: 'image/jpeg',
  size: 2048,
  sha256: 'b'.repeat(64),
  uploadedAt: '2026-08-20T12:01:00.000Z',
};

assert.equal(templateRequiresScreenshots('Attach {screenshots}'), true);
assert.equal(templateRequiresScreenshots('Attach {{ screenshots }}'), true);
assert.equal(templateRequiresScreenshots('No exhibits'), false);
assert.equal(screenshotPolicyRequiresUploads('none'), false);
assert.equal(screenshotPolicyRequiresUploads('cross_bureau_mismatch'), true);
const savedPolicy = buildDisputeScreenshotPolicySnapshot({
  screenshotPolicyCode: 'prior_consumer_statement_comments',
  screenshotStaffInstructions: 'Upload the comments section for each account.',
});
assert.deepEqual(savedPolicy, {
  version: 1,
  code: 'prior_consumer_statement_comments',
  label: 'Prior Consumer Statement comments',
  required: true,
  staffInstructions: 'Upload the comments section for each account.',
});
assert.equal(hasDisputeScreenshotPolicySnapshot(savedPolicy), true);
assert.equal(resolveDisputeScreenshotPolicy({ snapshot: savedPolicy, templateText: 'No token' }).required, true);
assert.equal(resolveDisputeScreenshotPolicy({
  snapshot: buildDisputeScreenshotPolicySnapshot({ screenshotPolicyCode: 'none' }),
  templateText: 'Legacy-looking {screenshots} token',
}).required, false, 'an explicit saved policy must override the placement token');
assert.equal(resolveDisputeScreenshotPolicy({ snapshot: {}, templateText: 'Legacy {screenshots}' }).code, 'legacy_template_token');
assert.equal(disputeScreenshotPolicyDetails('closure_status').required, true);
assert.deepEqual(missingScreenshotAccounts(accounts, [first]), [accounts[1]]);

const manifest = buildDisputeScreenshotManifest([first, second]);
assert.equal(manifest[0].dataUrl, undefined);
assert.equal(manifest[0].file, undefined);
assert.deepEqual(validateDisputeScreenshotManifest({
  accounts,
  manifest,
  policy: savedPolicy,
  userId: 'staff-1',
  clientId: 'client-1',
}), []);

assert.match(
  disputeScreenshotStoragePath({
    userId: 'staff-1',
    clientId: 'client-1',
    batchId: 'batch-1',
    account: accounts[0],
    id: 'image-1',
    mediaType: 'image/png',
  }),
  /^staff-1\/client-1\/dispute-screenshots\/batch-1\/client-account-ca-1\/image-1\.png$/,
);

const missingIssues = validateDisputeScreenshotManifest({ accounts, manifest: [manifest[0]], required: true });
assert.ok(missingIssues.some((issue) => issue.includes('Beta Collections')));
assert.deepEqual(validateDisputeScreenshotManifest({
  accounts,
  manifest: [],
  policy: buildDisputeScreenshotPolicySnapshot({ screenshotPolicyCode: 'none' }),
}), [], 'no-evidence course rounds must not inherit a flow-wide requirement');
const wrongClient = [{ ...manifest[0], storagePath: 'staff-1/other-client/dispute-screenshots/batch/a.png' }, manifest[1]];
assert.ok(validateDisputeScreenshotManifest({
  accounts,
  manifest: wrongClient,
  required: true,
  userId: 'staff-1',
  clientId: 'client-1',
}).some((issue) => issue.includes('outside this client')));
assert.ok(validateDisputeScreenshotManifest({
  accounts,
  manifest: [{ ...manifest[0], id: 'bad" onclick="alert(1)' }, manifest[1]],
  required: true,
}).some((issue) => issue.includes('unique saved identifier')));
assert.ok(validateDisputeScreenshotManifest({
  accounts,
  manifest: [{ ...manifest[0], storagePath: 'staff-1/client-1/dispute-screenshots/../other/image.png' }, manifest[1]],
  required: true,
}).some((issue) => issue.includes('traversal')));

const screenshotPolicyMigration = readFileSync(
  new URL('../supabase/migrations/20260820200000_course_screenshot_policies.sql', import.meta.url),
  'utf8',
);
assert.match(screenshotPolicyMigration, /Neither original course R1 letter says/);
assert.match(screenshotPolicyMigration, /I have included screenshots straight from my credit report/);
assert.match(screenshotPolicyMigration, /I have listed the exact fields and attached screenshots/);
assert.match(screenshotPolicyMigration, /I have listed the exact fields so there is nothing to guess at/);
assert.match(screenshotPolicyMigration, /Superseded by course screenshot-policy correction/);
assert.match(screenshotPolicyMigration, /successor\.id = correction\.successor_id[\s\S]*successor\.is_active = true/);

console.log('Dispute screenshot manifest rules passed.');
