import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const authModule = require('../netlify/functions/_requireAuth.cjs');
const artifactModule = require('../netlify/functions/_lobArtifacts.cjs');

const USER_ID = '10000000-0000-4000-8000-000000000001';
const PROFILE_ID = '20000000-0000-4000-8000-000000000002';
const CLIENT_ID = '30000000-0000-4000-8000-000000000003';
const LETTER_ID = 'historical-letter-1';
const LOB_ID = 'ltr_historical123';
const EMAIL = 'client@example.com';
const RECEIPT_URL = 'https://lob-assets.example/receipt.pdf';

let currentCaller = { userId: USER_ID, email: EMAIL, token: 'client-jwt' };
authModule.requireAuth = async () => currentCaller;

const archiveCalls = [];
artifactModule.archiveLobArtifact = async (args) => {
  archiveCalls.push(args);
  return { archived: true };
};

delete require.cache[require.resolve('../netlify/functions/get-return-receipt.cjs')];
const endpoint = require('../netlify/functions/get-return-receipt.cjs');
const {
  CERTIFIED_RETURN_RECEIPT,
  canonicalPortalIdentity,
  eligibleHistoricalLetter,
  httpsReceiptUrl,
} = endpoint._test;

process.env.VITE_SUPABASE_URL = 'https://supabase.example';
process.env.VITE_SUPABASE_ANON_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.LOB_MODE = 'test';
process.env.LOB_TEST_KEY = 'lob-test-key';

function freshScenario() {
  return {
    bootstrap: {
      has_portal_access: true,
      profile: { id: PROFILE_ID, email: EMAIL },
    },
    userProfiles: [{ id: PROFILE_ID, client_id: CLIENT_ID, user_id: USER_ID, email: EMAIL }],
    clientProfiles: [{ id: PROFILE_ID, client_id: CLIENT_ID, user_id: USER_ID, email: EMAIL }],
    identities: [{ id: USER_ID, email: EMAIL, role: 'client' }],
    clients: [{ id: CLIENT_ID, email: EMAIL }],
    affiliates: [],
    letters: [{
      id: LETTER_ID,
      client_id: CLIENT_ID,
      lob_id: LOB_ID,
      mail_service: CERTIFIED_RETURN_RECEIPT,
      return_receipt_url: RECEIPT_URL,
    }],
  };
}

let scenario = freshScenario();
let fetchCalls = [];

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  fetchCalls.push({ url, options });
  let body;
  if (url.pathname === '/rest/v1/rpc/get_my_client_portal_bootstrap') body = scenario.bootstrap;
  else if (url.pathname === '/rest/v1/client_profiles' && url.searchParams.has('user_id')) body = scenario.userProfiles;
  else if (url.pathname === '/rest/v1/client_profiles' && url.searchParams.has('client_id')) body = scenario.clientProfiles;
  else if (url.pathname === '/rest/v1/profiles') body = scenario.identities;
  else if (url.pathname === '/rest/v1/clients') body = scenario.clients;
  else if (url.pathname === '/rest/v1/affiliates') body = scenario.affiliates;
  else if (url.pathname === '/rest/v1/letters') body = scenario.letters;
  else throw new Error(`Unexpected Supabase request: ${url.pathname}${url.search}`);
  return { status: 200, json: async () => body };
};

function request(lobId = LOB_ID) {
  return {
    httpMethod: 'POST',
    headers: { Authorization: 'Bearer client-jwt' },
    body: JSON.stringify({ lobId }),
  };
}

async function invoke() {
  return endpoint.handler(request());
}

let response = await invoke();
assert.equal(response.statusCode, 200, 'an active exact client may retrieve an explicit historical certified receipt');
assert.deepEqual(JSON.parse(response.body), { return_receipt_url: RECEIPT_URL });
assert.equal(archiveCalls.length, 1);
assert.equal(archiveCalls[0].letterId, LETTER_ID, 'archival must carry the exact authorized letter id');
assert.equal(archiveCalls[0].lobId, LOB_ID);

const bootstrapCall = fetchCalls.find(({ url }) => url.pathname.endsWith('/get_my_client_portal_bootstrap'));
assert.equal(bootstrapCall.options.method, 'POST');
assert.equal(bootstrapCall.options.headers.Authorization, 'Bearer client-jwt', 'portal gate must run as the client JWT');
assert.equal(bootstrapCall.options.headers.apikey, 'anon-key');
const letterCall = fetchCalls.find(({ url }) => url.pathname === '/rest/v1/letters');
assert.equal(letterCall.options.headers.Authorization, 'Bearer service-key', 'raw letters must only be read with the server credential');
assert.equal(letterCall.url.searchParams.get('lob_id'), `eq.${LOB_ID}`);
assert.equal(letterCall.url.searchParams.get('client_id'), `eq.${CLIENT_ID}`);
assert.equal(letterCall.url.searchParams.get('limit'), '2');

