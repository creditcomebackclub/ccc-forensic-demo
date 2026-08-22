#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { handler, _test } = require('../netlify/functions/public-intake.cjs');
const { handler: bookedHandler } = require('../netlify/functions/intake-booked.cjs');

const validEvent = (payload, headers = { 'Content-Type': 'application/json' }) => ({
  httpMethod: 'POST',
  headers,
  body: JSON.stringify(payload),
});

const validPayload = {
  name: '  Jamie   Example  ',
  email: ' JAMIE@EXAMPLE.COM ',
  phone: '(970) 555-0100',
  tier: 'VIP',
  ref: 'A1B2C3',
  intent: 'CONSULTATION',
  website: '',
};

const normalized = _test.parsePayload(validEvent(validPayload));
assert.equal(normalized.name, 'Jamie Example');
assert.equal(normalized.email, 'jamie@example.com');
assert.equal(normalized.intent, 'consultation');
assert.equal(normalized.ref, 'a1b2c3');
assert.deepEqual([..._test.ALLOWED_TIERS], ['Standard', 'VIP', 'Paid In Full']);

assert.throws(() => _test.parsePayload(validEvent({ ...validPayload, phone: { nested: true } })));
assert.throws(() => _test.parsePayload(validEvent({ ...validPayload, extra: 'garbage' })));
assert.throws(() => _test.parsePayload(validEvent({ ...validPayload, tier: 'VIP Membership' })));
assert.throws(() => _test.parsePayload(validEvent({ ...validPayload, ref: 'not-a-ref' })));
assert.throws(() => _test.parsePayload(validEvent({ ...validPayload, phone: '123-45-6789' })));
assert.throws(() => _test.parsePayload(validEvent(validPayload, { 'Content-Type': 'text/plain' })));
assert.throws(() => _test.parsePayload(validEvent(validPayload, { 'Content-Type': 'application/jsonp' })));
assert.throws(() => _test.parsePayload(validEvent({ ...validPayload, email: 'jamie@bad..example' })));
assert.throws(() => _test.parsePayload({
  httpMethod: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: 'x'.repeat(_test.MAX_BODY_BYTES + 1),
}));

const rawIp = '203.0.113.42';
const rateKey = _test.clientRateKey({ headers: { 'x-nf-client-connection-ip': rawIp } }, 'test-secret');
assert.match(rateKey, /^intake:[0-9a-f]{64}$/);
assert.ok(!rateKey.includes(rawIp));

const originalFetch = globalThis.fetch;
const originalEnv = {
  url: process.env.VITE_SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  owner: process.env.PUBLIC_INTAKE_OWNER_USER_ID,
  site: process.env.URL,
};
process.env.VITE_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.URL = 'https://test.example';
delete process.env.PUBLIC_INTAKE_OWNER_USER_ID;

let fetchCalls = [];
globalThis.fetch = async (...args) => {
  fetchCalls.push(args);
  throw new Error('honeypot must not call a backend');
};
const honeypot = await handler(validEvent({ ...validPayload, website: 'https://spam.example' }));
assert.equal(honeypot.statusCode, 200);
assert.deepEqual(JSON.parse(honeypot.body), { success: true });
assert.equal(fetchCalls.length, 0);

globalThis.fetch = async () => new Response(JSON.stringify({ error: 'db down' }), { status: 503 });
const limiterUnavailable = await handler(validEvent(validPayload));
assert.equal(limiterUnavailable.statusCode, 503);
assert.equal(JSON.parse(limiterUnavailable.body).error, 'Service temporarily unavailable.');

const adminId = '11111111-1111-4111-8111-111111111111';
const secondAdminId = '22222222-2222-4222-8222-222222222222';
globalThis.fetch = async (url) => {
  if (String(url).endsWith('/rpc/consume_public_intake_rate_limit')) {
    return new Response(JSON.stringify({ allowed: true }), { status: 200 });
  }
  if (String(url).includes('/profiles?role=eq.admin')) {
    return new Response(JSON.stringify([{ id: adminId }, { id: secondAdminId }]), { status: 200 });
  }
  throw new Error('ambiguous owner must stop before lead persistence');
};
const ambiguousOwner = await handler(validEvent(validPayload));
assert.equal(ambiguousOwner.statusCode, 503);

process.env.PUBLIC_INTAKE_OWNER_USER_ID = adminId;
fetchCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  fetchCalls.push({ target, options });
  if (target.endsWith('/rpc/consume_public_intake_rate_limit')) {
    return new Response(JSON.stringify({ allowed: true }), { status: 200 });
  }
  if (target.includes(`/profiles?id=eq.${adminId}`)) {
    return new Response(JSON.stringify([{ id: adminId }]), { status: 200 });
  }
  if (target.endsWith('/rpc/create_or_reuse_public_intake_lead')) {
    return new Response(JSON.stringify({
      lead: { id: '33333333-3333-4333-8333-333333333333', name: 'Jamie Example', email: 'jamie@example.com', lead_phone: '(970) 555-0100' },
      created: true,
      attribution_added: false,
      affiliate: null,
    }), { status: 200 });
  }
  if (target === 'https://test.example/.netlify/functions/send-lpoa') {
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  throw new Error(`Unexpected request: ${target}`);
};
const accepted = await handler(validEvent(validPayload));
assert.equal(accepted.statusCode, 200);
assert.deepEqual(JSON.parse(accepted.body), { success: true });
assert.doesNotMatch(accepted.body, /33333333-3333-4333-8333-333333333333/);
const leadRpc = fetchCalls.find((call) => call.target.endsWith('/rpc/create_or_reuse_public_intake_lead'));
const leadRpcBody = JSON.parse(leadRpc.options.body);
assert.equal(leadRpcBody.p_owner_user_id, adminId);
assert.equal(leadRpcBody.p_tier, 'VIP');
assert.ok(!Object.hasOwn(leadRpcBody, 'p_billing_tier'));

const successfulBackendFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (String(url) === 'https://test.example/.netlify/functions/send-lpoa') throw new Error('mail unavailable');
  return successfulBackendFetch(url, options);
};
const notificationUnavailable = await handler(validEvent(validPayload));
assert.equal(notificationUnavailable.statusCode, 200);
assert.deepEqual(JSON.parse(notificationUnavailable.body), { success: true });

globalThis.fetch = successfulBackendFetch;
const guideAccepted = await handler(validEvent({ ...validPayload, tier: '', intent: 'guide_download' }));
assert.equal(guideAccepted.statusCode, 200);
const guideBody = JSON.parse(guideAccepted.body);
assert.equal(guideBody.success, true);
assert.match(guideBody.downloadUrl, /^\/api\/guide-download\?token=/);
assert.doesNotMatch(guideAccepted.body, /33333333-3333-4333-8333-333333333333/);

const retired = await bookedHandler(validEvent({ leadId: '33333333-3333-4333-8333-333333333333' }));
assert.equal(retired.statusCode, 410);
assert.match(JSON.parse(retired.body).error, /Verified Calendly webhooks/);

const config = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
assert.match(config, /\[functions\."public-intake"\.rate_limit\][\s\S]*?window = "1m"[\s\S]*?limit = 5/);
assert.match(config, /\[functions\."intake-booked"\.rate_limit\][\s\S]*?window = "1m"[\s\S]*?limit = 10/);

for (const callerPath of ['public/home.html', 'public/freeguide.html', 'public/join.html', 'public/join-embed.js']) {
  const caller = readFileSync(new URL(`../${callerPath}`, import.meta.url), 'utf8');
  assert.doesNotMatch(caller, /intake\.leadId|intakeLeadId|\/api\/intake-booked/, `${callerPath} still trusts a browser booking claim`);
  assert.doesNotMatch(caller, /openIntake\('(CCC Membership|VIP Membership|Paid in Full|Consultation)'\)/, `${callerPath} sends a retired tier label`);
}
const currentHome = readFileSync(new URL('../public/home.html', import.meta.url), 'utf8');
const currentGuide = readFileSync(new URL('../public/freeguide.html', import.meta.url), 'utf8');
for (const caller of [currentHome, currentGuide]) {
  assert.match(caller, /openIntake\('Standard'\)/);
  assert.match(caller, /openIntake\('VIP'\)/);
  assert.match(caller, /openIntake\('Paid In Full'\)/);
}

const migration = readFileSync(new URL('../supabase/migrations/20260820500000_public_intake_hardening.sql', import.meta.url), 'utf8');
assert.match(migration, /pg_advisory_xact_lock[\s\S]*public-intake-lead:/);
assert.match(migration, /status = 'lead'[\s\S]*lower\(btrim\(client\.email\)\) = v_email[\s\S]*for update/i);
assert.match(migration, /v_attribution_added := false;[\s\S]*v_affiliate := null;/);
const existingLeadUpdate = migration.match(/update public\.clients client([\s\S]*?)where client\.id = v_lead\.id/i)?.[1] || '';
assert.doesNotMatch(existingLeadUpdate, /referred_by\s*=/i);
assert.match(existingLeadUpdate, /coalesce\(nullif\(btrim\(client\.lead_phone\), ''\), v_phone\)/);
assert.match(migration, /owner_user_id = p_owner_user_id/);
assert.match(migration, /program_status in \('legacy_active', 'active'\)/);
assert.match(migration, /limit 500[\s\S]*delete from public\.public_intake_attempts/);
assert.match(migration, /revoke all on function public\.create_or_reuse_public_intake_lead[\s\S]*from public, anon, authenticated/);
assert.doesNotMatch(migration, /insert into public\.clients[\s\S]{0,800}billing_tier/i);
assert.doesNotMatch(migration, /'lead',\s*to_jsonb\(v_lead\)/i);
assert.match(migration, /'lead', pg_catalog\.jsonb_build_object\([\s\S]*'referred_by', v_lead\.referred_by/);

globalThis.fetch = originalFetch;
if (originalEnv.url === undefined) delete process.env.VITE_SUPABASE_URL;
else process.env.VITE_SUPABASE_URL = originalEnv.url;
if (originalEnv.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
else process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.key;
if (originalEnv.owner === undefined) delete process.env.PUBLIC_INTAKE_OWNER_USER_ID;
else process.env.PUBLIC_INTAKE_OWNER_USER_ID = originalEnv.owner;
if (originalEnv.site === undefined) delete process.env.URL;
else process.env.URL = originalEnv.site;

console.log('Public intake hardening checks passed.');
