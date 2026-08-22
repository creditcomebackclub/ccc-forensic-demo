#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  buildClassificationReviewSnapshot,
  buildCccInitializationRpcArgs,
  buildInitialAccountTrackStates,
  canonicalClassificationReviewSnapshotJson,
  canonicalClassificationRoutesJson,
  classificationRoutesFromStates,
} from '../src/utils/disputeFlow.js';

const clientId = '22222222-2222-4222-8222-222222222222';
const clientAccountId = '11111111-1111-4111-8111-111111111111';
const baseAudit = {
  id: 'audit-review-gate-1',
  client: { id: clientId, name: 'Review Gate Fixture' },
  reportCoverage: { complete: true, missing: [], duplicates: [], bureauCodes: ['EQ', 'EXP', 'TU'], counts: { EQ: 1, EXP: 1, TU: 1 } },
  accounts: [{
    id: 'audit-account-1',
    clientAccountId,
    furnisher: 'Fixture Bank',
    accountKind: 'late_payment',
    bureaus: ['EQ', 'EXP', 'TU'],
    routingFacts: {
      status: 'confirmed',
      source: 'staff_review',
      staffAttested: true,
      accountKind: 'late_payment',
      blockingCodes: [],
      reportCoverage: { complete: true, missing: [], duplicates: [] },
      bureauFacts: {
        EQ: { accountKind: 'late_payment', latePaymentCount: 2, latePaymentBand: 'two_or_fewer', latePaymentStatus: 'confirmed' },
        EXP: { accountKind: 'late_payment', latePaymentCount: 3, latePaymentBand: 'three_or_more', latePaymentStatus: 'confirmed' },
        TU: { accountKind: 'late_payment', latePaymentCount: 1, latePaymentBand: 'two_or_fewer', latePaymentStatus: 'confirmed' },
      },
    },
  }],
};

const states = buildInitialAccountTrackStates(baseAudit);
const routes = classificationRoutesFromStates(states);
assert.deepEqual(routes.map((route) => [route.bureauCode, route.nativeFlow]), [
  ['EQ', 'late_pay'],
  ['EXP', 'accuracy'],
  ['TU', 'late_pay'],
], 'late-payment routing is independently frozen per reported bureau');
const canonicalJson = canonicalClassificationRoutesJson([...routes].reverse());
assert.equal(canonicalJson, canonicalClassificationRoutesJson(routes), 'route canonicalization is order-independent');
const routesSha256 = crypto.createHash('sha256').update(canonicalJson).digest('hex');
const routingSnapshot = buildClassificationReviewSnapshot(baseAudit, routes);
const routingSnapshotCanonical = canonicalClassificationReviewSnapshotJson(routingSnapshot);
const routingSnapshotSha256 = crypto.createHash('sha256').update(routingSnapshotCanonical).digest('hex');

const reviewedAudit = {
  ...baseAudit,
  classificationReview: {
    status: 'confirmed',
    version: 1,
    auditId: baseAudit.id,
    clientId,
    reviewedAt: '2026-08-20T12:00:00.000Z',
    reviewedBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    methodVersion: 'ccc_skool_2026_v1',
    routes,
    routesSha256,
    routingSnapshot,
    routingSnapshotCanonical,
    routingSnapshotSha256,
  },
};
const args = buildCccInitializationRpcArgs(reviewedAudit);
assert.equal(args.p_classifications.length, 3);
assert.equal(args.p_review_version, 1);
assert.equal(args.p_review_snapshot_sha256, routingSnapshotSha256);
assert.ok(args.p_classifications.every((classification) => classification.bureaus.length === 1));
assert.deepEqual(args.p_classifications.map((classification) => classification.native_flow), ['late_pay', 'accuracy', 'late_pay']);
assert.throws(
  () => buildCccInitializationRpcArgs({
    ...reviewedAudit,
    classificationReview: {
      ...reviewedAudit.classificationReview,
      routes: reviewedAudit.classificationReview.routes.map((route, index) => index === 0 ? { ...route, nativeFlow: 'accuracy' } : route),
    },
  }),
  /changed after the saved staff review/,
);
assert.throws(
  () => buildInitialAccountTrackStates({
    ...baseAudit,
    accounts: [{ ...baseAudit.accounts[0], bureaus: ['eq', 'equifax', 'TU'] }],
  }),
  /unique, recognized reported-bureau list/,
  'bureau aliases that collapse to a duplicate fail closed',
);
const normalizedAliasStates = buildInitialAccountTrackStates({
  ...baseAudit,
  accounts: [{ ...baseAudit.accounts[0], bureaus: ['eq', 'experian', 'tu'] }],
});
assert.deepEqual(normalizedAliasStates.map((state) => state.bureauCode).sort(), ['EQ', 'EXP', 'TU']);
assert.throws(
  () => buildInitialAccountTrackStates({
    ...baseAudit,
    accounts: [{ ...baseAudit.accounts[0], bureaus: ['EQ', 'EXP', 'TU', 'TU'] }],
  }),
  /unique, recognized reported-bureau list/,
);
assert.throws(
  () => buildCccInitializationRpcArgs({
    ...reviewedAudit,
    classificationReview: { ...reviewedAudit.classificationReview, routesSha256: 'tampered' },
  }),
  /exact staff classification review/,
);

