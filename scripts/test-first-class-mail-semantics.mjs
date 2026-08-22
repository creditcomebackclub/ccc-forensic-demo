#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cccReviewClock } from '../src/utils/cccMailRules.js';
import { letterStatus, responseDeadline } from '../src/utils/responseWindow.js';
import { buildAccountResults, buildActionQueue } from '../src/utils/portalPlan.js';
import {
  hasClientVisibleDelivery,
  hasPortalReviewStarted,
  portalMailPresentation,
  portalReviewStartDate,
} from '../src/utils/portalCampaigns.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const webhook = read('../netlify/functions/lob-webhook.cjs');
const cron = read('../netlify/functions/daily-cron.cjs');
const migration = read('../supabase/migrations/20260820410000_first_class_delivery_semantics.sql');
const portal = read('../src/components/ClientPortal.jsx');
const overview = read('../src/components/client-portal/OverviewTab.jsx');
const disputes = read('../src/components/client-portal/DisputesTab.jsx');
const timeline = read('../src/components/client-portal/TimelineTab.jsx');
const affiliateApi = read('../netlify/functions/affiliate-portal-data.cjs');
const affiliatePortal = read('../src/components/AffiliatePortal.jsx');

const firstClass = {
  phase: 'CCC Dispute — Accuracy R1 — Equifax',
  mail_service: 'usps_first_class',
  mailed_date: '2026-08-20',
  expected_delivery_date: '2026-08-25',
  delivered_at: '2026-08-22T18:00:00Z',
  tracking_status: 'Delivered',
  response_due_at: '2026-09-21T18:00:00Z',
};
const legacyCertified = {
  phase: 'Phase 3 — Bureau Dispute',
  mail_service: 'usps_first_class_certified_return_receipt',
  mailed_date: '2026-08-20',
  delivered_at: '2026-08-22T18:00:00Z',
  tracking_status: 'Delivered',
};
const unknownMail = {
  phase: 'CCC Dispute — Accuracy R1 — Equifax',
  mail_service: null,
  mailed_date: '2026-08-20',
  expected_delivery_date: '2026-08-25',
  delivered_at: '2026-08-22T18:00:00Z',
  tracking_status: 'Delivered',
  response_due_at: '2026-09-21T18:00:00Z',
};
const terminalFirstClass = {
  ...firstClass,
  tracking_status: 'Returned to Sender',
};

assert.equal(portalMailPresentation(firstClass).currentFirstClass, true);
assert.equal(hasClientVisibleDelivery(firstClass), false, 'plain First-Class scans are never client-visible delivery proof');
assert.equal(portalReviewStartDate(firstClass), '2026-08-25');
assert.equal(hasPortalReviewStarted(firstClass, new Date('2026-08-24T12:00:00Z')), false);
assert.equal(hasPortalReviewStarted(firstClass, new Date('2026-08-25T12:00:00Z')), true);
assert.deepEqual(cccReviewClock(firstClass), { start: '2026-08-25', basis: 'expected_delivery' });
assert.equal(responseDeadline(firstClass).toISOString(), '2026-09-24T00:00:00.000Z');
assert.equal(letterStatus(firstClass, new Date('2026-08-24T12:00:00Z')).code, 'review_scheduled');

assert.equal(portalMailPresentation(unknownMail).untracked, true);
assert.equal(hasClientVisibleDelivery(unknownMail), false, 'unknown service cannot turn a scan into delivery proof');
assert.equal(portalReviewStartDate(unknownMail), null, 'unknown service cannot start a portal clock');
assert.equal(responseDeadline(unknownMail), null, 'unknown service must mask stored delivery and due dates');
assert.equal(portalReviewStartDate({ ...firstClass, mailed_date: null }), null, 'an expected date without a mailing is not a clock');
assert.equal(responseDeadline({ ...firstClass, mailed_date: null }), null);
assert.equal(portalReviewStartDate(terminalFirstClass), null, 'terminal mail never starts an expected-delivery clock');
assert.equal(responseDeadline(terminalFirstClass), null);

assert.equal(hasClientVisibleDelivery(legacyCertified), true, 'explicit legacy certified delivery remains historical proof');
assert.equal(portalReviewStartDate(legacyCertified), '2026-08-22');
assert.equal(responseDeadline(legacyCertified).toISOString(), '2026-10-06T18:00:00.000Z');

const lobOnlyActions = buildActionQueue({
  clientDocs: { id: { id: 'id-proof' }, address: { id: 'address-proof' } },
  letters: [{ id: 'lob-only', lob_id: 'lob_123', target_bureau: 'equifax' }],
});
assert.equal(lobOnlyActions.some((action) => action.id === 'upload-response-lob-only'), false, 'Lob acceptance is not mailing proof');
const mailedActions = buildActionQueue({
  clientDocs: { id: { id: 'id-proof' }, address: { id: 'address-proof' } },
  letters: [{ id: 'mailed', mailed_date: '2026-08-20', target_bureau: 'equifax' }],
});
assert.equal(mailedActions.some((action) => action.id === 'upload-response-mailed'), true);
const terminalActions = buildActionQueue({
  clientDocs: { id: { id: 'id-proof' }, address: { id: 'address-proof' } },
  letters: [{ id: 'returned', mailed_date: '2026-08-20', tracking_status: 'Returned to Sender', target_bureau: 'equifax' }],
});
assert.equal(terminalActions.some((action) => action.id === 'upload-response-returned'), false);
const packetResults = buildAccountResults({
  packetCoverage: [{
    coverage_id: 'coverage-1',
    account_label: 'SBA EIDL',
    masked_account: 'ending 4421',
    target_bureau: 'transunion',
    response_status: 'reviewed',
    client_progress: 'resolved',
  }],
});
assert.deepEqual(packetResults.rows[0], {
  id: 'coverage-1',
  name: 'SBA EIDL · ending 4421',
  bureau: 'transunion',
  outcome: 'resolved',
  outcomeLabel: 'Review complete',
  positive: false,
});

