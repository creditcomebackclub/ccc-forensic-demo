import { normalizeFurnisher, lastFour } from './diffEngine.js';
import { supabase } from './supabase.js';

const BUREAU_CODE = { EQ: 'equifax', EXP: 'experian', TU: 'transunion' };
export const BUREAU_LABEL = { equifax: 'Equifax', experian: 'Experian', transunion: 'TransUnion' };

/**
 * Resolve only bureaus positively present on the latest audit tradeline.
 * Positional account IDs are never authoritative; ambiguity blocks.
 */
export async function resolveActiveBureaus({ clientId, clientName, clientAccountId, accountId, furnisher }) {
  if (!clientId && !clientName) throw new Error('A client identity is required to resolve reporting bureaus.');
  const query = supabase.from('audits').select('id,report_date,saved_at,audit').order('saved_at', { ascending: false }).limit(1);
  const { data, error } = clientId
    ? await query.eq('client_id', clientId)
    : await query.eq('client_name', clientName);
  if (error) throw new Error('Could not load the latest audit: ' + error.message);
  const auditRecord = data?.[0] || null;
  const accounts = auditRecord?.audit?.accounts || [];
  if (!accounts.length) throw new Error('No audit is available for this client.');

  let account = null;
  if (clientAccountId) {
    account = accounts.find((item) => item.clientAccountId === clientAccountId) || null;
    if (!account) {
      throw new Error('The linked account identity is not present in the latest audit. Reconcile it before starting a bureau round.');
    }
  } else {
    const exactMasked = accountId
      ? accounts.filter((item) => item.accountNumberMasked && item.accountNumberMasked === accountId)
      : [];
    if (exactMasked.length === 1) account = exactMasked[0];
    else {
      const byName = accounts.filter((item) => normalizeFurnisher(item.furnisher) === normalizeFurnisher(furnisher));
      if (byName.length === 1) account = byName[0];
      else if (byName.length > 1) {
        const suffix = lastFour(accountId);
        const narrowed = suffix ? byName.filter((item) => lastFour(item.accountNumberMasked) === suffix) : [];
        if (narrowed.length === 1) account = narrowed[0];
        else throw new Error(`Cannot disambiguate ${byName.length} accounts from “${furnisher}”. Link the legacy letter to a stable account first.`);
      }
    }
  }
  if (!account) throw new Error(`No current audit account matches “${furnisher}”. Nothing was generated.`);

  const active = [...new Set((account.bureaus || []).map((code) => BUREAU_CODE[code]).filter(Boolean))];
  if (!active.length) throw new Error('The matched account has no positively identified reporting bureau. Nothing was generated.');
  return {
    account,
    activeBureaus: active,
    auditId: auditRecord?.id || null,
    auditReportDate: auditRecord?.report_date || null,
    auditSavedAt: auditRecord?.saved_at || null,
  };
}
