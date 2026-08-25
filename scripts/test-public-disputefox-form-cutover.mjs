#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const endpoint = 'https://pulse.disputeprocess.com/CustumFieldController?method=addWebFormData';
const scheduler = 'https://pulse.scorexer.com/Portal/meeting.jsp?id=5d235976-7de9-49d9-a061-dab6275c3c99';
const retiredPatterns = /\/api\/public-intake|\/api\/public-affiliate|calendly|ccc-forensic-demo\.netlify\.app/i;
const commonValues = [
  ['company_id', 'RkJJOWtkS1lYQ243V0Q5d3EybmlMUT09'],
  ['assignedto_id', '32175'],
  ['sales_representative_id', '32175'],
  ['workflow_statusid', '30'],
  ['customer_statusid', '-1'],
];
const leadValues = [
  ['tab_info_id', 'RjFaeDcvSWpqYTJidVdyRDB3WVBsdz09'],
  ['cust_type', '1'],
  ['add_affiliate_flag', '0'],
  ['folder_statusid', '5'],
  ['portalAccess', '0'],
  ['customerAgreementIDs', ''],
];
const affiliateValues = [
  ['tab_info_id', 'MGsvQUNYekVzd01aWlluRlU3Zm9yQT09'],
  ['cust_type', '4'],
  ['add_affiliate_flag', '1'],
  ['folder_statusid', 'null'],
  ['portalAccess', '1'],
  ['customerAgreementIDs', '0'],
];

function assertLockedValues(name, source, values) {
  for (const [field, value] of values) {
    const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const staticField = new RegExp(`name=["']${field}["'][^>]*value=["']${escapedValue}["']`);
    const dynamicField = new RegExp(`hiddenField\\(["']${field}["'],\\s*["']${escapedValue}["']\\)`);
    assert.ok(staticField.test(source) || dynamicField.test(source), `${name} must lock ${field}=${value}`);
  }
}

const load = (name) => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');
const pages = new Map([
  ['freeguide.html', load('freeguide.html')],
  ['affiliate-apply.html', load('affiliate-apply.html')],
  ['join.html', load('join.html')],
  ['join-embed.js', load('join-embed.js')],
]);

for (const [name, source] of pages) {
  assert.doesNotMatch(source, retiredPatterns, `${name} retains a retired public intake, affiliate, Calendly, or Netlify destination`);
  assert.match(source, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${name} must post directly to DisputeFox`);
  assert.match(source, /cancellation-refund-policy/, `${name} must link the cancellation and refund policy`);
  assert.match(source, /avoid (?:a|creating a) duplicate/i, `${name} must suppress unsafe duplicate retries after an uncertain response`);
  assertLockedValues(name, source, commonValues);
}

const guide = pages.get('freeguide.html');
assert.equal((guide.match(new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length >= 3, true,
  'free guide page must use DisputeFox for both the guide gate and consultation');
assert.match(guide, /Source: CCC free guide download/);
assert.match(guide, /Source: CCC free guide consultation/);
assert.match(guide, /GUIDE_DOWNLOAD_URL='\/api\/guide-download'/);
assert.doesNotMatch(guide, /guide-download\?token=/, 'guide cutover must not depend on the retired CCC CRM token');
assert.match(guide, new RegExp(scheduler.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

const partner = pages.get('affiliate-apply.html');
assertLockedValues('affiliate-apply.html', partner, affiliateValues);
for (const field of ['firstName', 'lastName', 'email', 'currentAddress', 'city', 'state', 'zipCode', 'mobilePhone']) {
  assert.match(partner, new RegExp(`name=["']${field}["'][^>]*required`), `affiliate application must require ${field}`);
}
assert.match(partner, /name=["']companyName["']/, 'affiliate application must submit the optional company field');
assert.doesNotMatch(partner, /name=["'](?:textArea1|email1|mobilePhone1|checkbox1)["']/, 'affiliate application must use only the generated affiliate field names and no agreement checkbox');
assert.doesNotMatch(partner, /value=["']RjFaeDcvSWpqYTJidVdyRDB3WVBsdz09["']/, 'affiliate application must not reuse the lead form configuration');
for (const host of ['pulse.disputeprocess.com', 'pulse.scorexer.com', 'creditcomeback.scorexer.com']) {
  assert.match(partner, new RegExp(`['"]${host.replace(/\./g, '\\.')}['"]`), `affiliate handoff must explicitly allow ${host}`);
}
assert.match(partner, /candidate\.protocol\s*!==\s*['"]https:['"]/, 'affiliate handoff must reject non-HTTPS response URLs');
assert.match(partner, /APPROVED_HANDOFF_HOSTS\.has\(candidate\.hostname\)/, 'affiliate handoff must reject arbitrary response hosts');
assert.doesNotMatch(partner, /firstname=|bill_address=|pGUID=/, 'affiliate handoff must not place applicant or password data in a URL');
assert.match(partner, /Application status pending/);

const join = pages.get('join.html');
const embed = pages.get('join-embed.js');
for (const [name, source] of [['freeguide.html', guide], ['join.html', join], ['join-embed.js', embed]]) {
  assert.match(source, /Source: CCC/, `${name} must identify its source in the DisputeFox notes field`);
  assertLockedValues(name, source, leadValues);
}
assert.match(join, /Source: CCC referral landing page/);
assert.match(join, /Referral code:/);
assert.match(embed, /Source: CCC partner embed/);
assert.match(embed, /Referral code:/);

for (const [name, source] of pages) {
  if (!name.endsWith('.html')) continue;
  for (const match of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (match[1].trim()) new Function(match[1]);
  }
}
new Function(embed);

console.log('Public DisputeFox form cutover checks passed.');
