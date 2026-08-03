/**
 * Pure helpers for the client-facing Recovery Blueprint PDF.
 * Opening Move = highest-balance Batch 1 account (fallback: highest overall).
 */

export function accountBalance(account) {
  if (!account) return 0;
  const raw = account.balance;
  if (raw == null || raw === '') return 0;
  const n = Number(String(raw).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function money(n) {
  const v = Number(n) || 0;
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

/** Ensure copy ends with terminal punctuation so PDF never trails mid-thought. */
export function ensureSentence(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  if (/[.!?]"?$/.test(s)) return s;
  return `${s}.`;
}

export function batchAccounts(accounts, batchNum) {
  return (accounts || []).filter((a) => Number(a.batch) === Number(batchNum));
}

export function sumBalances(accounts) {
  return (accounts || []).reduce((sum, a) => sum + accountBalance(a), 0);
}

/**
 * Pick the Month-1 Opening Move: highest balance among Batch 1.
 * If Batch 1 is empty, fall back to highest balance overall.
 */
export function pickOpeningMove(accounts) {
  const list = accounts || [];
  const batch1 = batchAccounts(list, 1);
  const pool = batch1.length ? batch1 : list;
  if (!pool.length) return null;
  return pool.slice().sort((a, b) => accountBalance(b) - accountBalance(a))[0];
}

export function personalInfoLines(personalInfo) {
  const pi = personalInfo || {};
  const lines = [];
  const names = pi.nameVariants || pi.names || [];
  const addresses = pi.formerAddresses || pi.addresses || [];
  const employers = pi.formerEmployers || pi.employers || [];
  if (names.length) lines.push({ label: 'Name variants', value: names.join(', ') });
  if (addresses.length) lines.push({ label: 'Former / variant addresses', value: addresses.join(' · ') });
  if (employers.length) lines.push({ label: 'Employers', value: employers.join(', ') });
  return lines;
}

export function blueprintStats(audit) {
  const accounts = (audit && audit.accounts) || [];
  const batch1 = batchAccounts(accounts, 1);
  const batch2 = batchAccounts(accounts, 2);
  const targeted = Number(audit?.accountsTargeted) || accounts.length || 0;
  const violations = Number(audit?.totalViolations)
    || accounts.reduce((n, a) => n + ((a.violations && a.violations.length) || 0), 0);
  const scanned = Number(audit?.accountsScanned) || 0;
  return {
    accounts,
    batch1,
    batch2,
    targeted,
    violations,
    scanned,
    totalBalance: sumBalances(accounts),
    batch1Balance: sumBalances(batch1),
    batch2Balance: sumBalances(batch2),
    openingMove: pickOpeningMove(accounts),
  };
}

/** Full Opening Move bullet lines — never truncated. */
export function openingMoveBullets(account) {
  if (!account) return [];
  const bullets = [];
  for (const v of account.violations || []) {
    const field = (v && v.field) || 'Accuracy issue';
    const issue = ensureSentence((v && v.issue) || '');
    if (issue) bullets.push({ field, text: issue });
  }
  const strategy = ensureSentence(account.strategy || '');
  if (strategy) bullets.push({ field: 'Campaign', text: strategy });
  return bullets;
}
