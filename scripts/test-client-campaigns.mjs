import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCampaignItems, buildCleanupRouteGroups } from '../src/utils/campaignItems.js';
import { isPendingRoundReview } from '../src/utils/roundState.js';
import { countMailStatuses, deriveNextAction } from '../src/components/client-detail/clientDetailUtils.js';
import { canMailLetter, generatedLetterValidationError, letterGenerationState } from '../src/utils/letterGeneration.js';
import { buildKeepOnFileIdentity, clientForLetterPrompt } from '../src/utils/letterPromptData.js';
import { isBureauAccountDisputeLetter, isFileUpdateLetter, isPersonalInfoCleanupLetter } from '../src/utils/letterMailing.js';
import { campaignReadyForTracking, isCancelledMail, isMailedMail } from '../src/utils/campaignMailing.js';
import { isCampaignSelectionLocked } from '../src/utils/campaignSelection.js';
import { calculateDeletionShare, countOngoingDisputeClients, selectVipClients, summarizeStructuredRoundWorkload } from '../src/utils/dashboardMetrics.js';

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

const cleanupGroups = buildCleanupRouteGroups([
  { id: 'pi-1', kind: 'personal_info', snapshot: { bureaus: ['EQ', 'EXP', 'TU'] } },
  { id: 'inq-eq', kind: 'inquiry', snapshot: { bureaus: ['EQ'] } },
  { id: 'inq-exp-tu', kind: 'inquiry', snapshot: { bureaus: ['EXP', 'TU'] } },
  { id: 'account-1', kind: 'account', snapshot: { bureaus: ['EQ'] } },
]);
assert.equal(cleanupGroups.length, 3, 'cleanup routes consolidate to at most one route per bureau');
assert.deepEqual(cleanupGroups.find((group) => group.targetBureau === 'equifax').itemIds, ['pi-1', 'inq-eq'], 'Equifax receives only matching selected cleanup findings');
assert.deepEqual(cleanupGroups.find((group) => group.targetBureau === 'experian').itemIds, ['pi-1', 'inq-exp-tu'], 'Experian receives only matching selected cleanup findings');
assert.deepEqual(cleanupGroups.find((group) => group.targetBureau === 'transunion').itemIds, ['pi-1', 'inq-exp-tu'], 'TransUnion receives only matching selected cleanup findings');

const legacySource = { id: 'source', roundId: 'round-1', furnisher: 'Example Bank', savedAt: '2026-01-01', roundReviewStatus: 'not_reviewed' };
assert.equal(isPendingRoundReview({ rounds: [{ round_id: 'round-1', status: 'closed' }], letters: [legacySource] }, legacySource), false, 'closed round lifecycle overrides a stale letter flag');
assert.equal(isPendingRoundReview({
  rounds: [{ round_id: 'round-1', status: 'open' }],
  letters: [legacySource, { phase: 'Phase 3 — Bureau Dispute', furnisher: 'Experian', coveredFurnishers: ['Example Bank'], savedAt: '2026-02-01' }],
}, legacySource), false, 'a later legacy Phase 3 follow-up proves the source review already happened');
assert.equal(isPendingRoundReview({ rounds: [{ round_id: 'round-1', status: 'open' }], letters: [legacySource] }, legacySource), true, 'an unresolved open round remains actionable');

const closedStale = { id: 'closed-source', roundId: 'round-closed', furnisher: 'Closed Bank', mailedDate: '2026-01-01', responseOutcome: 'received', roundReviewStatus: 'not_reviewed' };
const openDraft = { id: 'open-draft', roundId: 'round-open', furnisher: 'Open Bank', roundReviewStatus: 'not_reviewed', html: '<!DOCTYPE html><html><body><p>Complete reviewed dispute letter content.</p></body></html>' };
const detailClient = {
  rounds: [{ round_id: 'round-closed', status: 'closed' }, { round_id: 'round-open', status: 'open' }],
  letters: [closedStale, openDraft],
};
assert.equal(countMailStatuses(detailClient.letters, detailClient.rounds).received, 0, 'closed rounds do not inflate the detail review chip');
assert.equal(deriveNextAction(detailClient).label, 'Mail 1 letter', 'the client header points to real open work instead of a closed-round response');

