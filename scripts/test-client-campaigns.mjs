import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCampaignItems } from '../src/utils/campaignItems.js';

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
assert(items.some((item) => item.label.includes('Jamie S Sample')), 'real name variation remains selectable');
assert(!items.some((item) => item.label === 'Name variation: Jamie Sample'), 'keep-on-file name cannot become a dispute candidate');
assert.equal(new Set(items.map((item) => item.source_key)).size, items.length, 'all frozen source keys are unique');

const migration = fs.readFileSync(new URL('../supabase/migrations/20260809150000_client_campaign_command_center.sql', import.meta.url), 'utf8');
assert.match(migration, /dispute_rounds_one_open_per_account_target_idx/, 'direct and bureau tracks have separate open-round protection');
assert.match(migration, /campaign_letter_routes_bureau_uidx/, 'bureau routes are unique per item and bureau');
assert.match(migration, /coalesce\(v_client\.engagement_status,'pending_onboarding'\) <> 'active'/, 'new campaign generation is engagement gated');
assert.match(migration, /v_evidence\.analysis_status<>'analyzed'/, 'later routes require analyzed prior evidence');
assert.match(migration, /greatest\(v_campaign_max, v_dispute_max\) \+ 1/, 'campaign numbering continues existing adaptive-round history');

const api = fs.readFileSync(new URL('../src/utils/api.js', import.meta.url), 'utf8');
assert.match(api, /generateCampaignAccountRoute/, 'campaign routes use the server-side Claude generator');
assert.match(api, /validate|citation|frozen audit/i, 'campaign generation preserves forensic validation framing');
assert.match(api, /generate-letter-background/, 'campaign letters retain the protected background generation endpoint');

const workspace = fs.readFileSync(new URL('../src/components/client-detail/ClientCampaignWorkspace.jsx', import.meta.url), 'utf8');
assert.match(workspace, /letter\.targetType === 'bureau' \? onAnalyzeBureau : onAnalyze/, 'bureau and furnisher responses retain their specialized analyzers');

console.log('All client-campaign assertions passed.');
