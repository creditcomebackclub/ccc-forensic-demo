#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { handler: guideDownloadHandler } = require('../netlify/functions/guide-download.cjs');

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
assert.match(guideGenerator, /https:\/\/pulse\.scorexer\.com\/Portal\/meeting\.jsp\?id=5d235976-7de9-49d9-a061-dab6275c3c99/,
  'guide CTA must link directly to the approved DisputeFox calendar');
assert.doesNotMatch(guideGenerator, /calendly/i, 'guide generator must not retain the retired calendar');
assert.match(guideGenerator, /Keep learning with CCC[\s\S]*Join more than 280 members[\s\S]*https:\/\/www\.facebook\.com\/groups\/creditcomebackclub/,
  'guide must include meaningful community copy and the exact Facebook group link');

const guidePage = readFileSync(new URL('../public/freeguide.html', import.meta.url), 'utf8');
assert.match(guidePage, /data-guide-open/);
assert.match(guidePage, /id="guideForm"/);
assert.doesNotMatch(guidePage, /secure, tracked download/i);
assert.match(guidePage, /id="guideFirstName"[\s\S]*?name="firstName"[\s\S]*?required/);
assert.match(guidePage, /id="guideLastName"[\s\S]*?name="lastName"[\s\S]*?required/);
assert.match(guidePage, /id="guideEmail"[\s\S]*?required/);
assert.match(guidePage, /action="https:\/\/pulse\.disputeprocess\.com\/CustumFieldController\?method=addWebFormData"/);
assert.match(guidePage, /name="portalAccess" value="0"/);
assert.match(guidePage, /name="customerAgreementIDs" value=""/);
assert.match(guidePage, /name="checkbox1"[\s\S]*?required/);
assert.match(guidePage, /const GUIDE_DOWNLOAD_URL='\/api\/guide-download'/);
assert.match(guidePage, /submitToDisputeFox\(guideForm,GUIDE_REDIRECT_URL\)/);
assert.doesNotMatch(guidePage, /\/api\/public-intake|Calendly/i);
assert.match(guidePage, /role="status"[\s\S]*?aria-live="polite"/);
assert.match(guidePage, /Preparing your PDF/);
assert.match(guidePage, /dataset\.state='error'/);
assert.match(guidePage, /Your download is ready/);
assert.match(guidePage, /id="guideDownloadLink"/);
assert.match(guidePage, /id="consultForm"[\s\S]*?name="mobilePhone1"/);
assert.match(guidePage, /openIntake\('Standard'\)[\s\S]*openIntake\('VIP'\)[\s\S]*openIntake\('Six-Month Standard'\)/);
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

const originalFetch = globalThis.fetch;

const methodRejected = await guideDownloadHandler({ httpMethod: 'POST', queryStringParameters: {} });
assert.equal(methodRejected.statusCode, 405);

globalThis.fetch = async () => { throw new Error('guide delivery must not call the retired CCC CRM'); };
const downloaded = await guideDownloadHandler({ httpMethod: 'GET', queryStringParameters: {} });
assert.equal(downloaded.statusCode, 200);
assert.equal(downloaded.isBase64Encoded, true);
assert.equal(downloaded.headers['Content-Type'], 'application/pdf');
assert.match(downloaded.headers['Content-Disposition'], /^attachment;/);
assert.match(downloaded.headers['Cache-Control'], /no-store/);
assert.deepEqual(Buffer.from(downloaded.body, 'base64'), asset);

globalThis.fetch = originalFetch;

assert.ok(existsSync(assetUrl));
assert.ok(statSync(assetUrl).size === asset.length);
console.log(`Gated field guide checks passed (${pageCount} pages, ${asset.length.toLocaleString()} bytes).`);
