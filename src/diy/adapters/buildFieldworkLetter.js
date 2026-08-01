/**
 * Fieldwork HTML dispute letter — CCC forensic substance + Fieldwork skin.
 * Keeps useful ID / violation / demands tables; no CCC navy/gold chrome.
 */
import { wrapFieldworkLetterHtml } from './fieldworkLetterCss.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatAddress(user) {
  const a = user?.address || {};
  const line1 = a.line1 || a.street || '';
  const city = a.city || '';
  const state = a.state || '';
  const zip = a.zip || '';
  const loc = [city, state && zip ? `${state} ${zip}` : state || zip].filter(Boolean).join(', ');
  return { line1, loc };
}

function enclosuresLine(phaseId) {
  if (phaseId === 'phase2') {
    return 'Enclosures: (1) Government-issued photo ID; (2) Proof of current address; (3) Prior dispute letter; (4) Furnisher response; (5) Certified mail return receipt';
  }
  return 'Enclosures: (1) Government-issued photo ID; (2) Proof of current address';
}

/**
 * @param {object} [analysis] optional Fieldwork response analysis (phase2 follow-up)
 * @returns {string} complete HTML document
 */
export function buildFieldworkLetter(user, account, phaseId = 'phase1', analysis = null) {
  const { line1, loc } = formatAddress(user);
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const violations = account.violations || [];
  const statutes = [...new Set(violations.map((v) => v.statute).filter(Boolean))];
  const typeC = /Type C/i.test(account.typeLabel || '') || account.cccRaw?.type === 'C';
  const furnisherAddr = account.cccRaw?.furnisherAddress || '';
  const isFollowUp = phaseId === 'phase2' && analysis;

  const idRows = [
    ['Account number', account.accountMask],
    ['Furnisher', account.furnisher],
    ['Original creditor', account.originalCreditor],
    ['Account type', account.typeLabel || account.type],
    ['Status', account.status],
    ['Balance', account.balance == null ? '—' : `$${Number(account.balance).toLocaleString()}`],
    ['Bureaus', (account.bureaus || []).join(', ') || '—'],
    ['Statutes cited', statutes.join(' · ') || 'FCRA §623'],
  ];

  const openViolations = isFollowUp
    ? violations.filter((v) => {
      const hit = (analysis.demandAnalysis || []).find((d) =>
        String(d.demand || '').includes(String(v.field))
        || String(d.demand || '').toLowerCase().includes(String(v.fieldName || '').toLowerCase().slice(0, 12)),
      );
      return !hit || hit.outcome !== 'ADDRESSED';
    })
    : violations;
  const rowsForTable = openViolations.length ? openViolations : violations;

  const violationRows = rowsForTable.map((v) => `
    <tr>
      <td><strong>Field ${esc(v.field)}</strong><br/><span style="color:#6b7c89;font-size:11px">${esc(v.fieldName)}</span></td>
      <td>${esc(v.statute)}</td>
      <td class="reported">${esc(v.reported)}</td>
      <td class="challenge">${esc(v.expected)}</td>
    </tr>
    <tr>
      <td colspan="4" style="font-size:12.5px;color:#6b7c89"><strong style="color:#07131f">${esc(v.title)}</strong> — ${esc(v.plain)}</td>
    </tr>`).join('');

  const ignored = (analysis?.demandAnalysis || []).filter((d) =>
    d.outcome === 'IGNORED' || d.outcome === 'PARTIALLY_ADDRESSED',
  );
  const demandItems = isFollowUp
    ? [
      ...(ignored.length
        ? ignored.map((d) => `${d.demand} — prior response: ${d.outcome.replace(/_/g, ' ').toLowerCase()}. ${d.notes}`)
        : rowsForTable.map((v) =>
          `Correct Metro 2 Field ${v.field} (${v.fieldName}): currently reports “${v.reported}”; should report “${v.expected}”.`)),
      'Conduct a reasonable investigation under Johnson v. MBNA — not another automated verification against the same database.',
      'Produce in writing the records reviewed and original-source documentation relied upon for each disputed element.',
      'Update every CRA to which you furnish this account and confirm the corrected Metro 2 values in writing within thirty (30) days.',
      ...(analysis?.admissions || []).slice(0, 2).map((a) => `Your prior response admitted: ${a}. Address that admission with corrected reporting.`),
    ]
    : [
      ...violations.map((v) =>
        `Correct Metro 2 Field ${v.field} (${v.fieldName}): currently reports “${v.reported}”; should report “${v.expected}”.`),
      'Conduct a reasonable investigation of each disputed element — not an automated “verified as reported” check against the same database that produced the inaccuracy.',
      'Update every consumer reporting agency to which you have furnished this account, and confirm in writing the corrected Metro 2 field values and dates of update.',
      'Produce in writing: records reviewed, how those records support accuracy of each disputed element, and copies of documentation relied upon (redacted if necessary but sufficient to demonstrate verification).',
    ];
  if (typeC && !isFollowUp) {
    demandItems.push('Provide validation under 15 U.S.C. §1692g(b), including the amount of the debt and the name of the original creditor.');
  }

  const demands = demandItems.map((d, i) => `
    <tr>
      <td class="demand-num">${i + 1}</td>
      <td>${esc(d)}</td>
    </tr>`).join('');

  const noticeBlock = isFollowUp
    ? `<div class="section-header">Follow-up after inadequate response</div>
<p class="body-copy">
  I previously sent a <strong>direct written dispute</strong> under 12 C.F.R. §1022.43 and 15 U.S.C. §1681s-2(a)(8).
  Your response failed to address the specific Metro 2 / FCRA issues raised.
  ${analysis.summary ? esc(analysis.summary) : ''}
</p>
${analysis.followUpLeverage ? `<p class="body-copy"><strong>${esc(analysis.followUpLeverage)}</strong></p>` : ''}
<p class="body-copy">
  A reasonable reinvestigation requires more than parroting existing database entries
  (Johnson v. MBNA America Bank, 357 F.3d 426 (4th Cir. 2004)). This letter renews and sharpens those demands.
</p>`
    : `<div class="section-header">Notice of direct furnisher dispute</div>
<p class="body-copy">
  I am writing to dispute inaccurate information you are furnishing about me under the Fair Credit Reporting Act.
  This is a <strong>direct written dispute</strong> to you as the data furnisher under
  12 C.F.R. §1022.43 and 15 U.S.C. §1681s-2(a)(8) — not a bureau e-OSCAR forwarding.
</p>
${account.whyFurnisherFirst ? `<p class="body-copy">${esc(account.whyFurnisherFirst)}</p>` : ''}`;

  const reLine = isFollowUp
    ? `Follow-up Direct Furnisher Dispute · Account ${esc(account.accountMask)} · Inadequate prior response · Demand for correction`
    : `Direct Furnisher Dispute · Account ${esc(account.accountMask)} · ${esc(statutes.join(' · ') || 'FCRA §623')} · Demand for correction`;

  const body = `
<div class="date-line">${esc(date)}</div>

<div class="sender-block">
  ${esc(user.name)}<br/>
  ${esc(line1)}<br/>
  ${esc(loc)}
</div>

<div class="recipient-block">
  ${esc(account.furnisher)}<br/>
  ${furnisherAddr ? `${esc(furnisherAddr)}<br/>` : ''}
</div>

<div class="re-line">
  ${reLine}
</div>

${noticeBlock}

<div class="section-header accent">Account identification</div>
<table class="id-table">
  ${idRows.map(([k, v]) => `<tr><td class="label">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}
