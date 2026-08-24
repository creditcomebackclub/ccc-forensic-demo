const crypto = require('crypto');

const LEGACY_AGREEMENT_TEMPLATE_VERSION = 'ccc-service-agreement-v1-draft';
const PRIOR_SERVICE_ONLY_AGREEMENT_TEMPLATE_VERSION = 'ccc-service-agreement-v2-service-only';
const AGREEMENT_TEMPLATE_VERSION = 'ccc-service-agreement-v3-no-first-work';
const ACTIVE_PRICING_VERSION = 'ccc-pricing-v3-pif-849-2026-08-23';
const SERVICE_ONLY_PACKET_KIND = 'service_agreement_only';
const UNRESOLVED_PRINCIPAL_ADDRESS = '[PRINCIPAL BUSINESS ADDRESS REQUIRED BEFORE APPROVAL]';
const PRINCIPAL_BUSINESS_ADDRESS = '3088 Colorado Ave, Grand Junction, CO 81504';
const CANCELLATION_CALENDAR_KIND = 'weekdays_only_counsel_approved';
const PLAN_SCOPE_VERSION = 'ccc-plan-scope-v1-2026-08-21';
const CONTACT = {
  phone: '970-644-0063',
  city: 'Grand Junction',
  state: 'CO',
  zip: '81504',
  site: 'creditcomebackclub.com',
  email: 'info@creditcomebackclub.com',
};
const DEFAULT_TIER_PRICING = Object.freeze({
  Standard: Object.freeze({ monthlyFee: 149, label: 'Standard', serviceTerm: 'month-to-month service plan' }),
  VIP: Object.freeze({ monthlyFee: 299, label: 'VIP', serviceTerm: 'month-to-month service plan' }),
  'Paid In Full': Object.freeze({ flatFee: 849, flatMonths: 6, label: 'Paid In Full', serviceTerm: 'six months of Standard service' }),
});
const PLAN_SERVICE_SCOPES = Object.freeze({
  Standard: Object.freeze({
    scopeBasis: 'Standard',
    correspondenceLimit: 3,
    correspondencePeriod: 'monthly service cycle',
    includedServices: Object.freeze([
      'Review of the client-provided credit file and supporting materials.',
      'Preparation and management of individualized disputes or related correspondence when supported by the reviewed file.',
      'Up to 3 individualized correspondence pieces per monthly service cycle when supported by the reviewed file.',
      'Campaign status and document access through the client portal.',
    ]),
    qualifiers: Object.freeze([
      'The correspondence limit is a maximum, not a guaranteed quantity; the reviewed file controls what work is appropriate.',
      'Recipient response times and outcomes remain outside Credit Comeback Club’s control.',
    ]),
  }),
  VIP: Object.freeze({
    scopeBasis: 'VIP',
    correspondenceLimit: 5,
    correspondencePeriod: 'monthly service cycle',
    includedServices: Object.freeze([
      'Everything included in Standard service.',
      'One private 1-to-1 strategy call with Chris during each monthly service cycle.',
      'Chris personally reviews, directs, and works on the client’s file.',
      'Priority handling within Credit Comeback Club’s internal workflow.',
      'Up to 5 individualized correspondence pieces per monthly service cycle when supported by the reviewed file.',
      'Exclusive access to Credit Comeback Club’s funding-partner network, plus a fast-track funding-readiness review and priority partner referral when eligible.',
    ]),
    qualifiers: Object.freeze([
      'Priority handling applies only to Credit Comeback Club’s internal workflow and does not shorten bureau, furnisher, collector, or other third-party response times.',
      'Funding partners independently determine eligibility. Access, review, or referral does not guarantee approval, funding amount, rate, terms, or timing.',
      'The correspondence limit is a maximum, not a guaranteed quantity; the reviewed file controls what work is appropriate.',
    ]),
  }),
  'Paid In Full': Object.freeze({
    scopeBasis: 'Standard',
    correspondenceLimit: 3,
    correspondencePeriod: 'monthly service cycle during the six-month term',
    includedServices: Object.freeze([
      'Six months of Standard service.',
      'Review of the client-provided credit file and supporting materials.',
      'Preparation and management of individualized disputes or related correspondence when supported by the reviewed file.',
      'Up to 3 individualized correspondence pieces per monthly service cycle during the six-month term when supported by the reviewed file.',
      'Campaign status and document access through the client portal.',
    ]),
    qualifiers: Object.freeze([
      'Paid In Full changes the payment schedule, not the Standard service scope.',
      'The correspondence limit is a maximum, not a guaranteed quantity; the reviewed file controls what work is appropriate.',
      'Recipient response times and outcomes remain outside Credit Comeback Club’s control.',
    ]),
  }),
});
const LPOA_TEXT = 'The client authorizes Credit Comeback Club only to prepare and submit dispute correspondence, send certified mail, receive and respond to dispute-related correspondence, and prepare appropriate consumer-protection complaints. This authorization does not permit financial decisions, account access, settlement of claims, or disputing information the client knows is accurate. It remains effective until revoked in writing or the dispute work is complete.';
const ELECTRONIC_ACKNOWLEDGEMENT_TEXT = 'By signing, the client acknowledges receipt of the Service Agreement and Limited Power of Attorney, consents to electronic records and signatures, and confirms that the selected plan summary is part of the agreement packet.';
const SERVICE_ONLY_ELECTRONIC_ACKNOWLEDGEMENT_TEXT = 'By signing, the client acknowledges the Service Agreement and selected plan terms, separately acknowledges receipt of the Consumer Credit File Rights disclosure, and consents to electronic records and signatures.';
const CONSUMER_DISCLOSURE_TITLE = 'Consumer Credit File Rights Under State and Federal Law';
const CONSUMER_DISCLOSURE_TEXT = `You have a right to dispute inaccurate information in your credit report by contacting the credit bureau directly. However, neither you nor any “credit repair” company or credit repair organization has the right to have accurate, current, and verifiable information removed from your credit report. The credit bureau must remove accurate, negative information from your report only if it is over 7 years old. Bankruptcy information can be reported for 10 years.

You have a right to obtain a copy of your credit report from a credit bureau. You may be charged a reasonable fee. There is no fee, however, if you have been turned down for credit, employment, insurance, or a rental dwelling because of information in your credit report within the preceding 60 days. The credit bureau must provide someone to help you interpret the information in your credit file.

You are entitled to receive a free copy of your credit report if you are unemployed and intend to apply for employment in the next 60 days, if you are a recipient of public welfare assistance, or if you have reason to believe that there is inaccurate information in your credit report due to fraud.

You have a right to sue a credit repair organization that violates the Credit Repair Organization Act. This law prohibits deceptive practices by credit repair organizations.

You have the right to cancel your contract with any credit repair organization for any reason within 3 business days from the date you signed it.

Credit bureaus are required to follow reasonable procedures to ensure that the information they report is accurate. However, mistakes may occur.

You may, on your own, notify a credit bureau in writing that you dispute the accuracy of information in your credit file. The credit bureau must then reinvestigate and modify or remove inaccurate or incomplete information. The credit bureau may not charge any fee for this service. Any pertinent information and copies of all documents you have concerning an error should be given to the credit bureau.

If the credit bureau’s reinvestigation does not resolve the dispute to your satisfaction, you may send a brief statement to the credit bureau, to be kept in your file, explaining why you think the record is inaccurate. The credit bureau must include a summary of your statement about disputed information with any report it issues about you.

The Federal Trade Commission regulates credit bureaus and credit repair organizations. For more information contact:

The Public Reference Branch
Federal Trade Commission
Washington, D.C. 20580`;
const CANCELLATION_NOTICE_TITLE = 'Notice of Cancellation';
const CONTRACT_CANCELLATION_SIGNATURE_NOTICE = 'You may cancel this contract without penalty or obligation at any time before midnight of the 3rd business day after the date on which you signed the contract. See the attached notice of cancellation form for an explanation of this right.';
const CANCELLATION_NOTICE_TEXT = `You may cancel this contract, without any penalty or obligation, at any time before midnight of the 3rd day which begins after the date the contract is signed by you.

To cancel this contract, mail or deliver a signed, dated copy of this cancellation notice, or any other written notice to Credit Comeback Club at ${PRINCIPAL_BUSINESS_ADDRESS} before midnight on {{cancellation_date}}.

I hereby cancel this transaction,

Date: ______________________________

Purchaser’s signature: ______________________________`;

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

