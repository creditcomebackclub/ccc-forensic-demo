// Deterministic merge of per-chunk bureau / audit extractions from a split PDF.
// Chunks may overlap at page boundaries, so accounts and inquiries are keyed
// and deduped rather than concatenated blindly.
import { lastFour, normalizeFurnisher } from './diffEngine.js';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function preferString(a, b) {
  if (nonEmpty(a) && !nonEmpty(b)) return a;
  if (nonEmpty(b) && !nonEmpty(a)) return b;
  if (nonEmpty(a) && nonEmpty(b)) return a.length >= b.length ? a : b;
  return a ?? b ?? null;
}

function preferNumber(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.max(a, b);
  if (typeof a === 'number') return a;
  if (typeof b === 'number') return b;
  return a ?? b ?? null;
}

function uniqStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const key = String(value || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(value).trim());
  }
  return out;
}

function accountMergeKey(account) {
  const furnisher = normalizeFurnisher(account?.furnisher || account?.originalCreditor || '');
  const masked = account?.accountNumber || account?.accountNumberMasked || '';
  const four = lastFour(masked);
  if (furnisher && four) return `${furnisher}::${four}`;
  if (furnisher && nonEmpty(masked)) return `${furnisher}::${String(masked).replace(/\s+/g, '').toUpperCase()}`;
  if (nonEmpty(account?.id)) return `id::${String(account.id).trim().toUpperCase()}`;
  return `furn::${furnisher || 'UNKNOWN'}::${String(account?.status || '')}::${String(account?.balance ?? '')}`;
}

function inquiryMergeKey(inquiry) {
  const furnisher = normalizeFurnisher(inquiry?.furnisher || '');
  const date = String(inquiry?.date || '').trim();
  return `${furnisher}::${date}`;
}

function violationMergeKey(violation) {
  return [
    String(violation?.field || '').trim().toLowerCase(),
    String(violation?.currentValue || violation?.currentlyReports || '').trim().toLowerCase(),
    String(violation?.expectedValue || violation?.shouldReport || '').trim().toLowerCase(),
  ].join('::');
}

function mergeViolations(aList, bList) {
  const map = new Map();
  for (const list of [aList || [], bList || []]) {
    for (const violation of list) {
      if (!violation || typeof violation !== 'object') continue;
      const key = violationMergeKey(violation);
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { ...violation });
        continue;
      }
      map.set(key, {
        ...prev,
        ...violation,
        reason: preferString(prev.reason, violation.reason),
        issue: preferString(prev.issue, violation.issue),
        statute: preferString(prev.statute, violation.statute),
        severity: preferString(prev.severity, violation.severity),
      });
    }
  }
  return Array.from(map.values());
}

function richness(account) {
  const violations = Array.isArray(account?.violations) ? account.violations.length : 0;
  const filled = [
    account?.furnisher, account?.accountNumber, account?.accountNumberMasked,
    account?.status, account?.paymentHistory, account?.remarks, account?.dofd,
    account?.lastPaymentDate, account?.strategy, account?.primaryViolation,
  ].filter(nonEmpty).length;
  return violations * 10 + filled;
}

function mergeAccountRecords(a, b) {
  const primary = richness(a) >= richness(b) ? a : b;
  const secondary = primary === a ? b : a;
  return {
    ...secondary,
    ...primary,
    furnisher: preferString(primary.furnisher, secondary.furnisher),
    originalCreditor: preferString(primary.originalCreditor, secondary.originalCreditor),
    accountNumber: preferString(primary.accountNumber, secondary.accountNumber),
    accountNumberMasked: preferString(primary.accountNumberMasked, secondary.accountNumberMasked),
    type: preferString(primary.type, secondary.type),
    status: preferString(primary.status, secondary.status),
    balance: preferNumber(primary.balance, secondary.balance) ?? primary.balance ?? secondary.balance ?? 0,
    pastDue: preferNumber(primary.pastDue, secondary.pastDue) ?? primary.pastDue ?? secondary.pastDue ?? 0,
    lastPaymentDate: preferString(primary.lastPaymentDate, secondary.lastPaymentDate),
    dofd: preferString(primary.dofd, secondary.dofd),
    dateOfFirstDelinquency: preferString(primary.dateOfFirstDelinquency, secondary.dateOfFirstDelinquency),
    paymentHistory: preferString(primary.paymentHistory, secondary.paymentHistory),
    remarks: preferString(primary.remarks, secondary.remarks),
    accountClassification: preferString(primary.accountClassification, secondary.accountClassification),
    primaryViolation: preferString(primary.primaryViolation, secondary.primaryViolation),
    strategy: preferString(primary.strategy, secondary.strategy),
    addressStatus: preferString(primary.addressStatus, secondary.addressStatus),
    furnisherAddress: preferString(primary.furnisherAddress, secondary.furnisherAddress),
    id: preferString(primary.id, secondary.id),
    bureaus: uniqStrings([...(primary.bureaus || []), ...(secondary.bureaus || [])]),
    violations: mergeViolations(primary.violations, secondary.violations),
    batch: primary.batch ?? secondary.batch ?? 2,
  };
}