const failedDraft = { id: 'failed', html: 'ERROR: Generated letter is empty or too short' };
const runningDraft = { id: 'running', html: 'GENERATING...' };
const validDraft = { id: 'valid', html: '<!DOCTYPE html><html><body><p>Complete reviewed dispute letter content.</p></body></html>' };
const truncatedDraft = { id: 'truncated', html: '<!DOCTYPE html><html><body><table><tr><td>Ahoy Mit Inc</td><td>2026-07-06</' };
assert.equal(letterGenerationState(failedDraft), 'failed', 'server generation errors remain explicit letter failures');
assert.equal(letterGenerationState(runningDraft), 'generating', 'placeholders remain in-progress rather than mail-ready');
assert.equal(letterGenerationState(truncatedDraft), 'failed', 'a long but unfinished HTML document is still a failed generation');
assert.equal(canMailLetter(failedDraft), false, 'failed generation placeholders can never enter mailing');
assert.equal(canMailLetter(runningDraft), false, 'in-progress placeholders can never enter mailing');
assert.equal(canMailLetter(truncatedDraft), false, 'truncated HTML can never enter mailing');
assert.equal(canMailLetter(validDraft), true, 'completed HTML remains mail eligible');
assert.match(generatedLetterValidationError(truncatedDraft), /incomplete/i, 'truncated output explains the structural failure');
assert.match(generatedLetterValidationError('<!DOCTYPE html><html><body><p>Done</p></body></html>', { requireSections: true }), /signature block/i, 'new generator output requires the signature section');
assert.equal(generatedLetterValidationError("<!DOCTYPE html><html><body><div class='signature-block'>Name</div><div class='mail-notation'>Certified</div><div class='enclosures'>ID</div></body></html>", { requireSections: true }), null, 'new generator output accepts every required closing section');

const cleanupLetter = { phase: 'Personal Info & Inquiries', letterKind: 'file_update', targetType: 'bureau', coveredFurnishers: [] };
assert.equal(isFileUpdateLetter(cleanupLetter), true, 'PI/inquiry letters are classified as file updates');
assert.equal(isPersonalInfoCleanupLetter(cleanupLetter), true, 'PI/inquiry letters receive their identity-document enclosure path');
assert.equal(isBureauAccountDisputeLetter(cleanupLetter), false, 'a bureau recipient does not turn a PI/inquiry letter into a Phase 3 account dispute');
assert.equal(isBureauAccountDisputeLetter({ phase: 'Phase 3 — Bureau Dispute', targetType: 'bureau', coveredFurnishers: ['Acme Bank'] }), true, 'real Phase 3 bureau disputes retain account safeguards');
assert.equal(isFileUpdateLetter({ phase: 'Personal Info & Inquiries' }), true, 'legacy cleanup letters remain recognizable without newer metadata');

const promptClient = clientForLetterPrompt({
  id: 'client-1', name: 'Robert', address: '1 Main St', dateOfBirth: '1964-05-01', currentEmployer: 'Verified Employer', signatureData: 'secret-signature',
  audits: [{ reportDate: '2026-08-07', audit: { inquiries: [{ furnisher: 'Wrong bureau evidence' }] } }],
  letters: [{ html: 'prior private letter' }], ledger: [{ amount: 99 }],
});
assert.deepEqual(Object.keys(promptClient).sort(), ['address', 'dateOfBirth', 'id', 'name', 'reportDate'], 'letter prompts receive only the minimal client identity snapshot');
assert.equal(promptClient.reportDate, '2026-08-07', 'the identity snapshot retains the source report date');
assert.equal(JSON.stringify(promptClient).includes('Wrong bureau evidence'), false, 'another bureau audit cannot leak through the client payload');
assert.equal(JSON.stringify(promptClient).includes('secret-signature'), false, 'signature bytes never enter the Claude prompt');
assert.equal(JSON.stringify(promptClient).includes('Verified Employer'), false, 'the employer is sent only to cleanup routes that need it');
assert.deepEqual(
  buildKeepOnFileIdentity({ name: 'Robert', currentEmployer: 'Profile Employer' }, { keepOnFile: { name: 'Robert', employer: 'Report Employer' } }),
  { name: 'Robert', employer: 'Profile Employer' },
  'the saved profile employer overrides report-derived employer evidence',
);
const generationCounts = countMailStatuses([failedDraft, runningDraft, validDraft], []);
assert.equal(generationCounts.generation_failed, 1, 'failed generation has its own mail-workboard status');
assert.equal(generationCounts.generating, 1, 'running generation has its own mail-workboard status');
assert.equal(generationCounts.not_mailed, 1, 'only valid completed HTML counts as not mailed');