function isServiceAgreementOnly(templateVersion, packetKind) {
  return packetKind === SERVICE_ONLY_PACKET_KIND
    || templateVersion === AGREEMENT_TEMPLATE_VERSION
    || templateVersion === PRIOR_SERVICE_ONLY_AGREEMENT_TEMPLATE_VERSION;
}

function templateLiveReadiness(template = {}) {
  const blockers = [];
  const body = String(template.body_html || '');
  const disclosure = String(template.consumer_disclosure_html || '');
  if (template.legal_status !== 'approved') blockers.push('COUNSEL_APPROVAL_REQUIRED');
  if (!body.trim()) blockers.push('AGREEMENT_BODY_REQUIRED');
  if (isServiceAgreementOnly(template.version, template.packet_kind) && !disclosure.trim()) blockers.push('SEPARATE_DISCLOSURE_REQUIRED');
  if (isServiceAgreementOnly(template.version, template.packet_kind) && !String(template.cancellation_notice_html || '').trim()) blockers.push('DUPLICATE_CANCELLATION_NOTICE_REQUIRED');
  if (isServiceAgreementOnly(template.version, template.packet_kind) && template.cancellation_calendar_kind !== CANCELLATION_CALENDAR_KIND) blockers.push('CANCELLATION_CALENDAR_COUNSEL_APPROVAL_REQUIRED');
  if (`${body}\n${disclosure}`.includes(UNRESOLVED_PRINCIPAL_ADDRESS)) blockers.push('PRINCIPAL_BUSINESS_ADDRESS_REQUIRED');
  return { ready: blockers.length === 0, blockers };
}

