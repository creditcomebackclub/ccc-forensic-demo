import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  agreementOpeningInvoicePreview,
  openingInvoiceConfirmation,
} from '../src/utils/manualBilling.js';

const standard = agreementOpeningInvoicePreview({
  mode: 'tier', billingTier: 'Standard', label: 'Standard',
  firstMonthlyPayment: 149,
});
assert.equal(standard.total, 149);
assert.deepEqual(standard.lineItems.map((item) => item.code), [
  'first_monthly_payment',
]);
assert.match(openingInvoiceConfirmation(standard), /Total: \$149\.00/);
assert.match(openingInvoiceConfirmation(standard), /does not charge a payment method/);

const vip = agreementOpeningInvoicePreview({
  mode: 'tier', billingTier: 'VIP', label: 'VIP',
  firstMonthlyPayment: 315.25,
});
assert.equal(vip.total, 315.25, 'the frozen monthly override must be used, not a hard-coded tier total');

const legacyV2 = agreementOpeningInvoicePreview({
  mode: 'tier', billingTier: 'Standard', label: 'Standard',
  firstWorkFee: 75, firstMonthlyPayment: 79,
});
assert.equal(legacyV2.total, 154, 'an immutable v2 agreement keeps the exact signed opening terms');
assert.deepEqual(legacyV2.lineItems.map((item) => item.code), ['first_work_fee', 'first_monthly_payment']);
assert.throws(() => agreementOpeningInvoicePreview({
  mode: 'tier', billingTier: 'Standard', label: 'Standard',
  firstWorkFee: 75, firstMonthlyPayment: 79,
}, {
  templateVersion: 'ccc-service-agreement-v2-service-only', status: 'sent',
}), /unsigned legacy agreement uses retired pricing/i);

const historicalPaidInFullSnapshot = {
  mode: 'tier', billingTier: 'Paid In Full', label: 'Paid In Full', flatFee: 997,
};
assert.equal(
  agreementOpeningInvoicePreview(historicalPaidInFullSnapshot).total,
  997,
  'an immutable historical signed snapshot keeps its original $997 amount',
);
const customMonthly = agreementOpeningInvoicePreview({
  mode: 'custom', label: 'Custom monthly support', amount: 225,
  billingType: 'Automated Recurring', monthlyFee: 225, flatFee: null,
});
assert.equal(customMonthly.total, 225);
assert.deepEqual(customMonthly.lineItems, [{
  code: 'custom_first_monthly_payment',
  description: 'Custom monthly support — First Monthly Payment',
  amount: 225,
}]);
assert.match(openingInvoiceConfirmation(customMonthly), /Custom monthly support — First Monthly Payment: \$225\.00/);
const customOneTime = agreementOpeningInvoicePreview({
  mode: 'custom', label: 'Late pay package', amount: 150,
  billingType: 'Paid in Full', flatFee: 150, monthlyFee: null,
});
assert.equal(customOneTime.total, 150);
assert.deepEqual(customOneTime.lineItems, [{
  code: 'custom_paid_in_full_service',
  description: 'Late pay package — One-Time Service',
  amount: 150,
}]);
assert.match(openingInvoiceConfirmation(customOneTime), /Late pay package — One-Time Service: \$150\.00/);
assert.throws(() => agreementOpeningInvoicePreview({
  mode: 'custom', label: 'Outcome based', amount: null,
  billingType: 'Paid in Full', flatFee: null,
}),
  /missing/);
assert.throws(() => agreementOpeningInvoicePreview({
  mode: 'custom', label: 'Cross-shaped monthly', amount: 225,
  billingType: 'Automated Recurring', monthlyFee: 225, flatFee: 225,
}), /cannot contain a flat fee/i);
assert.throws(() => agreementOpeningInvoicePreview({
  mode: 'custom', label: 'Mismatch', amount: 225,
  billingType: 'Paid in Full', flatFee: 200, monthlyFee: null,
}), /does not match/i);
assert.throws(() => agreementOpeningInvoicePreview({
  mode: 'custom', label: 'Sub-cent monthly', amount: 225.001,
  billingType: 'Automated Recurring', monthlyFee: 225.001, flatFee: null,
}), /cent-exact/i);
assert.throws(() => agreementOpeningInvoicePreview({
  mode: 'tier', billingTier: 'Standard', firstMonthlyPayment: null,
}), /First Monthly Payment/);

