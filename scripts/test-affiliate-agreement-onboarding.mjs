import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { stripHtml, buildSignedAgreementPdf } = require('../netlify/functions/_affiliateAgreement.cjs');
const { hasPortalAccess } = require('../netlify/functions/_affiliateAccess.cjs');
const { handler: loadAffiliatePortalData } = require('../netlify/functions/affiliate-portal-data.cjs');

assert.equal(hasPortalAccess({ program_status: 'legacy_active' }), true);
assert.equal(hasPortalAccess({ program_status: 'active' }), true);
assert.equal(hasPortalAccess({ program_status: 'agreement_signed' }), false);
assert.equal(stripHtml('<h1>Hello</h1><script>alert(1)</script><p>Partner &amp; terms</p>'), 'Hello\nPartner & terms');

const packet = {
  id: '11111111-1111-1111-1111-111111111111',
  template_version: 'ccc-affiliate-agreement-v1-test',
  applicant_snapshot: { name: 'Test Partner', email: 'partner@example.com' },
  compensation_snapshot: { commissionRate: 0.2, compensationTerms: 'Exact owner supplied test terms.' },
  document_snapshot: { title: 'Partner Agreement', bodyHtml: '<p>Approved test agreement body.</p>' },
};
const pdf = await buildSignedAgreementPdf({ packet, agreement: packet, signerName: 'Test Partner', signedAt: '2026-08-21T12:00:00.000Z', ipAddress: '127.0.0.1' });
assert.equal(pdf.bytes.subarray(0, 4).toString(), '%PDF');
assert.match(pdf.hash, /^[0-9a-f]{64}$/);

const migration = readFileSync(new URL('../supabase/migrations/20260820380000_affiliate_agreement_onboarding.sql', import.meta.url), 'utf8');
assert.match(migration, /program_status[\s\S]*legacy_active/);
assert.match(migration, /legal_status text not null default 'counsel_review'/);
assert.match(migration, /create table if not exists public\.affiliate_agreements/);
assert.match(migration, /create table if not exists public\.affiliate_agreement_events/);
assert.match(migration, /source snapshots are immutable/i);
assert.match(migration, /events are append-only/i);
assert.match(migration, /drop policy if exists "Admins can manage affiliates"/);
assert.match(migration, /drop policy if exists "Affiliates can update own user_id"/);
assert.match(migration, /drop policy if exists affiliate_template_staff_read on public\.affiliate_agreement_templates/);
assert.match(migration, /drop policy if exists affiliate_template_signer_read on public\.affiliate_agreement_templates/);
assert.match(migration, /drop policy if exists affiliate_agreement_owner_read on public\.affiliate_agreements/);
assert.match(migration, /drop policy if exists affiliate_agreement_signer_read on public\.affiliate_agreements/);
assert.match(migration, /drop policy if exists affiliate_agreement_event_owner_read on public\.affiliate_agreement_events/);
assert.match(migration, /drop policy if exists affiliate_agreement_event_signer_read on public\.affiliate_agreement_events/);
assert.match(migration, /revoke insert, update, delete on public\.affiliates from anon, authenticated/);
assert.match(migration, /role in \('admin', 'auditor'\)[\s\S]*role = 'admin'/);
assert.match(migration, /create or replace function public\.ccc_prepare_affiliate_agreement/);
assert.match(migration, /create or replace function public\.ccc_complete_affiliate_agreement/);
assert.match(migration, /create or replace function public\.ccc_mark_affiliate_agreement_viewed/);
assert.match(migration, /create or replace function public\.ccc_activate_affiliate/);
assert.match(migration, /create or replace function public\.ccc_current_affiliate_access_state/);
assert.match(migration, /Use ccc_prepare_affiliate_agreement with the exact owner-approved compensation language/);

