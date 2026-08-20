import assert from 'node:assert/strict';
import {
  USPS_CERTIFIED_RETURN_RECEIPT,
  USPS_FIRST_CLASS,
  cccReviewClock,
  cccRoundNumber,
  isFirstClassCccLetter,
  mailServiceForLetter,
  requiresCccR1IdentityDocuments,
} from '../src/utils/cccMailRules.js';

const cccR1 = { phase: 'CCC Dispute — Accuracy R1 — Equifax', disputeRoundNumber: 1 };
const cccR2 = { phase: 'CCC Dispute — Accuracy R2 — Equifax', disputeRoundNumber: 2 };
const legacy = { phase: 'Phase 1 — Direct Furnisher' };

assert.equal(cccRoundNumber(cccR1), 1);
assert.equal(cccRoundNumber({ phase: 'CCC Dispute — Collection R12 — TransUnion' }), 12);
assert.equal(requiresCccR1IdentityDocuments(cccR1), true);
assert.equal(requiresCccR1IdentityDocuments(cccR2), false);
assert.equal(requiresCccR1IdentityDocuments(legacy), false);
assert.equal(mailServiceForLetter(cccR1), USPS_FIRST_CLASS);
assert.equal(mailServiceForLetter(legacy), USPS_CERTIFIED_RETURN_RECEIPT);
assert.equal(isFirstClassCccLetter(cccR1), true);
assert.deepEqual(
  cccReviewClock({ ...cccR1, deliveredAt: '2026-08-20T18:00:00Z', expectedDeliveryDate: '2026-08-25' }),
  { start: '2026-08-20', basis: 'delivered' },
);
assert.deepEqual(
  cccReviewClock({ ...cccR1, expected_delivery_date: '2026-08-25' }),
  { start: '2026-08-25', basis: 'expected_delivery' },
);
assert.deepEqual(cccReviewClock(legacy), { start: null, basis: null });

console.log('CCC mail rules passed.');
