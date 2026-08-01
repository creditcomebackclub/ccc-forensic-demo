/**
 * CCC forensic post-guards, copied for Fieldwork isolation.
 * (Same logic as audit-run-background.mjs — avoid importing the agency handler.)
 */

export function parseLooseDate(text) {
  if (!text) return null;
  const s = String(text);
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  const mdy = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (mdy) return new Date(Date.UTC(+mdy[3], +mdy[1] - 1, +mdy[2]));
  const my = s.match(/\b(\d{1,2})\/(\d{4})\b/);
  if (my) return new Date(Date.UTC(+my[2], +my[1] - 1, 1));
  const monthName = s.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b\.?\s+(\d{1,2},?\s+)?(\d{4})\b/i);
  if (monthName) {
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const m = months.indexOf(monthName[1].toLowerCase());
    const day = monthName[2] ? parseInt(monthName[2], 10) : 1;
    return new Date(Date.UTC(+monthName[3], m, day));
  }
  return null;
}

function extractDollarAmounts(text) {
  if (!text) return [];
  const matches = String(text).matchAll(/\$\s?([\d,]+(?:\.\d{2})?)/g);
  return [...matches].map((m) => parseFloat(m[1].replace(/,/g, '')));
}

export function applyCollectionBalanceGuard(accounts) {
  const suppressed = [];
  for (const acct of accounts || []) {
    if (acct.type !== 'C') continue;
    const kept = [];
    for (const v of acct.violations || []) {
      const isBalanceField = /\bfield\s*2[12]\b|current balance|amount past due/i.test(v.field || '');
      if (isBalanceField) {
        let amounts = extractDollarAmounts(v.currentlyReports);
        if (amounts.length < 2) amounts = extractDollarAmounts(`${v.currentlyReports || ''} ${v.issue || ''}`);
        const unique = [...new Set(amounts)];
        if (amounts.length >= 2 && unique.length === 1) {
          suppressed.push({
            accountId: acct.id,
            furnisher: acct.furnisher,
            field: v.field,
            amount: unique[0],
            reason: 'Current Balance equals Amount Past Due on a collection account — suppressed.',
          });
          continue;
        }
      }
      kept.push(v);
    }
    acct.violations = kept;
  }
  return suppressed;
}

export function applyDofdDirectionalGuard(accounts) {
  const suppressed = [];
  for (const acct of accounts || []) {
    const kept = [];
    for (const v of acct.violations || []) {
      const isDofd = /\b25\b|DOFD|date of first delinquency/i.test(v.field || '');
      if (isDofd) {
        const reported = parseLooseDate(v.currentlyReports);
        const asserted = parseLooseDate(v.shouldReport);
        if (reported && asserted && asserted.getTime() > reported.getTime()) {
          suppressed.push({
            accountId: acct.id,
            furnisher: acct.furnisher,
            field: v.field,
            reportedDOFD: v.currentlyReports,
            assertedDOFD: v.shouldReport,
            reason: 'Asserted DOFD later than reported — adverse; suppressed.',
          });
          continue;
        }
      }
      kept.push(v);
    }
    acct.violations = kept;
  }
  return suppressed;
}
