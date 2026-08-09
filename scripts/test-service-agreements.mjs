import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const agreement = require('../netlify/functions/_serviceAgreement.cjs');

const standard = agreement.planSnapshot({ billing_tier: 'Standard', service_agreement_mode: 'tier' });
assert.equal(standard.label, 'Standard');
assert.match(standard.feeText, /\$79\/month/);
assert.match(standard.feeText, /\$75/);

const custom = agreement.planSnapshot({
  service_agreement_mode: 'custom', service_agreement_label: 'Custom remediation', service_agreement_amount: '325', service_agreement_fee_text: 'Counsel-approved custom milestone terms.',
});
assert.equal(custom.label, 'Custom remediation');
assert.equal(custom.amount, 325);
assert.equal(custom.feeText, 'Counsel-approved custom milestone terms.');

const draft = agreement.renderPacket({ client: { name: 'Jane Client' }, plan: standard, approved: false });
assert.match(draft, /COUNSEL REVIEW REQUIRED/);
assert.match(draft, /970-644-0063/);
assert.match(draft, /81504/);
assert.match(draft, /No payment is created or collected/i);

const one = agreement.randomToken(); const two = agreement.randomToken();
assert.notEqual(one, two);
assert.equal(agreement.sha256(one).length, 64);
assert.match(agreement.renderLpoaOnly({ client: { name: 'Jane Client' }, plan: standard, signedAt: '2026-08-08T12:00:00.000Z', clientSignatureHtml: '<img>', attorneySignatureHtml: '<img>' }), /Limited Power of Attorney/);


console.log('All service-agreement utility assertions passed.');
