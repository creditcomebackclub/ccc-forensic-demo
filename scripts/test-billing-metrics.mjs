import assert from 'node:assert/strict';
import {
  calculateActiveRecurringMrr,
  resolveRecurringMonthlyFee,
} from '../src/utils/pricing.js';

const legacyRecurringClient = {
  billingStatus: 'Active',
  billingType: 'Automated Recurring',
  billingTier: null,
  ledger: [{
    type: 'Invoice',
    status: 'Outstanding',
    amount: 50,
    date: '2026-08-08',
    description: 'Monthly Fee',
  }],
};

assert.equal(resolveRecurringMonthlyFee(legacyRecurringClient), 50);
assert.equal(calculateActiveRecurringMrr([legacyRecurringClient]), 50);

// Paying the balance changes receivables/collections, never the recurring
// agreement itself, so the client must remain in MRR at the same amount.
const paidClient = {
  ...legacyRecurringClient,
  ledger: [{
    ...legacyRecurringClient.ledger[0],
    status: 'Paid',
    paid_at: '2026-08-14T19:00:00.000Z',
  }],
};
assert.equal(resolveRecurringMonthlyFee(paidClient), 50);
assert.equal(calculateActiveRecurringMrr([paidClient]), 50);

const configuredCustomClient = {
  ...paidClient,
  billingRecurringAmount: 50,
  ledger: [],
};
assert.equal(resolveRecurringMonthlyFee(configuredCustomClient), 50);
assert.equal(calculateActiveRecurringMrr([configuredCustomClient]), 50);

assert.equal(resolveRecurringMonthlyFee({
  billingStatus: 'Active',
  billingType: 'Automated Recurring',
  billingTier: 'Standard',
  ledger: [],
}), 149);

assert.equal(resolveRecurringMonthlyFee({
  billingStatus: 'Active',
  billingType: 'Automated Recurring',
  billingTier: 'VIP',
  ledger: [],
}), 299);

assert.equal(resolveRecurringMonthlyFee({
  billingStatus: 'Active',
  billingType: 'Automated Recurring',
  billingTier: null,
  billingRecurringAmount: 125,
  ledger: [],
}), 125);

assert.equal(resolveRecurringMonthlyFee({
  billingStatus: 'Active',
  billingType: 'Paid in Full',
  billingTier: 'Standard',
  ledger: paidClient.ledger,
}), 0);

console.log('All billing MRR assertions passed.');