assert.match(webhook, /Every event must resolve through one exact durable submission attempt[\s\S]*const isTrackedCertified = candidate\.mail_service === 'usps_first_class_certified_return_receipt'/);
assert.match(webhook, /const isUntrackedMail = !isTrackedCertified/);
assert.match(webhook, /const hasDeliveryProof = isDeliveryEvent && isTrackedCertified/);
assert.match(webhook, /const effectiveTrackingStatus = isUntrackedMail[\s\S]*'Mailpiece Scan Received'/);
assert.match(webhook, /isUntrackedMail[\s\S]*\? effectiveTrackingStatus === 'Returned to Sender' \? 'returned' : 'mailed'/);
assert.doesNotMatch(webhook, /hasDeliveryProof\s*=\s*isDeliveryEvent\s*&&\s*!/);
assert.match(webhook, /if \(hasDeliveryProof && updatedRows\[0\]\?\.target_type/);
assert.match(webhook, /if \(hasDeliveryProof && mailReady\)/);

assert.match(cron, /expected_delivery_date,tracking_status,response_due_at/);
assert.match(cron, /const hasExpectedDeliveryClock = isCurrentFirstClass[\s\S]*Boolean\(letter\.mailed_date\)[\s\S]*Boolean\(letter\.expected_delivery_date\)[\s\S]*!isTerminalMail/);
assert.match(cron, /const hasCertifiedDeliveryProof = isTrackedCertified[\s\S]*letter\.tracking_status === 'Delivered'[\s\S]*Boolean\(letter\.delivered_at\)/);
assert.match(cron, /const windowDays = hasCertifiedDeliveryProof && letter\.response_due_at/);
assert.doesNotMatch(cron, /:\s*letter\.delivered_at\s*\?/);

assert.match(migration, /where mail_service = 'usps_first_class'/);
assert.match(migration, /delivered_at = null,[\s\S]*response_due_at = null/);
assert.match(migration, /'mailed', 'in_transit'/);
assert.match(migration, /when l\.mail_service = 'usps_first_class'[\s\S]*then l\.expected_delivery_date \+ 30/);
assert.match(migration, /when l\.mail_service = 'usps_first_class_certified_return_receipt' then l\.delivered_at[\s\S]*else null[\s\S]*end as delivered_at/);
assert.doesNotMatch(migration, /coalesce\(l\.delivered_at::date, l\.expected_delivery_date\)/);

assert.match(portal, /const reviewStarted = letters\.filter\(\(letter\) => hasPortalReviewStarted\(letter\)\)/);
assert.match(overview, /Review clocks/);
assert.doesNotMatch(overview, /received a delivery scan/);
assert.match(overview, /agreementSignedAt \?/);
assert.match(overview, /Your service enrollment is active/);
assert.match(disputes, /review clocks active/);
assert.match(disputes, /Mailed First Class — review schedule pending/);
assert.doesNotMatch(disputes, /window begins upon recorded delivery/);
assert.match(timeline, /hasPortalReviewStarted\(l\)/);
assert.match(timeline, /UNTRACKED_CAMPAIGN_STEPS = \['Prepared', 'Mailed', 'Review Scheduled', 'Review Start'/);
assert.match(portal, /l\.tracking_number && mail\.legacyCertified/);
assert.doesNotMatch(portal, /l\.tracking_number && !mail\.currentFirstClass/);

assert.match(affiliateApi, /mail_service,expected_delivery_date,tracking_status,delivered_at/);
assert.match(affiliateApi, /loadAffiliateForUser\(\{ url: supabaseUrl, key: supabaseKey, userId: user\.id \}\)/);
assert.match(affiliateApi, /String\(affiliate\.id\)\.toLowerCase\(\) !== String\(affiliateId\)\.toLowerCase\(\)/);
assert.match(affiliateApi, /const isTrackedCertified = letter\.mail_service === 'usps_first_class_certified_return_receipt'/);
assert.match(affiliateApi, /delivered_at: null/);
assert.match(affiliateApi, /order=report_date\.desc\.nullslast,saved_at\.desc\.nullslast,id\.desc/);
assert.match(affiliateApi, /latest\?\.audit\?\.scores \|\| latest\?\.audit\?\.client\?\.scores/);
assert.match(affiliatePortal, /Review Active/);
assert.doesNotMatch(affiliatePortal, /label: 'Delivered'/);

console.log('First-Class expected-delivery semantics and legacy-certified boundaries passed.');
