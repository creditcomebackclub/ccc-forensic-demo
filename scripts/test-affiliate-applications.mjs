import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { normalizeApplication, normalizeWebsite } = require('../netlify/functions/public-affiliate-application.cjs')._test;

const valid = normalizeApplication({
  name: '  Jordan Partner  ',
  email: 'JORDAN@EXAMPLE.COM ',
  phone: ' 555-0100 ',
  company: ' Partner Co ',
  websiteUrl: 'linkedin.com/in/jordan',
  referralNotes: ' I work with homebuyers. ',
  acknowledged: true,
});
assert.equal(valid.error, undefined);
assert.deepEqual(valid.value, {
  name: 'Jordan Partner',
  email: 'jordan@example.com',
  phone: '555-0100',
  company: 'Partner Co',
  website_url: 'https://linkedin.com/in/jordan',
  referral_notes: 'I work with homebuyers.',
});
assert.equal(normalizeWebsite('javascript:alert(1)'), null);
assert.match(normalizeApplication({ name: 'A', email: 'bad', acknowledged: true }).error, /valid email/i);
assert.match(normalizeApplication({ name: 'A', email: 'a@example.com' }).error, /require approval/i);

const migration = readFileSync(new URL('../supabase/migrations/20260814210000_affiliate_applications.sql', import.meta.url), 'utf8');
assert.match(migration, /create table if not exists public\.affiliate_applications/i);
assert.match(migration, /where status = 'pending'/i);
assert.match(migration, /create or replace function public\.approve_affiliate_application/i);
assert.match(migration, /pg_advisory_xact_lock/i);
assert.match(migration, /role = 'admin'/i);
assert.match(migration, /create or replace function public\.reject_affiliate_application/i);
assert.doesNotMatch(migration, /grant\s+(?:all|insert)[^;]*affiliate_applications\s+to\s+anon/i);

const page = readFileSync(new URL('../public/affiliate-apply.html', import.meta.url), 'utf8');
assert.match(page, /\/api\/public-affiliate-application/);
assert.match(page, /name="faxNumber"/);
assert.match(page, /name="acknowledged"/);
assert.match(page, /Applications are reviewed before portal access is created/i);

const panel = readFileSync(new URL('../src/components/AffiliateApplicationsPanel.jsx', import.meta.url), 'utf8');
assert.match(panel, /approve_affiliate_application/);
assert.match(panel, /reject_affiliate_application/);
assert.match(panel, /provision-user/);
assert.match(panel, /https:\/\/creditcomebackclub\.com\/affiliate\/apply/);

const netlify = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
assert.match(netlify, /from = "\/affiliate\/apply"[\s\S]*to = "\/affiliate-apply\.html"/);
assert.match(netlify, /functions\."public-affiliate-application"/);

const vite = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
assert.match(vite, /affiliate\(\?:\\\/apply\|-apply\\\.html\)/);
assert.match(vite, /\*\*\/affiliate-apply\.html/);

console.log('All affiliate application assertions passed.');
