export const LETTER_GENERATING_PLACEHOLDER = 'GENERATING...';

const REQUIRED_GENERATED_SECTIONS = [
  ['signature-block', 'signature block'],
  ['mail-notation', 'certified-mail notation'],
  ['enclosures', 'enclosures section'],
];

function hasClass(html, className) {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`class=["'](?:[^"']*\\s)?${escaped}(?:\\s[^"']*)?["']`, 'i').test(html);
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

export function isGenerationFailed(letter) {
  return letterGenerationState(letter) === 'failed';
}

export function isGenerationRunning(letter) {
  return letterGenerationState(letter) === 'generating';
}

export function canMailLetter(letter) {
  return letterGenerationState(letter) === 'ready';
}

export function generationErrorMessage(letter) {
  const html = String(letter?.html || '').trim();
  return generatedLetterValidationError(html) || 'The letter was not generated successfully.';
}
