/**
 * Fieldwork-styled plain letter from forensic findings.
 * Uses CCC substance (fields, statutes, reported/should, legal boundary)
 * but NOT CCC navy/gold HTML tables — matches the demo <pre> preview.
 */

function formatAddress(user) {
  const a = user?.address || {};
  const line1 = a.line1 || a.street || '';
  const cityLine = [a.city, a.state, a.zip].filter(Boolean).join(', ').replace(', ', ', ').replace(/, ([A-Z]{2}), /, ', $1 ');
  // "City, ST ZIP"
  const city = a.city || '';
  const state = a.state || '';
  const zip = a.zip || '';
  const loc = [city, state && zip ? `${state} ${zip}` : state || zip].filter(Boolean).join(', ');
  return { line1, loc, cityLine: loc };
}

function phaseHeader(phaseId) {
  if (phaseId === 'phase2') {
    return 'PHASE 2 FOLLOW-UP — prior dispute + response enclosed';
  }
  return 'PHASE 1 DIRECT DISPUTE — FCRA §623 / Metro 2 / Reg V';
}

/**
 * @param {object} user Fieldwork user
 * @param {object} account Fieldwork account (adapted)
 * @param {'phase1'|'phase2'} phaseId
 */
export function buildFieldworkLetter(user, account, phaseId = 'phase1') {
  const { line1, loc } = formatAddress(user);
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const violations = account.violations || [];
  const top = violations[0];
  const statutes = [...new Set(violations.map((v) => v.statute).filter(Boolean))].join(' · ');

  const issueBlocks = violations
    .map((v, i) => {
      return [
        `ISSUE ${i + 1}: ${v.title}`,
        `METRO 2 FIELD: ${v.field}${v.fieldName ? ` (${v.fieldName})` : ''}`,
        `STATUTE: ${v.statute}`,
        '',
        v.plain,
        '',
        `Reported: ${v.reported}`,
        `Requested correction: ${v.expected}`,
      ].join('\n');
    })
    .join('\n\n────────────────\n\n');

  const typeC = /Type C/i.test(account.typeLabel || '') || account.cccRaw?.type === 'C';

  return `${phaseHeader(phaseId)}

${top ? `Field ${top.field} · ${statutes || top.statute}` : statutes}

${user.name}
${line1}
${loc}

${date}

${account.furnisher}
Re: Account ${account.accountMask} · Original creditor: ${account.originalCreditor}

I am writing to dispute inaccurate information you are furnishing about me under the Fair Credit Reporting Act. This is a direct written dispute to you as the data furnisher under 12 C.F.R. §1022.43 and 15 U.S.C. §1681s-2(a)(8) — not a bureau e-OSCAR forwarding.

${issueBlocks}

${typeC ? 'Additionally, to the extent you are a debt collector, I request validation under 15 U.S.C. §1692g(b).\n\n' : ''}Please investigate each disputed element and correct or delete inaccurate reporting within thirty (30) days, and update every consumer reporting agency to which you have furnished this data. Form “verified as reported” replies that do not address the specific Metro 2 fields above are not a reasonable investigation.

I expect your prompt attention to this matter and full compliance with FCRA accuracy duties.

Sincerely,
${user.name}
Consumer — All Rights Reserved

Sent via Certified Mail
Enclosures: identity + proof of address${phaseId === 'phase2' ? ' · prior letter · furnisher response · return receipt' : ''}`;
}
