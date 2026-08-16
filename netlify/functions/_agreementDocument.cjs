/**
 * Client Service Agreement + Limited Power of Attorney packet.
 * - CSA section: plan, fees, CROA, terms (attorney-approved structure)
 * - LPOA section: authorization only — NO pricing
 * Drawn letter signature remains separate (lpoa_signature_data / PNG upload).
 */

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

/** Default fee table aligned with src/utils/pricing.js */
function defaultTierTable(pricing = {}) {
  const std = pricing.standard || {};
  const vip = pricing.vip || {};
  const pif = pricing.paidInFull || pricing.paid_in_full || {};
  return {
    standard: {
      monthly: std.monthlyFee ?? 79,
      firstWork: std.firstWorkFee ?? 75,
      letters: 'Up to 3',
      term: 'Month-to-month',
    },
    vip: {
      monthly: vip.monthlyFee ?? 149,
      firstWork: vip.firstWorkFee ?? 99,
      letters: 'Up to 5',
      term: 'Month-to-month',
    },
    paidInFull: {
      monthly: pif.totalFee ?? pif.flatFee ?? 499,
      firstWork: 0,
      letters: 'Up to 3',
      term: '6 months',
      flat: true,
    },
  };
}

function resolveSelectedPlanLabel(billingTier, serviceAgreement = {}) {
  if (serviceAgreement.mode === 'custom' && serviceAgreement.feeText) {
    return `Custom: ${serviceAgreement.feeText}`;
  }
  const t = String(billingTier || '').trim();
  if (!t) return 'To be confirmed with Credit Comeback Club';
  return t;
}

function resolveFeeScheduleLines({ billingTier, serviceAgreement = {}, pricing = {}, monitoringService, monitoringFee }) {
  const tiers = defaultTierTable(pricing);
  const mon = monitoringFee != null ? monitoringFee : 16;
  const monLine = `Credit monitoring (${escapeHtml(monitoringService || 'Privacy Guard')}): approx. $${mon}/month (Principal responsibility).`;

  if (serviceAgreement.mode === 'custom' && serviceAgreement.feeText) {
    return {
      selectedPlan: `Custom arrangement`,
      feeLines: [escapeHtml(serviceAgreement.feeText), monLine],
      firstWorkDisplay: 'Per custom agreement',
    };
  }

  const key = String(billingTier || '').toLowerCase().replace(/\s+/g, '');
  let selected = null;
  let label = billingTier || 'Standard';
  if (key.includes('vip')) {
    selected = tiers.vip;
    label = 'VIP';
  } else if (key.includes('paid') || key.includes('pif') || key.includes('full')) {
    selected = tiers.paidInFull;
    label = 'Paid in Full';
  } else if (key.includes('standard') || billingTier) {
    selected = tiers.standard;
    label = billingTier || 'Standard';
  }

  if (!selected) {
    return {
      selectedPlan: 'Plan to be confirmed',
      feeLines: [
        `Standard: ${money(tiers.standard.monthly)}/mo + ${money(tiers.standard.firstWork)} first work fee`,
        `VIP: ${money(tiers.vip.monthly)}/mo + ${money(tiers.vip.firstWork)} first work fee`,
        `Paid in Full: ${money(tiers.paidInFull.monthly)} flat (first work waived)`,
        monLine,
      ],
      firstWorkDisplay: 'Per selected plan',
    };
  }

  if (selected.flat) {
    return {
      selectedPlan: label,
      feeLines: [
        `${label} Plan: ${money(selected.monthly)} flat for ${selected.term}`,
        `First Work Fee: Waived`,
        `Dispute letters: ${selected.letters} per month`,
        monLine,
      ],
      firstWorkDisplay: 'Waived',
    };
  }

  return {
    selectedPlan: label,
    feeLines: [
      `${label} Plan: ${money(selected.monthly)}/month`,
      `First Work Fee: ${money(selected.firstWork)} (one-time)`,
      `Dispute letters: ${selected.letters} per month`,
      `Term: ${selected.term}`,
      monLine,
    ],
    firstWorkDisplay: money(selected.firstWork),
  };
}

/**
 * Full compliance packet: Client Service Agreement + LPOA (no pricing in LPOA).
 */