</table>

<div class="section-header">${isFollowUp ? 'Outstanding Metro 2 / FCRA findings' : 'Metro 2 / FCRA findings'}</div>
<table class="list-table">
  <thead>
    <tr>
      <th style="width:18%">Field</th>
      <th style="width:18%">Statute</th>
      <th style="width:32%">Reported</th>
      <th style="width:32%">Challenge</th>
    </tr>
  </thead>
  <tbody>
    ${violationRows}
  </tbody>
</table>

<div class="section-header accent">Required corrections</div>
<table class="demands-table">
  ${demands}
</table>

<div class="section-header">Documentation required</div>
<p class="body-copy">
  Form letters and “verified as reported” responses that do not address the specific Metro 2 fields above
  are not a reasonable investigation. Provide a written response within <strong>thirty (30) days</strong>.
</p>

<p class="closing-statement">
  ${isFollowUp
    ? 'Correct the outstanding inaccuracies within thirty (30) days and update all consumer reporting agencies to which you have furnished this data. A second failure to investigate will be documented.'
    : 'Please correct this inaccurate reporting within thirty (30) days, as required under the Fair Credit Reporting Act, and update all consumer reporting agencies to which you have furnished this data.'}
</p>

<div class="signature-block">
  <div>Sincerely,</div>
  <div class="sig-line">${
    user.signatureData
      ? `<img src="${esc(user.signatureData)}" alt="Signature" />`
      : ''
  }</div>
  <div class="printed-name">${esc(user.name)}</div>
  <div class="rights-line">Consumer — All Rights Reserved</div>
</div>

<div class="mail-notation">Sent via Certified Mail</div>
<div class="enclosures">${esc(enclosuresLine(phaseId))}</div>
`;

  return wrapFieldworkLetterHtml(body);
}

/** Plain excerpt for Lob preview / tracking cards */
export function fieldworkLetterPlainExcerpt(htmlOrText, max = 200) {
  const text = String(htmlOrText || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, max);
}