const portalData = readFileSync(new URL('../netlify/functions/affiliate-portal-data.cjs', import.meta.url), 'utf8');
const refer = readFileSync(new URL('../netlify/functions/affiliate-refer-client.cjs', import.meta.url), 'utf8');
const provision = readFileSync(new URL('../netlify/functions/provision-user.cjs', import.meta.url), 'utf8');
assert.match(portalData, /AFFILIATE_ACTIVATION_REQUIRED/);
assert.match(portalData, /client_id=in\.\(\$\{idsQuery\}\)/);
assert.match(portalData, /referred_by=eq\.\$\{encodeURIComponent\(affiliate\.id\)\}&user_id=eq\.\$\{encodeURIComponent\(ownerUserId\)\}/);
assert.match(portalData, /Affiliate client ownership boundary mismatch/);
assert.match(portalData, /if \(!r\.ok\) throw new Error/);
assert.doesNotMatch(portalData, /client_id\.is\.null/);
assert.doesNotMatch(portalData, /client_name\.in/);
assert.doesNotMatch(portalData, /user_id\.in/);
assert.match(refer, /requireAffiliatePortalAccess/);
assert.match(provision, /ccc_link_affiliate_portal_identity/);
assert.match(provision, /\['legacy_active', 'active'\]/);
assert.doesNotMatch(provision, /rest\/v1\/affiliates\?email[^\n]+\{ user_id: userId \}/);

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const affiliatePortal = readFileSync(new URL('../src/components/AffiliatePortal.jsx', import.meta.url), 'utf8');
const adminPanel = readFileSync(new URL('../src/components/AffiliateApplicationsPanel.jsx', import.meta.url), 'utf8');
const onboarding = readFileSync(new URL('../src/components/AffiliateOnboardingFlow.jsx', import.meta.url), 'utf8');
assert.match(app, /ccc_current_affiliate_access_state/);
assert.match(app, /ccc_claim_legacy_affiliate_portal_identity/);
assert.match(app, /AffiliateOnboardingFlow/);
assert.doesNotMatch(affiliatePortal, /from\('affiliates'\)\.update/);
assert.doesNotMatch(affiliatePortal, /client_name\s*===/);
assert.match(adminPanel, /exact owner-approved compensation language/i);
assert.match(adminPanel, /Counsel review required/i);
assert.match(onboarding, /electronic records and signatures/i);

const originalFetch = globalThis.fetch;
const originalUrl = process.env.VITE_SUPABASE_URL;
const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const originalAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const affiliateId = '11111111-1111-4111-8111-111111111111';
const clientId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const ownerUserId = '44444444-4444-4444-8444-444444444444';
const response = (status, value) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => value,
  text: async () => JSON.stringify(value),
});

