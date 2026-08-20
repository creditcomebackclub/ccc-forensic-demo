const HUMAN_SECTION_TOKENS = new Set([
  'damages',
  'personalization',
  'penalty',
  'consumer_statement',
  'optional_strengthener',
]);

export const TEMPLATE_FIELD_GROUPS = {
  automatic: [
    'client_first_name', 'client_last_name', 'client_name', 'client_address',
    'ss_number', 'bdate', 'bureau_address', 'bureau_name', 'curr_date',
    'dispute_item_and_explanation', 'account_list', 'report_date', 'screenshots',
    'creditor_name', 'creditor_address', 'creditor_city', 'creditor_state',
    'creditor_zip', 'account_number',
  ],
  human: [...HUMAN_SECTION_TOKENS],
};

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

export function extractTemplateTokens(templateText) {
  const tokens = [];
  const re = /\{\{?\s*([a-zA-Z0-9_ -]+?)\s*\}?\}/g;
  let match;
  while ((match = re.exec(String(templateText || '')))) tokens.push(normalizeToken(match[1]));
  return [...new Set(tokens)];
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
  const tokenRe = /\{\{?\s*([a-zA-Z0-9_ -]+?)\s*\}?\}/g;
  let cursor = 0;
  let html = '';
  let match;
  while ((match = tokenRe.exec(source))) {
    html += textToHtml(source.slice(cursor, match.index));
    const token = normalizeToken(match[1]);
    if (Object.prototype.hasOwnProperty.call(normalizedValues, token)) {
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
    const header = `${account.furnisher || 'Account'} — Account ${account.accountNumberMasked || 'number not shown'}`;
    const issues = (account.violations || []).map((violation) => {
      const facts = [
        violation.issue,
        violation.currentlyReports ? `Currently reports: ${violation.currentlyReports}` : null,
        violation.shouldReport ? `Should report: ${violation.shouldReport}` : null,
      ].filter(Boolean).join(' — ');
      return `• ${violation.field || 'Reporting issue'}: ${facts || 'Review required'}`;
    });
    if (!issues.length && account.primaryViolation) issues.push(`• ${account.primaryViolation}`);
    return [header, ...issues].join('\n');
  }).join('\n\n');
}

function splitClientName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

function maskedSsn(last4) {
  const digits = String(last4 || '').replace(/\D/g, '').slice(-4);
  return digits ? `***-**-${digits}` : '';
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
} = {}) {
  const clientName = identity.name || audit?.client?.name || '';
  const name = splitClientName(clientName);
  return {
    client_first_name: name.first,
    client_last_name: name.last,
    client_name: clientName,
    client_address: identity.address || audit?.client?.address || '',
    ss_number: maskedSsn(identity.ssnLast4),
    bdate: identity.dateOfBirth || audit?.personalInfo?.dateOfBirth || '',
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
    account_number: creditor.accountNumberMasked || creditor.accountNumber || '',
  };
}

export function screenshotsHtml(screenshots = []) {
  const safeScreenshots = screenshots.filter((item) => /^data:image\/(?:png|jpeg|webp);base64,/i.test(String(item?.dataUrl || '')));
  if (!safeScreenshots.length) return '';
  return `<section class="screenshots"><h2>Credit report screenshots</h2>${safeScreenshots.map((item) => (
    `<figure><img src="${escapeHtml(item.dataUrl)}" alt="${escapeHtml(item.name || 'Credit report screenshot')}"><figcaption>${escapeHtml(item.name || '')}</figcaption></figure>`
  )).join('')}</section>`;
}

export function wrapDisputeLetterHtml(bodyHtml, title = 'Dispute Letter') {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title><style>
    @page { size: letter; margin: 0.75in; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0.75in; color: #111827; background: #fff; font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.5; }
    .letter-content { white-space: normal; }
    mark[data-missing-token] { background: #fee2e2; color: #991b1b; padding: 0 2px; }
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