const endpointSource = fs.readFileSync(new URL('../netlify/functions/recovery-blueprint.mjs', import.meta.url), 'utf8');
assert.match(endpointSource, /payload\.auditId !== auditRow\.id/);
assert.match(endpointSource, /expectedAuditRevision/);
assert.match(endpointSource, /expectedAuditSha256/);
assert.match(endpointSource, /initializedTrackCount/);
assert.match(endpointSource, /routingSnapshotSha256/);
assert.match(endpointSource, /auditRevision: auditRow\.saved_at/);
assert.match(endpointSource, /auditSha256: auditHash\(auditRow\.audit\)/);

const browserApiSource = fs.readFileSync(new URL('../src/utils/recoveryBlueprintApi.js', import.meta.url), 'utf8');
assert.match(browserApiSource, /expectedAuditRevision: audit\.auditRevision/);
assert.match(browserApiSource, /expectedAuditSha256: audit\.auditSha256/);
assert.match(endpointSource, /payload\.clientId !== auditRow\.client_id/);
assert.match(endpointSource, /hardRoutingBlockers/);
assert.match(endpointSource, /source: 'staff_review'/);
assert.match(endpointSource, /routesSha256: crypto\.createHash\('sha256'\)/);

const migrationSource = fs.readFileSync(new URL('../supabase/migrations/20260820270000_classification_review_gate.sql', import.meta.url), 'utf8');
assert.match(migrationSource, /ccc_classification_routes_sha256/);
assert.match(migrationSource, /p_review_snapshot_sha256/);
assert.match(migrationSource, /protect_initialized_audit_routing/);
assert.match(migrationSource, /Every non-excluded source account\/bureau pair must have exactly one normalized route/);
assert.match(migrationSource, /Requested classifications do not exactly match the saved staff review/);
assert.match(migrationSource, /Existing CCC track does not match this exact immutable classification review/);
assert.match(migrationSource, /Direct tracks cannot be created from the CRA classification review/);
const initializerBody = migrationSource.match(
  /create function public\.initialize_ccc_account_tracks\([\s\S]*?\nas \$\$([\s\S]*?)\n\$\$;/,
)?.[1] || '';
assert.match(
  initializerBody,
  /coalesce\(v_client\.engagement_status, 'pending_onboarding'\) is distinct from 'active'/,
  'preclients, inactive clients, and graduated clients cannot receive fresh CCC tracks',
);
assert.match(
  initializerBody,
  /public\.ccc_has_service_authorization\(v_client\.id\) is not true/,
  'fresh CCC tracks require the authoritative agreement/grandfather service predicate',
);
assert.ok(
  initializerBody.indexOf('ccc_has_service_authorization(v_client.id)')
    < initializerBody.indexOf('insert into public.ccc_account_tracks'),
  'service eligibility must be checked before any track insert',
);
assert.doesNotMatch(
  migrationSource,
  /(?:update|delete from)\s+public\.ccc_account_tracks/i,
  'the gate must not rewrite or remove already-in-flight tracks',
);

const uiSource = fs.readFileSync(new URL('../src/components/AuditResults.jsx', import.meta.url), 'utf8');
assert.match(uiSource, /setClassificationReview\(null\)/, 'classification edits invalidate the in-memory review');
assert.match(uiSource, /latePaymentByBureau/, 'staff review captures per-bureau late facts');
assert.match(uiSource, /classificationAttested/, 'staff must explicitly attest after seeing category evidence');
assert.match(uiSource, /Narrative-only extraction/, 'unanchored model narratives are visibly labeled for staff review');
assert.match(uiSource, /getBlueprintStatus\(audit\)/, 'new jobs and saved-summary opens resolve the exact audit row before save');
assert.match(uiSource, /refreshSavedClassification/, 'the Blueprint save path reloads the server-issued review revision');

const clientsSource = fs.readFileSync(new URL('../src/components/ClientsPage.jsx', import.meta.url), 'utf8');
assert.match(
  clientsSource,
  /const exactAudit = \{ \.\.\.audit\.audit, id: audit\.id, auditId: audit\.id \}/,
  'reopened audits carry the exact persisted row id into classification review',
);

const auditJobSource = fs.readFileSync(new URL('../netlify/functions/audit-run-background.mjs', import.meta.url), 'utf8');
assert.match(auditJobSource, /audit\.auditId = savedAuditId/,
  'fresh background-audit results carry the exact persisted row id');
assert.match(auditJobSource, /return \{ clientName, clientId, auditId, savedAt \}/,
  'the audit saver returns its exact persisted identity and revision');

console.log('Classification review gate assertions passed.');
