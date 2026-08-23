#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ROUTE_CLASSIFICATIONS,
  buildCampaignBlueprint,
  classifyAccountRoute,
  recommendAccountRoute,
  splitPacketSpec,
  validatePacketSpec,
} from '../src/utils/campaignBlueprint.js';
import { packetAccountIsolationProblems } from '../src/utils/letterGeneration.js';
import { assessPacketAccount } from '../src/utils/packetResponse.js';
import { extractPacketAccountHtml } from '../src/utils/packetResponse.js';
import { renderStructuredLetter } from '../src/utils/structuredLetter.js';
import roundEmailModule from '../netlify/functions/_roundEmail.cjs';

const TODAY = new Date('2026-08-14T12:00:00Z');
const finding = (field, ruleId = `FIELD_${field}_MISMATCH`) => ({
  ruleId,
  field: `Field ${field}`,
  outcome: 'FLAG',
  evidenceRefs: [{ bureau: 'EQ', field: String(field), page: 2, rawValue: 'fixture value' }],
  adjudication: { status: 'authorized', reason: 'Page-backed deterministic test fixture', by: 'fixture', at: '2026-08-14T12:00:00.000Z' },
});

const accountItem = (number, overrides = {}) => {
  const snapshotOverrides = overrides.snapshot || {};
  return {
    id: `account-${number}`,
    kind: 'account',
    label: overrides.label || 'Shared Bank',
    selectionState: overrides.selectionState || 'selected',
    sortOrder: number,
    routeReview: overrides.routeReview || {},
    snapshot: {
      furnisher: overrides.label || 'Shared Bank',
      furnisherAddress: '100 Dispute Way\nPhoenix, AZ 85001',
      addressStatus: 'YES',
      accountNumberMasked: `XXXX${String(number).padStart(4, '0')}`,
      bureaus: ['EQ'],
      auditReportDate: '2026-08-01',
      findings: [finding(number === 1 ? '12' : '25')],
      violations: [finding(number === 1 ? '12' : '25')],
      ...snapshotOverrides,
    },
  };
};

const directItems = Array.from({ length: 6 }, (_, index) => accountItem(index + 1));
const blueprint = buildCampaignBlueprint(directItems, { now: TODAY });
const directPackets = blueprint.accountPackets.filter((packet) => packet.targetType === 'furnisher' && packet.disputeBasis === 'FCRA_DIRECT');
const bureauPackets = blueprint.accountPackets.filter((packet) => packet.targetType === 'bureau');
assert.deepEqual(directPackets.map((packet) => packet.itemIds.length), [5, 1], 'six compatible direct accounts split five-plus-one');
assert.deepEqual(bureauPackets.map((packet) => packet.itemIds.length), [5, 1], 'six compatible bureau accounts split five-plus-one');
assert.equal(buildCampaignBlueprint(directItems.slice(0, 2), { now: TODAY }).accountPackets
  .find((packet) => packet.targetType === 'furnisher').itemIds.length, 2, 'two compatible accounts share one packet');
assert.equal(buildCampaignBlueprint(directItems.slice(0, 5), { now: TODAY }).accountPackets
  .find((packet) => packet.targetType === 'furnisher').itemIds.length, 5, 'five compatible accounts share one packet');

const cleanupItem = {
  id: 'cleanup-1', kind: 'personal_info', label: 'Former address', selectionState: 'selected', sortOrder: 0,
  snapshot: { bureaus: ['EQ', 'EXP'] },
};
const cleanupBlueprint = buildCampaignBlueprint([cleanupItem, accountItem(1)], { now: TODAY });
assert.equal(cleanupBlueprint.cleanupPackets.length, 2, 'cleanup remains one separate packet per applicable bureau');
assert.ok(cleanupBlueprint.cleanupPackets.every((packet) => packet.itemIds.every((id) => id === cleanupItem.id)), 'cleanup never mixes with account disputes');
assert.ok(cleanupBlueprint.accountPackets.every((packet) => !packet.itemIds.includes(cleanupItem.id)), 'account packets exclude cleanup findings');