const mailingWorkspace = {
  routes: [
    { status: 'generated', letterIds: ['mailed-letter'], approvedLetterIds: ['mailed-letter'] },
    { status: 'pending', letterIds: [], approvedLetterIds: [] },
  ],
  letters: [],
};
const mailedLetter = { id: 'mailed-letter', mailed_date: '2026-08-09', tracking_status: 'Mailed' };
assert.equal(isMailedMail(mailedLetter), true, 'a completed Lob submission counts as mailed');
assert.equal(campaignReadyForTracking(mailingWorkspace, [mailedLetter]), false, 'ungenerated routes keep a partial batch in the Mail step');
mailingWorkspace.routes[1] = { status: 'generated', letterIds: ['cancelled-letter'], approvedLetterIds: ['cancelled-letter'] };
const cancelledLetter = { id: 'cancelled-letter', mailed_date: '2026-08-09', tracking_status: 'Cancelled' };
assert.equal(isCancelledMail(cancelledLetter), true, 'a signed Lob cancellation is recognized');
assert.equal(isMailedMail(cancelledLetter), false, 'a canceled mailpiece never counts as mailed even if stale date data remains');
assert.equal(campaignReadyForTracking(mailingWorkspace, [mailedLetter, cancelledLetter]), false, 'a canceled letter blocks automatic advancement to Track');
cancelledLetter.tracking_status = 'Mailed';
assert.equal(campaignReadyForTracking(mailingWorkspace, [mailedLetter, cancelledLetter]), true, 'only a complete generated, approved, mailed batch advances to Track');

assert.equal(isCampaignSelectionLocked({ routes: [{ letterIds: [] }], letters: [] }), false, 'ungenerated route configuration can be replaced when dispute targets change');
assert.equal(isCampaignSelectionLocked({ routes: [{ letterIds: ['draft-1'] }], letters: [] }), true, 'a generated letter id locks the frozen dispute selection');
assert.equal(isCampaignSelectionLocked({ routes: [], letters: [{ id: 'draft-1' }] }), true, 'a persisted campaign letter locks the frozen dispute selection');

assert.deepEqual(summarizeStructuredRoundWorkload([
  { status: 'active', rounds: [{ status: 'open' }, { status: 'closed' }] },
  { status: 'active', rounds: [{ status: 'open' }, { status: 'open' }] },
  { status: 'active', rounds: [] },
  { status: 'lead', rounds: [{ status: 'open' }] },
]), { openDisputeRounds: 3, activeRoundClients: 2 }, 'dashboard workload counts structured open rounds and participating clients separately');
assert.equal(countOngoingDisputeClients([
  { status: 'active', billingStatus: 'Active', letters: [{}] },
  { status: 'active', billingStatus: 'Paused', audits: [{}] },
  { status: 'active', billingStatus: 'Active', activeCampaign: { id: 'campaign-1' } },
  { status: 'active', billingStatus: 'Graduated', letters: [{}] },
  { status: 'active', billingStatus: 'Inactive', rounds: [{}] },
  { status: 'lead', billingStatus: 'Active', letters: [{}] },
  { status: 'active', billingStatus: 'Active' },
]), 3, 'ongoing client count includes active and paused dispute work without counting inactive, graduated, leads, or empty files');
assert.deepEqual(selectVipClients([
  { id: 'client-vip', status: 'active', isVip: true },
  { id: 'lead-vip', status: 'lead', isVip: true },
  { id: 'client-standard', status: 'active', isVip: false },
]).map((client) => client.id), ['client-vip'], 'VIP dashboard list excludes records converted back to leads');
assert.equal(calculateDeletionShare(1, 16), 6, 'deletion share exposes the existing rounded 1-of-16 calculation');
assert.equal(calculateDeletionShare(0, 0), null, 'deletion share stays empty without a recorded denominator');

const migration = fs.readFileSync(new URL('../supabase/migrations/20260809150000_client_campaign_command_center.sql', import.meta.url), 'utf8');
assert.match(migration, /dispute_rounds_one_open_per_account_target_idx/, 'direct and bureau tracks have separate open-round protection');
assert.match(migration, /campaign_letter_routes_bureau_uidx/, 'bureau routes are unique per item and bureau');
assert.match(migration, /coalesce\(v_client\.engagement_status,'pending_onboarding'\) <> 'active'/, 'new campaign generation is engagement gated');
assert.match(migration, /v_evidence\.analysis_status<>'analyzed'/, 'later routes require analyzed prior evidence');
assert.match(migration, /greatest\(v_campaign_max, v_dispute_max\) \+ 1/, 'campaign numbering continues existing adaptive-round history');
assert.match(migration, /client_campaigns_round_uidx[\s\S]*where stage <> 'legacy'/, 'legacy reference rows cannot collide with real campaign round numbers');

