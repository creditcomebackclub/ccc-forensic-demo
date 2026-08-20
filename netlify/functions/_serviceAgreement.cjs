const crypto = require('crypto');

const AGREEMENT_TEMPLATE_VERSION = 'ccc-service-agreement-v1-draft';
const CONTACT = {
  phone: '970-644-0063',
  city: 'Grand Junction',
  state: 'CO',
  zip: '81504',
  site: 'creditcomebackclub.com',
};
const LPOA_TEXT = 'The client authorizes Credit Comeback Club only to prepare and submit dispute correspondence, send certified mail, receive and respond to dispute-related correspondence, and prepare appropriate consumer-protection complaints. This authorization does not permit financial decisions, account access, settlement of claims, or disputing information the client knows is accurate. It remains effective until revoked in writing or the dispute work is complete.';
const ELECTRONIC_ACKNOWLEDGEMENT_TEXT = 'By signing, the client acknowledges receipt of the Service Agreement and Limited Power of Attorney, consents to electronic records and signatures, and confirms that the selected plan summary is part of the agreement packet.';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function planSnapshot(client, pricing = {}) {
  const tier = client.billing_tier || 'Standard';
  const custom = client.service_agreement_mode === 'custom';
  const defaults = {
    Standard: { monthlyFee: 79, firstWorkFee: 75, label: 'Standard', serviceTerm: 'month-to-month service plan' },
    VIP: { monthlyFee: 149, firstWorkFee: 99, label: 'VIP', serviceTerm: 'month-to-month service plan' },
    'Paid In Full': { flatFee: 499, flatMonths: 6, firstWorkFee: 0, label: 'Paid In Full', serviceTerm: 'six months of service' },
  };
  const base = { ...(defaults[tier] || defaults.Standard), ...((pricing.tiers || {})[tier] || {}) };
  if (custom) {
    return {
      mode: 'custom', label: client.service_agreement_label || 'Custom service package',
      amount: client.service_agreement_amount == null ? null : Number(client.service_agreement_amount),
      feeText: String(client.service_agreement_fee_text || '').trim(),
      serviceTerm: 'custom service package', billingTier: null,
    };
  }
  const feeText = tier === 'Paid In Full'
    ? `$${base.flatFee} flat for ${base.flatMonths} months of service; First Work Fee waived.`
    : `$${base.monthlyFee}/month plus a $${base.firstWorkFee} First Work Fee after the counsel-approved performed-service milestone.`;
  return { mode: 'tier', billingTier: tier, label: base.label, amount: base.flatFee || base.monthlyFee, feeText, serviceTerm: base.serviceTerm, pricing: base };
}