const fdcpaItem = accountItem(2, { routeReview: { fdcpaValidationEligible: true, notes: 'Reviewed collector validation facts.' } });
const legalBlueprint = buildCampaignBlueprint([accountItem(1), fdcpaItem], { now: TODAY });
const fcra = legalBlueprint.accountPackets.filter((packet) => packet.disputeBasis === 'FCRA_DIRECT');
const fdcpa = legalBlueprint.accountPackets.filter((packet) => packet.disputeBasis === 'FDCPA');
assert.equal(fcra.length, 1, 'compatible FCRA routes consolidate');
assert.deepEqual(fcra[0].itemIds, ['account-1', 'account-2']);
assert.equal(fdcpa.length, 1, 'verified FDCPA eligibility creates its own legal-path packet');
assert.deepEqual(fdcpa[0].itemIds, ['account-2']);
assert.notEqual(fcra[0].recipientKey, fdcpa[0].recipientKey, 'FCRA direct and FDCPA can never share a recipient key');

assert.equal(classifyAccountRoute(accountItem(7, {
  snapshot: { furnisherAddress: '', addressStatus: 'NO' },
}), { now: TODAY }).classification, ROUTE_CLASSIFICATIONS.BUREAU_ONLY, 'an unverified direct address blocks only the direct route');
assert.equal(classifyAccountRoute(accountItem(8, {
  snapshot: { auditReportDate: '2026-05-01' },
}), { now: TODAY }).classification, ROUTE_CLASSIFICATIONS.FRESH_REPORT_REQUIRED, 'stale evidence blocks generation');
assert.equal(classifyAccountRoute(accountItem(9, {
  snapshot: { findings: [finding('12'), { ruleId: 'ACCOUNT_MATCH_AMBIGUOUS', outcome: 'REVIEW_REQUIRED', verificationStatus: 'required' }] },
}), { now: TODAY }).classification, ROUTE_CLASSIFICATIONS.CLIENT_CONFIRMATION_REQUIRED, 'missing client confirmation blocks generation');
assert.equal(classifyAccountRoute(accountItem(10, {
  snapshot: { findings: [], violations: [] },
}), { now: TODAY }).classification, ROUTE_CLASSIFICATIONS.NO_DISPUTE, 'unsupported theories do not become dispute routes');
assert.equal(classifyAccountRoute(accountItem(11, {
  snapshot: { findings: [finding('25', 'CROSS_BUREAU_DOFD_MISMATCH')], violations: [finding('25', 'CROSS_BUREAU_DOFD_MISMATCH')] },
}), { now: TODAY }).classification, ROUTE_CLASSIFICATIONS.BUREAU_ONLY, 'cross-bureau comparison alone cannot authorize a furnisher-direct route');

const selectedMap = new Map([accountItem(1), accountItem(2, { label: 'Other Bank', snapshot: { furnisher: 'Other Bank' } })].map((item) => [item.id, item]));
assert.throws(() => validatePacketSpec({
  itemIds: ['account-1', 'account-2'], targetType: 'furnisher', disputeBasis: 'FCRA_DIRECT',
}, selectedMap, { now: TODAY }), /same furnisher, verified address, and legal path/i, 'incompatible direct recipients cannot be manually merged');
assert.throws(() => validatePacketSpec({
  itemIds: ['account-1'], targetType: 'furnisher', disputeBasis: 'FDCPA',
}, new Map([[accountItem(1).id, accountItem(1)]]), { now: TODAY }), /FDCPA eligibility/i, 'account type alone never authorizes FDCPA');
assert.deepEqual(splitPacketSpec(directPackets[0], 4).map((packet) => packet.itemIds.length), [4, 1], 'staff can split a compatible packet without changing its recipient');

const accounts = [
  { accountRef: 'acct-1', roundNumber: 1, account: accountItem(1).snapshot },
  { accountRef: 'acct-2', roundNumber: 2, account: accountItem(2).snapshot },
];
assert.throws(() => renderStructuredLetter(), /renderer is retired.*template library/i,
  'the former free-form packet renderer cannot create new correspondence');
