import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  USPS_FIRST_CLASS,
  cccReviewClock,
  cccRoundNumber,
  isFirstClassCccLetter,
  mailServiceForLetter,
  requiresCccR1IdentityDocuments,
} from '../src/utils/cccMailRules.js';
import { canMailLetter } from '../src/utils/letterGeneration.js';
import {
  CCC_BUREAU_RECIPIENTS,
  normalizeCccAccountTrackSnapshots,
  unresolvedCccMissingTokens,
  validateCccLetterTrackBinding,
} from '../src/utils/cccLetterTrackSnapshots.js';

const cccR1 = { phase: 'CCC Dispute — Accuracy R1 — Equifax', disputeRoundNumber: 1 };
const cccR2 = { phase: 'CCC Dispute — Accuracy R2 — Equifax', disputeRoundNumber: 2 };
const legacy = { phase: 'Phase 1 — Direct Furnisher' };

assert.equal(cccRoundNumber(cccR1), 1);
assert.equal(cccRoundNumber({ phase: 'CCC Dispute — Collection R12 — TransUnion' }), 12);
assert.equal(requiresCccR1IdentityDocuments(cccR1), true);
assert.equal(requiresCccR1IdentityDocuments(cccR2), false);
assert.equal(requiresCccR1IdentityDocuments(legacy), false);
assert.equal(mailServiceForLetter(cccR1), USPS_FIRST_CLASS);
assert.equal(mailServiceForLetter(legacy), null, 'historical letters must never receive an active mail-service default');
assert.equal(isFirstClassCccLetter(cccR1), false, 'missing mail service must not default to First-Class');
assert.equal(isFirstClassCccLetter({ ...cccR1, mail_service: USPS_FIRST_CLASS }), true);
assert.equal(canMailLetter({ ...cccR1, html: '<!DOCTYPE html><html><body>Unsigned CCC letter</body></html>' }), true);
assert.equal(canMailLetter({ ...legacy, html: '<!DOCTYPE html><html><body>Unsigned legacy letter</body></html>' }), false);
assert.deepEqual(
  cccReviewClock({ ...cccR1, mailService: USPS_FIRST_CLASS, mailedDate: '2026-08-20', deliveredAt: '2026-08-20T18:00:00Z', expectedDeliveryDate: '2026-08-25' }),
  { start: '2026-08-25', basis: 'expected_delivery' },
);
assert.deepEqual(
  cccReviewClock({ ...cccR1, mail_service: USPS_FIRST_CLASS, mailed_date: '2026-08-20', expected_delivery_date: '2026-08-25' }),
  { start: '2026-08-25', basis: 'expected_delivery' },
);
assert.deepEqual(
  cccReviewClock({ ...cccR1, mail_service: USPS_FIRST_CLASS, expected_delivery_date: '2026-08-25' }),
  { start: null, basis: null },
  'an expected date without mailed proof cannot start the clock',
);
assert.deepEqual(
  cccReviewClock({ ...cccR1, mail_service: USPS_FIRST_CLASS, mailed_date: '2026-08-20', expected_delivery_date: '2026-08-25', tracking_status: 'Returned to Sender' }),
  { start: null, basis: null },
  'terminal mail cannot start the expected-delivery clock',
);
assert.deepEqual(cccReviewClock(legacy), { start: null, basis: null });

