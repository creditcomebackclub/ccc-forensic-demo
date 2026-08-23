const SHARED_AUTOMATIC_TOKENS = [
  'client_first_name', 'client_last_name', 'client_name', 'client_address', 'curr_date',
];

const CRA_ONLY_AUTOMATIC_TOKENS = [
  'ss_number', 'bdate', 'bureau_address', 'bureau_name',
  'dispute_item_and_explanation', 'account_list', 'report_date', 'screenshots',
];

const DIRECT_ONLY_AUTOMATIC_TOKENS = [
  'creditor_name', 'creditor_address', 'creditor_city', 'creditor_state',
  'creditor_zip', 'account_number',
];

const SHARED_HUMAN_TOKENS = [
  'damages',
  'personalization',
  'penalty',
  'optional_strengthener',
];

export const CRA_TEMPLATE_FLOWS = Object.freeze([
  'accuracy',
  'collection',
  'combo',
  'consent',
  'late_pay',
  'accuracy_solo',
]);

const CRA_TEMPLATE_FLOW_SET = new Set(CRA_TEMPLATE_FLOWS);

export const CRA_TEMPLATE_FIELD_GROUPS = Object.freeze({
  automatic: Object.freeze([...SHARED_AUTOMATIC_TOKENS, ...CRA_ONLY_AUTOMATIC_TOKENS]),
  human: Object.freeze([...SHARED_HUMAN_TOKENS, 'consumer_statement']),
});

export const DIRECT_TEMPLATE_FIELD_GROUPS = Object.freeze({
  automatic: Object.freeze([...SHARED_AUTOMATIC_TOKENS, ...DIRECT_ONLY_AUTOMATIC_TOKENS]),
  human: Object.freeze([...SHARED_HUMAN_TOKENS]),
});

// Union retained for population-contract auditing. Authoring must use
// templateFieldGroupsForFlow(), which enforces the physical recipient.
export const TEMPLATE_FIELD_GROUPS = {
  automatic: [...new Set([
    ...CRA_TEMPLATE_FIELD_GROUPS.automatic,
    ...DIRECT_TEMPLATE_FIELD_GROUPS.automatic,
  ])],
  human: [...new Set([
    ...CRA_TEMPLATE_FIELD_GROUPS.human,
    ...DIRECT_TEMPLATE_FIELD_GROUPS.human,
  ])],
};

export function templateAudienceForFlow(flow) {
  const normalizedFlow = normalizeToken(flow);
  if (normalizedFlow === 'direct') return 'direct';
  if (CRA_TEMPLATE_FLOW_SET.has(normalizedFlow)) return 'cra';
  return null;
}

export function isCraTemplateFlow(flow) {
  return templateAudienceForFlow(flow) === 'cra';
}

