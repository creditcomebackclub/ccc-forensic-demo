import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCampaignItems } from '../src/utils/campaignItems.js';
import { isCampaignSelectionLocked } from '../src/utils/campaignSelection.js';
import { campaignReadyForTracking, isCancelledMail, isMailedMail } from '../src/utils/campaignMailing.js';
import {
  buildPortalCampaignJourneys,
  isPortalBureauDispute,
  isPortalFileUpdate,
  portalLetterGroup,
} from '../src/utils/portalCampaigns.js';
import roundEmailModule from '../netlify/functions/_roundEmail.cjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const { campaignReadyForPreparedEmail, campaignReadyForMailedEmail, campaignCleanupReadyForEmail } = roundEmailModule;

const auditRecord = {
  id: 'audit-1',
  audit: {
    client: { name: 'Jamie Sample' },
    accounts: [
      { clientAccountId: '11111111-1111-4111-8111-111111111111', furnisher: 'Capital One', bureaus: ['EQ', 'EXP'], violations: [{ field: '21' }] },
      { clientAccountId: '11111111-1111-4111-8111-111111111111', furnisher: 'Capital One duplicate', bureaus: ['EQ'] },
      { furnisher: 'Unreconciled account', bureaus: ['TU'] },
    ],
    personalInfo: {
      keepOnFile: { name: 'Jamie Sample', employer: 'Current Employer' },
      nameVariants: ['Jamie Sample', 'Jamie S Sample'],
      formerAddresses: ['123 Old Street'],
      formerEmployers: ['Old Employer'],
    },
    inquiries: [
      { furnisher: 'Auto Dealer', date: '2026-01-02', bureaus: ['Experian'], category: 'no_linked_account' },
      { furnisher: 'Bank', date: '2026-02-03', bureaus: ['EQ'], category: 'linked_to_open_account' },
    ],
  },
};

const items = buildCampaignItems(auditRecord);
assert.equal(items.filter((item) => item.item_kind === 'account').length, 1, 'accounts require stable identity and deduplicate');
assert.equal(items.filter((item) => item.item_kind === 'personal_info').length, 3, 'protected current name is excluded');
assert.equal(items.filter((item) => item.item_kind === 'inquiry').length, 1, 'linked inquiries are excluded');
assert.equal(new Set(items.map((item) => item.source_key)).size, items.length, 'frozen source keys stay unique');

assert.equal(isCampaignSelectionLocked({ letters: [] }), false);
assert.equal(isCampaignSelectionLocked({ letters: [{ id: 'derived-letter' }] }), true);
assert.equal(isMailedMail({ mailed_date: '2026-08-20' }), true);
assert.equal(isCancelledMail({ tracking_status: 'Cancelled' }), true);
assert.equal(campaignReadyForTracking({
  routes: [{ status: 'generated', letterIds: ['mailed-1'], approvedLetterIds: ['mailed-1'] }],
  letters: [{ id: 'mailed-1', mailed_date: '2026-08-20' }],
}), true);

assert.equal(campaignReadyForPreparedEmail([{ status: 'generated' }, { status: 'generated' }]), true);
assert.equal(campaignReadyForPreparedEmail([{ status: 'generated' }, { status: 'failed' }]), false);
assert.equal(campaignReadyForMailedEmail([{ mailed_date: '2026-08-20' }, { mailed_date: '2026-08-20' }]), true);
const cleanupMilestone = {
  items: [{ id: 'pi', item_kind: 'personal_info', selection_state: 'selected' }, { id: 'account', item_kind: 'account', selection_state: 'selected' }],
  routes: [{ item_id: 'pi', item_ids: ['pi'], status: 'generated', letter_ids: ['cleanup-1'] }, { item_id: 'account', item_ids: ['account'], status: 'configured', letter_ids: [] }],
  letters: [{ id: 'cleanup-1', mailed_date: '2026-08-20' }],
};
assert.equal(campaignCleanupReadyForEmail(cleanupMilestone), true, 'account routes do not delay the distinct cleanup milestone');

const cleanupLetter = {
  id: 'cleanup-1',
  campaign_id: 'campaign-1',
  letter_kind: 'file_update',
  target_type: 'bureau',
  phase: 'Personal Info & Inquiries',
  mailed_date: '2026-08-20',
  mail_service: 'usps_first_class',
  expected_delivery_date: '2099-08-25',
};
const accountLetter = { id: 'account-1', campaign_id: 'campaign-1', round_id: 'round-1', round_number: 1, letter_kind: 'dispute', target_type: 'bureau' };
assert.equal(isPortalFileUpdate(cleanupLetter), true);
assert.equal(isPortalBureauDispute(cleanupLetter), false);
assert.equal(isPortalBureauDispute(accountLetter), true);
assert.deepEqual(portalLetterGroup(cleanupLetter), { key: 'campaign:campaign-1:cleanup', label: 'Report preparation' });
assert.deepEqual(portalLetterGroup(accountLetter), { key: 'campaign:campaign-1:account', label: 'Round 1 · Account casework' });
const [journey] = buildPortalCampaignJourneys(
  [{ campaign_id: 'campaign-1', round_number: 1, stage: 'mailing', selected_cleanup_count: 1, selected_account_count: 1 }],
  [cleanupLetter],
  [],
);
assert.equal(journey.cleanup.status, 'Mailed · case review scheduled');
assert.equal(journey.account.status, 'Coming next');

const api = read('../src/utils/api.js');
const studio = read('../src/components/DisputeCampaignStudio.jsx');
assert.doesNotMatch(api, /generateCampaignAccountRoute/, 'retired Claude campaign-letter generation must not return');
assert.match(studio, /buildStateDrivenCraWorkItems/, 'current campaigns are built from reviewed account tracks');
assert.match(studio, /cccAccountTrackSnapshots/, 'current letters freeze their authoritative track bindings');

const legacyMigration = read('../supabase/migrations/20260809150000_client_campaign_command_center.sql');
assert.match(legacyMigration, /client_campaigns_round_uidx/, 'historical campaign records remain reconstructable');
const stateMigration = read('../supabase/migrations/20260820220000_ccc_account_tracks.sql');
assert.match(stateMigration, /create table if not exists public\.ccc_account_tracks/, 'new-method account state is additive');

console.log('Current campaign boundaries and retained legacy-history assertions passed.');
