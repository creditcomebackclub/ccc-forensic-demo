import crypto from 'node:crypto';
import { buildDeterministicAudit } from '../../src/utils/deterministicAudit.js';
import {
  buildClassificationReviewSnapshot,
  buildInitialAccountTrackStates,
  canonicalClassificationReviewSnapshotJson,
  canonicalClassificationRoutesJson,
  classificationRoutesFromStates,
  CLASSIFICATION_REVIEW_METHOD_VERSION,
} from '../../src/utils/disputeFlow.js';

export const ZERO_CREDIT_CLIENT_ID = '22222222-2222-4222-8222-222222222222';

const client = {
  id: ZERO_CREDIT_CLIENT_ID,
  name: 'Jordan Zero Credit Fixture',
  address: '125 Test Mesa Road, Grand Junction, CO 81504',
  reportDate: '2026-08-20',
};

function evidence(row) {
  return [
    'furnisher', 'originalCreditor', 'reportedType', 'accountType', 'accountStatus',
    'statusText', 'balance', 'paymentHistory', 'remarks',
  ].filter((field) => row[field] !== null && row[field] !== undefined && row[field] !== '')
    .map((field) => ({ field, rawValue: row[field], page: 4, label: field }));
}

function account(overrides) {
  const row = {
    furnisher: 'Fixture Bank',
    originalCreditor: 'Fixture Bank',
    accountNumber: 'XXXX0000',
    reportedType: 'Installment account',
    accountType: '00',
    accountStatus: '11',
    statusText: 'Current',
    dateOpened: '2021-03-01',
    balance: 0,
    paymentHistory: 'OK OK OK',
    remarks: null,
    ...overrides,
  };
  row.evidence = evidence(row);
  return row;
}

const collection = account({
  furnisher: 'Mesa Recovery Services',
  originalCreditor: 'Western Utility Company',
  accountNumber: 'XXXX4101',
  reportedType: 'Collection account',
  accountType: '48',
  accountStatus: '93',
  statusText: 'Placed for collection',
  balance: 684,
  paymentHistory: null,
});

const chargeOff = account({
  furnisher: 'Frontier Card Bank',
  originalCreditor: 'Frontier Card Bank',
  accountNumber: 'XXXX5202',
  reportedType: 'Revolving account',
  accountType: '18',
  accountStatus: '97',
  statusText: 'Charged off',
  balance: 2135,
  paymentHistory: '30 60 90 CO',
});

function late(history) {
  return account({
    furnisher: 'High Desert Auto Finance',
    originalCreditor: 'High Desert Auto Finance',
    accountNumber: 'XXXX6303',
    reportedType: 'Auto installment loan',
    accountType: '00',
    accountStatus: '11',
    statusText: 'Current with historical late payments',
    balance: 8790,
    paymentHistory: history,
  });
}

function bureauReport(bureau, lateHistory) {
  return {
    bureau,
    client,
    scores: bureau === 'equifax' ? { equifax: 602 } : bureau === 'experian' ? { experian: 617 } : { transunion: 594 },
    accounts: [collection, chargeOff, late(lateHistory)],
    inquiries: [],
    personalInfo: {
      currentAddress: client.address,
      formerAddresses: ['44 Prior Avenue, Fruita, CO 81521'],
      nameVariants: ['Jordan Z Fixture'],
      formerEmployers: [],
    },
  };
}

export function zeroCreditBureauExtractions() {
  return [
    bureauReport('equifax', 'Jan 2026 OK Feb 2026 30 Mar 2026 OK'),
    bureauReport('experian', 'Jan 2026 30 Feb 2026 60 Mar 2026 90'),
    bureauReport('transunion', 'Jan 2026 OK Feb 2026 30 Mar 2026 60'),
  ];
}

export function makeZeroCreditReviewedAudit() {
  const built = buildDeterministicAudit(zeroCreditBureauExtractions());
  const idsBySuffix = {
    4101: '11111111-1111-4111-8111-111111111111',
    5202: '33333333-3333-4333-8333-333333333333',
    6303: '44444444-4444-4444-8444-444444444444',
  };
  const baseAudit = {
    ...built,
    id: 'audit-zero-credit-3b-2026-08-20',
    client: { ...built.client, ...client },
    scores: { equifax: 602, experian: 617, transunion: 594 },
    accounts: built.accounts.map((row) => {
      const suffix = String(row.accountNumberMasked || '').slice(-4);
      return {
        ...row,
        clientAccountId: idsBySuffix[suffix],
        classificationAttested: true,
        routingFacts: {
          ...row.routingFacts,
          source: 'staff_review',
          staffAttested: true,
          reviewedAt: '2026-08-20T19:00:00.000Z',
          reviewedBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      };
    }),
  };
  const routes = classificationRoutesFromStates(buildInitialAccountTrackStates(baseAudit));
  const routingSnapshot = buildClassificationReviewSnapshot(baseAudit, routes);
  const routingSnapshotCanonical = canonicalClassificationReviewSnapshotJson(routingSnapshot);
  return {
    ...baseAudit,
    classificationReview: {
      status: 'confirmed',
      version: 1,
      auditId: baseAudit.id,
      clientId: ZERO_CREDIT_CLIENT_ID,
      reviewedAt: '2026-08-20T19:00:00.000Z',
      reviewedBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      methodVersion: CLASSIFICATION_REVIEW_METHOD_VERSION,
      routes,
      routesSha256: crypto.createHash('sha256').update(canonicalClassificationRoutesJson(routes)).digest('hex'),
      routingSnapshot,
      routingSnapshotCanonical,
      routingSnapshotSha256: crypto.createHash('sha256').update(routingSnapshotCanonical).digest('hex'),
    },
  };
}
