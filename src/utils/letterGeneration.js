export const LETTER_GENERATING_PLACEHOLDER = 'GENERATING...';

const FIELD_NUMBER_PATTERN = /\b(?:field|fields)\s*(17A|17B|\d{1,2})(?:\s*\/\s*(17A|17B|\d{1,2}))?/gi;

function citedFieldNumbers(value) {
  const out = new Set();
  for (const match of String(value || '').matchAll(FIELD_NUMBER_PATTERN)) {
    if (match[1]) out.add(match[1].toUpperCase());
    if (match[2]) out.add(match[2].toUpperCase());
  }
  return out;
}

/**
 * Deterministic finding authorization guard. Legacy accounts without a
 * findings array are intentionally exempt so historical letters retain their
 * existing generation contract.
 */
export function unauthorizedFieldCitations(html, account, { additionalAllowed = [] } = {}) {
  if (!Array.isArray(account?.findings)) return [];
  const authorized = account.findings.filter((finding) => finding?.outcome === 'FLAG');
  const allowed = new Set();
  for (const finding of authorized) {
    for (const number of citedFieldNumbers(finding.field)) allowed.add(number);
  }
  for (const number of additionalAllowed) allowed.add(String(number).toUpperCase());
  const problems = [];
  for (const number of citedFieldNumbers(html)) {
    if (!allowed.has(number)) problems.push(`Cites Metro 2 Field ${number}, which is not present in the authorized deterministic findings.`);
  }
  return problems;
}

function sectionsWithAccountRefs(html) {
  const sections = [];
  for (const match of String(html || '').matchAll(/<(section|tr)\b([^>]*\bdata-account-ref=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/\1>/gi)) {
    sections.push({ accountRef: match[3], html: match[0], body: match[4] });
  }
  return sections;
}

/**
 * Multi-account isolation guard. Account-specific Metro 2 claims are graded
 * only against the frozen finding set for the section that contains them.
 */
export function packetAccountIsolationProblems(html, accounts = [], { additionalAllowedFor = () => [] } = {}) {
  if (!(accounts || []).length) return [];
  const byRef = new Map(accounts.map((entry) => [entry.accountRef, entry.account || entry]));
  const represented = new Set();
  const problems = [];
  const scoped = sectionsWithAccountRefs(html);
  for (const section of scoped) {
    const account = byRef.get(section.accountRef);
    if (!account) {
      problems.push(`Uses unknown packet accountRef ${section.accountRef}.`);
      continue;
    }
    represented.add(section.accountRef);
    problems.push(...unauthorizedFieldCitations(section.html, account, {
      additionalAllowed: additionalAllowedFor(account, section.accountRef),
    }).map((problem) => `${section.accountRef}: ${problem}`));
    for (const entry of accounts) {
      if (entry.accountRef === section.accountRef) continue;
      const masked = String((entry.account || entry)?.accountNumberMasked || '').replace(/[^a-z0-9]/gi, '');
      const suffix = masked.slice(-4);
      if (suffix.length === 4 && new RegExp(`(?:\\*|x|#|\\b)${suffix}\\b`, 'i').test(section.body)) {
        problems.push(`${section.accountRef}: includes the masked suffix belonging to ${entry.accountRef}.`);
      }
    }
  }
  for (const entry of accounts) {
    if (!represented.has(entry.accountRef)) problems.push(`The draft has no account-scoped section for ${entry.accountRef}.`);
  }
  const outsideScoped = String(html || '').replace(/<(section|tr)\b[^>]*\bdata-account-ref=["'][^"']+["'][^>]*>[\s\S]*?<\/\1>/gi, '');
  if (citedFieldNumbers(outsideScoped).size) problems.push('Shared packet text contains an account-specific Metro 2 field citation.');
  return problems;
}

const REQUIRED_GENERATED_SECTIONS = [
  ['signature-block', 'signature block'],
  ['mail-notation', 'certified-mail notation'],
  ['enclosures', 'enclosures section'],
];

function hasClass(html, className) {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`class=["'](?:[^"']*\\s)?${escaped}(?:\\s[^"']*)?["']`, 'i').test(html);
}

