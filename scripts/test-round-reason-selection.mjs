import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildRoundReasonSnapshots,
  evidenceReasonsForAccount,
  privateInstructionLeakIssues,
  roundSelectionDraftSuffix,
  roundReasonRenderIssues,
  validateRoundReasonSnapshots,
} from '../src/utils/disputeReasonSelection.js';
import {
  disputeItemsText,
  renderDisputeTemplate,
  wrapDisputeLetterHtml,
} from '../src/utils/disputeTemplateEngine.js';
import { CCC_BUREAU_RECIPIENTS } from '../src/utils/cccLetterTrackSnapshots.js';

const accountId = (index) => `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const trackId = (index) => `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

function violation(index, bureau = 'EQ', overrides = {}) {
  return {
    ruleId: `RULE_${index}`,
    field: 'Account status',
    issue: `The status conflict ${index} is visible in the report.`,
    currentlyReports: 'Open',
    shouldReport: 'Closed',
    statute: '15 U.S.C. § 1681e(b)',
    severity: 'high',
    challengeStatement: 'Investigate and correct the unsupported status.',
    outcome: 'FLAG',
    adjudication: { status: 'authorized' },
    evidenceRefs: [{
      bureau,
      page: index,
      field: 'accountStatus',
      label: 'Account status',
      rawValue: 'Open',
    }],
    ...overrides,
  };
}

function account(index, violations = [violation(index)]) {
  return {
    clientAccountId: accountId(index),
    furnisher: `Evidence Bank ${index}`,
    accountNumber: `RAW-${9000 + index}`,
    bureaus: ['EQ'],
    violations,
  };
}

function track(index, sourceAuditSnapshot) {
  return {
    id: trackId(index),
    client_account_id: accountId(index),
    source_audit_snapshot: sourceAuditSnapshot,
  };
}

const first = account(1, [
  violation(1),
  violation(2, 'EQ', { field: 'Balance', issue: 'The reported balance conflicts with the source record.' }),
  violation(3, 'TU'),
  violation(4, 'EQ', { outcome: 'PASS' }),
]);
const second = account(2);
const offered = evidenceReasonsForAccount(first, 'EQ');
assert.equal(offered.length, 2, 'only authorized findings with target-bureau source evidence are offered');
assert.deepEqual(offered.map((reason) => reason.ruleId), ['RULE_1', 'RULE_2']);
assert.deepEqual(evidenceReasonsForAccount(account(9, [
  violation(9, 'EQ', { outcome: undefined }),
  violation(10, 'EQ', { evidenceRefs: [{ bureau: 'EQ', page: null, rawValue: null }] }),
]), 'EQ'), [], 'missing authorization or concrete page/value support fails closed');

const privateNote = 'Lead with the balance conflict; do not expose this private team note.';
const canonicalOrderSnapshot = buildRoundReasonSnapshots({
  accounts: [first],
  bureauCode: 'EQ',
  selection: {
    [first.clientAccountId]: {
      included: true,
      reasonIds: [offered[1].reasonId, offered[0].reasonId],
      internalStaffInstructions: '',
    },
  },
});
assert.deepEqual(canonicalOrderSnapshot[0].selectedReasons.map((reason) => reason.ruleId), ['RULE_1', 'RULE_2'],
  'selected reasons always freeze in the source audit order rather than click order');
const selection = {
  [first.clientAccountId]: {
    included: true,
    reasonIds: [offered[1].reasonId],
    internalStaffInstructions: privateNote,
  },
  [second.clientAccountId]: {
    included: false,
    reasonIds: evidenceReasonsForAccount(second, 'EQ').map((reason) => reason.reasonId),
    internalStaffInstructions: 'This unchecked account must not be persisted.',
  },
};
const snapshots = buildRoundReasonSnapshots({ accounts: [first, second], bureauCode: 'EQ', selection });
assert.equal(snapshots.length, 1, 'unchecked accounts never enter the physical-letter snapshot');
assert.equal(snapshots[0].clientAccountId, first.clientAccountId);
assert.equal(snapshots[0].accountNumberMasked, '****9001', 'raw account numbers are reduced to last-four masks');
assert.equal(snapshots[0].selectedReasons.length, 1, 'only expressly selected reasons are frozen');
assert.equal(snapshots[0].selectedReasons[0].ruleId, 'RULE_2');
assert.deepEqual(snapshots[0].selectedReasons[0].evidenceRefs, [{
  bureauCode: 'EQ',
  page: 2,
  field: 'accountStatus',
  label: 'Account status',
  rawValue: 'Open',
}]);
assert.equal(snapshots[0].internalStaffInstructions, privateNote);