const html = `<!doctype html><html><body>
  <div class="account-card" data-account-ref="acct-1">Account 1 — Masked account: XXXX0001</div>
  <div class="account-card" data-account-ref="acct-2">Account 2 — Masked account: XXXX0002</div>
  <section class="section" data-account-ref="acct-1"><h2>Account 1 — Field 12</h2><p>Correct Field 12 for account XXXX0001.</p></section>
  <section class="section" data-account-ref="acct-2"><h2>Account 2 — Field 25</h2><p>Correct Field 25 for account XXXX0002.</p></section>
  <tr data-account-ref="acct-1"><td>Correct Field 12.</td></tr>
  <tr data-account-ref="acct-2"><td>Correct Field 25.</td></tr>
</body></html>`;
assert.equal((html.match(/class="account-card"/g) || []).length, 2, 'one rendered letter contains a distinct card for every covered account');
assert.deepEqual(packetAccountIsolationProblems(html, accounts), [], 'valid account-scoped citations pass generation isolation');
assert.match(extractPacketAccountHtml(html, 'acct-1'), /Field 12/);
assert.doesNotMatch(extractPacketAccountHtml(html, 'acct-1'), /Field 25/, 'prior packet evidence can be reduced to one account without sibling facts');
const leaked = html.replace('Correct Field 12 for account XXXX0001.', 'Correct Field 25 for account XXXX0002.');
const leakProblems = packetAccountIsolationProblems(leaked, accounts);
assert.ok(leakProblems.some((problem) => /acct-1.*Field 25/i.test(problem)), 'a citation authorized only for another account fails generation');
assert.ok(leakProblems.some((problem) => /masked suffix belonging to acct-2/i.test(problem)), 'a foreign masked suffix fails generation');
assert.ok(packetAccountIsolationProblems(html.replace('<section class="section" data-account-ref="acct-1">', '<section class="section" data-account-ref="acct-99">'), accounts)
  .some((problem) => /unknown packet accountRef acct-99/i.test(problem)), 'unknown account references fail generation');

const extraction = {
  sender: 'Equifax', responseDate: '2026-08-10',
  claims: [{
    type: 'CORRECTION_STATED', fieldNumber: '12', accountSuffix: '0001', value: 'corrected',
    statement: 'We corrected Field 12 on account 0001.', page: 2,
  }],
  providedDocumentTypes: [], documentQuality: { enclosureLegible: true, issues: [] },
};
const accountOneAssessment = assessPacketAccount({ letterHtml: html, coverageOrder: 1, responseKind: 'bureau', extraction });
const accountTwoAssessment = assessPacketAccount({ letterHtml: html, coverageOrder: 2, responseKind: 'bureau', extraction });
assert.equal(accountOneAssessment.proposedNextAction, 'resolved', 'a matched correction can resolve its own covered account');
assert.equal(accountTwoAssessment.proposedNextAction, 'next_round', 'the same correction cannot resolve a different covered account');
assert.deepEqual(accountOneAssessment.citedPages, [2], 'account assessment retains its evidence page');
assert.deepEqual(accountTwoAssessment.citedPages, [], 'unmatched account receives no borrowed page citation');

const oneAccountPacketHtml = '<!doctype html><html><body><div class="account-card" data-account-ref="acct-1">Account 1 — Masked account: XXXX0001</div><section class="section" data-account-ref="acct-1"><h2>Field 12</h2><p>Correct Field 12 for account XXXX0001.</p></section><tr data-account-ref="acct-1"><td>Correct Field 12.</td></tr></body></html>';
assert.match(oneAccountPacketHtml, /class="account-card" data-account-ref="acct-1"/, 'the one-account remainder of a packet split retains packet coverage markup');
assert.deepEqual(packetAccountIsolationProblems(oneAccountPacketHtml, [accounts[0]]), [], 'one-account packets retain account-scoped citation validation');
assert.equal(assessPacketAccount({ letterHtml: oneAccountPacketHtml, coverageOrder: 1, responseKind: 'bureau', extraction }).proposedNextAction, 'resolved', 'one-account packet responses retain suffix-scoped assessment');