try {
  process.env.VITE_SUPABASE_URL = 'https://affiliate-security-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.VITE_SUPABASE_ANON_KEY = 'test-anon-key';

  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    if (String(url).includes('/auth/v1/user')) return response(200, { id: userId });
    if (String(url).includes('/rest/v1/affiliates?')) return response(200, [{ id: affiliateId, user_id: userId, owner_user_id: ownerUserId, program_status: 'active', commission_rate: 0.2 }]);
    if (String(url).includes('/rest/v1/clients?')) return response(200, [{ id: clientId, user_id: ownerUserId, referred_by: affiliateId, name: 'Same Name', ledger: [] }]);
    if (String(url).includes('/rest/v1/commission_payouts?')) return response(200, []);
    if (String(url).includes('/rest/v1/letters?')) return response(200, [{ user_id: ownerUserId, client_id: clientId, furnisher: 'Example Bank', mail_service: 'usps_first_class', mailed_date: '2026-08-20', expected_delivery_date: '2026-08-25', tracking_status: 'Mailpiece Scan Received' }]);
    if (String(url).includes('/rest/v1/audits?')) return response(200, [{ id: 'audit-1', user_id: ownerUserId, client_id: clientId, report_date: '2026-08-21', audit: { scores: { equifax: 700 } } }]);
    return response(404, { error: 'Unexpected test URL' });
  };

  const successful = await loadAffiliatePortalData({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer test-user-token' },
    body: JSON.stringify({ affiliateId }),
  });
  assert.equal(successful.statusCode, 200);
  const successfulBody = JSON.parse(successful.body);
  assert.equal(successfulBody.letters.length, 1);
  assert.equal('user_id' in successfulBody.letters[0], false, 'firm ownership IDs are validation inputs, not affiliate response data');
  assert.equal(successfulBody.letters[0].tracking_status, 'Mailed First Class');
  const letterRequest = requestedUrls.find((url) => url.includes('/rest/v1/letters?'));
  const auditRequest = requestedUrls.find((url) => url.includes('/rest/v1/audits?'));
  const clientRequest = requestedUrls.find((url) => url.includes('/rest/v1/clients?'));
  assert.match(clientRequest, new RegExp(`referred_by=eq\\.${affiliateId}`));
  assert.match(clientRequest, new RegExp(`user_id=eq\\.${ownerUserId}`));
  assert.match(letterRequest, new RegExp(`client_id=in\\.\\(${clientId}\\)`));
  assert.match(auditRequest, new RegExp(`client_id=in\\.\\(${clientId}\\)`));
  assert.match(letterRequest, new RegExp(`user_id=eq\\.${ownerUserId}`));
  assert.match(auditRequest, new RegExp(`user_id=eq\\.${ownerUserId}`));
  assert.doesNotMatch(requestedUrls.join('\n'), /client_name|client_id\.is\.null|user_id\.in/);

  globalThis.fetch = async (url) => {
    if (String(url).includes('/auth/v1/user')) return response(200, { id: userId });
    if (String(url).includes('/rest/v1/affiliates?')) return response(200, [{ id: affiliateId, user_id: userId, owner_user_id: ownerUserId, program_status: 'active', commission_rate: 0.2 }]);
    if (String(url).includes('/rest/v1/clients?')) return response(200, [{ id: clientId, user_id: userId, referred_by: affiliateId, name: 'Wrong owner', ledger: [] }]);
    return response(200, []);
  };
  const ownershipMismatch = await loadAffiliatePortalData({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer test-user-token' },
    body: JSON.stringify({ affiliateId }),
  });
  assert.equal(ownershipMismatch.statusCode, 500);
  assert.deepEqual(JSON.parse(ownershipMismatch.body), { error: 'Could not load affiliate portal data.' });

  globalThis.fetch = async (url) => {
    if (String(url).includes('/auth/v1/user')) return response(200, { id: userId });
    if (String(url).includes('/rest/v1/affiliates?')) return response(200, [{ id: affiliateId, user_id: userId, owner_user_id: ownerUserId, program_status: 'active', commission_rate: 0.2 }]);
    if (String(url).includes('/rest/v1/clients?')) return response(200, [{ id: clientId, user_id: ownerUserId, referred_by: affiliateId, name: 'Correct referral', ledger: [] }]);
    if (String(url).includes('/rest/v1/commission_payouts?')) return response(200, []);
    if (String(url).includes('/rest/v1/letters?')) return response(200, [{ user_id: userId, client_id: clientId, furnisher: 'Wrong tenant letter' }]);
    return response(200, []);
  };
  const downstreamOwnershipMismatch = await loadAffiliatePortalData({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer test-user-token' },
    body: JSON.stringify({ affiliateId }),
  });
  assert.equal(downstreamOwnershipMismatch.statusCode, 500);
  assert.deepEqual(JSON.parse(downstreamOwnershipMismatch.body), { error: 'Could not load affiliate portal data.' });

  globalThis.fetch = async (url) => {
    if (String(url).includes('/auth/v1/user')) return response(200, { id: userId });
    return response(503, { error: 'Internal upstream detail that must not leak' });
  };
  const failedClosed = await loadAffiliatePortalData({
    httpMethod: 'POST',
    headers: { Authorization: 'Bearer test-user-token' },
    body: JSON.stringify({ affiliateId }),
  });
  assert.equal(failedClosed.statusCode, 500);
  assert.deepEqual(JSON.parse(failedClosed.body), { error: 'Could not load affiliate portal data.' });
} finally {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.VITE_SUPABASE_URL;
  else process.env.VITE_SUPABASE_URL = originalUrl;
  if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  if (originalAnonKey === undefined) delete process.env.VITE_SUPABASE_ANON_KEY;
  else process.env.VITE_SUPABASE_ANON_KEY = originalAnonKey;
}

console.log('All affiliate agreement onboarding assertions passed.');
