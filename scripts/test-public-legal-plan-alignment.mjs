import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const terms = await readFile(new URL('public/terms.html', root), 'utf8');
const privacy = await readFile(new URL('public/privacy.html', root), 'utf8');

for (const phrase of [
  '$149.00 per month',
  '$299.00 per month',
  '$997.00 for 6 months of Standard-level service',
  'up to 3 individualized correspondence pieces per monthly service cycle',
  'up to 5 individualized correspondence pieces per monthly service cycle',
  'Chris personally reviews, directs, and works on the client file',
  'does not guarantee approval, funding amount, rate, terms, or timing',
]) {
  assert.match(terms, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `Terms missing: ${phrase}`);
}

for (const retired of [
  'secure.scorexer.com',
  'first work fee',
  'limited power of attorney',
  'initial letters within 2–3 business days',
  'within 48 hours of receipt',
]) {
  assert.doesNotMatch(`${terms}\n${privacy}`, new RegExp(retired.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `Retired public copy remains: ${retired}`);
}

assert.match(terms, /href="\/login" class="btn-portal"/);
assert.match(privacy, /href="\/login" class="btn-portal"/);
for (const provider of ['Supabase', 'Netlify', 'Resend', 'Calendly', 'Lob', 'Anthropic', 'Google Gemini']) {
  assert.match(privacy, new RegExp(`<strong>${provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:<\\/strong>`), `Privacy provider missing: ${provider}`);
}
assert.doesNotMatch(privacy, /<strong>SendGrid:<\/strong>/);

console.log('Public legal/plan alignment checks passed.');
