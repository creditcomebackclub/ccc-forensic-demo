function money(value, label, { allowZero = false, centExact = false } = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || (allowZero ? amount < 0 : amount <= 0)) {
    throw new Error(`${label} is missing from the agreement pricing snapshot.`);
  }
  if (centExact && !/^[0-9]+(?:\.[0-9]{1,2})?$/.test(String(value).trim())) {
    throw new Error(`${label} must be fixed and cent-exact.`);
  }
  return Math.round(amount * 100) / 100;
}

/**
 * Read-only preview of the server-authoritative opening invoice calculation.
 * The database repeats this validation before writing the ledger; this helper
 * exists only so staff can see and confirm the exact action first.
 */
export function agreementOpeningInvoicePreview(plan, agreementContext = {}) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('The agreement pricing snapshot is unavailable.');
  }

  const label = String(plan.label || plan.billingTier || 'Service package').trim();
  if (plan.mode === 'tier' && ['Standard', 'VIP'].includes(plan.billingTier)) {
    const firstMonthlyPayment = money(plan.firstMonthlyPayment, 'First Monthly Payment');
    // Immutable v2 snapshots carry firstWorkFee and must continue to preview
    // exactly what the client signed. New v3 snapshots omit that field and
    // create an opening invoice for the first monthly payment only.
    if (plan.firstWorkFee != null) {
      if (agreementContext.templateVersion === 'ccc-service-agreement-v2-service-only'
          && agreementContext.status
          && agreementContext.status !== 'signed') {
        throw new Error('This unsigned legacy agreement uses retired pricing. Prepare the current agreement instead.');
      }
      const firstWorkFee = money(plan.firstWorkFee, 'First Work Fee', { allowZero: true });
      return {
        description: `${label} — First Work Fee + First Monthly Payment`,
        total: Math.round((firstWorkFee + firstMonthlyPayment) * 100) / 100,
        lineItems: [
          { code: 'first_work_fee', description: 'First Work Fee', amount: firstWorkFee },
          { code: 'first_monthly_payment', description: 'First Monthly Payment', amount: firstMonthlyPayment },
        ],
      };
    }
    return {
      description: `${label} — First Monthly Payment`,
      total: firstMonthlyPayment,
      lineItems: [
        { code: 'first_monthly_payment', description: 'First Monthly Payment', amount: firstMonthlyPayment },
      ],
    };
  }

  if (plan.mode === 'tier' && plan.billingTier === 'Paid In Full') {
    const flatFee = money(plan.flatFee, 'Paid In Full Service amount');
    return {
      description: `${label} — Paid In Full Service`,
      total: flatFee,
      lineItems: [{ code: 'paid_in_full_service', description: 'Paid In Full Service', amount: flatFee }],
    };
  }

  if (plan.mode === 'custom') {
    const amount = money(plan.amount, 'Custom agreement amount', { centExact: true });
    if (plan.billingType === 'Automated Recurring') {
      const monthlyFee = money(plan.monthlyFee, 'Custom monthly agreement amount', { centExact: true });
      if (monthlyFee !== amount) {
        throw new Error('Custom monthlyFee does not match the frozen agreement amount.');
      }
      if (plan.flatFee != null) {
        throw new Error('Custom monthly agreements cannot contain a flat fee.');
      }
      const description = `${label} — First Monthly Payment`;
      return {
        description,
        total: amount,
        lineItems: [{ code: 'custom_first_monthly_payment', description, amount }],
      };
    }
    if (plan.billingType === 'Paid in Full') {
      const flatFee = money(plan.flatFee, 'Custom one-time agreement amount', { centExact: true });
      if (flatFee !== amount) {
        throw new Error('Custom flatFee does not match the frozen agreement amount.');
      }
      if (plan.monthlyFee != null) {
        throw new Error('Custom one-time agreements cannot contain a monthly fee.');
      }
      const description = `${label} — One-Time Service`;
      return {
        description,
        total: amount,
        lineItems: [{ code: 'custom_paid_in_full_service', description, amount }],
      };
    }
    throw new Error('Custom agreement billing schedule is missing from the frozen agreement.');
  }

  throw new Error('This agreement does not have a fixed opening-invoice amount. Use Add Transaction instead.');
}

export function openingInvoiceConfirmation(preview) {
  const lines = preview.lineItems
    .map((item) => `${item.description}: $${Number(item.amount).toFixed(2)}`)
    .join('\n');
  return `Create this ledger invoice?\n\n${lines}\n\nTotal: $${Number(preview.total).toFixed(2)}\n\nThis records an invoice only. It does not charge a payment method.`;
}

/**
 * Owner-only optimistic ledger mutation. The database row-locks the client,
 * rejects a stale browser snapshot, protects agreement-created invoices, and
 * appends an immutable audit event before returning the authoritative ledger.
 */
export async function mutateClientLedger({
  clientId,
  expectedLedger,
  operation,
  transactionId,
  changes = {},
}) {
  if (!clientId || !transactionId) throw new Error('Client and transaction are required.');
  const { supabase } = await import('./supabase.js');
  const { data, error } = await supabase.rpc('ccc_mutate_client_ledger', {
    p_client_id: clientId,
    p_expected_ledger: Array.isArray(expectedLedger) ? expectedLedger : [],
    p_operation: operation,
    p_transaction_id: transactionId,
    p_changes: changes || {},
  });
  if (error) throw error;
  if (!Array.isArray(data?.ledger)) throw new Error('The ledger command returned no authoritative ledger.');
  return data;
}