function calculateCancellationWindow(signedAt, calendarKind = '') {
  if (calendarKind !== CANCELLATION_CALENDAR_KIND) {
    throw new Error('Cancellation calendar is pending counsel approval. Signing is blocked.');
  }
  const signed = new Date(signedAt);
  if (!Number.isFinite(signed.getTime())) throw new Error('A valid signing time is required.');
  const localParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(signed).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
  let cursor = new Date(Date.UTC(Number(localParts.year), Number(localParts.month) - 1, Number(localParts.day)));
  let counted = 0;
  while (counted < 3) {
    cursor = new Date(cursor.getTime() + 86_400_000);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) counted += 1;
  }
  const cancellationDate = new Date(cursor);
  const serviceEligibleAt = new Date(Date.UTC(
    cancellationDate.getUTCFullYear(), cancellationDate.getUTCMonth(), cancellationDate.getUTCDate() + 1, 7, 0, 0,
  ));
  return {
    cancellationDate: cancellationDate.toISOString().slice(0, 10),
    cancellationDateLabel: cancellationDate.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }),
    cancellationDeadline: serviceEligibleAt.toISOString(),
    serviceEligibleAt: serviceEligibleAt.toISOString(),
    calendarKind,
    timeZone: 'America/Phoenix',
  };
}

function normalizeMoney(value, label, { allowNull = false } = {}) {
  if (value == null || value === '') {
    if (allowNull) return null;
    throw new Error(`${label} is required.`);
  }
  if (typeof value === 'string' && !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(value.trim())) {
    throw new Error(`${label} must be a positive amount with no more than two decimal places.`);
  }
  const amount = Number(value);
  const cents = amount * 100;
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(cents))
      || Math.abs(cents - Math.round(cents)) > 1e-8) {
    throw new Error(`${label} must be a positive amount with no more than two decimal places.`);
  }
  return Math.round(cents) / 100;
}