const lobFunction = readFileSync(new URL('../netlify/functions/lob.cjs', import.meta.url), 'utf8');
assert.match(lobFunction, /dispute_screenshot_policy_snapshot/, 'Lob must load the immutable course screenshot-policy snapshot');
assert.match(
  lobFunction,
  /resolveDisputeScreenshotPolicy\(\{[\s\S]*snapshot: letter\.dispute_screenshot_policy_snapshot,[\s\S]*templateText: letter\.dispute_template_snapshot,[\s\S]*\}\)/,
  'Lob must resolve explicit policy first and use the template token only for legacy letters',
);
assert.match(
  lobFunction,
  /validateDisputeScreenshotManifest\(\{[\s\S]*policy: screenshotPolicy,[\s\S]*userId: letter\.user_id,[\s\S]*clientId: letter\.client_id/,
  'Lob must enforce the saved policy and client-scoped exhibit paths server-side',
);

const TRACK_1 = '11111111-1111-4111-8111-111111111111';
const TRACK_2 = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CLIENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TEMPLATE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const snapshots = normalizeCccAccountTrackSnapshots([
  {
    trackId: TRACK_1,
    revision: 3,
    methodVersion: 'ccc_skool_2026_v1',
    trackScope: 'cra',
    clientAccountId: ACCOUNT_1,
    bureauCode: 'EQ',
    accountKind: 'collection',
    nativeFlow: 'collection',
    logicalFlow: 'combo',
    logicalRound: 1,
    concreteFlow: 'combo',
    concreteRound: 1,
    cycle: 1,
    pathRole: 'standard',
  },
  {
    trackId: TRACK_2,
    revision: 1,
    methodVersion: 'ccc_skool_2026_v1',
    trackScope: 'cra',
    clientAccountId: ACCOUNT_2,
    bureauCode: 'EQ',
    accountKind: 'charge_off',
    nativeFlow: 'accuracy',
    logicalFlow: 'combo',
    logicalRound: 1,
    concreteFlow: 'combo',
    concreteRound: 1,
    cycle: 1,
    pathRole: 'standard',
  },
]);

const letter = {
  id: 'ccc-letter',
  user_id: USER_ID,
  client_id: CLIENT_ID,
  client_account_id: null,
  furnisher: 'Equifax Information Services LLC',
  phase: 'CCC Dispute — Accuracy + Collection Combo R1 — Equifax',
  target_type: 'bureau',
  target_bureau: 'equifax',
  dispute_bureau_code: 'EQ',
  dispute_template_id: TEMPLATE_ID,
  dispute_flow_code: 'combo',
  dispute_round_number: 1,
  dispute_account_snapshot: [
    { clientAccountId: ACCOUNT_1 },
    { clientAccountId: ACCOUNT_2 },
  ],
  ccc_account_track_snapshots: snapshots,
};
const tracks = [
  {
    id: TRACK_1,
    user_id: USER_ID,
    client_id: CLIENT_ID,
    client_account_id: ACCOUNT_1,
    track_scope: 'cra',
    bureau_code: 'EQ',
    method_version: 'ccc_skool_2026_v1',
    account_kind: 'collection',
    native_flow: 'collection',
    current_flow: 'combo',
    current_round: 1,
    path_role: 'standard',
    status: 'active',
    cycle: 1,
    revision: 3,
  },
  {
    id: TRACK_2,
    user_id: USER_ID,
    client_id: CLIENT_ID,
    client_account_id: ACCOUNT_2,
    track_scope: 'cra',
    bureau_code: 'EQ',
    method_version: 'ccc_skool_2026_v1',
    account_kind: 'charge_off',
    native_flow: 'accuracy',
    current_flow: 'combo',
    current_round: 1,
    path_role: 'standard',
    status: 'active',
    cycle: 1,
    revision: 1,
  },
];
const template = { id: TEMPLATE_ID, flow_code: 'combo', round_number: 1, bureau_code: 'ALL' };
const validate = (overrides = {}) => validateCccLetterTrackBinding({
  letter: overrides.letter || letter,
  tracks: overrides.tracks || tracks,
  template: overrides.template || template,
  toAddress: overrides.toAddress || CCC_BUREAU_RECIPIENTS.EQ,
  verifiedDirectRecipient: overrides.verifiedDirectRecipient || null,
});

assert.deepEqual(validate(), [], 'an exact multi-account CRA track binding should pass');
assert.throws(
  () => normalizeCccAccountTrackSnapshots([]),
  /require an account-track snapshot/i,
  'new CCC letters must not save without a track binding',
);
assert.throws(
  () => normalizeCccAccountTrackSnapshots([{ ...snapshots[0], revision: 'stale' }]),
  /invalid revision/i,
  'malformed snapshots must fail before persistence',
);
assert.throws(
  () => normalizeCccAccountTrackSnapshots([snapshots[0], { ...snapshots[1], clientAccountId: ACCOUNT_1 }]),
  /duplicated/i,
  'duplicate account bindings must be rejected',
);
assert.match(validate({ tracks: [{ ...tracks[0], revision: 4 }, tracks[1]] }).join(' '), /changed its revision/i);
assert.match(validate({ tracks: [{ ...tracks[0], status: 'review_required' }, tracks[1]] }).join(' '), /not active/i);
assert.match(validate({ tracks: [{ ...tracks[0], user_id: ACCOUNT_1 }, tracks[1]] }).join(' '), /different staff owner or client/i);
assert.match(validate({ tracks: [{ ...tracks[0], client_id: ACCOUNT_1 }, tracks[1]] }).join(' '), /different staff owner or client/i);
assert.match(validate({ tracks: [{ ...tracks[0], bureau_code: 'TU' }, tracks[1]] }).join(' '), /changed its bureauCode/i);
assert.match(validate({ letter: { ...letter, dispute_account_snapshot: [{ clientAccountId: ACCOUNT_1 }] } }).join(' '), /do not exactly match/i);
assert.match(validate({ letter: { ...letter, dispute_account_snapshot: [{ clientAccountId: ACCOUNT_1 }, { clientAccountId: ACCOUNT_1 }] } }).join(' '), /duplicate account/i);
assert.match(validate({ letter: { ...letter, dispute_round_number: 2 } }).join(' '), /metadata does not match/i);
assert.match(validate({ template: { ...template, flow_code: 'accuracy' } }).join(' '), /template no longer proves/i);
assert.match(validate({ toAddress: { ...CCC_BUREAU_RECIPIENTS.EQ, zip: '00000' } }).join(' '), /recipient does not match/i);
assert.deepEqual(
  unresolvedCccMissingTokens('<p>Ready</p><mark class="warn" data-missing-token="damages">{damages}</mark><mark data-missing-token=penalty>{penalty}</mark>'),
  ['damages', 'penalty'],
  'the exact signed HTML preflight must find every unresolved CCC curly marker',
);

const directSnapshot = normalizeCccAccountTrackSnapshots([{
  trackId: TRACK_1,
  revision: 2,
  methodVersion: 'ccc_skool_2026_v1',
  trackScope: 'direct',
  clientAccountId: ACCOUNT_1,
  bureauCode: null,
  accountKind: 'collection',
  nativeFlow: 'direct',
  logicalFlow: 'direct',
  logicalRound: 1,
  concreteFlow: 'direct',
  concreteRound: 1,
  cycle: 1,
  pathRole: 'standard',
}]);
const directRecipient = {
  user_id: USER_ID,
  furnisher_key: 'MIDLAND CREDIT MANAGEMENT',
  display_name: 'Midland Credit Management',
  address_line1: 'P.O. Box 939019',
  address_line2: null,
  city: 'San Diego',
  state: 'CA',
  zip: '92193-9019',
};
const directAddress = {
  name: directRecipient.display_name,
  line1: directRecipient.address_line1,
  line2: '',
  city: directRecipient.city,
  state: directRecipient.state,
  zip: directRecipient.zip,
};
const directLetter = {
  ...letter,
  furnisher: 'Midland Credit Management',
  target_type: 'furnisher',
  target_bureau: null,
  dispute_bureau_code: null,
  dispute_flow_code: 'direct',
  dispute_round_number: 1,
  client_account_id: ACCOUNT_1,
  dispute_account_snapshot: [{ clientAccountId: ACCOUNT_1 }],
  ccc_account_track_snapshots: directSnapshot,
};
const directTrack = {
  ...tracks[0],
  revision: 2,
  track_scope: 'direct',
  bureau_code: null,
  account_kind: 'collection',
  native_flow: 'direct',
  current_flow: 'direct',
  current_round: 1,
};
assert.deepEqual(validateCccLetterTrackBinding({
  letter: directLetter,
  tracks: [directTrack],
  template: { ...template, flow_code: 'direct', round_number: 1 },
  toAddress: directAddress,
  verifiedDirectRecipient: directRecipient,
}), []);
assert.match(validateCccLetterTrackBinding({
  letter: directLetter,
  tracks: [directTrack],
  template: { ...template, flow_code: 'direct', round_number: 1 },
  toAddress: { ...directAddress, zip: '00000' },
  verifiedDirectRecipient: directRecipient,
}).join(' '), /server-verified furnisher address/i);

assert.match(lobFunction, /ccc_account_track_snapshots/, 'Lob must reload the immutable track binding from letters');
assert.match(lobFunction, /\/rest\/v1\/ccc_account_tracks\?id=in\./, 'Lob must reload each bound track server-side');
assert.match(lobFunction, /\/rest\/v1\/dispute_templates\?id=eq\./, 'Lob must reload the concrete library template server-side');
assert.match(lobFunction, /\/rest\/v1\/furnisher_addresses\?user_id=eq\./, 'Direct mail must reload the verified furnisher recipient');
const bindingGateIndex = lobFunction.indexOf('const cccTrackIssues = await validateCccTrackSnapshotPreflight');
const authorizationGateIndex = lobFunction.indexOf('await hasCccServiceAuthorization(letter.client_id');
const unresolvedTokenGateIndex = lobFunction.indexOf('const unresolvedTokens = unresolvedCccMissingTokens(scannedMailpiece.html)');
const lobSendIndex = lobFunction.indexOf("lobRequest('/v1/letters'");
assert.ok(bindingGateIndex > 0 && lobSendIndex > bindingGateIndex, 'CCC state validation must run before the irreversible Lob send');
assert.ok(authorizationGateIndex > bindingGateIndex && lobSendIndex > authorizationGateIndex,
  'CCC mailing must verify signed-v2 eligibility or immutable grandfathering before the irreversible Lob send');
assert.match(lobFunction, /\/rest\/v1\/rpc\/ccc_has_service_authorization/,
  'the server must use the authoritative service-authorization predicate instead of mutable LPOA flags');
assert.ok(unresolvedTokenGateIndex > bindingGateIndex && lobSendIndex > unresolvedTokenGateIndex, 'exact signed HTML must be free of unresolved curlys before the irreversible Lob send');
const legacyRetiredIndex = lobFunction.indexOf('LEGACY MAILING RETIRED');
assert.ok(legacyRetiredIndex > 0 && legacyRetiredIndex < bindingGateIndex,
  'non-CCC mail must be rejected before current CCC preflight and the irreversible Lob send');
assert.doesNotMatch(lobFunction.slice(legacyRetiredIndex, lobSendIndex), /Metro 2|validateStructuredRoundPreflight|validatePacketPreflight/,
  'the current send path must not route through retired dispute-method preflights');

const migration = readFileSync(new URL('../supabase/migrations/20260820230000_ccc_letter_track_snapshots.sql', import.meta.url), 'utf8');
assert.match(migration, /add column if not exists ccc_account_track_snapshots jsonb not null default '\[\]'::jsonb/);
assert.match(migration, /add column if not exists dispute_automatic_values_snapshot jsonb not null default '\{\}'::jsonb/);
assert.match(migration, /prevent_mailed_ccc_track_snapshot_rewrite/);
assert.match(migration, /old\.dispute_automatic_values_snapshot is distinct from new\.dispute_automatic_values_snapshot/);

const storage = readFileSync(new URL('../src/utils/storage.js', import.meta.url), 'utf8');
assert.match(storage, /ccc_account_track_snapshots: cccAccountTrackSnapshots/);
assert.match(storage, /dispute_automatic_values_snapshot: disputeAutomaticValuesSnapshot/);

console.log('CCC mail rules passed.');
