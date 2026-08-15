export const LETTER_CONTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    subject: { type: 'string' },
    summary: { type: 'string' },
    opening: { type: 'array', items: { type: 'string' } },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          accountRef: { type: 'string' },
          heading: { type: 'string' },
          paragraphs: { type: 'array', items: { type: 'string' } },
          bullets: { type: 'array', items: { type: 'string' } },
        },
        required: ['heading', 'paragraphs', 'bullets'],
      },
    },
    demands: { type: 'array', items: { type: 'string' } },
    closing: { type: 'string' },
  },
  required: ['subject', 'summary', 'opening', 'sections', 'demands', 'closing'],
};

export const BUREAU_RECIPIENTS = {
  equifax: ['Equifax Information Services LLC', 'P.O. Box 740256', 'Atlanta, GA 30374-0256'],
  experian: ['Experian Information Solutions Inc.', 'P.O. Box 4500', 'Allen, TX 75013'],
  transunion: ['TransUnion LLC', 'Consumer Dispute Center', 'P.O. Box 2000', 'Chester, PA 19016'],
};

const CSS = `
  @page { size: Letter; margin: 0.72in 0.78in 0.72in; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #172033; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.43; }
  .letter { max-width: 7in; margin: 0 auto; }
  .date-line { margin: 0 0 14pt; }
  .sender-block, .recipient-block { line-height: 1.35; margin: 0 0 14pt; }
  .recipient-block { margin-top: 18pt; }
  .re-line { border-top: 2px solid #1b2a4a; border-bottom: 1px solid #cbd3df; padding: 8pt 0; margin: 18pt 0; font-weight: 700; }
  p { margin: 0 0 10pt; orphans: 3; widows: 3; }
  .section { break-inside: avoid-page; margin-top: 14pt; }
  .section-header { color: #1b2a4a; border-bottom: 1px solid #c6a246; padding: 0 0 4pt; margin: 0 0 8pt; font-size: 10pt; font-weight: 700; text-transform: uppercase; letter-spacing: .055em; }
  .id-table { width: 100%; border-collapse: collapse; margin: 0 0 16pt; table-layout: fixed; }
  .id-table td { border: 1px solid #d7dde6; padding: 6pt 8pt; vertical-align: top; overflow-wrap: anywhere; }
  .id-table td.label { width: 29%; background: #f5f7fa; font-weight: 700; color: #273a60; }
  .account-card { break-inside: avoid; border: 1px solid #d7dde6; margin: 0 0 10pt; padding: 8pt; }
  .account-card-title { font-weight: 700; color: #273a60; margin-bottom: 3pt; }
  .list-table, .demands-table { width: 100%; border-collapse: collapse; margin: 4pt 0 12pt; table-layout: fixed; }
  .list-table td, .demands-table td { border-bottom: 1px solid #e1e5eb; padding: 6pt 5pt; vertical-align: top; overflow-wrap: anywhere; }
  .list-table td.marker, .demands-table td.demand-num { width: 26pt; color: #8a6a0a; font-weight: 700; text-align: center; }
  .closing-statement { font-weight: 700; margin-top: 16pt; }
  .signature-block { margin-top: 28pt; min-height: 82pt; break-inside: avoid; }
  .signature-block img { max-height: 54pt !important; max-width: 180pt !important; object-fit: contain; }
  .printed-name { font-weight: 700; margin-top: 2pt; }
  .rights { color: #4b5563; font-size: 9pt; }
  .mail-notation, .enclosures { margin-top: 12pt; font-size: 9pt; break-inside: avoid; }
  .mail-notation { font-style: italic; }
  .enclosures strong { color: #1b2a4a; }
  @media print { .letter { max-width: none; } }
`;

export function escapeLetterHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nonEmpty(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function addressLines(value, fallbackName = '') {
  if (Array.isArray(value)) return value.map((line) => nonEmpty(line)).filter(Boolean);
  if (value && typeof value === 'object') {
    const name = nonEmpty(value.name, fallbackName);
    const locality = [value.city, value.state, value.zip].map(nonEmpty).filter(Boolean);
    return [name, value.line1, value.line2, locality.length ? `${locality[0] || ''}${locality[1] ? `, ${locality[1]}` : ''}${locality[2] ? ` ${locality[2]}` : ''}` : '']
      .map(nonEmpty).filter(Boolean);
  }
  const text = nonEmpty(value);
  if (!text) return fallbackName ? [fallbackName] : [];
  const parts = text.split(/\r?\n/).map(nonEmpty).filter(Boolean);
  if (parts.length > 1) return fallbackName && parts[0].toLowerCase() !== fallbackName.toLowerCase() ? [fallbackName, ...parts] : parts;
  return fallbackName ? [fallbackName, text] : [text];
}

function renderLines(lines) {
  return lines.map((line) => escapeLetterHtml(line)).join('<br>');
}

function renderParagraphs(values) {
  return (values || []).map((value) => `<p>${escapeLetterHtml(value)}</p>`).join('');
}

function renderBullets(values) {
  if (!values?.length) return '';
  return `<table class="list-table"><tbody>${values.map((value, index) => `<tr><td class="marker">${index + 1}.</td><td>${escapeLetterHtml(value)}</td></tr>`).join('')}</tbody></table>`;
}

function requireContent(content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) throw new Error('Claude returned invalid letter content.');
  for (const key of ['subject', 'summary', 'closing']) {
    if (!nonEmpty(content[key])) throw new Error(`Claude omitted the letter ${key}.`);
  }
  if (!Array.isArray(content.opening) || !content.opening.length) throw new Error('Claude omitted the letter opening.');
  if (!Array.isArray(content.sections) || !content.sections.length) throw new Error('Claude omitted the supported dispute sections.');
  if (!Array.isArray(content.demands) || !content.demands.length) throw new Error('Claude omitted the required corrections.');
}