export function templateFieldGroupsForFlow(flow) {
  const audience = templateAudienceForFlow(flow);
  const groups = audience === 'cra'
    ? CRA_TEMPLATE_FIELD_GROUPS
    : audience === 'direct'
      ? DIRECT_TEMPLATE_FIELD_GROUPS
      : { automatic: [], human: [] };
  return {
    automatic: [...groups.automatic],
    human: [...groups.human],
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function templateTokenRegex() {
  return /\{\{\s*([a-zA-Z0-9_ -]+?)\s*\}\}|\{\s*([a-zA-Z0-9_ -]+?)\s*\}/g;
}

export function hasMalformedTemplatePlaceholders(templateText) {
  const withoutValidTokens = String(templateText || '').replace(templateTokenRegex(), '');
  return /[{}]/.test(withoutValidTokens);
}

export function extractTemplateTokens(templateText) {
  const tokens = [];
  const re = templateTokenRegex();
  let match;
  while ((match = re.exec(String(templateText || '')))) tokens.push(normalizeToken(match[1] || match[2]));
  return [...new Set(tokens)];
}

export function consumerStatementTokenCount(templateText) {
  return templateTokenCount(templateText, 'consumer_statement');
}

export function templateTokenCount(templateText, expectedToken) {
  const tokenRe = templateTokenRegex();
  let count = 0;
  let match;
  while ((match = tokenRe.exec(String(templateText || '')))) {
    if (normalizeToken(match[1] || match[2]) === normalizeToken(expectedToken)) count += 1;
  }
  return count;
}

export function validateConsumerStatementContract({ flow, body, active = true } = {}) {
  const audience = templateAudienceForFlow(flow);
  const count = consumerStatementTokenCount(body);
  if (audience === 'direct' && count > 0) {
    return 'Direct templates cannot contain {consumer_statement}; Consumer Statements are bureau/CRA-only.';
  }
  if (audience === 'cra' && active !== false && count !== 1) {
    return count === 0
      ? 'Active bureau/CRA templates must contain one {consumer_statement} curly.'
      : 'Active bureau/CRA templates must contain exactly one {consumer_statement} curly.';
  }
  return null;
}

export function disallowedTemplateTokensForFlow(flow, templateText) {
  const groups = templateFieldGroupsForFlow(flow);
  const allowed = new Set([...groups.automatic, ...groups.human]);
  return extractTemplateTokens(templateText).filter((token) => !allowed.has(token));
}

export function validateTemplateTokenContract({ flow, body, active = true } = {}) {
  const audience = templateAudienceForFlow(flow);
  if (!audience) {
    return `Unknown physical template flow "${String(flow || '').trim() || '(blank)'}"; no curlys are permitted.`;
  }

  if (hasMalformedTemplatePlaceholders(body)) {
    return 'Template contains a malformed curly. Use only {field_name} or {{ field_name }} placeholders.';
  }

  const screenshotCount = templateTokenCount(body, 'screenshots');
  if (screenshotCount > 1) return 'A template may contain at most one {screenshots} exhibit anchor.';
  if (screenshotCount === 1 && !/(?:\{\{\s*screenshots\s*\}\}|\{\s*screenshots\s*\})\s*$/i.test(String(body || ''))) {
    return '{screenshots} must be the final template field so the mailed exhibits follow the letter in the reviewed order.';
  }

  const consumerStatementError = validateConsumerStatementContract({ flow, body, active });
  if (consumerStatementError) return consumerStatementError;

  const disallowed = disallowedTemplateTokensForFlow(flow, body);
  if (!disallowed.length) return null;
  const recipient = audience === 'direct' ? 'Direct-to-collector' : 'Bureau/CRA';
  return `${recipient} templates cannot contain curlys outside their allowlist: ${disallowed.map((token) => `{${token}}`).join(', ')}.`;
}

export function unknownTemplateTokens(templateText, values = {}) {
  const known = new Set(Object.keys(values).map(normalizeToken));
  return extractTemplateTokens(templateText).filter((token) => !known.has(token));
}

function textToHtml(value) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

export function renderDisputeTemplate(templateText, values = {}, safeHtmlTokens = []) {
  const safe = new Set(safeHtmlTokens.map(normalizeToken));
  const normalizedValues = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [normalizeToken(key), value]),
  );
  const source = String(templateText || '');
  const tokenRe = templateTokenRegex();
  let cursor = 0;
  let html = '';
  let match;
  let consumerStatementRendered = false;
  while ((match = tokenRe.exec(source))) {
    html += textToHtml(source.slice(cursor, match.index));
    const token = normalizeToken(match[1] || match[2]);
    if (token === 'consumer_statement') {
      if (!consumerStatementRendered) {
        consumerStatementRendered = true;
        const statement = Object.prototype.hasOwnProperty.call(normalizedValues, token)
          ? textToHtml(normalizedValues[token] ?? '')
          : `<mark data-missing-token="consumer_statement">{consumer_statement}</mark>`;
        html += '<section class="consumer-statement" data-ccc-section="consumer_statement" aria-labelledby="consumer-statement-heading">'
          + '<h2 id="consumer-statement-heading">Consumer Statement:</h2>'
          + `<div class="consumer-statement__body">${statement}</div></section>`;
      }
    } else if (Object.prototype.hasOwnProperty.call(normalizedValues, token)) {
      const value = normalizedValues[token] ?? '';
      html += safe.has(token) ? String(value) : textToHtml(value);
    } else {
      html += `<mark data-missing-token="${escapeHtml(token)}">{${escapeHtml(token)}}</mark>`;
    }
    cursor = match.index + match[0].length;
  }
  html += textToHtml(source.slice(cursor));
  return html;
}