const migration = readFileSync(new URL('../supabase/migrations/20260814160000_consolidated_round_packets.sql', import.meta.url), 'utf8');
assert.match(migration, /create table if not exists public\.letter_account_coverage/i);
assert.match(migration, /create table if not exists public\.response_evidence_account_assessment/i);
assert.match(migration, /create or replace function public\.start_campaign_packet/i);
assert.match(migration, /create or replace function public\.review_campaign_item_eligibility/i);
assert.match(migration, /coverage\.client_id,/i, 'client-safe packet view exposes its server-filtered client key');
assert.match(migration, /array_length\(v_item_ids, 1\) > 5/i, 'database operation enforces the five-account limit');
assert.match(migration, /v_campaign\.packet_version\s*<>\s*2/i, 'packet RPC is feature-version gated');
assert.match(migration, /response_evidence_one_packet_upload_uidx/i, 'one packet accepts one authoritative response upload');
assert.match(migration, /source_assessment\.next_action in \('next_round', 'escalate'\)/i, 'next rounds require an account-specific reviewed assessment');
const portalView = migration.slice(migration.indexOf('create or replace view public.client_packet_account_status'), migration.indexOf('grant select on public.client_packet_account_status'));
assert.match(portalView, /client_progress/);
assert.doesNotMatch(portalView, /assessment\.disposition|assessment\.next_action|assessment\.review_status/, 'client packet view never exposes internal staff routing fields');

const settingsSource = readFileSync(new URL('../src/utils/settings.js', import.meta.url), 'utf8');
assert.match(settingsSource, /consolidatedPacketsEnabled:\s*false/, 'consolidated packets remain opt-in for newly created campaigns');
const lobSource = readFileSync(new URL('../netlify/functions/lob.cjs', import.meta.url), 'utf8');
assert.match(lobSource, /validatePacketPreflight/);
assert.match(lobSource, /updatePacketCoverage/);
const responseSource = readFileSync(new URL('../netlify/functions/phase2-analyze-background.mjs', import.meta.url), 'utf8');
assert.match(responseSource, /assessPacketAccount/);
assert.match(responseSource, /Packet covered account suffixes/);
assert.match(responseSource, /let packetCoverage = \[\];[\s\S]*catch \(e\)[\s\S]*response_status: 'received'/, 'packet analysis failures restore coverage to a retryable received state');

const { roundEventKey } = roundEmailModule;
const campaignRound = { id: 'round-1', campaign_id: 'campaign-1' };
assert.equal(roundEventKey(campaignRound, 'first_response_received'), 'campaign:campaign-1:first_response_received', 'first response email is idempotent for the whole campaign');
assert.equal(roundEventKey({ id: 'round-2', campaign_id: 'campaign-1' }, 'round_review_complete'), 'campaign:campaign-1:round_review_complete', 'completion email is idempotent for the whole campaign');

// Route recommendations are guidance only — they must not auto-enable FDCPA.
const collectorRec = recommendAccountRoute(accountItem(20, {
  label: 'Midland Credit Management',
  snapshot: { type: 'C', furnisher: 'Midland Credit Management' },
}), { now: TODAY });
assert.equal(collectorRec.classification, ROUTE_CLASSIFICATIONS.DIRECT_ELIGIBLE, 'collector stays DIRECT until staff verifies FDCPA');
assert.equal(collectorRec.fdcpaRecommended, true, 'collector with verified address is FDCPA-recommended');
assert.equal(collectorRec.furnisherFirstRecommended, true);
assert.equal(collectorRec.badgeTone, 'fdcpa');

const verifiedFdcpaRec = recommendAccountRoute(accountItem(21, {
  label: 'Portfolio Recovery',
  snapshot: { type: 'C', furnisher: 'Portfolio Recovery' },
  routeReview: { fdcpaValidationEligible: true },
}), { now: TODAY });
assert.equal(verifiedFdcpaRec.classification, ROUTE_CLASSIFICATIONS.FDCPA_ELIGIBLE);
assert.match(verifiedFdcpaRec.badge, /FDCPA eligible/i);

const bureauOnlyRec = recommendAccountRoute(accountItem(22, {
  snapshot: { furnisherAddress: '', addressStatus: 'NO' },
}), { now: TODAY });
assert.equal(bureauOnlyRec.classification, ROUTE_CLASSIFICATIONS.BUREAU_ONLY);
assert.equal(bureauOnlyRec.fdcpaRecommended, false);
assert.equal(bureauOnlyRec.bureauPacketEligible, true);

console.log('All consolidated packet assertions passed.');
