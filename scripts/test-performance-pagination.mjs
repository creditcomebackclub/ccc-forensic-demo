import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/App.jsx');
const inbox = read('src/components/InboxPage.jsx');
const preview = read('website-preview/index.html');

for (const route of ['AuthPage', 'ClientSetupFlow', 'ClientPortal', 'AffiliateOnboardingFlow', 'AffiliatePortal']) {
  assert.match(
    app,
    new RegExp(`<LazyRoute>[\\s\\S]{0,1200}<${route}\\b`),
    `${route} must render inside a Suspense-backed LazyRoute`,
  );
}

assert.match(inbox, /const INBOX_PAGE_SIZE = \{/);
assert.match(inbox, /\.range\(offset, pageEnd\)/);
assert.match(inbox, /values\.slice\(0, pageSize\)/);
assert.match(inbox, /values\.length > pageSize/);
assert.match(inbox, /mergeRowsById/);
for (const source of ['leads', 'onboarding', 'letters', 'audits']) {
  assert.match(inbox, new RegExp(`loadMoreRows\\('${source}'\\)`));
}
assert.doesNotMatch(
  inbox,
  /\.limit\((?:200|300|500)\)/,
  'Inbox work queues must not silently stop at the former fixed caps',
);

for (const asset of [
  'review-stefani-bryant.webp',
  'review-noah-panetta.webp',
  'robert-k-result.webp',
  'client-result-equifax-820.webp',
  'client-result-inquiries-828.webp',
  'client-result-dilian-t.webp',
  'client-result-ryan-e.webp',
  'client-result-elizabeth-h.webp',
  'client-result-cameron-m.webp',
]) {
  const imageTag = preview.match(new RegExp(`<img[^>]+src="/${asset}"[\\s\\S]*?>`))?.[0] || '';
  assert.match(imageTag, /loading="lazy"/);
  assert.match(imageTag, /decoding="async"/);
  assert.match(imageTag, /width="\d+"/);
  assert.match(imageTag, /height="\d+"/);
}

console.log('Lazy-route, inbox pagination, and below-fold image assertions passed.');