const selectedTrack = track(1, first);
assert.deepEqual(validateRoundReasonSnapshots({ accountSnapshots: snapshots, tracks: [selectedTrack], bureauCode: 'EQ' }), []);
const jsonbReordered = structuredClone(snapshots);
const originalRef = jsonbReordered[0].selectedReasons[0].evidenceRefs[0];
jsonbReordered[0].selectedReasons[0].evidenceRefs[0] = {
  rawValue: originalRef.rawValue,
  label: originalRef.label,
  field: originalRef.field,
  page: originalRef.page,
  bureauCode: originalRef.bureauCode,
};
assert.deepEqual(
  validateRoundReasonSnapshots({ accountSnapshots: jsonbReordered, tracks: [selectedTrack], bureauCode: 'EQ' }),
  [],
  'jsonb object-key reordering must not make exact frozen evidence look tampered',
);
assert.match(
  validateRoundReasonSnapshots({ accountSnapshots: snapshots, tracks: [selectedTrack, track(2, second)], bureauCode: 'EQ' }).join(' '),
  /do not exactly cover/i,
  'an unselected track cannot be silently attached to the selected letter',
);

const tamperedReason = structuredClone(snapshots);
tamperedReason[0].selectedReasons[0].issue = 'A free-form allegation was inserted.';
assert.match(
  validateRoundReasonSnapshots({ accountSnapshots: tamperedReason, tracks: [selectedTrack], bureauCode: 'EQ' }).join(' '),
  /does not exactly match/i,
  'a modified reason fails frozen-evidence revalidation',
);
const tamperedMetadata = structuredClone(snapshots);
tamperedMetadata[0].furnisher = 'Different Furnisher';
assert.match(
  validateRoundReasonSnapshots({ accountSnapshots: tamperedMetadata, tracks: [selectedTrack], bureauCode: 'EQ' }).join(' '),
  /metadata does not exactly match/i,
);