export function disputeItemsText(accounts = []) {
  return accounts.map((account) => {
    const header = `${account.furnisher || 'Account'} — Account ${maskAccountNumber(account.accountNumberMasked || account.accountNumber) || 'number not shown'}`;
    const selectedReasons = Array.isArray(account.selectedReasons) ? account.selectedReasons : null;
    const issues = (selectedReasons || account.violations || []).map((violation) => {
      const facts = [
        violation.issue,
        violation.currentlyReports ? `Currently reports: ${violation.currentlyReports}` : null,
        violation.shouldReport
          ? `Should report: ${violation.shouldReport}`
          : violation.challengeStatement
            ? `Requested action: ${violation.challengeStatement}`
            : null,
      ].filter(Boolean).join(' — ');
      return `• ${violation.field || 'Reporting issue'}: ${facts || 'Review required'}`;
    });
    if (!selectedReasons && !issues.length && String(account.primaryViolation || '').trim()) issues.push(`• ${String(account.primaryViolation).trim()}`);
    if (!issues.length) return '';
    return [header, ...issues].join('\n');
  }).filter(Boolean).join('\n\n');
}

export function accountsMissingConfirmedDisputeFacts(accounts = []) {
  return accounts.filter((account) => {
    const reasons = Array.isArray(account.selectedReasons) ? account.selectedReasons : (account.violations || []);
    const hasFinding = reasons.some((violation) => String(
      violation?.issue || violation?.reason || violation?.primaryViolation || '',
    ).trim());
    return !hasFinding && (Array.isArray(account.selectedReasons) || !String(account.primaryViolation || '').trim());
  });
}

export function splitClientName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

function maskedSsn(last4) {
  const digits = String(last4 || '').replace(/\D/g, '');
  return digits.length >= 4 ? `***-**-${digits.slice(-4)}` : '';
}

export function maskAccountNumber(value) {
  const normalized = String(value || '').replace(/[^a-zA-Z0-9]/g, '');
  if (normalized.length < 4) return '';
  return `****${normalized.slice(-4)}`;
}

const DOB_MONTHS = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]);

export function formatDateOfBirth(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  let year;
  let month;
  let day;
  let match = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    [, year, month, day] = match.map(Number);
  } else {
    match = source.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (match) [, month, day, year] = match.map(Number);
    else {
      match = source.match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
      if (!match) return '';
      month = DOB_MONTHS.findIndex((label) => label.toLowerCase() === match[1].toLowerCase()) + 1;
      day = Number(match[2]);
      year = Number(match[3]);
    }
  }
  if (!Number.isInteger(year) || year < 1900 || year > new Date().getUTCFullYear()
      || !Number.isInteger(month) || month < 1 || month > 12
      || !Number.isInteger(day) || day < 1 || day > 31) return '';
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return '';
  return `${DOB_MONTHS[month - 1]} ${day}, ${year}`;
}