export function renderStructuredLetter({ content, client, account, accounts = [], letter, enclosures = [] }) {
  requireContent(content);
  const coveredAccounts = accounts.length ? accounts : [{ accountRef: null, account, roundNumber: letter?.round_number }];
  const packetMode = Number(letter?.packet_version || 1) === 2 || coveredAccounts.length > 1;
  const validRefs = new Set(coveredAccounts.map((entry) => entry.accountRef).filter(Boolean));
  if (packetMode) {
    const represented = new Set();
    for (const section of content.sections) {
      if (!validRefs.has(section.accountRef)) throw new Error('Every packet section must use the exact accountRef for one covered account.');
      represented.add(section.accountRef);
    }
    if (represented.size !== coveredAccounts.length) throw new Error('The packet draft omitted a distinct supported section for one or more covered accounts.');
    for (const demand of content.demands) {
      const match = String(demand || '').match(/^\[([^\]]+)\]\s+(.+)$/s);
      if (!match || !validRefs.has(match[1])) throw new Error('Every packet correction must begin with its exact [accountRef].');
    }
  }
  const targetType = letter?.target_type || 'furnisher';
  const bureau = String(letter?.target_bureau || '').toLowerCase();
  const sender = addressLines(client?.address, client?.name || letter?.client_name);
  if (sender.length < 2) throw new Error('The client profile needs a verified current address before generating a letter.');
  const recipient = targetType === 'bureau'
    ? BUREAU_RECIPIENTS[bureau]
    : addressLines(coveredAccounts[0]?.account?.furnisherAddress || account?.furnisherAddress, coveredAccounts[0]?.account?.furnisher || account?.furnisher || letter?.furnisher);
  if (!recipient?.length || (targetType === 'furnisher' && recipient.length < 2)) {
    throw new Error('Confirm the furnisher mailing address before generating this letter.');
  }

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const identity = [
    ['Consumer Name', client?.name || letter?.client_name],
    ['Current Verified Address', client?.address],
    ...(client?.date_of_birth || client?.dateOfBirth ? [['Date of Birth on File', client.date_of_birth || client.dateOfBirth]] : []),
    ...(packetMode ? [['Covered Accounts', String(coveredAccounts.length)]] : [
      ['Furnisher', account?.furnisher || letter?.furnisher],
      ['Account Number', account?.accountNumberMasked || letter?.account_id || 'Not displayed'],
    ]),
    ...(targetType === 'bureau' ? [['Reporting Bureau', bureau.charAt(0).toUpperCase() + bureau.slice(1)]] : []),
    ...(!packetMode && letter?.round_number ? [['Dispute Round', String(letter.round_number)]] : []),
  ];

  const accountCards = packetMode ? coveredAccounts.map((entry, index) => `<div class="account-card" data-account-ref="${escapeLetterHtml(entry.accountRef)}"><div class="account-card-title">Account ${index + 1}: ${escapeLetterHtml(entry.account?.furnisher || 'Reported account')}</div><div>Masked account: ${escapeLetterHtml(entry.account?.accountNumberMasked || 'Not displayed')}</div><div>Individual dispute round: ${escapeLetterHtml(entry.roundNumber || '1')}</div></div>`).join('') : '';

  const sections = content.sections.map((section) => `
    <section class="section"${packetMode ? ` data-account-ref="${escapeLetterHtml(section.accountRef)}"` : ''}>
      <h2 class="section-header">${escapeLetterHtml(section.heading)}</h2>
      ${renderParagraphs(section.paragraphs)}
      ${renderBullets(section.bullets)}
    </section>`).join('');
  const demands = content.demands.map((demand, index) => {
    if (!packetMode) return `<tr><td class="demand-num">${index + 1}</td><td>${escapeLetterHtml(demand)}</td></tr>`;
    const match = String(demand).match(/^\[([^\]]+)\]\s+(.+)$/s);
    return `<tr data-account-ref="${escapeLetterHtml(match[1])}"><td class="demand-num">${index + 1}</td><td>${escapeLetterHtml(match[2])}</td></tr>`;
  }).join('');
  const enclosureText = enclosures.map(escapeLetterHtml).join('; ');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style></head><body><main class="letter">
    <div class="date-line">${escapeLetterHtml(today)}</div>
    <div class="sender-block">${renderLines(sender)}</div>
    <div class="recipient-block">${renderLines(recipient)}</div>
    <div class="re-line">RE: ${escapeLetterHtml(content.subject)}</div>
    ${renderParagraphs(content.opening)}
    <table class="id-table"><tbody>${identity.map(([label, value]) => `<tr><td class="label">${escapeLetterHtml(label)}</td><td>${escapeLetterHtml(typeof value === 'object' ? addressLines(value).join(', ') : value)}</td></tr>`).join('')}</tbody></table>
    ${accountCards}
    ${sections}
    <section class="section"><h2 class="section-header">Required Corrections</h2><table class="demands-table"><tbody>${demands}</tbody></table></section>
    <p class="closing-statement">${escapeLetterHtml(content.closing)}</p>
    <div class="signature-block"><div class="printed-name">${escapeLetterHtml(client?.name || letter?.client_name)}</div><div class="rights">Consumer — All Rights Reserved</div></div>
    <div class="mail-notation">Sent via Certified Mail.</div>
    <div class="enclosures"><strong>Enclosures:</strong> ${enclosureText || 'None'}</div>
  </main></body></html>`;
}
