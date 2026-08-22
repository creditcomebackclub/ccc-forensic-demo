#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const notify = read('../netlify/functions/notify-affiliate.cjs');
const billing = read('../src/components/ClientBillingPanel.jsx');
const affiliatePanel = read('../src/components/AffiliateProfilePanel.jsx');
const cron = read('../netlify/functions/daily-cron.cjs');

assert.match(notify, /if \(!caller\.isSystem && caller\.role !== 'admin'\)/,
  'auditors must never trigger partner PII or financial emails');
assert.match(notify, /const affiliateId = client\.referred_by/);
assert.match(notify, /client\.user_id[\s\S]*affiliate\.owner_user_id/,
  'referral and firm ownership must both match before PII is emailed');
assert.match(notify, /affiliate\.owner_user_id[\s\S]*caller\.userId/,
  'a browser admin may notify only their own partner program');
assert.doesNotMatch(notify, /payload\.(amount|revenueAmount|paidAt|clientName|billingStatus|exitReason|monthKey)/,
  'email financial/status facts may not come from browser payloads');
assert.match(notify, /loadPayout\(payload\.payoutId/);
assert.match(notify, /exactLedgerTransaction\(client, payload\.ledgerTransactionId\)/);
assert.match(notify, /eligibleCollectedAmount\(transaction\)/);
assert.match(notify, /const status = client\.billing_status/);
assert.match(notify, /exitReason: client\.exit_reason/);
assert.match(notify, /const monthKey = previousMonthKey\(\)/);
assert.match(notify, /eventType === 'monthly_summary'[\s\S]*?!caller\.isSystem/);
assert.match(notify, /affiliate_commission_earned:\$\{transaction\.id\}/);
assert.match(notify, /affiliate_commission_paid:\$\{payout\.id\}/);

assert.match(billing, /ledgerTransactionId/);
assert.doesNotMatch(billing, /notifyAffiliate\('commission_earned',[\s\S]{0,180}(?:amount|revenueAmount):/);
assert.match(billing, /\.from\('commission_payouts'\)\.insert\([\s\S]*?\.select\('id'\)\.single\(\)/);
assert.match(billing, /notifyAffiliate\('commission_paid', \{[\s\S]*?payoutId: payout\.id/);
assert.match(affiliatePanel, /\.select\('id'\)\.single\(\)/);
assert.match(affiliatePanel, /notifyAffiliate\('commission_paid', \{[\s\S]*?payoutId: payout\.id/);
assert.match(cron, /JSON\.stringify\(\{ event: 'monthly_summary' \}\)/);
assert.doesNotMatch(cron, /event: 'monthly_summary', monthKey/);

console.log('Affiliate notification ownership and authoritative-record assertions passed.');
