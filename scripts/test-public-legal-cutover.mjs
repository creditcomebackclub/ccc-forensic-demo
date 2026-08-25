import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const [terms, privacy, cancellation, sitemap, homepage, guide, viteConfig] = await Promise.all([
  read('public/terms.html'),
  read('public/privacy.html'),
  read('public/cancellation-refund-policy.html'),
  read('public/sitemap.xml'),
  read('website-preview/index.html'),
  read('public/freeguide.html'),
  read('vite.config.js'),
]);

for (const [name, html] of Object.entries({ terms, privacy, cancellation })) {
  assert.match(html, /<!DOCTYPE html>/i, `${name} must remain a standalone HTML page`);
  assert.match(html, /<meta name="viewport"/, `${name} must remain mobile-ready`);
  assert.match(html, /https:\/\/creditcomeback\.scorexer\.com/, `${name} must link to the Scorexer member portal`);
  assert.match(html, /href="\/cancellation-refund-policy(?:\.html)?"/, `${name} must link to the cancellation policy`);
  assert.doesNotMatch(html, /Calendly/i, `${name} must not disclose the retired public scheduler`);
  assert.doesNotMatch(html, /complies fully|full compliance/i, `${name} must not make an unqualified compliance claim`);
  assert.doesNotMatch(html, /\$849|one payment covers|paid once/i, `${name} must not present future credit repair as presently collectible in full`);
  assert.equal((html.match(/<html\b/gi) || []).length, 1, `${name} must contain one html root`);
  assert.equal((html.match(/<\/html>/gi) || []).length, 1, `${name} must close its html root`);
  assert.doesNotMatch(html, /href=["']\/#(?:why|contact)["']/, `${name} must not link to retired homepage anchors`);
  assert.match(html, /href=["']\/#process["']/, `${name} must link Why Us to the live process section`);
  assert.match(html, /href=["']\/#consultation["']/, `${name} must link Contact to the live consultation section`);
}

assert.match(terms, /five \(5\) working days/i, 'Terms must state the five-working-day minimum');
assert.match(terms, /ten \(10\) days/i, 'Terms must state the Colorado cancellation-refund deadline');
assert.match(terms, /before (?:that agreed|the specific agreed) service has been fully performed/i, 'Terms must prohibit advance collection');
assert.match(terms, /more protective requirement controls/i, 'Terms must preserve stronger state rights');
assert.match(terms, /signed service agreement[\s\S]{0,300}(?:does not replace|provide additional information)/i, 'Terms must distinguish the website from signed documents');

assert.match(privacy, /<strong>Netlify:<\/strong> Hosts the public website/i, 'Privacy must identify Netlify as the public host');
assert.match(privacy, /<strong>DisputeFox:<\/strong> Directly receives and stores/i, 'Privacy must identify DisputeFox as the public intake CRM');
assert.match(privacy, /<strong>Scorexer:<\/strong> Provides consultation scheduling/i, 'Privacy must identify Scorexer as scheduler and portal');
assert.match(privacy, /New public intake forms are not submitted to Supabase/i, 'Privacy must distinguish new intake from retained internal systems');
assert.match(privacy, /technology transition does not automatically delete existing records/i, 'Privacy must preserve existing-record expectations');

assert.match(cancellation, /before midnight of the fifth \(5th\) working day/i, 'Policy must state the cancellation deadline');
assert.match(cancellation, /returned within ten \(10\) days following our receipt/i, 'Policy must state refund timing');
assert.match(cancellation, /No reason is required/i, 'Policy must not burden the cancellation right');
assert.match(cancellation, /confirmation[\s\S]{0,100}not a condition/i, 'Policy must not make company confirmation a cancellation condition');
assert.match(cancellation, /does not replace the signed service agreement/i, 'Policy must not replace required signed notices');
assert.match(cancellation, /more protective provision controls/i, 'Policy must preserve stronger state or contract rights');

assert.match(sitemap, /<loc>https:\/\/creditcomebackclub\.com\/privacy<\/loc>/, 'Sitemap must include privacy');
assert.match(sitemap, /<loc>https:\/\/creditcomebackclub\.com\/cancellation-refund-policy<\/loc>/, 'Sitemap must include cancellation policy');

for (const [name, html] of Object.entries({ homepage, guide })) {
  assert.doesNotMatch(html, /prepay|paid in full|paid once|one[- ]time payment|one payment/i, `${name} must not market advance collection for future credit repair`);
  assert.match(html, /\$849/i, `${name} must retain the six-month total rate`);
  assert.match(html, /(?:only )?after (?:the )?(?:specific )?(?:agreed )?(?:service|work)[\s\S]{0,40}(?:completed|performed)|payment follows completed work/i,
    `${name} must say payment follows completed service`);
}

assert.match(viteConfig, /\^\\\/croa-statement\//, 'PWA navigation fallback must exclude the consumer-rights route');
assert.match(viteConfig, /\*\*\/croa-statement\.html/, 'PWA precache glob must not hijack the consumer-rights page');

console.log('Public legal cutover contracts passed.');
