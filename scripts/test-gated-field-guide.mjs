#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { handler: guideDownloadHandler } = require('../netlify/functions/guide-download.cjs');
const { createGuideDownloadToken, verifyGuideDownloadToken } = require('../netlify/functions/_guideDownloadToken.cjs');

const root = new URL('../', import.meta.url);
const assetUrl = new URL('../netlify/functions/assets/credit-comeback-club-credit-report-field-guide.pdf', import.meta.url);
const asset = readFileSync(assetUrl);
assert.equal(asset.subarray(0, 5).toString('ascii'), '%PDF-');
assert.ok(asset.length > 100_000, 'premium guide should contain substantive content and worksheets');
assert.ok(asset.length < 4_000_000, 'base64 response must stay comfortably below the Netlify synchronous response ceiling');
const pageCount = (asset.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
assert.ok(pageCount >= 15 && pageCount <= 30, `guide should be 15-30 pages, found ${pageCount}`);

const guideGenerator = readFileSync(new URL('../scripts/build-credit-field-guide.py', import.meta.url), 'utf8');
assert.match(guideGenerator, /CLIENT EXPERIENCES[\s\S]*Jasmine W\.[\s\S]*Noah P\.[\s\S]*Karl E\./,
  'guide must retain the client-experience proof page');
assert.match(guideGenerator, /You can do this yourself\. You do not have to do it alone\./,
  'guide must retain the respectful DIY-to-service handoff');
assert.match(guideGenerator, /https:\/\/calendly\.com\/creditcomebackclub\/consultation\?hide_gdpr_banner=1/,
  'guide CTA must link directly to the approved consultation calendar');
assert.match(guideGenerator, /Keep learning with CCC[\s\S]*Join more than 280 members[\s\S]*https:\/\/www\.facebook\.com\/groups\/creditcomebackclub/,
  'guide must include meaningful community copy and the exact Facebook group link');

const guidePage = readFileSync(new URL('../public/freeguide.html', import.meta.url), 'utf8');
assert.match(guidePage, /data-guide-open/);
assert.match(guidePage, /id="guideForm"/);
assert.match(guidePage, /id="guideName"[\s\S]*?required/);
assert.match(guidePage, /id="guideEmail"[\s\S]*?required/);
assert.match(guidePage, /intent:'guide_download'/);
assert.match(guidePage, /fetch\('\/api\/public-intake'/);
assert.match(guidePage, /result\.downloadUrl[\s\S]*?triggerGuideDownload\(result\.downloadUrl\)/);
assert.match(guidePage, /role="status"[\s\S]*?aria-live="polite"/);
assert.match(guidePage, /Preparing your PDF/);
assert.match(guidePage, /dataset\.state='error'/);
assert.match(guidePage, /Your download is ready/);
assert.match(guidePage, /id="guideDownloadLink"/);
assert.match(guidePage, /id="consultForm"[\s\S]*?intent:'consultation'/);
assert.match(guidePage, /openIntake\('Standard'\)[\s\S]*openIntake\('VIP'\)[\s\S]*openIntake\('Paid In Full'\)/);
assert.doesNotMatch(guidePage, /netlify\/functions\/assets|credit-comeback-club-credit-report-field-guide\.pdf/,
  'public page must not reveal the private bundled asset path or filename');

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
const publicRoot = new URL('../public/', import.meta.url).pathname;
assert.equal(walk(publicRoot).some((path) => path.endsWith('credit-comeback-club-credit-report-field-guide.pdf')), false,
  'guide PDF must never be copied into the public publish tree');

const netlify = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
assert.match(netlify, /\[functions\."guide-download"\][\s\S]*included_files\s*=\s*\["netlify\/functions\/assets\/credit-comeback-club-credit-report-field-guide\.pdf"\]/);
for (const file of ['public/home.html', 'public/privacy.html', 'public/terms.html']) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /https:\/\/creditcomebackclub\.netlify\.app\/freeguide/i, `${file} retains a stale absolute guide URL`);
  assert.match(source, /href="\/freeguide\.html"/);
}

const secret = 'guide-test-secret';
const validToken = createGuideDownloadToken('lead-1', secret, 1_000);
assert.equal(verifyGuideDownloadToken(validToken, secret, 1_001), 'lead-1');
assert.equal(verifyGuideDownloadToken(validToken + 'x', secret, 1_001), null, 'tampered token must be rejected');
assert.equal(verifyGuideDownloadToken(validToken, secret, 1_000 + (31 * 24 * 60 * 60)), null, 'expired token must be rejected');

const originalFetch = globalThis.fetch;
const originalEnv = {
  url: process.env.VITE_SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
};
process.env.VITE_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = secret;

const methodRejected = await guideDownloadHandler({ httpMethod: 'POST', queryStringParameters: {} });
assert.equal(methodRejected.statusCode, 405);

let calls = [];
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  calls.push({ target, options });
  if (target.includes('/clients?id=eq.lead-1&select=id,tags')) {
    return new Response(JSON.stringify([{ id: 'lead-1', tags: ['source:freeguide'] }]), { status: 200 });
  }
  if (target.includes('/clients?id=eq.lead-1') && options.method === 'PATCH') {
    return new Response(null, { status: 204 });
  }
  throw new Error(`Unexpected request: ${target}`);
};

const runtimeToken = createGuideDownloadToken('lead-1', secret);
const downloaded = await guideDownloadHandler({ httpMethod: 'GET', queryStringParameters: { token: runtimeToken } });
assert.equal(downloaded.statusCode, 200);
assert.equal(downloaded.isBase64Encoded, true);
assert.equal(downloaded.headers['Content-Type'], 'application/pdf');
assert.match(downloaded.headers['Content-Disposition'], /^attachment;/);
assert.match(downloaded.headers['Cache-Control'], /no-store/);
assert.deepEqual(Buffer.from(downloaded.body, 'base64'), asset);
const trackingPatch = calls.find((call) => call.options.method === 'PATCH');
assert.ok(trackingPatch, 'successful download must persist a tracking event first');
assert.ok(JSON.parse(trackingPatch.options.body).tags.includes('guide:downloaded'));

calls = [];
globalThis.fetch = async () => { throw new Error('invalid token must not call storage'); };
const tampered = await guideDownloadHandler({ httpMethod: 'GET', queryStringParameters: { token: runtimeToken + 'x' } });
assert.equal(tampered.statusCode, 400);
assert.equal(calls.length, 0);
assert.equal(tampered.isBase64Encoded, undefined);

globalThis.fetch = async () => new Response(JSON.stringify([]), { status: 200 });
const missingLead = await guideDownloadHandler({ httpMethod: 'GET', queryStringParameters: { token: runtimeToken } });
assert.equal(missingLead.statusCode, 503);
assert.equal(missingLead.isBase64Encoded, undefined, 'failed tracking must never leak the PDF body');

globalThis.fetch = originalFetch;
if (originalEnv.url === undefined) delete process.env.VITE_SUPABASE_URL;
else process.env.VITE_SUPABASE_URL = originalEnv.url;
if (originalEnv.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
else process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.key;

assert.ok(existsSync(assetUrl));
assert.ok(statSync(assetUrl).size === asset.length);
console.log(`Gated field guide checks passed (${pageCount} pages, ${asset.length.toLocaleString()} bytes).`);
