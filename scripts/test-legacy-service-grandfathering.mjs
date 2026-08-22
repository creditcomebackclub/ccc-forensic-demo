import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/20260820280000_legacy_service_grandfathering.sql', import.meta.url),
  'utf8',
);
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

function qualifiesLegacySnapshot(row, cutoff) {
  const signature = row.lpoaSignatureData || {};
  return row.hasFirmOwner === true
    && row.lpoaSigned === true
    && !!row.lpoaSignedAt
    && (!!String(signature.signaturePath || '').trim() || !!String(signature.signatureUrl || '').trim())
    && new Date(row.lpoaSignedAt) <= cutoff;
}

const cutoff = new Date('2026-08-20T19:00:00.000Z');
const complete = {
  hasFirmOwner: true,
  portalUserId: '10000000-0000-4000-8000-000000000001',
  onboardingComplete: true,
  agreementSignedAt: '2026-08-01T12:00:00.000Z',
  profileSignatureSignedAt: '2026-08-01T12:00:00.000Z',
  lpoaSigned: true,
  lpoaSignedAt: '2026-08-01T12:00:00.000Z',
  lpoaSignatureData: { signaturePath: 'firm/client/lpoa/signature.png' },
  clientProfileCount: 1,
  portalUserProfileCount: 1,
};

assert.equal(qualifiesLegacySnapshot(complete, cutoff), true);
assert.equal(qualifiesLegacySnapshot({ ...complete, onboardingComplete: false,
  agreementSignedAt: null, profileSignatureSignedAt: null }, cutoff), true,
  'owner-approved signed legacy evidence remains valid when newer portal metadata is absent');
assert.equal(qualifiesLegacySnapshot({ ...complete, hasFirmOwner: false }, cutoff), false);
assert.equal(qualifiesLegacySnapshot({ ...complete, lpoaSigned: false }, cutoff), false);
assert.equal(qualifiesLegacySnapshot({ ...complete, lpoaSignatureData: {} }, cutoff), false,
  'legacy booleans without a signature reference are ambiguous and must fail closed');
assert.equal(qualifiesLegacySnapshot({ ...complete, lpoaSignedAt: '2026-08-21T12:00:00.000Z' }, cutoff), false,
  'evidence created after the persisted cutover can never be grandfathered');

assert.match(migration, /create table if not exists public\.legacy_service_grandfathering_cutover/);
assert.match(migration, /create table if not exists public\.legacy_service_grandfathering_exceptions/);
assert.match(migration, /legacy_service_grandfathering_exceptions \([\s\S]*?firm_user_id_at_cutoff uuid not null/);
assert.match(migration, /on conflict \(singleton\) do nothing/);
assert.match(migration, /select cutoff_at into strict v_cutoff/);
assert.match(migration, /owner_approved_legacy_signed_lpoa/);
assert.match(migration, /c\.user_id is not null/);
assert.match(migration, /c\.lpoa_signed is true/);
assert.match(migration, /c\.lpoa_signed_at is not null/);
assert.match(migration, /signaturePath[\s\S]*signatureUrl/);
assert.match(migration, /select count\(\*\) from public\.client_profiles peer[\s\S]*peer\.client_id = c\.id/);
assert.match(migration, /left join public\.client_profiles cp/);
assert.match(migration, /legacySignatureMetadataSha256/);
assert.match(migration, /before update or delete on public\.legacy_service_grandfathering/);
assert.match(migration, /before update or delete on public\.legacy_service_grandfathering_cutover/);
assert.match(migration, /MISSING_LEGACY_SIGNATURE_REFERENCE/);
assert.match(migration, /AMBIGUOUS_CLIENT_PROFILE_LINK/);
assert.match(migration, /AMBIGUOUS_PORTAL_USER_LINK/);
assert.match(migration, /EVIDENCE_AFTER_CUTOVER/);
assert.match(migration, /before update or delete on public\.legacy_service_grandfathering_exceptions/);
assert.match(migration, /revoke all on table public\.legacy_service_grandfathering[\s\S]*from public, anon, authenticated, service_role/);
assert.doesNotMatch(migration, /update public\.(clients|client_profiles)/i,
  'the forward migration must preserve source rows unchanged');

const authorizationBody = migration.match(
  /create or replace function public\.ccc_has_service_authorization\(p_client_id uuid\)([\s\S]*?)\n\$\$;/,
)?.[1] || '';
assert.match(authorizationBody, /agreement\.status = 'signed'/);
assert.match(authorizationBody, /agreement\.service_eligible_at <= current_timestamp/);
assert.match(authorizationBody, /template\.packet_kind = 'service_agreement_only'/);
assert.match(authorizationBody, /public\.legacy_service_grandfathering/);
assert.doesNotMatch(authorizationBody, /lpoa_signed|onboarding_complete/,
  'runtime service authorization must never re-read mutable legacy flags');
assert.match(migration, /grant execute on function public\.ccc_has_service_authorization\(uuid\)[\s\S]*to service_role/);

const grandfatherPolicy = migration.match(
  /create policy "staff_read_legacy_service_grandfathering"([\s\S]*?)\n\);/,
)?.[1] || '';
assert.match(grandfatherPolicy, /caller\.role = 'admin'/);
assert.match(grandfatherPolicy, /caller\.role = 'auditor'[\s\S]*firm_user_id_at_cutoff = auth\.uid\(\)/);
const exceptionPolicy = migration.match(
  /create policy "staff_read_legacy_service_grandfathering_exceptions"([\s\S]*?)\n\);/,
)?.[1] || '';
assert.match(exceptionPolicy, /caller\.role = 'admin'/);
assert.match(exceptionPolicy, /caller\.role = 'auditor'[\s\S]*firm_user_id_at_cutoff = auth\.uid\(\)/);
const cutoverPolicy = migration.match(
  /create policy "staff_read_legacy_service_grandfathering_cutover"([\s\S]*?)\n\);/,
)?.[1] || '';
assert.match(cutoverPolicy, /caller\.role = 'admin'/);
assert.doesNotMatch(cutoverPolicy, /caller\.role = 'auditor'|public\.is_staff\(\)/);

const portalBody = migration.match(
  /create or replace function public\.ccc_current_client_has_portal_access\(p_profile_id uuid\)([\s\S]*?)\n\$\$;/,
)?.[1] || '';
assert.match(portalBody, /profile\.user_id = auth\.uid\(\)/);
assert.match(portalBody, /select count\(\*\)[\s\S]*client_peer\.client_id = profile\.client_id/);
assert.match(portalBody, /select count\(\*\)[\s\S]*user_peer\.user_id = auth\.uid\(\)/);
assert.match(portalBody, /grandfather\.profile_id = profile\.id/);
assert.match(portalBody, /linkedClientProfileCount/);
assert.match(portalBody, /template\.packet_kind = 'service_agreement_only'/);
assert.doesNotMatch(portalBody, /profile\.onboarding_complete|lpoa_signed/,
  'portal access must be backed by an immutable agreement/grandfather record, not mutable flags');
assert.match(app, /rest\/v1\/rpc\/get_my_client_portal_bootstrap/);
assert.doesNotMatch(app, /rest\/v1\/rpc\/ccc_current_client_has_portal_access/);
assert.doesNotMatch(app, /setClientOnboarded\(cp\.onboarding_complete === true\)/);

console.log('Legacy service grandfathering and authoritative access-gate assertions passed.');