function currentDateLabel(date = new Date()) {
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// This is the single data contract for automatic letter curlys. CRA campaign
// letters and future direct-to-collector letters must both use this mapper so
// a token cannot silently point at a different client or account property.
export function buildAutomaticTemplateValues({
  identity = {},
  audit = {},
  bureau = {},
  accounts = [],
  screenshots = [],
  creditor = {},
  currentDate = new Date(),
  strictIdentity = false,
} = {}) {
  const clientName = strictIdentity ? (identity.name || '') : (identity.name || audit?.client?.name || '');
  const explicitFirstName = String(identity.firstName || '').trim();
  const explicitLastName = String(identity.lastName || '').trim();
  // Current CCC Campaign Studio supplies both fields from the staff-attested
  // letter-identity record. The full-name split remains only for historical
  // non-CCC callers; it is never accepted by the current CCC save/mail gates.
  const name = explicitFirstName && explicitLastName
    ? { first: explicitFirstName, last: explicitLastName }
    : strictIdentity ? { first: '', last: '' } : splitClientName(clientName);
  return {
    client_first_name: name.first,
    client_last_name: name.last,
    client_name: clientName,
    client_address: strictIdentity ? (identity.address || '') : (identity.address || audit?.client?.address || ''),
    ss_number: maskedSsn(identity.ssnLast4),
    bdate: formatDateOfBirth(identity.dateOfBirth || audit?.personalInfo?.dateOfBirth),
    bureau_address: bureau.address || '',
    bureau_name: bureau.name || '',
    curr_date: currentDateLabel(currentDate),
    report_date: audit?.client?.reportDate || '',
    dispute_item_and_explanation: disputeItemsText(accounts),
    account_list: disputeItemsText(accounts),
    screenshots: screenshotsHtml(screenshots),
    creditor_name: creditor.name || creditor.creditorName || creditor.furnisher || '',
    creditor_address: creditor.address || creditor.creditorAddress || '',
    creditor_city: creditor.city || creditor.creditorCity || '',
    creditor_state: creditor.state || creditor.creditorState || '',
    creditor_zip: creditor.zip || creditor.zipCode || creditor.creditorZip || '',
    account_number: maskAccountNumber(creditor.accountNumberMasked || creditor.accountNumber),
  };
}

export function screenshotsHtml(screenshots = []) {
  const safeScreenshots = screenshots.filter((item) => /^data:image\/(?:png|jpeg|webp);base64,/i.test(String(item?.dataUrl || '')));
  if (!safeScreenshots.length) return '';
  return `<section class="screenshots"><h2>Credit report screenshots</h2>${safeScreenshots.map((item) => (
    `<figure><img src="${escapeHtml(item.dataUrl)}" alt="${escapeHtml(item.fileName || item.name || 'Credit report screenshot')}"><figcaption>${escapeHtml([item.furnisher, item.accountNumberMasked, item.fileName || item.name].filter(Boolean).join(' — '))}</figcaption></figure>`
  )).join('')}</section>`;
}

export function wrapDisputeLetterHtml(bodyHtml, title = 'Dispute Letter') {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title><style>
    @page { size: letter; margin: 0.75in; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0.75in; color: #111827; background: #fff; font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.5; }
    .letter-content { white-space: normal; }
    mark[data-missing-token] { background: #fee2e2; color: #991b1b; padding: 0 2px; }
    .consumer-statement { margin: 1em 0; }
    .consumer-statement h2 { margin: 0 0 0.35em; font: inherit; font-weight: 700; }
    .consumer-statement__body { white-space: normal; }
    .screenshots { break-before: page; }
    .screenshots h2 { font-size: 12pt; margin: 0 0 16px; }
    .screenshots figure { margin: 0 0 20px; break-inside: avoid; }
    .screenshots img { display: block; max-width: 100%; max-height: 8.5in; object-fit: contain; border: 1px solid #d1d5db; }
    .screenshots figcaption { color: #6b7280; font-size: 9pt; margin-top: 6px; }
    @media print { body { padding: 0; } }
  </style></head><body><main class="letter-content">${bodyHtml}</main></body></html>`;
}

function replaceBlock(text, startPattern, endPattern, token) {
  const start = text.search(startPattern);
  if (start < 0) return text;
  const tail = text.slice(start);
  const endMatch = tail.match(endPattern);
  if (!endMatch || endMatch.index === undefined) return text;
  const end = start + endMatch.index;
  return `${text.slice(0, start)}{${token}}\n\n${text.slice(end)}`;
}

// Converts CCC's authoring instructions into explicit merge fields without
// touching the fixed facts or statute language around them.
export function normalizeCourseStyleTemplate(templateText) {
  let text = String(templateText || '').replace(/\r\n/g, '\n');
  text = replaceBlock(text, /^►► WRITE THIS — DAMAGES.*$/m, /^— — — FACTS.*$/m, 'damages');
  text = replaceBlock(text, /^►► WRITE THIS — LIST OF EXACT INACCURACIES.*$/m, /^►► WRITE THIS — PENALTY.*$/m, 'personalization');
  text = replaceBlock(text, /^►► OPTIONAL STRENGTHENER.*$/m, /^►► WRITE THIS — PENALTY.*$/m, 'optional_strengthener');
  text = replaceBlock(text, /^►► WRITE THIS — PENALTY.*$/m, /^— — — DELETION LIST.*$/m, 'penalty');
  text = replaceBlock(text, /^►► WRITE THIS — CONSUMER STATEMENT.*$/m, /^(?:— — — SCREENSHOTS|►► ATTACH ID).*$/m, 'consumer_statement');
  text = text.replace(/^►► PASTE SCREENSHOTS HERE.*$/gm, '{screenshots}');
  text = text.replace(/^►► ATTACH ID \+ PROOF OF ADDRESS.*$/gm, '');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export function templateNeedsHumanSection(templateText, token) {
  return extractTemplateTokens(templateText).includes(normalizeToken(token));
}
