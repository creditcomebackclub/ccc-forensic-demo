#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  clientTrackStatusLabel,
  portalMailPresentation,
  visiblePortalTracks,
} from '../src/utils/portalCampaigns.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const portal = read('../src/components/ClientPortal.jsx');
const disputes = read('../src/components/client-portal/DisputesTab.jsx');
const chat = read('../src/components/client-portal/ConciergeChat.jsx');
const campaigns = read('../src/utils/portalCampaigns.js');
const agent = read('../agents/concierge_agent.py');
const migration = read('../supabase/migrations/20260820370000_client_portal_ccc_projection.sql');
const canonicalRuntimeMigration = read('../supabase/migrations/20260820430000_portal_canonical_runtime_hardening.sql');

assert.equal(portalMailPresentation({ mail_service: 'usps_first_class' }).currentFirstClass, true);
assert.equal(portalMailPresentation({ mail_service: 'usps_first_class_certified_return_receipt' }).legacyCertified, true);
assert.equal(portalMailPresentation({}).label, 'Mail service not recorded');
assert.equal(portalMailPresentation({ tracking_number: 'tracking-is-not-service-proof' }).unknown, true);
assert.equal(clientTrackStatusLabel('staff_review'), 'Staff review underway');
assert.deepEqual(
  visiblePortalTracks([
    { track_id: 'cra', channel: 'credit_bureau', status: 'active' },
    { track_id: 'direct-pending', channel: 'direct_account', status: 'not_started' },
    { track_id: 'direct-active', channel: 'direct_account', status: 'active' },
  ]).map((row) => row.track_id),
  ['cra', 'direct-active'],
  'pending Direct state is not projected as active client work',
);

assert.doesNotMatch(disputes, /useMemo/, 'letter rendering must not call a hook inside a map');
assert.match(disputes, /Case review: day/);
assert.match(disputes, /portalMailPresentation\(l\)/);
assert.match(disputes, /mail\.legacyCertified/);
assert.doesNotMatch(disputes, /Mailed \{[^}]*certified/i);

assert.match(portal, /rpc\('get_my_client_portal_snapshot'\)/);
assert.match(portal, /snapshot\.has_portal_access !== true/);
assert.doesNotMatch(portal, /from\('client_profiles'\)/, 'the browser must not download raw client profiles');
assert.doesNotMatch(portal, /from\('clients'\)/, 'the browser must not download raw CRM rows');
assert.doesNotMatch(portal, /from\('letters'\)/, 'the browser must not download raw letter rows');
assert.doesNotMatch(portal, /from\('audits'\)/, 'the browser must not download raw audits');
assert.doesNotMatch(portal, /\.eq\('email',|\.eq\('name',|\.eq\('client_name',/);
assert.match(portal, /mail\.timelineLabel/);
assert.match(campaigns, /Certified Mail \(legacy history\)/);
assert.match(portal, /<ConciergeChat accessToken=/);
assert.doesNotMatch(portal, /<ConciergeChat clientId=/);

assert.match(chat, /if \(!res\.ok\) throw new Error/);
assert.match(chat, /fetch\(`\$\{apiUrl\}\/portal\/chat`/);
assert.match(chat, /JSON\.stringify\(\{ message: userMsg \}\)/);
assert.doesNotMatch(chat, /client_id:/);
assert.match(chat, /Never send an SSN, card number, password/);

assert.match(agent, /def _resolve_caller/);
assert.match(agent, /ccc_resolve_canonical_portal_identity/);
assert.match(agent, /"p_access_mode": "active"/);
assert.doesNotMatch(agent, /\.eq\("name"|\.eq\("email"/);
assert.doesNotMatch(agent, /table\("audits"\)/, 'raw audits must not enter concierge context');
assert.doesNotMatch(agent, /select\("\*"\)/);
assert.match(agent, /ccc_begin_portal_concierge_request/);
assert.match(agent, /_reject_sensitive_message/);
assert.match(agent, /do not describe internal flow names/);
assert.match(agent, /@app\.post\("\/portal\/chat"\)/);
assert.match(agent, /from google import genai/);
assert.match(agent, /gemini-3\.1-flash-lite/);
assert.match(agent, /GenerateContentConfig/);
assert.doesNotMatch(agent, /_memory_rate_limit|_rate_events/, 'the production limiter must not fall back to process memory');
assert.match(agent, /gate\.get\("handoff_recorded"\) is not True/);
assert.match(agent, /raise HTTPException\(status_code=503, detail="The concierge is temporarily unavailable"\)/);

assert.match(migration, /create or replace function public\.get_my_ccc_portal_projection\(\)/);
assert.match(migration, /where profile\.user_id = v_caller/);
assert.match(migration, /v_profile_count <> 1 or v_client_id is null/);
assert.match(migration, /v_client_profile_count <> 1/);
assert.match(migration, /track\.track_scope = 'cra' or track\.status <> 'pending'/);
assert.match(migration, /create or replace function public\.ccc_begin_portal_concierge_request/);
assert.match(migration, /v_minute_count >= 8/);
assert.match(migration, /v_hour_count >= 40/);
assert.match(migration, /Stores no message body/);
assert.match(canonicalRuntimeMigration, /ccc_resolve_canonical_portal_identity\([\s\S]*?'active'/);
assert.match(canonicalRuntimeMigration, /v_canonical_client_id is distinct from p_client_id/);
assert.match(canonicalRuntimeMigration, /stores no message content/i);

const projectionBody = migration.match(
  /create or replace function public\.get_my_ccc_portal_projection\(\)[\s\S]*?as \$\$([\s\S]*?)\n\$\$;/,
)?.[1] || '';
for (const forbidden of ['current_flow', 'native_flow', 'classification_snapshot', 'source_audit_snapshot', 'review_reason']) {
  assert.doesNotMatch(projectionBody, new RegExp(forbidden), `${forbidden} must stay out of the client projection`);
}

console.log('Client portal current-method, exact-auth, mail, projection, and concierge assertions passed.');
