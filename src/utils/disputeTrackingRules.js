export const DISPUTE_RESULT_OPTIONS = [
  { code: 'deleted', label: 'Deleted — win' },
  { code: 'verified', label: 'Verified' },
  { code: 'updated', label: 'Updated, not deleted' },
  { code: 'no_response', label: 'No response' },
  { code: 'duplicate', label: 'Duplicate / recycled letter' },
];

export function disputeAccountKey(account = {}) {
  if (account.accountKey) return String(account.accountKey);
  if (account.clientAccountId) return `client-account:${account.clientAccountId}`;
  if (account.accountId) return `account:${account.accountId}`;
  const furnisher = String(account.furnisher || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `furnisher:${furnisher || 'unknown'}`;
}

export function accountsForTrackedLetter(letter = {}) {
  const snapshots = Array.isArray(letter.dispute_account_snapshot) ? letter.dispute_account_snapshot : [];
  if (snapshots.length) return snapshots.map((account) => ({ ...account, accountKey: disputeAccountKey(account) }));
  const furnishers = Array.isArray(letter.covered_furnishers) && letter.covered_furnishers.length
    ? letter.covered_furnishers
    : [letter.furnisher].filter(Boolean);
  return furnishers.map((furnisher) => ({ furnisher, accountKey: disputeAccountKey({ furnisher }) }));
}