function renderPacket({ client, plan, signedAt, clientSignatureHtml, attorneySignatureHtml, approved, approvedTermsHtml = '' }) {
  const signingDate = signedAt ? new Date(signedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Pending signature';
  const title = approved ? 'Client Service Agreement & Limited Power of Attorney' : 'Draft Client Service Agreement & Limited Power of Attorney';
  const draftBanner = approved ? '' : '<div class="draft">COUNSEL REVIEW REQUIRED — THIS DRAFT CANNOT BE SENT OR SIGNED</div>';
  const signer = clientSignatureHtml || '<span class="pending">Awaiting client signature</span>';
  const attorney = attorneySignatureHtml || '<span class="pending">Firm signature required before execution</span>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
    body{font-family:Arial,sans-serif;color:#161616;font-size:12px;line-height:1.55;margin:38px auto;max-width:760px;padding:0 30px}.brand{background:#1B2A4A;color:#fff;padding:24px 28px}.brand h1{color:#C9A84C;margin:0;font-size:19px}.brand p{margin:5px 0 0;font-size:11px}.draft{margin:18px 0;padding:10px 12px;background:#fff7ed;border:1px solid #f59e0b;color:#92400e;font-weight:bold}h2{font-size:12px;background:#1B2A4A;color:#fff;padding:6px 10px;margin:23px 0 9px;text-transform:uppercase;letter-spacing:.04em}.summary{border:1px solid #d9dee7;background:#f8fafc;padding:14px}.summary dt{font-weight:bold;float:left;clear:left;width:155px}.summary dd{margin-left:165px;margin-bottom:6px}.sigrow{display:flex;gap:36px;margin-top:30px}.sig{width:50%}.sigline{min-height:66px;border-bottom:1px solid #111;display:flex;align-items:flex-end;padding-bottom:4px}.small{font-size:10px;color:#555}.pending{color:#777;font-style:italic}.footer{font-size:10px;color:#666;text-align:center;margin-top:36px;border-top:1px solid #ddd;padding-top:12px}@media print{body{margin:0;max-width:none}.draft{display:none}}</style></head><body>
    <div class="brand"><h1>Credit Comeback Club</h1><p>${escapeHtml(title)} · ${escapeHtml(CONTACT.site)} · ${escapeHtml(CONTACT.phone)}</p></div>${draftBanner}
    <p><strong>Client:</strong> ${escapeHtml(client.name)}<br><strong>Packet date:</strong> ${escapeHtml(signingDate)}</p>
    <h2>1. Selected service plan</h2><div class="summary"><dl><dt>Plan</dt><dd>${escapeHtml(plan.label)}</dd><dt>Service term</dt><dd>${escapeHtml(plan.serviceTerm)}</dd><dt>Plan terms snapshot</dt><dd>${escapeHtml(plan.feeText || 'To be supplied in counsel-approved terms.')}</dd><dt>Collection status</dt><dd>No payment is created or collected by this packet.</dd></dl></div>
    <h2>2. Service agreement</h2>${approved && approvedTermsHtml ? approvedTermsHtml : '<p>The final counsel-approved agreement terms, required disclosures, service description, payment-milestone language, and cancellation materials are incorporated in this versioned packet. Credit Comeback Club does not guarantee any particular credit outcome.</p>'}
    <h2>3. Limited power of attorney</h2><p>${escapeHtml(LPOA_TEXT)}</p>
    <h2>4. Electronic records and acknowledgements</h2><p>${escapeHtml(ELECTRONIC_ACKNOWLEDGEMENT_TEXT)} Required cancellation rights and notices must be contained in the counsel-approved version before execution.</p>
    <div class="sigrow"><div class="sig"><div class="sigline">${signer}</div><div class="small"><strong>${escapeHtml(client.signerName || client.name)}</strong> — Client<br>Date: ${escapeHtml(signingDate)}</div></div><div class="sig"><div class="sigline">${attorney}</div><div class="small"><strong>Christopher Holland</strong> — Credit Comeback Club<br>Date: ${escapeHtml(signingDate)}</div></div></div>
    <div class="footer">Credit Comeback Club · ${escapeHtml(CONTACT.city)}, ${escapeHtml(CONTACT.state)} ${escapeHtml(CONTACT.zip)} · ${escapeHtml(CONTACT.phone)} · ${escapeHtml(CONTACT.site)}</div>
  </body></html>`;
}

function renderLpoaOnly({ client, plan, signedAt, clientSignatureHtml, attorneySignatureHtml }) {
  const date = new Date(signedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:12px;line-height:1.55;margin:40px;color:#111}.header{background:#1B2A4A;color:#fff;padding:18px 24px;margin:-40px -40px 28px}.header h1{color:#C9A84C;margin:0;font-size:18px}h2{font-size:11px;background:#1B2A4A;color:#fff;padding:5px 10px;text-transform:uppercase}.signatures{display:flex;gap:36px;margin-top:28px}.signature{width:50%}.line{min-height:62px;border-bottom:1px solid #111;display:flex;align-items:flex-end}.small{font-size:10px;color:#555}</style></head><body><div class="header"><h1>Limited Power of Attorney</h1><div>Credit Comeback Club · Executed ${escapeHtml(date)}</div></div><p>This Limited Power of Attorney is between <strong>${escapeHtml(client.name)}</strong> (Principal) and Credit Comeback Club (Attorney-in-Fact).</p><h2>Grant of authority</h2><p>The Principal authorizes Credit Comeback Club solely to prepare and submit dispute correspondence, send certified mail, receive and respond to dispute-related correspondence, and prepare consumer-protection complaints related to the client’s credit-dispute campaign.</p><h2>Limitations</h2><p>This authorization does not permit financial decisions, access to accounts, settlement of claims, or disputing information the Principal knows is accurate. The selected service plan is: ${escapeHtml(plan.label)}. This authorization is effective until written revocation or completion of the dispute work.</p><h2>Electronic signature</h2><p>This document was signed electronically as part of the related Service Agreement packet.</p><div class="signatures"><div class="signature"><div class="line">${clientSignatureHtml}</div><div class="small"><strong>${escapeHtml(client.signerName || client.name)}</strong> — Principal<br>${escapeHtml(date)}</div></div><div class="signature"><div class="line">${attorneySignatureHtml}</div><div class="small"><strong>Christopher Holland</strong> — Attorney-in-Fact<br>${escapeHtml(date)}</div></div></div></body></html>`;
}

module.exports = { AGREEMENT_TEMPLATE_VERSION, CONTACT, LPOA_TEXT, ELECTRONIC_ACKNOWLEDGEMENT_TEXT, escapeHtml, sha256, randomToken, planSnapshot, renderPacket, renderLpoaOnly };