scenario = freshScenario();
scenario.bootstrap.has_portal_access = false;
fetchCalls = [];
response = await invoke();
assert.equal(response.statusCode, 404, 'unsigned or inactive portal identities fail closed');
assert.equal(fetchCalls.some(({ url }) => url.pathname === '/rest/v1/letters'), false);

scenario = freshScenario();
scenario.userProfiles.push({ ...scenario.userProfiles[0], id: 'duplicate-user-profile' });
response = await invoke();
assert.equal(response.statusCode, 404, 'ambiguous Auth-user profile mappings fail closed');

scenario = freshScenario();
scenario.clientProfiles.push({ ...scenario.clientProfiles[0], id: 'duplicate-client-profile' });
response = await invoke();
assert.equal(response.statusCode, 404, 'ambiguous client profile mappings fail closed');

scenario = freshScenario();
scenario.identities[0].role = 'affiliate';
response = await invoke();
assert.equal(response.statusCode, 404, 'non-client identity roles cannot retrieve receipts');

scenario = freshScenario();
scenario.affiliates = [{ id: 'affiliate-link' }];
response = await invoke();
assert.equal(response.statusCode, 404, 'affiliate-linked identities cannot cross into client receipt access');

scenario = freshScenario();
scenario.clients[0].email = 'different@example.com';
response = await invoke();
assert.equal(response.statusCode, 404, 'non-canonical email mappings fail closed');

scenario = freshScenario();
scenario.letters[0].mail_service = 'usps_first_class';
response = await invoke();
assert.equal(response.statusCode, 404, 'current untracked First-Class mail never exposes return-receipt retrieval');

scenario = freshScenario();
scenario.letters[0].client_id = 'another-client';
response = await invoke();
assert.equal(response.statusCode, 404, 'a letter must belong to the exact authenticated client');

currentCaller = { userId: USER_ID, email: EMAIL, token: 'service-key', isSystem: true };
scenario = freshScenario();
fetchCalls = [];
response = await invoke();
assert.equal(response.statusCode, 403, 'the requireAuth service-role shortcut is forbidden on this portal endpoint');
assert.equal(fetchCalls.length, 0);

const canonicalFixture = {
  caller: { userId: USER_ID, email: EMAIL },
  bootstrap: { has_portal_access: true, profile: { id: PROFILE_ID, email: EMAIL } },
  userProfile: { id: PROFILE_ID, client_id: CLIENT_ID, user_id: USER_ID, email: EMAIL },
  clientProfile: { id: PROFILE_ID, client_id: CLIENT_ID, user_id: USER_ID, email: EMAIL },
  identity: { id: USER_ID, email: EMAIL, role: 'client' },
  client: { id: CLIENT_ID, email: EMAIL },
  affiliates: [],
};
assert.equal(canonicalPortalIdentity(canonicalFixture), true);
assert.equal(canonicalPortalIdentity({ ...canonicalFixture, affiliates: [{ id: 'affiliate' }] }), false);
assert.equal(eligibleHistoricalLetter(freshScenario().letters[0], { lobId: LOB_ID, clientId: CLIENT_ID }), true);
assert.equal(eligibleHistoricalLetter({ ...freshScenario().letters[0], mail_service: 'usps_first_class' }, { lobId: LOB_ID, clientId: CLIENT_ID }), false);
assert.equal(httpsReceiptUrl('http://unsafe.example/receipt.pdf'), null, 'receipt evidence must be HTTPS');

const source = readFileSync(new URL('../netlify/functions/get-return-receipt.cjs', import.meta.url), 'utf8');
assert.match(source, /get_my_client_portal_bootstrap/);
assert.match(source, /client_id=eq\.\$\{encodeURIComponent\(clientId\)\}/);
assert.match(source, /letterId:\s*letter\.id/);
assert.doesNotMatch(source, /client_name|full_name|name=eq\./i, 'authorization must never fall back to name matching');
assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*(?:lobId|caller|email)/, 'logs must not include client or letter identifiers');

console.log('return-receipt endpoint security tests passed');