function buildClientAgreementPacketHtml({
  clientName,
  clientAddress = '',
  clientPhone = '',
  clientEmail = '',
  signedAt,
  clientSignatureDataUrl,
  attorneySignatureDataUrl = null,
  billingTier = null,
  serviceAgreement = {},
  pricing = {},
  monitoringService = 'Privacy Guard',
  monitoringFee = 16,
}) {
  const safeName = escapeHtml(clientName || 'Client');
  const safeDate = escapeHtml(signedAt || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }));
  const addr = escapeHtml(clientAddress || '—');
  const phone = escapeHtml(clientPhone || '—');
  const email = escapeHtml(clientEmail || '—');

  const fees = resolveFeeScheduleLines({
    billingTier,
    serviceAgreement,
    pricing,
    monitoringService,
    monitoringFee,
  });

  const clientSigImg = clientSignatureDataUrl
    ? `<img src="${clientSignatureDataUrl}" alt="Client signature" style="max-height:56px;max-width:220px;" />`
    : `<span style="font-size:13px;font-weight:bold;">${safeName}</span>`;

  const attorneySigImg = attorneySignatureDataUrl
    ? `<img src="${attorneySignatureDataUrl}" alt="Attorney-in-Fact signature" style="max-height:56px;max-width:220px;" />`
    : `<span style="font-size:14px;font-weight:bold;">Christopher Holland</span>`;

  const feeList = fees.feeLines.map((line) => `<li>${line}</li>`).join('');

  const tiers = defaultTierTable(pricing);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Credit Comeback Club — Client Service Agreement &amp; Limited Power of Attorney</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;font-size:12px;line-height:1.55;margin:0;padding:40px;color:#0f172a;max-width:800px;margin-left:auto;margin-right:auto;}
  .header{background:#0f172a;color:#fbbf24;padding:22px 28px;margin:-40px -40px 28px;}
  .header h1{margin:0;font-size:20px;letter-spacing:0.02em;}
  .header p{margin:6px 0 0;font-size:11px;color:#e2e8f0;opacity:0.9;}
  h2{font-size:12px;background:#0f172a;color:#fff;padding:7px 12px;margin:28px 0 12px;}
  h3{font-size:12px;margin:16px 0 8px;color:#0f172a;}
  p,li{margin:6px 0;}
  ul{padding-left:20px;}
  table{width:100%;border-collapse:collapse;margin:12px 0;font-size:11px;}
  th,td{border:1px solid #cbd5e1;padding:8px 10px;text-align:left;}
  th{background:#f1f5f9;font-weight:bold;}
  .notice{background:#fffbeb;border:1px solid #f59e0b;padding:12px 14px;margin:12px 0;font-size:11px;}
  .meta{margin:10px 0;font-size:12px;}
  .sig-block{margin-top:32px;padding-top:16px;border-top:1px solid #cbd5e1;}
  .sig-row{display:flex;gap:36px;margin-top:16px;flex-wrap:wrap;}
  .sig-col{flex:1;min-width:220px;}
  .sig-line{border-bottom:1px solid #0f172a;margin-bottom:4px;min-height:60px;display:flex;align-items:flex-end;}
  .sig-label{font-size:10px;color:#64748b;}
  .footer{margin-top:36px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8;text-align:center;}
  .selected{background:#fef3c7;font-weight:bold;}
</style>
</head>
<body>
  <div class="header">
    <h1>Credit Comeback Club</h1>
    <p>Client Service Agreement &amp; Limited Power of Attorney · Executed ${safeDate}</p>
    <p>creditcomebackclub.com · 480-913-9172 · Grand Junction, CO 81501</p>
  </div>

  <h2>1. Parties &amp; Effective Date</h2>
  <p>This Credit Repair Services Agreement (“Agreement”) is entered into as of <strong>${safeDate}</strong> between:</p>
  <p><strong>Service Provider:</strong> Credit Comeback Club, a DBA of Christopher Holland, Sole Proprietor<br/>
  Grand Junction, CO 81501 · EIN: 81-3138942 · Phone: 480-913-9172 · Web: creditcomebackclub.com</p>
  <p class="meta"><strong>Client:</strong> ${safeName}<br/>
  <strong>Address:</strong> ${addr}<br/>
  <strong>Phone:</strong> ${phone}<br/>
  <strong>Email:</strong> ${email}</p>
  <p>Together referred to as the “Parties.”</p>

  <h2>2. Consumer Rights Disclosure (Required by Federal Law)</h2>
  <div class="notice">
    <strong>NOTICE REQUIRED BY THE CREDIT REPAIR ORGANIZATIONS ACT (15 U.S.C. § 1679 et seq.)</strong>
    <p>You have a right to dispute inaccurate information in your credit report by contacting the credit bureau directly. There is no fee for this. Any improvements to your credit report from the use of a credit repair company may also be achieved by you at no cost by contacting the bureaus directly.</p>
    <p>You have a right to sue a credit repair organization that violates the Credit Repair Organizations Act. This law prohibits deceptive practices by credit repair organizations.</p>
    <p>You may cancel this contract without penalty or obligation at any time before midnight of the 3rd business day after the date you signed the contract. See Section 9 for cancellation instructions.</p>
  </div>

  <h2>3. Selected Service Plan</h2>
  <p>Client has selected the following service plan:</p>
  <table>
    <thead>
      <tr>
        <th>Service Feature</th>
        <th>Standard</th>
        <th>VIP</th>
        <th>Paid in Full</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Monthly / Program Fee</td>
        <td>${money(tiers.standard.monthly)}/mo</td>
        <td>${money(tiers.vip.monthly)}/mo</td>
        <td>${money(tiers.paidInFull.monthly)} flat</td>
      </tr>
      <tr>
        <td>First Work Fee</td>
        <td>${money(tiers.standard.firstWork)} (one-time)</td>
        <td>${money(tiers.vip.firstWork)} (one-time)</td>
        <td>Waived</td>
      </tr>
      <tr>
        <td>Dispute Letters/Month</td>
        <td>${tiers.standard.letters}</td>
        <td>${tiers.vip.letters}</td>
        <td>${tiers.paidInFull.letters}</td>
      </tr>
      <tr>
        <td>Term</td>
        <td>${tiers.standard.term}</td>
        <td>${tiers.vip.term}</td>
        <td>${tiers.paidInFull.term}</td>
      </tr>
    </tbody>
  </table>
  <p><strong>Selected Plan:</strong> <span class="selected">${escapeHtml(fees.selectedPlan)}</span></p>
  <p><strong>First Work Fee:</strong> ${escapeHtml(fees.firstWorkDisplay)}</p>
  <ul>${feeList}</ul>
  <p><strong>Services:</strong> Credit Comeback Club will analyze Equifax, Experian, and TransUnion information as provided, identify inaccurate or unverifiable items, and prepare and submit dispute correspondence to data furnishers and/or consumer reporting agencies on Client’s behalf as authorized herein.</p>
  <p><strong>No Guarantee:</strong> CCC makes no guarantee of specific outcomes. Results depend on individual credit profiles and creditor responses.</p>
  <p><strong>Prohibited Practices:</strong> CCC does not provide legal advice, dispute accurate/verifiable information, or create new credit identities.</p>

  <h2>4. Billing</h2>
  <p>First Work Fee is due at enrollment before dispute work commences, unless waived under the selected plan. Monthly fees (if applicable) are billed in advance on the anniversary of enrollment. Paid-in-full arrangements are as stated in Section 3.</p>

  <h2>5. CROA Compliance &amp; Cancellation</h2>
  <p>This agreement complies with the Credit Repair Organizations Act. No advance fees are charged for work not yet performed. Client may cancel without penalty within 3 business days of signing. To cancel, email info@creditcomebackclub.com with subject “CANCEL — [Your Name]”.</p>

  <h2>6. Limited Power of Attorney (Authorization Only)</h2>
  <p><em>This section grants authorization to perform credit-dispute work. It does not set fees; fees are only in Sections 3–4 above.</em></p>
  <h3>6.1 Parties</h3>
  <p>This Limited Power of Attorney is executed between <strong>${safeName}</strong> (“Principal”) and Credit Comeback Club, a DBA of Christopher Holland, Grand Junction, CO (“Attorney-in-Fact”).</p>
  <h3>6.2 Grant of Authority</h3>
  <p>Principal authorizes Credit Comeback Club to act exclusively for credit dispute activities, including:</p>
  <ul>
    <li>Prepare and submit dispute letters to data furnishers under 15 U.S.C. §1681s-2(b)</li>
    <li>Prepare and submit dispute letters to Equifax, Experian, and TransUnion under 15 U.S.C. §1681i</li>
    <li>Send certified mail on behalf of Principal for credit disputes</li>
    <li>Receive and respond to furnisher and bureau correspondence related to disputes</li>
    <li>Submit CFPB, FTC, and state AG complaints for FCRA/FDCPA issues when appropriate</li>
    <li>Review credit reports and sign dispute correspondence as “By: Credit Comeback Club, Authorized Representative”</li>
  </ul>
  <h3>6.3 Limitations</h3>
  <p>This authorization does NOT grant authority to make financial decisions, access financial accounts, dispute accurate information, create a new credit identity, or settle legal claims without explicit written consent.</p>
  <h3>6.4 Duration &amp; Revocation</h3>
  <p>Effective until written revocation, dispute completion, or agreement termination. To revoke: email creditcomebackclub@gmail.com with subject “LPOA REVOCATION — [Your Name].”</p>

  <h2>7. ESIGN Disclosure</h2>
  <p>This document was executed electronically. The drawn signature below constitutes a legally binding electronic signature under the ESIGN Act (15 U.S.C. §7001). Execution timestamp and related audit metadata may be recorded.</p>

  <div class="sig-block">
    <div class="sig-row">
      <div class="sig-col">
        <div class="sig-line">${clientSigImg}</div>
        <div class="sig-label">Client / Principal — ${safeName}</div>
        <div class="sig-label">Date: ${safeDate}</div>
      </div>
      <div class="sig-col">
        <div class="sig-line">${attorneySigImg}</div>
        <div class="sig-label">Christopher Holland — Attorney-in-Fact, Credit Comeback Club</div>
        <div class="sig-label">Date: ${safeDate}</div>
      </div>
    </div>
  </div>

  <div class="footer">
    Credit Comeback Club · Grand Junction, CO · 480-913-9172 · creditcomebackclub.com<br/>
    Client Service Agreement &amp; Limited Power of Attorney · Confidential · Executed under ESIGN Act 15 U.S.C. §7001
  </div>
</body>
</html>`;
}

/** @deprecated Use buildClientAgreementPacketHtml — kept for callers that still expect LPOA-only title */
function buildLpoaHtml(opts) {
  return buildClientAgreementPacketHtml(opts);
}

module.exports = {
  escapeHtml,
  buildLpoaHtml,
  buildClientAgreementPacketHtml,
  resolveFeeScheduleLines,
  defaultTierTable,
};