const api = fs.readFileSync(new URL('../src/utils/api.js', import.meta.url), 'utf8');
assert.match(api, /generateCampaignAccountRoute/, 'campaign routes use the server-side Claude generator');
assert.match(api, /generate-letter-background/, 'campaign letters retain the protected background generation endpoint');
assert.match(api, /existingLetterId/, 'failed cleanup retries reuse the existing technical placeholder instead of creating duplicate letters');
assert.match(api, /jobIndexes/, 'multi-letter account retries regenerate only failed sibling placeholders');
assert.match(api, /isBackgroundPollTimeout/, 'a browser polling timeout leaves the background route recoverable');
assert.match(api, /generationContext/, 'the browser persists only selected generation facts');
assert.match(api, /body: JSON\.stringify\(\{ letterId \}\)/, 'each background request contains one stored letter id and no browser-authored prompt');
const letterContext = fs.readFileSync(new URL('../netlify/functions/_letterContext.mjs', import.meta.url), 'utf8');
assert.match(letterContext, /Authoritative server-loaded evidence/, 'campaign generation preserves server-owned frozen forensic evidence');
assert.match(letterContext, /no-linked-account category means the file shows no linked tradeline/i, 'cleanup letters cannot overstate no-linked-account evidence');
assert.match(letterContext, /duplication alone does not prove lack of permissible purpose/i, 'duplicate inquiry findings receive a fact-limited dispute basis');

