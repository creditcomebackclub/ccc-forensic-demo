import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  buildCraTrackInitializationArgs,
  craTrackInitializationBlocker,
  initializeCraAccountTracks,
} from '../src/utils/disputeStateApi.js';
import {
  buildClassificationReviewSnapshot,
  buildInitialAccountTrackStates,
  canonicalClassificationReviewSnapshotJson,
  canonicalClassificationRoutesJson,
  classificationRoutesFromStates,
} from '../src/utils/disputeFlow.js';

const accountId = '11111111-1111-4111-8111-111111111111';
const baseAudit = {
  id: 'saved-audit-1',
  client: { id: '22222222-2222-4222-8222-222222222222', name: 'Test Client' },
  accounts: [{
    id: 'report-account-1',
    clientAccountId: accountId,
    furnisher: 'Test Collector',
    accountKind: 'collection',
    bureaus: ['EQ', 'TU'],
    routingFacts: {
      status: 'confirmed',
      source: 'staff_review',
      staffAttested: true,
      accountKind: 'collection',
      blockingCodes: [],
      reportCoverage: { complete: true, missing: [], duplicates: [] },
      bureauFacts: {
        EQ: { accountKind: 'collection', latePaymentStatus: 'not_applicable', latePaymentBand: 'none' },
        TU: { accountKind: 'collection', latePaymentStatus: 'not_applicable', latePaymentBand: 'none' },
      },
    },
  }],
};
const routes = classificationRoutesFromStates(buildInitialAccountTrackStates(baseAudit));
const routingSnapshot = buildClassificationReviewSnapshot(baseAudit, routes);
const routingSnapshotCanonical = canonicalClassificationReviewSnapshotJson(routingSnapshot);
const routingSnapshotSha256 = crypto.createHash('sha256').update(routingSnapshotCanonical).digest('hex');
const audit = {
  ...baseAudit,
  classificationReview: {
    status: 'confirmed',
    version: 1,
    auditId: baseAudit.id,
    clientId: baseAudit.client.id,
    reviewedAt: '2026-08-20T12:00:00.000Z',
    reviewedBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    methodVersion: 'ccc_skool_2026_v1',
    routesSha256: crypto.createHash('sha256').update(canonicalClassificationRoutesJson(routes)).digest('hex'),
    routes,
    routingSnapshot,
    routingSnapshotCanonical,
    routingSnapshotSha256,
  },
};

const args = buildCraTrackInitializationArgs(audit);
assert.equal(args.p_audit_id, audit.id);
assert.equal(args.p_client_id, audit.client.id);
assert.equal(args.p_classifications.length, 2);
assert.equal(args.p_classifications[0].direct_track, false, 'Audit Results must not opt into Direct tracks');
assert.deepEqual(args.p_classifications.map((item) => item.bureaus), [['EQ'], ['TU']], 'each reviewed route is an independent account/bureau input');
assert.equal(craTrackInitializationBlocker(audit), null);
assert.match(craTrackInitializationBlocker({ ...audit, id: null }), /Confirm and save this classification review/);
assert.match(
  craTrackInitializationBlocker({ ...audit, accounts: [{ ...audit.accounts[0], clientAccountId: null }] }),
  /reconciled clientAccountId/,
  'a report id or furnisher must never substitute for canonical account identity',
);
assert.match(
  craTrackInitializationBlocker({ ...audit, classificationReview: null }),
  /exact staff classification review/,
  'an extracted audit alone cannot authorize track initialization',
);
assert.match(
  craTrackInitializationBlocker({
    ...audit,
    accounts: audit.accounts.map((item) => ({ ...item, accountKind: 'charge_off', routingFacts: { ...item.routingFacts, accountKind: 'charge_off' } })),
  }),
  /changed after the saved staff review/,
  'a classification edit invalidates the saved route set',
);

let calls = 0;
let capturedArgs = null;
const returned = [
  { id: 'track-eq', track_scope: 'cra', client_id: audit.client.id, client_account_id: accountId, bureau_code: 'EQ', source_audit_id: audit.id, method_version: args.p_method_version, account_kind: 'collection', native_flow: 'collection', classification_snapshot: { reviewVersion: 1, reviewSnapshotSha256: routingSnapshotSha256 } },
  { id: 'track-tu', track_scope: 'cra', client_id: audit.client.id, client_account_id: accountId, bureau_code: 'TU', source_audit_id: audit.id, method_version: args.p_method_version, account_kind: 'collection', native_flow: 'collection', classification_snapshot: { reviewVersion: 1, reviewSnapshotSha256: routingSnapshotSha256 } },
  { id: 'old-cra', track_scope: 'cra', client_id: audit.client.id, client_account_id: '33333333-3333-4333-8333-333333333333', bureau_code: 'EXP', source_audit_id: 'old-audit', method_version: args.p_method_version, account_kind: 'collection', native_flow: 'collection' },
  { id: 'direct', track_scope: 'direct', client_account_id: accountId, bureau_code: null },
];
const client = {
  auth: {
    getSession: async () => ({ data: { session: { access_token: 'staff-token' } }, error: null }),
  },
  rpc: async (name, rpcArgs) => {
    calls += 1;
    capturedArgs = rpcArgs;
    assert.equal(name, 'initialize_ccc_account_tracks');
    return { data: returned, error: null };
  },
};

const tracks = await initializeCraAccountTracks(audit, client);
assert.deepEqual(tracks.map((track) => track.id), ['track-eq', 'track-tu'], 'only exact requested CRA tracks reach Campaign Studio');
assert.ok(capturedArgs.p_classifications.every((item) => item.direct_track === false));
assert.deepEqual((await initializeCraAccountTracks(audit, client)).map((track) => track.id), ['track-eq', 'track-tu']);
assert.equal(calls, 2, 'an identical retry uses the same idempotent RPC boundary');

await assert.rejects(
  initializeCraAccountTracks(audit, {
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    rpc: async () => { throw new Error('RPC must not run without a session'); },
  }),
  /staff session has expired/,
);

await assert.rejects(
  initializeCraAccountTracks(audit, {
    auth: { getSession: async () => ({ data: { session: { access_token: 'staff-token' } }, error: null }) },
    rpc: async () => ({ data: returned.filter((track) => track.id !== 'track-tu'), error: null }),
  }),
  /did not return 1 required CRA account track/,
);

const source = fs.readFileSync(new URL('../src/components/AuditResults.jsx', import.meta.url), 'utf8');
assert.match(source, /item\.recommendations\.map/, 'every bureau recommendation is rendered as its own R1 letter');
assert.match(source, /initialTracks=\{initialTracks\}/, 'initialized CRA tracks are passed into Campaign Studio');
assert.match(source, /Confirm classification review/, 'missing saved audit identity has an actionable review step');
assert.match(source, /setClassificationReview\(null\)/, 'any local classification edit invalidates saved review authority');
assert.match(source, /does not create Direct tracks/, 'the Audit Results entry point is labeled CRA-only');
assert.doesNotMatch(source, /Separate route:/, 'routed accounts are not presented as silently deferred work');

console.log('Audit Results CRA initialization tests passed.');