const cron = readFileSync(new URL('../netlify/functions/daily-cron.cjs', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260820300000_owner_controlled_billing.sql', import.meta.url), 'utf8');
const retirementMigration = readFileSync(new URL('../supabase/migrations/20260820360000_retire_first_work_fee.sql', import.meta.url), 'utf8');
const customInvoiceMigration = readFileSync(new URL('../supabase/migrations/20260820480000_custom_billing_invoice_integrity.sql', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../src/components/ClientBillingPanel.jsx', import.meta.url), 'utf8');
const manualBilling = readFileSync(new URL('../src/utils/manualBilling.js', import.meta.url), 'utf8');

assert.doesNotMatch(cron, /claimBillingInvoice|claim_billing_invoice/);
assert.doesNotMatch(cron, /billing_invoice_due_today|billing_service_paused|billing_pre_due_[35]/);
assert.doesNotMatch(cron, /Initial Month & First Work Fee|VIP Initial Month/);
assert.doesNotMatch(cron, /billing_status:\s*'Paused'/);
assert.match(cron, /Read Owner-Controlled Billing Alerts/);
assert.match(cron, /select=id,name,ledger/);

assert.match(migration, /revoke execute on function public\.claim_billing_invoice[\s\S]*from service_role/);
assert.match(migration, /create table if not exists public\.manual_agreement_invoice_commands/);
assert.match(migration, /create or replace function public\.ccc_create_manual_agreement_invoice/);
assert.match(migration, /v_role is distinct from 'admin'/);
assert.doesNotMatch(migration, /v_role not in \('admin', 'auditor'\)/);
assert.match(migration, /v_template\.packet_kind is distinct from 'service_agreement_only'/);
assert.match(migration, /first_work_fee/);
assert.match(migration, /first_monthly_payment/);
assert.match(migration, /v_ledger \|\| jsonb_build_array\(v_invoice\)/);
assert.match(migration, /create table if not exists public\.client_ledger_events/);
assert.match(migration, /create or replace function public\.ccc_mutate_client_ledger/);
assert.match(migration, /v_current is distinct from p_expected_ledger/);
assert.match(migration, /Agreement opening invoices cannot be edited or deleted/);
assert.match(migration, /ccc_guard_client_ledger_update_trigger/);
assert.match(migration, /set_config\('ccc\.ledger_write_authorized', 'on', true\)/);
assert.doesNotMatch(migration, /set\s+(billing_status|engagement_status)/i);
assert.match(migration, /Never charges, emails, pauses, or authorizes service/);

assert.match(retirementMigration, /create or replace function public\.ccc_create_manual_agreement_invoice/);
assert.match(retirementMigration, /v_agreement\.template_version = 'ccc-service-agreement-v2-service-only'/);
assert.match(retirementMigration, /Unsigned legacy agreements use retired pricing/);
assert.match(retirementMigration, /v_description := v_label \|\| ' - First Monthly Payment'/);
assert.match(retirementMigration, /New agreement snapshots cannot contain a retired First Work Fee/);
assert.match(retirementMigration, /v_description := v_label \|\| ' - Paid In Full Service'/);
assert.doesNotMatch(retirementMigration, /update public\.manual_agreement_invoice_commands|delete from public\.manual_agreement_invoice_commands/i);

assert.match(customInvoiceMigration, /create or replace function public\.ccc_create_manual_agreement_invoice/);
assert.match(customInvoiceMigration, /for update/);
assert.match(customInvoiceMigration, /where request_key = p_request_key/);
assert.match(customInvoiceMigration, /where agreement_id = p_agreement_id/);
assert.match(customInvoiceMigration, /v_billing_type := nullif\(btrim\(v_plan ->> 'billingType'\), ''\)/);
assert.match(customInvoiceMigration, /custom_first_monthly_payment/);
assert.match(customInvoiceMigration, /Custom monthlyFee must match the frozen agreement amount/);
assert.match(customInvoiceMigration, /custom_paid_in_full_service/);
assert.match(customInvoiceMigration, /Custom flatFee must match the frozen agreement amount/);
assert.match(customInvoiceMigration, /v_label \|\| ' — First Monthly Payment'/);
assert.match(customInvoiceMigration, /v_label \|\| ' — One-Time Service'/);
assert.match(customInvoiceMigration, /Paid In Full must cover exactly 6 months of Standard service/);
assert.match(customInvoiceMigration, /Paid In Full must freeze the Standard service scope/);
assert.match(customInvoiceMigration, /v_agreement\.template_version = 'ccc-service-agreement-v2-service-only'[\s\S]*round\(\(v_plan ->> 'firstWorkFee'\)::numeric, 2\)/,
  'signed v2 invoice snapshots must preserve their historical rounding path');
assert.match(customInvoiceMigration, /from public, anon, authenticated, service_role/);
assert.match(customInvoiceMigration, /grant execute[\s\S]*to authenticated/);
assert.doesNotMatch(customInvoiceMigration, /set\s+(billing_status|engagement_status|program_status)/i);
assert.doesNotMatch(customInvoiceMigration, /send_email|net\.http|stripe|payment_method/i);

assert.match(panel, /Create opening invoice/);
assert.match(panel, /ccc_create_manual_agreement_invoice/);
assert.match(panel, /mutateClientLedger/);
assert.match(panel, /isAdmin \? <div/);
assert.match(panel, /Agreement invoice terms are immutable/);
assert.match(panel, /openingInvoiceConfirmation/);
assert.match(panel, /It records a ledger invoice and never charges automatically/);
assert.match(panel, /Start onboarding/);
assert.match(panel, /It never creates a payment/);
assert.doesNotMatch(panel, /Add matching ledger invoice|addMatchingInvoice/);
assert.match(manualBilling, /custom_first_monthly_payment/);
assert.match(manualBilling, /custom_paid_in_full_service/);
assert.doesNotMatch(manualBilling, /custom_service_package/);

console.log('Owner-controlled billing and exact opening-invoice assertions passed.');