function planSnapshot(client, pricing = {}) {
  const custom = client.service_agreement_mode === 'custom';
  if (custom) {
    const label = String(client.service_agreement_label || '').trim();
    const feeText = String(client.service_agreement_fee_text || '').trim();
    if (!label) throw new Error('Custom service agreement needs a saved plan label.');
    if (!feeText) throw new Error('Custom service agreement needs saved fee terms.');
    const rawAmount = client.service_agreement_amount;
    const amount = normalizeMoney(rawAmount, 'Custom service agreement amount', { allowNull: true });
    const billingType = String(client.billing_type || '').trim();
    if (!['Automated Recurring', 'Paid in Full'].includes(billingType)) {
      throw new Error('Custom billing requires a saved monthly recurring or one-time billing schedule.');
    }
    const recurring = billingType === 'Automated Recurring';
    if (recurring) {
      if (amount == null || amount <= 0) {
        throw new Error('Custom monthly billing requires a saved monthly amount greater than zero.');
      }
      const savedRecurring = normalizeMoney(
        client.billing_recurring_amount ?? client.billingRecurringAmount,
        'Saved custom monthly fee',
      );
      if (savedRecurring !== amount) {
        throw new Error('Custom monthly amount must match the saved recurring billing amount.');
      }
    }
    return {
      mode: 'custom', label, amount, feeText,
      monthlyFee: recurring ? amount : null,
      flatFee: recurring ? null : amount,
      flatMonths: null,
      firstMonthlyPayment: recurring ? amount : null,
      serviceTerm: recurring ? 'custom monthly service plan' : 'custom one-time service package',
      billingTier: null,
      billingType,
      expectedBillingType: billingType,
      pricingSource: 'saved_client_custom_agreement', pricingSettingsHash: null,
    };
  }

  const tier = String(client.billing_tier || '').trim();
  if (!Object.hasOwn(DEFAULT_TIER_PRICING, tier)) throw new Error('Select and save a supported billing tier before preparing the agreement.');
  const billingType = String(client.billing_type || '').trim() || null;
  const expectedBillingType = tier === 'Paid In Full' ? 'Paid in Full' : 'Automated Recurring';
  if (billingType && billingType !== expectedBillingType) {
    throw new Error(`${tier} requires Billing Type “${expectedBillingType}” before preparing the agreement.`);
  }
  if (pricing == null || typeof pricing !== 'object' || Array.isArray(pricing)) throw new Error('Saved pricing settings are malformed.');
  const pricingVersion = String(pricing.version || '');
  const tiers = pricing.tiers == null ? {} : pricing.tiers;
  if (typeof tiers !== 'object' || Array.isArray(tiers)) throw new Error('Saved tier pricing settings are malformed.');
  // Unversioned saved settings belong to the retired First Work schedule.
  // Ignore them for every new snapshot; only the active pricing version may
  // override the owner-approved defaults below.
  const tierOverride = pricingVersion === ACTIVE_PRICING_VERSION
    ? (tiers[tier] == null ? {} : tiers[tier])
    : {};
  const ignoredLegacyPricing = pricingVersion !== ACTIVE_PRICING_VERSION
    && Object.keys(tiers).length > 0;
  if (typeof tierOverride !== 'object' || Array.isArray(tierOverride)) throw new Error(`Saved ${tier} pricing settings are malformed.`);
  const defaults = DEFAULT_TIER_PRICING[tier];
  const hasOverride = (field) => Object.hasOwn(tierOverride, field) && tierOverride[field] != null;
  if (tier === 'Paid In Full' && hasOverride('monthlyFee')) {
    throw new Error('Paid In Full pricing cannot contain a monthlyFee override.');
  }
  if (tier !== 'Paid In Full' && (hasOverride('flatFee') || hasOverride('flatMonths'))) {
    throw new Error(`${tier} pricing cannot contain flatFee or flatMonths overrides.`);
  }
  const normalized = tier === 'Paid In Full'
    ? {
        monthlyFee: null,
        flatFee: normalizeMoney(hasOverride('flatFee') ? tierOverride.flatFee : defaults.flatFee, 'Saved flatFee'),
        flatMonths: Number(hasOverride('flatMonths') ? tierOverride.flatMonths : defaults.flatMonths),
      }
    : {
        monthlyFee: normalizeMoney(hasOverride('monthlyFee') ? tierOverride.monthlyFee : defaults.monthlyFee, `Saved ${tier} monthlyFee`),
        flatFee: null,
        flatMonths: null,
      };
  if (tier === 'Paid In Full') {
    if (!Number.isInteger(normalized.flatMonths) || normalized.flatMonths !== 6) {
      throw new Error('Paid In Full must cover exactly 6 months of Standard service.');
    }
  }

  let recurringOverrideApplied = false;
  const rawRecurring = client.billing_recurring_amount ?? client.billingRecurringAmount;
  if (tier !== 'Paid In Full' && rawRecurring != null && rawRecurring !== '') {
    const recurring = normalizeMoney(rawRecurring, 'Saved custom monthly fee');
    normalized.monthlyFee = recurring;
    recurringOverrideApplied = true;
  }
  const feeText = tier === 'Paid In Full'
    ? `$${normalized.flatFee} flat for ${normalized.flatMonths} months of service.`
    : `$${normalized.monthlyFee}/month.`;
  return {
    mode: 'tier', billingTier: tier, label: String(defaults.label || tier),
    amount: normalized.flatFee ?? normalized.monthlyFee,
    ...normalized,
    firstMonthlyPayment: tier === 'Paid In Full' ? null : normalized.monthlyFee,
    feeText,
    serviceTerm: String(defaults.serviceTerm || ''),
    billingType,
    expectedBillingType,
    serviceScopeVersion: PLAN_SCOPE_VERSION,
    serviceScope: JSON.parse(JSON.stringify(PLAN_SERVICE_SCOPES[tier])),
    recurringOverrideApplied,
    pricingSource: ignoredLegacyPricing
      ? 'owner_approved_defaults_retired_legacy_settings'
      : String(pricing.source || 'default_settings'),
    pricingSettingsHash: pricing.settingsHash || null,
    pricingVersion: ACTIVE_PRICING_VERSION,
  };
}