const merged = disputeItemsText(snapshots);
assert.match(merged, /Balance/);
assert.match(merged, /Should report: Closed/);
assert.doesNotMatch(merged, /status conflict 1/);
assert.doesNotMatch(merged, /Evidence Bank 2/);
assert.doesNotMatch(merged, new RegExp(privateNote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
const challengeOnlySnapshot = structuredClone(snapshots);
challengeOnlySnapshot[0].selectedReasons[0].shouldReport = '';
assert.match(disputeItemsText(challengeOnlySnapshot), /Requested action: Investigate and correct the unsupported status\./,
  'the source-backed requested action prints when the audit has no shouldReport value');
assert.deepEqual(privateInstructionLeakIssues(snapshots, `<p>${merged}</p>`), []);
assert.equal(privateInstructionLeakIssues(snapshots, `<p>${privateNote}</p>`).length, 1, 'mail preflight detects a leaked private note');
const templateText = 'Consumer facts:\n{dispute_item_and_explanation}\n{consumer_statement}';
const automaticValues = { dispute_item_and_explanation: merged };
const editableSections = { consumer_statement: 'I am asking for an accurate investigation.' };
const renderedBody = renderDisputeTemplate(
  templateText,
  { ...automaticValues, ...editableSections },
  ['screenshots'],
);
const renderedLetter = wrapDisputeLetterHtml(renderedBody);
assert.deepEqual(roundReasonRenderIssues({
  accountSnapshots: snapshots,
  automaticValues,
  editableSections,
  templateText,
  renderedHtml: renderedLetter,
}), [], 'the exact selected facts own the account curly while Consumer Statement stays separate');
assert.match(roundReasonRenderIssues({
  accountSnapshots: snapshots,
  automaticValues,
  editableSections,
  templateText,
  renderedHtml: renderedLetter.replace('</main>', '<p>Unsupported appended claim.</p></main>'),
}).join(' '), /not the exact frozen template merge/i, 'appended post-save claims fail exact render validation');
assert.match(roundReasonRenderIssues({
  accountSnapshots: snapshots,
  automaticValues,
  editableSections,
  templateText,
  renderedHtml: renderedLetter.replace('<main class="letter-content">', '<main class="letter-content"><p>Unsupported prefixed claim.</p>'),
}).join(' '), /not the exact frozen template merge/i, 'prefixed post-save claims fail exact render validation');
assert.match(roundReasonRenderIssues({
  accountSnapshots: snapshots,
  automaticValues,
  editableSections: { consumer_statement: 'Different browser snapshot.' },
  templateText,
  renderedHtml: renderedLetter,
}).join(' '), /not the exact frozen template merge/i, 'changed human sections cannot validate against old rendered HTML');
assert.match(roundReasonRenderIssues({
  accountSnapshots: snapshots,
  automaticValues: { dispute_item_and_explanation: 'AI changed the facts.' },
  editableSections,
  templateText,
  renderedHtml: renderedLetter,
}).join(' '), /does not exactly match/i, 'AI/manual changes cannot replace the selected account facts');

assert.throws(
  () => buildRoundReasonSnapshots({ accounts: [first], bureauCode: 'EQ', selection: {
    [first.clientAccountId]: { included: true, reasonIds: ['CUSTOM_FREE_FORM'], internalStaffInstructions: '' },
  } }),
  /no longer authorized/i,
  'custom/free-form reason IDs fail closed',
);

const draftSuffix = await roundSelectionDraftSuffix({
  accountSnapshots: snapshots,
  trackSnapshots: [{ trackId: trackId(1), revision: 0 }],
  template: { id: 'template-1', version: 'v1', body: 'Fixed {account_list}' },
  automaticValues,
  editableSections,
});
const sameDraftSuffix = await roundSelectionDraftSuffix({
  accountSnapshots: jsonbReordered,
  trackSnapshots: [{ revision: 0, trackId: trackId(1) }],
  template: { body: 'Fixed {account_list}', version: 'v1', id: 'template-1' },
  automaticValues,
  editableSections,
});
const changedReasonSuffix = await roundSelectionDraftSuffix({
  accountSnapshots: tamperedReason,
  trackSnapshots: [{ trackId: trackId(1), revision: 0 }],
  template: { id: 'template-1', version: 'v1', body: 'Fixed {account_list}' },
  automaticValues,
  editableSections,
});
const changedStatementSuffix = await roundSelectionDraftSuffix({
  accountSnapshots: snapshots,
  trackSnapshots: [{ trackId: trackId(1), revision: 0 }],
  template: { id: 'template-1', version: 'v1', body: 'Fixed {account_list}' },
  automaticValues,
  editableSections: { consumer_statement: 'A corrected reviewed statement.' },
});
assert.match(draftSuffix, /^__selection-[a-f0-9]{64}$/);
assert.equal(sameDraftSuffix, draftSuffix, 'exact save retries share one deterministic letter identity');
assert.notEqual(changedReasonSuffix, draftSuffix, 'a materially different frozen reason receives a different draft identity');
assert.notEqual(changedStatementSuffix, draftSuffix, 'a corrected reviewed human section receives a recoverable new draft identity');
assert.throws(
  () => buildRoundReasonSnapshots({ accounts: [first], bureauCode: 'EQ', selection: {
    [first.clientAccountId]: { included: true, reasonIds: [], internalStaffInstructions: '' },
  } }),
  /at least one evidence-backed dispute reason/i,
);

const sixAccounts = Array.from({ length: 6 }, (_, index) => account(index + 10));
const sixSelection = Object.fromEntries(sixAccounts.map((item) => [item.clientAccountId, {
  included: true,
  reasonIds: evidenceReasonsForAccount(item, 'EQ').map((reason) => reason.reasonId),
  internalStaffInstructions: '',
}]));
assert.throws(
  () => buildRoundReasonSnapshots({ accounts: sixAccounts, bureauCode: 'EQ', selection: sixSelection }),
  /no more than 5 accounts/i,
);

const huge = 'X'.repeat(7900);
const largeAccounts = Array.from({ length: 5 }, (_, accountIndex) => account(accountIndex + 20, [
  violation(accountIndex * 2 + 100, 'EQ', {
    issue: huge,
    currentlyReports: huge,
    shouldReport: huge,
    challengeStatement: huge,
    evidenceRefs: [{ bureau: 'EQ', page: 1, field: 'status', label: 'Status', rawValue: 'Y'.repeat(1900) }],
  }),
  violation(accountIndex * 2 + 101, 'EQ', {
    issue: huge,
    currentlyReports: huge,
    shouldReport: huge,
    challengeStatement: huge,
    evidenceRefs: [{ bureau: 'EQ', page: 2, field: 'balance', label: 'Balance', rawValue: 'Y'.repeat(1900) }],
  }),
]));
const largeSelection = Object.fromEntries(largeAccounts.map((item) => [item.clientAccountId, {
  included: true,
  reasonIds: evidenceReasonsForAccount(item, 'EQ').map((reason) => reason.reasonId),
  internalStaffInstructions: '',
}]));
assert.throws(
  () => buildRoundReasonSnapshots({ accounts: largeAccounts, bureauCode: 'EQ', selection: largeSelection }),
  /256 KB letter snapshot limit/i,
  'aggregate evidence is bounded even when every individual field is valid',
);

const lobSource = readFileSync(new URL('../netlify/functions/lob.cjs', import.meta.url), 'utf8');
assert.match(lobSource, /source_audit_snapshot/);
assert.match(lobSource, /validateRoundReasonSnapshots\(\{/);
assert.match(lobSource, /privateInstructionLeakIssues\(letter\.dispute_account_snapshot, letter\.html\)/);
assert.match(lobSource, /roundReasonRenderIssues\(\{/);
assert.match(lobSource, /editableSections: letter\.dispute_editable_sections/);
assert.match(lobSource, /template\?\.body_text === letter\.dispute_template_snapshot/);
assert.match(lobSource, /body_text,is_active/);
const migrationSource = readFileSync(new URL('../supabase/migrations/20260820510000_round_reason_selection.sql', import.meta.url), 'utf8');
const recipientKey = (address) => [address.name, address.line1, address.line2, address.city, address.state, address.zip]
  .map((value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ''))
  .join('|');
assert.match(migrationSource, /letters_round_reason_snapshot_shape/);
assert.match(migrationSource, /pg_catalog\.pg_column_size\(p_snapshot\) > 262144/);
assert.doesNotMatch(migrationSource, /pg_catalog\.coalesce\(/,
  'COALESCE is SQL syntax and must never be schema-qualified');
assert.match(migrationSource, /protect_saved_ccc_round_reason_snapshot_trigger/);
assert.match(migrationSource, /create or replace view public\.ccc_pre5100_mail_inventory/,
  'pre-cutover durable sends are inventoried before claims are enabled');
assert.match(migrationSource, /5100 blocked: ambiguous durable pre-cutover CCC mail evidence/,
  'ambiguous legacy evidence aborts the migration rather than inventing ownership');
assert.match(migrationSource, /create table if not exists public\.ccc_track_revision_prior_sends/);
assert.match(migrationSource, /unique \(track_id, track_revision\)/,
  'one immutable pre-cutover evidence record owns an exact track revision');
assert.match(migrationSource, /One or more selected account rounds already has durable pre-cutover mail evidence/,
  'claim RPC fails closed when postage evidence predates the claim protocol');
assert.match(migrationSource, /revoke all on public\.ccc_track_revision_prior_sends from public, anon, authenticated, service_role/,
  'pre-cutover mail history has no direct service-role DML grant');
assert.match(migrationSource, /create table if not exists public\.ccc_track_revision_mail_claims/);
assert.match(migrationSource, /ccc_track_revision_one_active_mail_claim[\s\S]*\(track_id, track_revision\)[\s\S]*where claim_status = 'active'/);
assert.match(migrationSource, /claim_ccc_track_revisions_for_mail/);
assert.match(migrationSource, /jsonb_array_length\(p_track_snapshots\) not between 1 and 5/,
  'the server enforces the same five-account physical-letter maximum as the composer');
assert.match(migrationSource, /for update of track/);
assert.match(migrationSource, /v_letter\.ccc_account_track_snapshots is distinct from p_track_snapshots/);
assert.match(migrationSource, /v_current_letter_snapshot is distinct from p_expected_letter_snapshot/);
assert.match(migrationSource, /v_template\.is_active is distinct from true/);
assert.match(migrationSource, /v_template\.body_text is distinct from v_letter\.dispute_template_snapshot/);
assert.match(migrationSource, /The fixed CRA recipient does not match the exact bound bureau/);
for (const recipient of Object.values(CCC_BUREAU_RECIPIENTS)) {
  assert.ok(migrationSource.includes(recipientKey(recipient)),
    `${recipient.name} must have the same normalized recipient identity in the atomic claim RPC`);
}
assert.match(migrationSource, /p_recipient_snapshot->>'version' is distinct from '1'/);
assert.match(migrationSource, /mailpiece_sha256 is distinct from p_mailpiece_sha256/);
assert.match(migrationSource, /lob_request_sha256 is distinct from p_lob_request_sha256/,
  'the atomic claim binds the exact JSON body handed to Lob');
assert.match(migrationSource, /lob_idempotency_key is distinct from v_submission\.idempotency_key/);
assert.match(migrationSource, /lob_idempotency_created_at is distinct from v_submission\.idempotency_created_at/);
assert.match(migrationSource, /idempotency_created_at < pg_catalog\.now\(\) - interval '24 hours'/,
  'stale unresolved provider generations are blocked for manual reconciliation');
assert.match(migrationSource, /attachment_manifest is distinct from p_attachment_manifest/);
assert.match(migrationSource, /The all-exhibit CCC attachment manifest is malformed or duplicated/,
  'the atomic claim accepts only exact ordered path, digest, and byte-size identities');
assert.match(migrationSource, /ccc_storage_object_has_active_mail_claim/,
  'active claims expose a server-owned storage immutability predicate');
for (const command of ['insert', 'update', 'delete']) {
  assert.match(
    migrationSource,
    new RegExp(`active_ccc_claim_blocks_packet_asset_${command}[\\s\\S]*as restrictive for ${command}[\\s\\S]*ccc_storage_object_has_active_mail_claim`, 'i'),
    `an authenticated browser cannot ${command} an exhibit referenced by an active physical-mail claim`,
  );
}
assert.match(migrationSource, /A different saved letter already owns physical mail for one or more selected account rounds/,
  'parallel drafts cannot both own the same exact track revision');
assert.match(migrationSource, /revoke all on public\.ccc_track_revision_mail_claims from public, anon, authenticated, service_role/,
  'even the service role has no direct claim-table DML grant; only guarded SECURITY DEFINER RPCs mutate it');
assert.match(migrationSource, /grant select on public\.ccc_track_revision_mail_claims to service_role/);
assert.doesNotMatch(migrationSource, /signed_failed/);
assert.match(migrationSource, /p_release_reason not in \('lob_rejected_preaccept', 'pre_lob_integrity_failure', 'signed_cancelled'\)/,
  'only the three server-proved release lifecycles exist');
assert.match(migrationSource, /v_submission\.status = 'pending'[\s\S]*v_submission\.lob_id is null[\s\S]*v_submission\.submitted_at is null[\s\S]*v_submission\.attempt_count >= 1[\s\S]*v_letter\.lob_id is null[\s\S]*split_part\(coalesce\(v_submission\.last_error, ''\), ':', 1\) = 'LOB_PREACCEPT_REJECTED'/,
  'pre-accept release requires a called, exact, never-accepted provider attempt');
assert.match(migrationSource, /v_rejection_code in \([\s\S]*'INVALID_TEMPLATE_HTML'[\s\S]*'UNEMBEDDED_FONTS'[\s\S]*\)/,
  'only reviewed Lob validation codes can release a called attempt');
const releaseFunction = migrationSource.slice(
  migrationSource.indexOf('create or replace function public.release_ccc_track_revision_mail_claims'),
  migrationSource.indexOf('-- Once a physical-mail claim exists'),
);
assert.doesNotMatch(releaseFunction, /'CONFLICT'/,
  'generic provider conflicts can never release an irreversible-mail claim');
assert.match(releaseFunction, /p_release_reason = 'pre_lob_integrity_failure'[\s\S]*v_submission\.attempt_count = 0[\s\S]*v_submission\.last_attempt_at is null[\s\S]*'PRE_LOB_INTEGRITY_FAILURE'/,
  'a post-claim integrity failure releases only a provider-never-called attempt');
assert.match(releaseFunction, /idempotency_key = extensions\.gen_random_uuid\(\)::text[\s\S]*lob_request_sha256 = null/,
  'corrected retries rotate both provider identity and exact request binding');
assert.match(migrationSource, /v_submission\.status = 'cancelled'[\s\S]*v_submission\.lob_id is not null[\s\S]*v_letter\.lob_id = v_submission\.lob_id[\s\S]*v_letter\.tracking_status = 'Cancelled'/,
  'cancellation release requires the exact signed terminal attempt recorded on both rows');
assert.match(migrationSource, /revoke all on function public\.release_ccc_track_revision_mail_claims\(text, uuid, text\) from public, anon, authenticated/);
assert.match(migrationSource, /grant execute on function public\.release_ccc_track_revision_mail_claims\(text, uuid, text\) to service_role/);
assert.match(migrationSource, /protect_claimed_ccc_letter_printable_snapshot_trigger/);
assert.match(lobSource, /p_expected_letter_snapshot: cccPrintableLetterClaimSnapshot\(letter\)/);
assert.match(lobSource, /function isExplicitLobPreacceptRejection[\s\S]*status === 400 \|\| status === 422[\s\S]*LOB_PREACCEPT_VALIDATION_CODES\.has\(lobErrorCode\(result\)\)/,
  'HTTP status alone never releases; an exact reviewed Lob validation code is also required');
assert.match(lobSource, /const lobRequestSha256 = sha256Hex\(Buffer\.from\(JSON\.stringify\(letterPayload\), 'utf8'\)\)/,
  'the hash binds the byte-exact provider JSON request');
assert.match(lobSource, /const postClaimPacket = await validateCccRenderedMailpiece/,
  'packet and attachment bytes are re-read after storage locks become active');
assert.match(lobSource, /PRE_LOB_INTEGRITY_FAILURE:[^\n]+[\s\S]*'pre_lob_integrity_failure'/,
  'a never-called post-claim mismatch uses the guarded server release lifecycle');
assert.match(lobSource, /scanMailpieceExternalDependencies[\s\S]*CSS @import/,
  'all unbound renderer dependencies, including CSS imports and links, fail closed');
assert.ok(
  lobSource.indexOf('LOB_PREACCEPT_REJECTED:')
    < lobSource.indexOf("'lob_rejected_preaccept'"),
  'the durable explicit-rejection marker is recorded before the guarded release RPC runs',
);
assert.match(lobSource, /await claimCccTrackRevisionsForMail\(\{/);
assert.ok(
  lobSource.indexOf('await claimCccTrackRevisionsForMail({')
    < lobSource.indexOf("await lobRequest('/v1/letters'"),
  'exact track revisions are atomically claimed before the irreversible Lob request',
);

console.log('Round reason selection tests passed.');
