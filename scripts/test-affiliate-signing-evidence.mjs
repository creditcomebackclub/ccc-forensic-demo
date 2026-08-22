import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { sha256, buildSignedAgreementPdf } = require('../netlify/functions/_affiliateAgreement.cjs');
const { normalizeClaimedTimestamp, uploadImmutablePdf } = require('../netlify/functions/affiliate-agreement.cjs')._test;

const runtime = readFileSync(new URL('../netlify/functions/affiliate-agreement.cjs', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260820440000_affiliate_signing_evidence_claim.sql', import.meta.url), 'utf8');

assert.match(migration, /create or replace function public\.ccc_claim_affiliate_agreement_signing/);
assert.match(migration, /ccc_claim_affiliate_agreement_signing[\s\S]*returns text[\s\S]*to_char\([\s\S]*SS\.US"Z"/);
assert.match(migration, /signing_started_at = v_claimed_at/);
assert.match(migration, /p_signed_at is distinct from v_agreement\.signing_started_at/);
assert.match(migration, /v_event_signed_at is distinct from p_signed_at/);
assert.match(migration, /'signedAt', p_signed_at/);
assert.match(migration, /created_at[\s\S]*p_signed_at/);
assert.match(migration, /Signed affiliate agreement evidence is immutable/);
assert.match(migration, /revoke all on function public\.ccc_claim_affiliate_agreement_signing[\s\S]*from public, anon, authenticated/);

const claimIndex = runtime.indexOf("'ccc_claim_affiliate_agreement_signing'");
const pdfIndex = runtime.indexOf('buildSignedAgreementPdf({ agreement');
const uploadIndex = runtime.indexOf('await uploadImmutablePdf(');
const completionIndex = runtime.indexOf("'ccc_complete_affiliate_agreement'");
assert.ok(claimIndex >= 0 && claimIndex < pdfIndex && pdfIndex < uploadIndex && uploadIndex < completionIndex,
  'server must claim one timestamp before rendering, immutable upload, and atomic completion');
assert.doesNotMatch(runtime, /const signedAt = new Date\(\)\.toISOString\(\)/);
const normalizeTimestampBody = runtime.match(/function normalizeClaimedTimestamp\(value\) \{[\s\S]*?\n\}/)?.[0] || '';
assert.doesNotMatch(normalizeTimestampBody, /toISOString\(\)/);
assert.match(runtime, /const path = `affiliate-agreements\/\$\{agreement\.owner_user_id\}\/\$\{affiliate\.id\}\/\$\{agreement\.id\}\/\$\{pdf\.hash\}-signed\.pdf`/);
assert.match(runtime, /p_signed_at: signedAt/);
assert.match(runtime, /p_signing_material_sha256: signingMaterialHash/);
assert.match(runtime, /acceptedAt: signedAt/);

const microsecondClaim = '2026-08-21T12:00:00.123456Z';
assert.equal(
  normalizeClaimedTimestamp(microsecondClaim),
  microsecondClaim,
  'a fresh PostgreSQL claim must retain all six fractional digits through completion',
);
assert.equal(
  normalizeClaimedTimestamp('2026-08-21T12:00:00.123456+00:00'),
  '2026-08-21T12:00:00.123456+00:00',
  'validation must not canonicalize a PostgreSQL timestamp through millisecond-only Date output',
);
assert.throws(() => normalizeClaimedTimestamp('not-a-date'), /invalid signing timestamp/);

const agreement = {
  id: '11111111-1111-4111-8111-111111111111',
  template_version: 'ccc-affiliate-agreement-v1-test',
  applicant_snapshot: { name: 'Deterministic Partner', email: 'partner@example.com' },
  compensation_snapshot: { commissionRate: 0.2, compensationTerms: 'Frozen compensation terms.' },
  document_snapshot: { title: 'Partner Agreement', bodyHtml: '<p>Frozen approved agreement body.</p>' },
};
const renderInput = {
  agreement,
  signerName: 'Deterministic Partner',
  signedAt: microsecondClaim,
  ipAddress: '127.0.0.1',
};
const firstPdf = await buildSignedAgreementPdf(renderInput);
await new Promise((resolve) => setTimeout(resolve, 1_100));
const retryPdf = await buildSignedAgreementPdf(renderInput);
assert.equal(retryPdf.hash, firstPdf.hash, 'an exact retry must produce the same content-addressed hash');
assert.deepEqual(retryPdf.bytes, firstPdf.bytes, 'an exact retry must produce byte-identical signed evidence');

const originalFetch = globalThis.fetch;
const bytes = Buffer.from('%PDF-exact-affiliate-evidence');
const hash = sha256(bytes);
const response = ({ ok, status, text = '', body = Buffer.alloc(0) }) => ({
  ok,
  status,
  text: async () => text,
  arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
});

try {
  globalThis.fetch = async () => response({ ok: true, status: 200 });
  assert.deepEqual(
    await uploadImmutablePdf('https://example.supabase.co', 'service-key', 'affiliate-agreements/exact.pdf', bytes, hash),
    { reused: false },
  );

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? response({ ok: false, status: 409, text: 'The resource already exists' })
      : response({ ok: true, status: 200, body: bytes });
  };
  assert.deepEqual(
    await uploadImmutablePdf('https://example.supabase.co', 'service-key', 'affiliate-agreements/exact.pdf', bytes, hash),
    { reused: true },
  );
  assert.equal(calls, 2);

  calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? response({ ok: false, status: 409, text: 'The resource already exists' })
      : response({ ok: true, status: 200, body: Buffer.from('%PDF-different') });
  };
  await assert.rejects(
    uploadImmutablePdf('https://example.supabase.co', 'service-key', 'affiliate-agreements/exact.pdf', bytes, hash),
    /does not match this signing claim/,
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log('All affiliate signing evidence assertions passed.');