function renderPlanScopeSummary(plan = {}) {
  const scope = plan.serviceScope;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return '';
  const included = Array.isArray(scope.includedServices) ? scope.includedServices : [];
  const qualifiers = Array.isArray(scope.qualifiers) ? scope.qualifiers : [];
  if (!included.length) return '';
  const itemHtml = included.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const qualifierHtml = qualifiers.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  return `<dt>Included service scope</dt><dd><ul>${itemHtml}</ul>${qualifierHtml ? `<p><strong>Important limits:</strong></p><ul>${qualifierHtml}</ul>` : ''}</dd>`;
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

function renderServiceAgreementOnlyPacket({ client, plan, signedAt, clientSignatureHtml, approved, approvedTermsHtml = '' }) {
  const signingDate = signedAt ? new Date(signedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Pending signature';
  const title = approved ? 'Client Service Agreement' : 'Draft Client Service Agreement';
  const draftBanner = approved ? '' : '<div class="draft">COUNSEL REVIEW REQUIRED — THIS DRAFT CANNOT BE SENT OR SIGNED</div>';
  const signer = clientSignatureHtml || '<span class="pending">Awaiting client signature</span>';
  const money = (value) => value == null ? null : `$${Number(value).toFixed(2)}`;
  const priceRows = [
    plan.monthlyFee == null ? '' : `<dt>Monthly service price</dt><dd>${escapeHtml(money(plan.monthlyFee))}</dd>`,
    plan.flatFee == null ? '' : `<dt>Flat service price</dt><dd>${escapeHtml(money(plan.flatFee))}</dd>`,
    plan.firstWorkFee == null ? '' : `<dt>First Work Fee</dt><dd>${escapeHtml(money(plan.firstWorkFee))}</dd>`,
  ].join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
    body{font-family:Arial,sans-serif;color:#161616;font-size:12px;line-height:1.55;margin:38px auto;max-width:760px;padding:0 30px}.brand{background:#1B2A4A;color:#fff;padding:24px 28px}.brand h1{color:#C9A84C;margin:0;font-size:19px}.brand p{margin:5px 0 0;font-size:11px}.draft{margin:18px 0;padding:10px 12px;background:#fff7ed;border:1px solid #f59e0b;color:#92400e;font-weight:bold}h2{font-size:12px;background:#1B2A4A;color:#fff;padding:6px 10px;margin:23px 0 9px;text-transform:uppercase;letter-spacing:.04em}.summary{border:1px solid #d9dee7;background:#f8fafc;padding:14px}.summary dt{font-weight:bold;float:left;clear:left;width:155px}.summary dd{margin-left:165px;margin-bottom:6px}.sigrow{display:flex;gap:36px;margin-top:30px}.sig{width:50%}.sigline{min-height:66px;border-bottom:1px solid #111;display:flex;align-items:flex-end;padding-bottom:4px}.small{font-size:10px;color:#555}.pending{color:#777;font-style:italic}.footer{font-size:10px;color:#666;text-align:center;margin-top:36px;border-top:1px solid #ddd;padding-top:12px}@media print{body{margin:0;max-width:none}.draft{display:none}}</style></head><body>
    <div class="brand"><h1>Credit Comeback Club</h1><p>${escapeHtml(title)} · ${escapeHtml(CONTACT.site)} · ${escapeHtml(CONTACT.phone)}</p></div>${draftBanner}
    <p><strong>Client:</strong> ${escapeHtml(client.name)}<br><strong>Agreement date:</strong> ${escapeHtml(signingDate)}</p>
    <h2>Selected service plan</h2><div class="summary"><dl><dt>Plan</dt><dd>${escapeHtml(plan.label)}</dd><dt>Service term</dt><dd>${escapeHtml(plan.serviceTerm)}</dd>${priceRows}<dt>Exact fee terms</dt><dd>${escapeHtml(plan.feeText || 'To be supplied in counsel-approved terms.')}</dd>${renderPlanScopeSummary(plan)}<dt>Signing action</dt><dd>No payment is created or collected by this signing process.</dd></dl></div>
    <h2>Client Service Agreement</h2>${approved && approvedTermsHtml ? approvedTermsHtml : '<p>The final counsel-approved agreement terms, service description, payment terms, and cancellation materials will appear in this versioned agreement. Credit Comeback Club does not guarantee any particular credit outcome.</p>'}
    <h2>Electronic records and acknowledgements</h2><p>${escapeHtml(SERVICE_ONLY_ELECTRONIC_ACKNOWLEDGEMENT_TEXT)}</p>
    <p style="font-size:14px;font-weight:bold;border:2px solid #111;padding:10px;margin:18px 0 4px">${escapeHtml(CONTRACT_CANCELLATION_SIGNATURE_NOTICE)}</p>
    <div class="sigrow"><div class="sig"><div class="sigline">${signer}</div><div class="small"><strong>${escapeHtml(client.signerName || client.name)}</strong> — Client<br>Date: ${escapeHtml(signingDate)}</div></div></div>
    <div class="footer">Credit Comeback Club · ${escapeHtml(CONTACT.phone)} · ${escapeHtml(CONTACT.site)} · ${escapeHtml(CONTACT.email)}</div>
  </body></html>`;
}

function sanitizeDisclosurePresentationHtml(value) {
  const withoutActivePresentation = String(value || '')
    .replace(/<(style|script)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<link\b[^>]*>/gi, '');
  return withoutActivePresentation.replace(/<[^>]*>/g, (tag) => {
    const match = tag.match(/^<\s*(\/?)\s*(h[1-6]|p|br|strong|em|ul|ol|li)\b[^>]*>$/i);
    if (!match) return '';
    const closing = match[1] === '/';
    const name = match[2].toLowerCase();
    if (name === 'br') return '<br>';
    return `<${closing ? '/' : ''}${name}>`;
  });
}

function renderConsumerDisclosure({ client, signedAt, clientSignatureHtml, disclosureHtml = '', disclosureText = CONSUMER_DISCLOSURE_TEXT }) {
  const signingDate = signedAt ? new Date(signedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Pending signature';
  const signer = clientSignatureHtml || '<span class="pending">Awaiting client signature</span>';
  const approvedCopy = String(disclosureHtml || '').trim();
  const disclosureCopy = approvedCopy
    ? sanitizeDisclosurePresentationHtml(approvedCopy)
    : `<div class="preline">${escapeHtml(disclosureText)}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(CONSUMER_DISCLOSURE_TITLE)}</title><style>body{font-family:Arial,sans-serif;color:#161616;font-size:14px;line-height:1.6;margin:38px auto;max-width:760px;padding:0 30px}.brand{background:#1B2A4A;color:#fff;padding:22px 26px}.brand h1{color:#C9A84C;margin:0;font-size:18px}.copy{margin:24px 0}.copy,.copy *{font-size:14px!important;font-weight:700!important}.copy .preline{white-space:pre-line}.sigline{min-height:66px;border-bottom:1px solid #111;display:flex;align-items:flex-end;padding-bottom:4px;max-width:330px}.small{font-size:10px;color:#555}.footer{font-size:10px;color:#666;text-align:center;margin-top:36px;border-top:1px solid #ddd;padding-top:12px}</style></head><body><div class="brand"><h1>${escapeHtml(CONSUMER_DISCLOSURE_TITLE)}</h1><div>Separate Consumer Rights Disclosure</div></div><div class="copy">${disclosureCopy}</div><p><strong>Acknowledgment of receipt:</strong> I acknowledge that I received this disclosure as a separate document before executing the Client Service Agreement.</p><div class="sigline">${signer}</div><div class="small"><strong>${escapeHtml(client.signerName || client.name)}</strong> — Client<br>Date: ${escapeHtml(signingDate)}</div><div class="footer">Credit Comeback Club · ${escapeHtml(CONTACT.phone)} · ${escapeHtml(CONTACT.site)} · ${escapeHtml(CONTACT.email)}</div></body></html>`;
}

function fillCancellationNoticeHtml(noticeHtml, cancellationDateLabel) {
  return String(noticeHtml || '').replaceAll('{{cancellation_date}}', escapeHtml(cancellationDateLabel));
}

function renderCancellationNotices({ client, signedAt, cancellationDateLabel, noticeHtml = '' }) {
  const contractDate = new Date(signedAt).toLocaleDateString('en-US', { timeZone: 'America/Phoenix', month: 'long', day: 'numeric', year: 'numeric' });
  const copy = fillCancellationNoticeHtml(noticeHtml, cancellationDateLabel)
    || `<div style="white-space:pre-line">${escapeHtml(CANCELLATION_NOTICE_TEXT.replaceAll('{{cancellation_date}}', cancellationDateLabel))}</div>`;
  const form = (copyNumber) => `<section class="notice"><h1>${escapeHtml(CANCELLATION_NOTICE_TITLE)}</h1><p><strong>Contract date:</strong> ${escapeHtml(contractDate)}</p><div class="notice-copy">${copy}</div><p class="copy-label">Consumer copy ${copyNumber} of 2</p></section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(CANCELLATION_NOTICE_TITLE)}</title><style>body{font-family:Arial,sans-serif;color:#111;font-size:12px;line-height:1.6;margin:0}.notice{box-sizing:border-box;min-height:100vh;padding:48px}.notice+ .notice{page-break-before:always}.notice h1{text-align:center;text-transform:uppercase;font-size:18px}.notice-copy{font-weight:bold;white-space:normal}.copy-label{margin-top:34px;color:#555;font-size:10px}.footer{position:fixed;bottom:24px;left:48px;right:48px;text-align:center;color:#666;font-size:9px}</style></head><body>${form(1)}${form(2)}<div class="footer">Credit Comeback Club · ${escapeHtml(CONTACT.phone)} · ${escapeHtml(CONTACT.site)}</div></body></html>`;
}

function renderLpoaOnly({ client, plan, signedAt, clientSignatureHtml, attorneySignatureHtml }) {
  const date = new Date(signedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:12px;line-height:1.55;margin:40px;color:#111}.header{background:#1B2A4A;color:#fff;padding:18px 24px;margin:-40px -40px 28px}.header h1{color:#C9A84C;margin:0;font-size:18px}h2{font-size:11px;background:#1B2A4A;color:#fff;padding:5px 10px;text-transform:uppercase}.signatures{display:flex;gap:36px;margin-top:28px}.signature{width:50%}.line{min-height:62px;border-bottom:1px solid #111;display:flex;align-items:flex-end}.small{font-size:10px;color:#555}</style></head><body><div class="header"><h1>Limited Power of Attorney</h1><div>Credit Comeback Club · Executed ${escapeHtml(date)}</div></div><p>This Limited Power of Attorney is between <strong>${escapeHtml(client.name)}</strong> (Principal) and Credit Comeback Club (Attorney-in-Fact).</p><h2>Grant of authority</h2><p>The Principal authorizes Credit Comeback Club solely to prepare and submit dispute correspondence, send certified mail, receive and respond to dispute-related correspondence, and prepare consumer-protection complaints related to the client’s credit-dispute campaign.</p><h2>Limitations</h2><p>This authorization does not permit financial decisions, access to accounts, settlement of claims, or disputing information the Principal knows is accurate. The selected service plan is: ${escapeHtml(plan.label)}. This authorization is effective until written revocation or completion of the dispute work.</p><h2>Electronic signature</h2><p>This document was signed electronically as part of the related Service Agreement packet.</p><div class="signatures"><div class="signature"><div class="line">${clientSignatureHtml}</div><div class="small"><strong>${escapeHtml(client.signerName || client.name)}</strong> — Principal<br>${escapeHtml(date)}</div></div><div class="signature"><div class="line">${attorneySignatureHtml}</div><div class="small"><strong>Christopher Holland</strong> — Attorney-in-Fact<br>${escapeHtml(date)}</div></div></div></body></html>`;
}

module.exports = {
  AGREEMENT_TEMPLATE_VERSION,
  LEGACY_AGREEMENT_TEMPLATE_VERSION,
  PRIOR_SERVICE_ONLY_AGREEMENT_TEMPLATE_VERSION,
  ACTIVE_PRICING_VERSION,
  SERVICE_ONLY_PACKET_KIND,
  UNRESOLVED_PRINCIPAL_ADDRESS,
  PRINCIPAL_BUSINESS_ADDRESS,
  CANCELLATION_CALENDAR_KIND,
  PLAN_SCOPE_VERSION,
  CONTACT,
  DEFAULT_TIER_PRICING,
  PLAN_SERVICE_SCOPES,
  LPOA_TEXT,
  ELECTRONIC_ACKNOWLEDGEMENT_TEXT,
  SERVICE_ONLY_ELECTRONIC_ACKNOWLEDGEMENT_TEXT,
  CONSUMER_DISCLOSURE_TITLE,
  CONSUMER_DISCLOSURE_TEXT,
  CANCELLATION_NOTICE_TITLE,
  CONTRACT_CANCELLATION_SIGNATURE_NOTICE,
  CANCELLATION_NOTICE_TEXT,
  escapeHtml,
  sha256,
  randomToken,
  isServiceAgreementOnly,
  templateLiveReadiness,
  calculateCancellationWindow,
  planSnapshot,
  renderPlanScopeSummary,
  renderPacket,
  renderServiceAgreementOnlyPacket,
  sanitizeDisclosurePresentationHtml,
  renderConsumerDisclosure,
  fillCancellationNoticeHtml,
  renderCancellationNotices,
  renderLpoaOnly,
};