function signatureImageTag(html) {
  const value = String(html || '');
  const tags = [...value.matchAll(/<img\b[^>]*>/gi)];
  let match = tags.find((candidate) => /data-ccc-signature=["']true["']|alt=["']Client signature["']/i.test(candidate[0]));
  if (!match) {
    const block = /class=["'][^"']*\bsignature-block\b/i.exec(value);
    if (block) match = tags.find((candidate) => candidate.index > block.index && candidate.index < block.index + 1800);
  }
  if (!match && tags.length === 1 && /Consumer\s*[—-]\s*All Rights Reserved/i.test(value)) match = tags[0];
  return match?.[0] || null;
}

export function letterSignatureSource(letterOrHtml) {
  const html = typeof letterOrHtml === 'string' ? letterOrHtml : letterOrHtml?.html;
  const tag = signatureImageTag(html);
  return tag ? (tag.match(/\bsrc=["']([^"']+)["']/i) || [])[1] || null : null;
}

/**
 * Remote and signed Storage URLs are intentionally not mail-safe: they can
 * expire or become private between review and Lob rendering. Only an embedded
 * PNG/JPEG with a real image header is durable enough for physical mail.
 */
export function letterSignatureState(letterOrHtml) {
  const source = String(letterSignatureSource(letterOrHtml) || '');
  if (!source) return 'missing';
  if (/^https?:/i.test(source)) return 'remote';
  if (/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$/i.test(source)) return 'embedded';
  if (/^data:image\/(?:jpeg|jpg);base64,\/9j\/[A-Za-z0-9+/=]+$/i.test(source)) return 'embedded';
  return 'invalid';
}

/**
 * Certified-mail notation is fixed product copy, not model-authored legal
 * analysis. Repairing this mechanical omission is safer than discarding an
 * otherwise valid letter and asking the model to regenerate it.
 */
export function ensureCertifiedMailNotation(letterOrHtml) {
  const html = typeof letterOrHtml === 'string' ? letterOrHtml : letterOrHtml?.html;
  const value = String(html || '');
  if (!value || hasClass(value, 'mail-notation')) return value;
  const notation = '<div class="mail-notation">Sent via Certified Mail.</div>';
  if (/<\/body>/i.test(value)) return value.replace(/<\/body>/i, `${notation}</body>`);
  if (/<\/html>/i.test(value)) return value.replace(/<\/html>/i, `${notation}</html>`);
  return value + notation;
}

/**
 * Detect output that stopped mid-document. Legacy fragment letters are left
 * alone; a value that declares itself to be an HTML document must actually
 * close, and newly generated letters may opt into the required closing
 * sections check.
 */
export function generatedLetterValidationError(letterOrHtml, { requireSections = false } = {}) {
  const html = typeof letterOrHtml === 'string' ? letterOrHtml : letterOrHtml?.html;
  const value = String(html || '').trim();
  if (!value) return 'The generated letter is empty.';
  if (value === LETTER_GENERATING_PLACEHOLDER) return 'Letter generation is still running.';
  if (value.startsWith('ERROR:')) return value.slice('ERROR:'.length).trim() || 'Letter generation failed.';

  const declaresDocument = /^<!doctype\s+html/i.test(value) || /^<html\b/i.test(value);
  if (declaresDocument && (!/<\/body>\s*<\/html>\s*$/i.test(value) || /<\/?[a-z][^>]*$/i.test(value))) {
    return 'The generated letter is incomplete and stops before the document closes.';
  }

  if (requireSections) {
    for (const [className, label] of REQUIRED_GENERATED_SECTIONS) {
      if (!hasClass(value, className)) return `The generated letter is missing its ${label}.`;
    }
  }
  return null;
}

export function letterGenerationState(letterOrHtml) {
  const html = typeof letterOrHtml === 'string' ? letterOrHtml : letterOrHtml?.html;
  const value = String(html || '').trim();
  if (value === LETTER_GENERATING_PLACEHOLDER) return 'generating';
  if (generatedLetterValidationError(value)) return 'failed';
  return 'ready';
}

/**
 * Durable delivery facts outrank a later presentation-time validation result.
 * This does not make an incomplete document mail-safe; it only distinguishes
 * an already-mailed historical record from a draft that is still retryable.
 */
export function hasMailedDeliveryEvidence(letter) {
  if (!letter || typeof letter === 'string') return false;
  const trackingStatus = String(letter.trackingStatus || letter.tracking_status || '').toLowerCase();
  return !!(
    letter.mailedDate
    || letter.mailed_date
    || letter.deliveredAt
    || letter.delivered_at
    || letter.trackingNumber
    || letter.tracking_number
    || ['mailed', 'in transit', 'in_transit', 'delivered', 'returned'].includes(trackingStatus)
  );
}

export function hasMailedContentWarning(letter) {
  return hasMailedDeliveryEvidence(letter) && letterGenerationState(letter) === 'failed';
}

export function isGenerationFailed(letter) {
  return letterGenerationState(letter) === 'failed';
}

export function isGenerationRunning(letter) {
  return letterGenerationState(letter) === 'generating';
}

export function canMailLetter(letter) {
  return letterGenerationState(letter) === 'ready' && letterSignatureState(letter) === 'embedded';
}

export function generationErrorMessage(letter) {
  const html = String(letter?.html || '').trim();
  return generatedLetterValidationError(html) || 'The letter was not generated successfully.';
}
