#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COMBINED_FIXED_COLUMN_CONTEXT_POLICY,
  detectCombinedPdfContextPolicy,
  resolveFrozenCombinedContextPolicy,
} from '../src/utils/auditCheckpointPlanner.js';

const fakeDocument = (textContent) => ({
  getPage: async () => ({
    getTextContent: async () => textContent,
    getViewport: () => ({ width: 612, height: 792 }),
    cleanup() {},
  }),
  async destroy() {},
});

// A completed parser run that proves the signature absent is distinct from a
// parser/layout failure. The latter must never silently become matched:false.
const noMatch = await detectCombinedPdfContextPolicy(new Uint8Array([1]), {
  pdfJsLoader: async () => ({
    getDocument: () => ({ promise: Promise.resolve(fakeDocument({ items: [] })) }),
  }),
});
assert.equal(noMatch.detectionStatus, 'proven_no_match');
assert.equal(noMatch.matched, false);
assert.equal(noMatch.detectionErrorCode, null);

const detectionError = await detectCombinedPdfContextPolicy(new Uint8Array([1]), {
  pdfJsLoader: async () => { throw new Error('synthetic layout parser failure'); },
});
assert.equal(detectionError.detectionStatus, 'detection_error');
assert.equal(detectionError.matched, null);
assert.equal(detectionError.detectionErrorCode, 'pdf_context_detection_failed');

// New plans read their explicit frozen state. Every null-state mixed-version
// plan is ambiguous and must retire, regardless of its historical digest.
const explicitMatched = resolveFrozenCombinedContextPolicy({
  context_policy_state: 'matched',
  context_policy: COMBINED_FIXED_COLUMN_CONTEXT_POLICY,
  context_source_page: 1,
  input_sha256: 'ignored',
});
assert.equal(explicitMatched.detectionStatus, 'matched');
assert.equal(explicitMatched.inferredFromInputSha256, false);

const explicitNoMatch = resolveFrozenCombinedContextPolicy({
  context_policy_state: 'proven_no_match',
  context_policy: null,
  context_source_page: null,
  input_sha256: 'ignored',
});
assert.equal(explicitNoMatch.detectionStatus, 'proven_no_match');

const legacyMatchedDigest = resolveFrozenCombinedContextPolicy({
  context_policy_state: null,
  context_policy: null,
  context_source_page: null,
  input_sha256: 'matched-digest',
});
assert.equal(legacyMatchedDigest, null,
  'a null-state plan from an earlier detector version must retire');

const legacyNoContext = resolveFrozenCombinedContextPolicy({
  context_policy_state: null,
  context_policy: null,
  context_source_page: null,
  input_sha256: 'no-match-digest',
});
assert.equal(legacyNoContext, null,
  'a pre-policy no-context digest must retire instead of finalizing ambiguous output');
assert.equal(resolveFrozenCombinedContextPolicy({
  context_policy_state: null,
  context_policy: null,
  context_source_page: null,
  input_sha256: 'unknown-digest',
}), null);

const worker = readFileSync(new URL('../netlify/functions/audit-run-background.mjs', import.meta.url), 'utf8');
const remoteMigration = readFileSync(new URL('../supabase/migrations/20260820570000_combined_context_policy_freeze.sql', import.meta.url), 'utf8');

assert.match(worker, /detectionStatus === 'detection_error'[\s\S]*same saved audit will retry/);
assert.match(worker, /frozenCheckpointContextPolicy\(checkpoint\)/);
assert.match(worker, /context_policy_state:[\s\S]*context_policy:[\s\S]*context_source_page:/);
assert.match(worker, /resolveFrozenCombinedContextPolicy/);
const detectorHandling = worker.slice(
  worker.indexOf('async function combinedContextPolicy'),
  worker.indexOf('async function pdfChunksForReport'),
);
assert.doesNotMatch(detectorHandling, /ccc_retire_incompatible_combined_audit_job/);
const existingPlanResume = worker.slice(
  worker.indexOf("if ((job.expected_checkpoint_count || 0) > 0)"),
  worker.indexOf('const rows = [];'),
);
assert.match(existingPlanResume, /frozenCheckpointContextPolicy/);
assert.doesNotMatch(existingPlanResume, /detectCombinedPdfContextPolicy|combinedContextPolicy\(report\)/);
assert.match(remoteMigration, /add column if not exists context_policy_state/);
assert.match(remoteMigration, /inherit_combined_checkpoint_context_policy/);
assert.match(remoteMigration, /parent\.source_sha256 = new\.source_sha256/);
assert.match(remoteMigration, /parent\.start_page <= new\.start_page[\s\S]*parent\.end_page >= new\.end_page/);

console.log('Combined context tri-state/frozen-resume regressions passed.');
