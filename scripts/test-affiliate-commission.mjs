#!/usr/bin/env node
// Focused fixtures for cash recognition / commission (NMI double-count guard).
import assert from 'node:assert/strict';
import {
  computeClientCommission,
  recognizedTotal,
  recognizedTransactions,
} from '../src/utils/affiliateCommission.js';

const affiliate = { commission_rate: 0.20 };

function approx(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 0.005, `${label}: expected ${expected}, got ${actual}`);
}

{
  // NMI success shape: Invoice Paid + Payment, same nmi / payment ids.
  const ledger = [
    {
      id: 'inv-1',
      type: 'Invoice',
      status: 'Paid',
      amount: 154,
      date: '2026-08-01',
      paid_at: '2026-08-01T18:00:00.000Z',
      description: 'Initial Month & First Work Fee',
      nmi_transaction_id: 'txn_abc',
      payment_transaction_id: 'pt_1',
      source: 'nmi',
    },
    {
      id: 'pay-1',
      type: 'Payment',
      status: 'Paid',
      amount: 154,
      date: '2026-08-01',
      description: 'Card payment (NMI)',
      nmi_transaction_id: 'txn_abc',
      payment_transaction_id: 'pt_1',
      source: 'nmi',
    },
  ];
  const client = { ledger, referral_fee: null };
  approx(recognizedTotal(client), 154, 'NMI linked total');
  assert.equal(recognizedTransactions(client).length, 1, 'NMI linked row count');
  const { earned } = computeClientCommission(client, affiliate, []);
  approx(earned, 154 * 0.20, 'NMI linked commission');
}

{
  // Legacy mark-Paid only (no Payment row) still counts once.
  const ledger = [
    {
      id: 'inv-legacy',
      type: 'Invoice',
      status: 'Paid',
      amount: 79,
      date: '2026-06-01',
      paid_at: '2026-06-05T12:00:00.000Z',
      description: 'Standard Monthly Service Fee',
    },
  ];
  const client = { ledger };
  approx(recognizedTotal(client), 79, 'legacy mark-paid total');
  const { earned } = computeClientCommission(client, affiliate, []);
  approx(earned, 79 * 0.20, 'legacy mark-paid commission');
}

{
  // Same-day same-amount without gateway ids (loose match) — still once.
  const ledger = [
    {
      id: 'inv-2',
      type: 'Invoice',
      status: 'Paid',
      amount: 149,
      date: '2026-07-15',
      paid_at: '2026-07-15T10:00:00.000Z',
      description: 'VIP Monthly Service Fee',
    },
    {
      id: 'pay-2',
      type: 'Payment',
      status: 'Paid',
      amount: 149,
      date: '2026-07-15',
      description: 'Payment Received',
      source: 'manual',
    },
  ];
  approx(recognizedTotal({ ledger }), 149, 'loose same-day total');
}

{
  // Two distinct cash events must both count.
  const ledger = [
    {
      id: 'inv-a',
      type: 'Invoice',
      status: 'Paid',
      amount: 154,
      date: '2026-05-01',
      paid_at: '2026-05-01T12:00:00.000Z',
      nmi_transaction_id: 'txn_1',
      payment_transaction_id: 'pt_a',
    },
    {
      id: 'pay-a',
      type: 'Payment',
      amount: 154,
      date: '2026-05-01',
      nmi_transaction_id: 'txn_1',
      payment_transaction_id: 'pt_a',
    },
    {
      id: 'inv-b',
      type: 'Invoice',
      status: 'Paid',
      amount: 79,
      date: '2026-06-01',
      paid_at: '2026-06-01T12:00:00.000Z',
      nmi_transaction_id: 'txn_2',
      payment_transaction_id: 'pt_b',
    },
    {
      id: 'pay-b',
      type: 'Payment',
      amount: 79,
      date: '2026-06-01',
      nmi_transaction_id: 'txn_2',
      payment_transaction_id: 'pt_b',
    },
  ];
  approx(recognizedTotal({ ledger }), 154 + 79, 'two NMI months total');
  const { earned } = computeClientCommission({ ledger }, affiliate, []);
  approx(earned, (154 + 79) * 0.20, 'two NMI months commission');
}

{
  // Unpaid invoice must not count.
  const ledger = [
    { id: 'inv-due', type: 'Invoice', status: 'Due', amount: 79, date: '2026-08-01' },
  ];
  approx(recognizedTotal({ ledger }), 0, 'due invoice total');
}

console.log('test-affiliate-commission: all fixtures passed');