const workspace = fs.readFileSync(new URL('../src/components/client-detail/ClientCampaignWorkspace.jsx', import.meta.url), 'utf8');
assert.match(workspace, /letter\.targetType === 'bureau' \? onAnalyzeBureau : onAnalyze/, 'bureau and furnisher responses retain their specialized analyzers');
assert.match(workspace, /Select all/, 'personal information and inquiry groups expose bulk selection');
assert.match(workspace, /Generate cleanup letters/, 'cleanup letters can be generated before account disputes');
assert.match(workspace, /Continue approved cleanup to Mail/, 'approved cleanup letters move into the dedicated Mail step before the account batch');
assert.match(workspace, /Mailing section/, 'campaigns expose a durable mailing workspace');
assert.match(workspace, /Canceled in Lob/, 'the mailing workspace distinguishes canceled Lob jobs from successful mail');
assert.doesNotMatch(workspace, /Mail approved cleanup/, 'review no longer opens the mailer directly');
assert.match(workspace, /aria-current=\{current \? 'step'/, 'the campaign rail exposes the workspace currently being viewed');
assert.match(workspace, /Click an available step to revisit its workspace/, 'the campaign rail explains its navigation behavior');
assert.match(workspace, /viewStage \|\| normalizedStage\(lifecycleStage\)/, 'workspace navigation is separate from the persisted campaign lifecycle');
assert.match(workspace, /readOnly=\{selectionLocked\}/, 'revisited dispute selections lock only after downstream letters exist');
assert.match(workspace, /clear its saved, ungenerated letter routes/, 'editing a configured round explicitly warns that derived routes will be rebuilt');
assert.match(workspace, /Later round[\s\S]*carry-forward queue/, 'the picker explains that Later is durable across eligible rounds');
assert.match(workspace, /awaiting_responses', 'response_review', 'closed'/, 'Track remains locked until the campaign lifecycle reaches response tracking');
assert.match(workspace, /failures\.push/, 'one failed route does not abort generation of later siblings');
assert.match(workspace, /generationProgress/, 'the queue exposes route-specific progress instead of one shared spinner label');

const dashboard = fs.readFileSync(new URL('../src/components/DashboardPage.jsx', import.meta.url), 'utf8');
assert.match(dashboard, /Open structured rounds/, 'dashboard distinguishes migrated structured rounds from the full ongoing caseload');
assert.match(dashboard, /Ongoing dispute clients/, 'dashboard reports the full active and paused dispute caseload');
assert.match(dashboard, /Deletion share/, 'the recorded-outcome ratio is not overstated as a win rate');
assert.match(dashboard, /recorded letter outcomes/, 'the deletion-share denominator is visible');

const clientsPage = fs.readFileSync(new URL('../src/components/ClientsPage.jsx', import.meta.url), 'utf8');
assert.match(clientsPage, /case 'open_rounds':[\s\S]*round\.status === 'open'/, 'the open-round dashboard tile drills into the same five-client population');

const groupedRoutes = fs.readFileSync(new URL('../supabase/migrations/20260809164000_campaign_grouped_cleanup_routes.sql', import.meta.url), 'utf8');
assert.match(groupedRoutes, /item_ids uuid\[\]/, 'campaign routes persist all findings consolidated into a bureau letter');

const employerMigration = fs.readFileSync(new URL('../supabase/migrations/20260809170000_add_current_employer.sql', import.meta.url), 'utf8');
assert.match(employerMigration, /add column if not exists current_employer text/, 'current employer has a durable CRM field');

const roundState = fs.readFileSync(new URL('../src/utils/roundState.js', import.meta.url), 'utf8');
assert.match(roundState, /round\.status === 'open'/, 'closed rounds cannot resurface as pending review');

const campaignApi = fs.readFileSync(new URL('../src/utils/campaigns.js', import.meta.url), 'utf8');
assert.match(campaignApi, /updateCampaignItemStates[\s\S]*revise_client_campaign_selection/, 'single and bulk selection changes use the guarded campaign RPC');

const selectionMigration = fs.readFileSync(new URL('../supabase/migrations/20260811160000_campaign_selection_revisions.sql', import.meta.url), 'utf8');
assert.match(selectionMigration, /exists \(select 1 from public\.letters letter where letter\.campaign_id = p_campaign_id\)/, 'the server locks selection as soon as a downstream letter exists');
assert.match(selectionMigration, /delete from public\.campaign_letter_routes where campaign_id = p_campaign_id/, 'a selection change clears only replaceable route configuration');
assert.match(selectionMigration, /prior_item\.selection_state = 'later'/, 'Later items carry into the next campaign when their deterministic source key still exists');

const lobFunction = fs.readFileSync(new URL('../netlify/functions/lob.cjs', import.meta.url), 'utf8');
assert.match(lobFunction, /storedHtml === 'GENERATING\.\.\.'/i, 'server-side mailing rejects generation placeholders');
assert.match(lobFunction, /storedHtml\.startsWith\('ERROR:'\)/i, 'server-side mailing rejects failed generation output');
assert.match(lobFunction, /incompleteDocument/i, 'server-side mailing rejects truncated HTML documents');
assert.match(lobFunction, /isBureauAccountDisputeLetter\(letter\)[\s\S]*PHASE 3 COVERAGE MISSING/, 'server applies covered-furnisher requirements only to account disputes');
assert.match(lobFunction, /select=id[^'\n]*letter_kind[^'\n]*target_type/, 'server loads the durable letter classification before mailing');
assert.match(lobFunction, /validatePersonalInfoCleanupPreflight\(letter/, 'server verifies PI/inquiry identity enclosures independently of the browser');
assert.match(lobFunction, /submission\.status === 'cancelled'/, 'an explicitly canceled submission can enter the guarded re-mail path');
assert.match(lobFunction, /prepareCancelledRetry[\s\S]*crypto\.randomUUID\(\)/, 'a canceled re-mail rotates Lob idempotency instead of reusing the abandoned job');

const lobWebhook = fs.readFileSync(new URL('../netlify/functions/lob-webhook.cjs', import.meta.url), 'utf8');
assert.match(lobWebhook, /letter\.deleted/, 'signed Lob deletion events are handled as cancellations');
assert.match(lobWebhook, /tracking_status: 'Cancelled'/, 'a cancellation clears the false mailed state');
assert.match(lobWebhook, /status: 'cancelled'/, 'the durable submission records the canceled terminal state');
assert.match(lobWebhook, /tracking_status\.is\.null,tracking_status\.neq\.Cancelled/, 'late tracking events cannot revive a canceled Lob job');
assert.match(lobWebhook, /lob_id=is\.null.*unresolvedFilter/, 'an old webhook cannot overwrite a newer explicit re-mail Lob id');

const cancellationMigration = fs.readFileSync(new URL('../supabase/migrations/20260809171000_lob_cancelled_submissions.sql', import.meta.url), 'utf8');
assert.match(cancellationMigration, /accepted_unreconciled', 'cancelled'/, 'mail submissions permit the durable canceled state');

const letterGenerator = fs.readFileSync(new URL('../netlify/functions/generate-letter-background.mjs', import.meta.url), 'utf8');
assert.match(letterGenerator, /LETTER_MAX_TOKENS = 24000/, 'letter generation has a bounded output and thinking budget');
assert.match(letterGenerator, /assertCompletedMessage/, 'output-limit truncation and abnormal stops fail closed before saving');
assert.match(letterGenerator, /loadCanonicalClientSignature/, 'the protected server injects the canonical client signature');
assert.match(letterGenerator, /renderStructuredLetter/, 'the server renders structured legal content with deterministic formatting');
assert.match(letterGenerator, /generatedLetterValidationError\(html, \{ requireSections: true \}\)/, 'new generated letters require a complete closing structure');

console.log('All client-campaign assertions passed.');
