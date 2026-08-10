export const LETTER_GENERATING_PLACEHOLDER = 'GENERATING...';

export function letterGenerationState(letterOrHtml) {
  const html = typeof letterOrHtml === 'string' ? letterOrHtml : letterOrHtml?.html;
  const value = String(html || '').trim();
  if (value === LETTER_GENERATING_PLACEHOLDER) return 'generating';
  if (!value || value.startsWith('ERROR:')) return 'failed';
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
  return html.startsWith('ERROR:') ? html.slice('ERROR:'.length).trim() : 'The letter was not generated successfully.';
}