function mergePersonalInfo(parts) {
  const out = {
    formerAddresses: [],
    nameVariants: [],
    formerEmployers: [],
    dateOfBirth: null,
    phone: null,
    currentAddress: null,
  };
  for (const part of parts) {
    const pi = part?.personalInfo || {};
    out.formerAddresses.push(...(pi.formerAddresses || []));
    out.nameVariants.push(...(pi.nameVariants || []));
    out.formerEmployers.push(...(pi.formerEmployers || []));
    out.dateOfBirth = preferString(out.dateOfBirth, pi.dateOfBirth);
    out.phone = preferString(out.phone, pi.phone);
    out.currentAddress = preferString(out.currentAddress, pi.currentAddress);
  }
  out.formerAddresses = uniqStrings(out.formerAddresses);
  out.nameVariants = uniqStrings(out.nameVariants);
  out.formerEmployers = uniqStrings(out.formerEmployers);
  return out;
}

function mergeClient(parts) {
  let name = '';
  let address = null;
  let score = null;
  const scores = {};
  for (const part of parts) {
    const client = part?.client || {};
    name = preferString(name, client.name) || name;
    address = preferString(address, client.address);
    score = preferNumber(score, client.score);
    const s = client.scores || {};
    for (const key of Object.keys(s)) {
      scores[key] = preferNumber(scores[key], s[key]);
    }
  }
  const client = { name: name || 'Unknown Client', address, score };
  if (Object.keys(scores).length) client.scores = scores;
  return client;
}

function mergeKeyedList(parts, listKey, keyFn, mergeFn) {
  const map = new Map();
  for (const part of parts) {
    for (const item of part?.[listKey] || []) {
      if (!item || typeof item !== 'object') continue;
      const key = keyFn(item);
      const prev = map.get(key);
      map.set(key, prev ? mergeFn(prev, item) : { ...item });
    }
  }
  return Array.from(map.values());
}

/**
 * Merge BUREAU_SCHEMA chunk extracts into one bureau object.
 */
export function mergeBureauParseResults(parts, bureauName) {
  const usable = (parts || []).filter((part) => part && typeof part === 'object');
  if (!usable.length) {
    throw new Error(`${bureauName || 'Bureau'} chunk merge received no parse results`);
  }
  return {
    bureau: bureauName || usable[0].bureau || null,
    client: mergeClient(usable),
    accounts: mergeKeyedList(usable, 'accounts', accountMergeKey, mergeAccountRecords),
    inquiries: mergeKeyedList(usable, 'inquiries', inquiryMergeKey, (a, b) => ({
      ...a,
      ...b,
      furnisher: preferString(a.furnisher, b.furnisher),
      date: preferString(a.date, b.date),
      type: preferString(a.type, b.type),
    })),
    personalInfo: mergePersonalInfo(usable),
  };
}

/**
 * Merge AUDIT_SCHEMA chunk extracts (combined / single mode) into one audit.
 * Batch ranking is recomputed from violation density after the merge.
 */
export function mergeAuditParseResults(parts) {
  const usable = (parts || []).filter((part) => part && typeof part === 'object');
  if (!usable.length) {
    throw new Error('Audit chunk merge received no parse results');
  }

  const accounts = mergeKeyedList(usable, 'accounts', accountMergeKey, mergeAccountRecords);
  accounts.sort((a, b) => (b.violations?.length || 0) - (a.violations?.length || 0));
  accounts.forEach((account, index) => {
    account.batch = index < 5 ? 1 : 2;
  });

  const inquiries = mergeKeyedList(usable, 'inquiries', inquiryMergeKey, (a, b) => ({
    ...a,
    ...b,
    furnisher: preferString(a.furnisher, b.furnisher),
    date: preferString(a.date, b.date),
    bureaus: uniqStrings([...(a.bureaus || []), ...(b.bureaus || [])]),
    linkedAccountId: preferString(a.linkedAccountId, b.linkedAccountId),
    ageInMonths: preferNumber(a.ageInMonths, b.ageInMonths),
    category: preferString(a.category, b.category),
  }));

  const client = mergeClient(usable);
  const personalInfo = mergePersonalInfo(usable);
  const totalViolations = accounts.reduce((sum, account) => sum + (account.violations?.length || 0), 0);

  // Prefer the richest top-level copy for fields we don't specially merge.
  const primary = usable.reduce((best, part) => (
    ((part.accounts?.length || 0) >= (best.accounts?.length || 0)) ? part : best
  ), usable[0]);

  return {
    ...primary,
    client,
    accounts,
    inquiries,
    personalInfo,
    totalViolations,
    totalAccounts: accounts.length,
  };
}
