import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ownedFiles = [
  'netlify/functions/_leadNurture.cjs',
  'netlify/functions/_roundEmail.cjs',
  'netlify/functions/_consultationBooking.cjs',
  'netlify/functions/send-lpoa.cjs',
  'netlify/functions/notify-affiliate.cjs',
  'netlify/functions/chat-prospect.mjs',
];

const sources = new Map(await Promise.all(ownedFiles.map(async (relativePath) => [
  relativePath,
  await readFile(path.join(repoRoot, relativePath), 'utf8'),
])));

const combinedSource = [...sources.values()].join('\n');
const canonicalConsultationUrl = 'https://calendly.com/creditcomebackclub/consultation?hide_gdpr_banner=1';

const bannedVisibleCopy = [
  [/Metro\s*2/gi, 'retired Metro 2 methodology'],
  [/USPS\s+Certified\s+Mail/gi, 'retired certified-mail claim'],
  [/certified\s+dispute\s+letters?/gi, 'retired certified-letter claim'],
  [/signed\s+LPOA/gi, 'retired LPOA onboarding copy'],
  [/Limited\s+Power\s+of\s+Attorney/gi, 'retired LPOA document name'],
  [/pay[- ]for[- ]performance/gi, 'unverified pricing model'],
  [/Why\s+We\s+Go\s+After\s+the\s+Furnisher/gi, 'retired furnisher-first claim'],
  [/480-913-9172/g, 'retired phone number'],
  [/\$79\s*\/\s*mo/gi, 'retired Standard price'],
  [/\$149\s*\/\s*mo/gi, 'retired VIP price'],
  [/\$499\s+flat/gi, 'retired paid-in-full price'],
  [/Consent,\s*Accuracy,\s*Collection/gi, 'internal route codes in external copy'],
];

for (const [pattern, label] of bannedVisibleCopy) {
  pattern.lastIndex = 0;
  assert.equal(pattern.test(combinedSource), false, `Owned communication source still contains ${label}.`);
}

const calendlyUrls = combinedSource.match(/https:\/\/calendly\.com\/creditcomebackclub\/consultation[^\s'"<>`]*/g) || [];
assert.ok(calendlyUrls.length >= 2, 'Expected consultation links in the booking communication surfaces.');
assert.deepEqual([...new Set(calendlyUrls)], [canonicalConsultationUrl], 'Every CCC consultation link must use the canonical Calendly URL.');

const { sourceAwareNurtureBody } = require(path.join(repoRoot, 'netlify/functions/_leadNurture.cjs'));
const nurtureDay1 = sourceAwareNurtureBody(1, {});
const nurtureDay3 = sourceAwareNurtureBody(3, {});
assert.match(nurtureDay1, /free review of your current three-bureau report|Recovery Blueprint/i);
for (const framing of ['Your Story', 'The Facts', 'The Pressure']) assert.match(nurtureDay3, new RegExp(framing));
assert.match(nurtureDay3, /inaccurate, incomplete, or inconsistent/i);
assert.match(nurtureDay3, /documented consumer-law and deadline follow-through/i);
assert.match(nurtureDay3, /team member reviews|trained team member reviews/i);
assert.match(nurtureDay3, /No deletion, score change, outcome, or timeline is guaranteed/i);

const { EVENT_COPY, isCurrentMethodEmailTemplate } = require(path.join(repoRoot, 'netlify/functions/_roundEmail.cjs'));
const mailedBody = EVENT_COPY.round_mailed.body({
  firstName: 'Jordan',
  round: { round_number: 1 },
  letters: [{ id: 'one' }],
});
assert.match(mailedBody, /USPS First-Class Mail/);
assert.match(mailedBody, /recorded the send date/i);
assert.match(mailedBody, /does not include delivery confirmation or a signed receipt/i);
assert.doesNotMatch(mailedBody, /certified|tracking number/i);

const cleanupBody = EVENT_COPY.file_cleanup_mailed.body({
  firstName: 'Jordan',
  letters: [{ id: 'one' }],
});
assert.match(cleanupBody, /separately from your account-specific dispute paths/i);
assert.match(cleanupBody, /First-Class Mail does not include delivery confirmation/i);
assert.equal(isCurrentMethodEmailTemplate({
  subject_template: 'Round mailed',
  body_template: 'Every letter has now been mailed by certified mail. We will monitor delivery and the response window.',
}), false, 'Persisted retired-method templates must not override current event copy.');
assert.equal(isCurrentMethodEmailTemplate({
  subject_template: 'Round mailed',
  body_template: 'CCC sent the approved letters by USPS First-Class Mail and recorded each send date.',
}), true, 'Current-method custom templates must remain eligible.');

const { bookedEmail } = require(path.join(repoRoot, 'netlify/functions/_consultationBooking.cjs'));
const booked = bookedEmail('Jordan Richardson');
assert.match(booked.html, /current three-bureau report/i);
assert.match(booked.html, /free Recovery Blueprint/i);
assert.match(booked.html, /team member reviews the account classifications/i);
assert.match(booked.html, /secure service-agreement and document-upload wizard/i);
assert.match(booked.html, /Booking does not create a payment/i);

const legacyMultiplexer = sources.get('netlify/functions/send-lpoa.cjs');
for (const action of [
  'send_campaign_update',
  'send_onboarding_reminder',
  'send_report_refresh',
  'send_phase_notification',
]) {
  assert.match(legacyMultiplexer, new RegExp(`action === ['"]${action}['"]`), `Missing legacy-compatible action contract: ${action}`);
}
for (const requiredCopy of [
  'Recovery Blueprint',
  'Your Story',
  'The Facts',
  'The Pressure',
  'USPS First-Class Mail',
  'No deletion, score change, outcome, or timeline is guaranteed',
]) {
  assert.ok(legacyMultiplexer.includes(requiredCopy), `send-lpoa.cjs is missing current-method copy: ${requiredCopy}`);
}
assert.match(legacyMultiplexer, /grandfathered campaign created under an earlier CCC workflow/i);
assert.match(legacyMultiplexer, /First-Class Mail does not include delivery confirmation or a signed receipt/i);

const affiliateSource = sources.get('netlify/functions/notify-affiliate.cjs');
assert.match(affiliateSource, /client_profiles\?client_id=eq\./);
assert.match(affiliateSource, /profile\.onboarding_complete === true && !!profile\.agreement_signed_at/);
assert.match(affiliateSource, /Grandfathered clients may predate the service-agreement wizard/);
assert.match(affiliateSource, /client\.lpoa_signed === true/);
assert.match(affiliateSource, /eligible cleared revenue under your saved partner terms/i);

const chatbotSource = sources.get('netlify/functions/chat-prospect.mjs');
assert.ok(chatbotSource.includes(canonicalConsultationUrl));
for (const framing of ['Your Story', 'The Facts', 'The Pressure']) assert.match(chatbotSource, new RegExp(framing));
assert.match(chatbotSource, /Never invent or quote pricing/);
assert.match(chatbotSource, /Never promise or imply a deletion, score increase, outcome, or timeline/);
assert.match(chatbotSource, /Do not expose proprietary codes, statutes, or letter sequences/i);

console.log('New-method communication contracts passed.');
