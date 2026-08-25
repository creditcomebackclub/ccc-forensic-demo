import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WEBSITE_LIVE_FILES,
  createWebsiteReleaseCss,
  createWebsiteReleaseHtml,
} from './release-build.mjs';

const previewRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(previewRoot);
const [htmlSource, cssSource, previewJs, liveJs, viteConfig, netlifyConfig, robots, sitemap, confirmationHtml] = await Promise.all([
  readFile(join(previewRoot, 'index.html'), 'utf8'),
  readFile(join(previewRoot, 'styles.css'), 'utf8'),
  readFile(join(previewRoot, 'app.js'), 'utf8'),
  readFile(join(previewRoot, 'live-app.js'), 'utf8'),
  readFile(join(repoRoot, 'vite.config.js'), 'utf8'),
  readFile(join(repoRoot, 'netlify.toml'), 'utf8'),
  readFile(join(repoRoot, 'public/robots.txt'), 'utf8'),
  readFile(join(repoRoot, 'public/sitemap.xml'), 'utf8'),
  readFile(join(repoRoot, 'public/success.html'), 'utf8'),
]);

const previewHtml = createWebsiteReleaseHtml(htmlSource, 'preview');
const liveHtml = createWebsiteReleaseHtml(htmlSource, 'live');
const liveIntakeMarker = liveHtml.indexOf('data-live-intake-form');
const liveIntakeOpening = liveIntakeMarker >= 0
  ? liveHtml.slice(liveHtml.lastIndexOf('<form', liveIntakeMarker), liveHtml.indexOf('>', liveIntakeMarker) + 1)
  : '';
const liveCss = createWebsiteReleaseCss(cssSource, 'live');
const socialImageUrl = 'https://creditcomebackclub.com/site-live/ccc-social-preview-2026.jpg';
const socialImagePath = join(previewRoot, 'ccc-social-preview-2026.jpg');
const [socialImageBytes, socialImageStat] = await Promise.all([
  readFile(socialImagePath),
  stat(socialImagePath),
]);

function jpegDimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Social image is not a JPEG.');
  let offset = 2;
  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const segmentLength = bytes.readUInt16BE(offset);
    if (startOfFrameMarkers.has(marker)) {
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    if (segmentLength < 2) break;
    offset += segmentLength;
  }
  throw new Error('Could not read social JPEG dimensions.');
}

const socialImageDimensions = jpegDimensions(socialImageBytes);
const assertions = [];
const check = (condition, message) => assertions.push({ condition: Boolean(condition), message });

check(
  previewHtml.includes('data-preview-only="true"')
    && previewHtml.includes('Local concept preview')
    && previewHtml.includes('Preview only')
    && !previewHtml.includes('data-live-intake-form')
    && !previewHtml.includes('/site-live/live-app.js')
    && !previewHtml.includes('/embed.js')
    && !previewHtml.includes('assets.calendly.com'),
  'review artifact remains visibly preview-only with no live form, chat, or Calendly assets',
);
check(
  !/\b(fetch|XMLHttpRequest|sendBeacon|localStorage|sessionStorage)\b/.test(previewJs)
    && !previewHtml.includes('/api/public-intake'),
  'review artifact retains a no-network JavaScript and HTML boundary',
);
check(
  liveHtml.includes('data-live-site="true"')
    && liveHtml.includes('<meta name="robots" content="index,follow">')
    && liveHtml.includes('<title>Credit Comeback Club | Factual Credit Repair Support</title>')
    && !/Preview only|Production disconnected|Local concept preview|data-preview-only/i.test(liveHtml),
  'live artifact has production metadata and no preview ribbon or preview-only copy',
);
check(
  liveHtml.includes(`<meta property="og:image" content="${socialImageUrl}">`)
    && liveHtml.includes(`<meta property="og:image:secure_url" content="${socialImageUrl}">`)
    && liveHtml.includes('<meta property="og:image:type" content="image/jpeg">')
    && liveHtml.includes('<meta property="og:image:width" content="1200">')
    && liveHtml.includes('<meta property="og:image:height" content="630">')
    && liveHtml.includes('<meta property="og:image:alt" content="Credit Comeback Club — 3-bureau review, evidence-backed disputes, and client portal">')
    && liveHtml.includes('<meta name="twitter:card" content="summary_large_image">')
    && liveHtml.includes(`<meta name="twitter:image" content="${socialImageUrl}">`)
    && liveHtml.includes('<meta name="twitter:image:alt" content="Credit Comeback Club — 3-bureau review, evidence-backed disputes, and client portal">'),
  'live artifact publishes the exact versioned Open Graph and Twitter social image contract',
);
check(
  liveHtml.includes(`"url": "${socialImageUrl}"`)
    && liveHtml.includes('"width": 1200')
    && liveHtml.includes('"height": 630')
    && !liveHtml.includes('site-live/ccc-logo.jpg')
    && !liveHtml.includes('og-image.png'),
  'live JSON-LD uses the social artwork while retired social-image references remain absent',
);
check(
  WEBSITE_LIVE_FILES.includes('ccc-social-preview-2026.jpg')
    && socialImageBytes[0] === 0xff
    && socialImageBytes[1] === 0xd8
    && socialImageDimensions.width === 1200
    && socialImageDimensions.height === 630
    && socialImageStat.size < 500_000,
  'versioned production social asset is a real optimized 1200x630 JPEG',
);
check(
  robots.includes('Allow: /')
    && !robots.includes('Disallow: /\n')
    && robots.includes('Disallow: /api/')
    && robots.includes('Disallow: /login')
    && robots.includes('Disallow: /site-preview/')
    && robots.includes('Sitemap: https://creditcomebackclub.com/sitemap.xml')
    && sitemap.includes('<loc>https://creditcomebackclub.com/</loc>')
    && sitemap.includes('<loc>https://creditcomebackclub.com/freeguide</loc>')
    && !sitemap.includes('/login')
    && !sitemap.includes('/site-preview'),
  'robots and sitemap expose the public site while excluding app, API, and preview surfaces',
);
check(
  liveHtml.includes('href="/site-live/styles.css"')
    && liveHtml.includes('src="/site-live/app.js"')
    && liveHtml.includes('src="/site-live/live-app.js"')
    && liveHtml.includes('src="/site-live/ccc-logo.webp"'),
  'live artifact resolves every shared release asset from its isolated directory',
);
check(
  liveIntakeOpening.includes('action="https://pulse.disputeprocess.com/CustumFieldController?method=addWebFormData"')
    && liveIntakeOpening.includes('method="post"')
    && liveIntakeOpening.includes('enctype="multipart/form-data"')
    && !liveIntakeOpening.includes('novalidate')
    && liveHtml.includes('name="firstName" autocomplete="given-name" maxlength="80" required')
    && liveHtml.includes('name="lastName" autocomplete="family-name" maxlength="80" required')
    && liveHtml.includes('name="email1" autocomplete="email" maxlength="254" required')
    && liveHtml.includes('name="mobilePhone1" autocomplete="tel" inputmode="tel" maxlength="40" required')
    && liveHtml.includes('name="checkbox1" value="true" required')
    && liveHtml.includes('name="website" tabindex="-1" autocomplete="off"'),
  'live intake posts the required contact and consent fields directly to DisputeFox',
);
check(
  [
    ['method', 'addWebFormData'],
    ['tab_info_id', 'RjFaeDcvSWpqYTJidVdyRDB3WVBsdz09'],
    ['company_id', 'RkJJOWtkS1lYQ243V0Q5d3EybmlMUT09'],
    ['cust_type', '1'],
    ['add_affiliate_flag', '0'],
    ['assignedto_id', '32175'],
    ['sales_representative_id', '32175'],
    ['workflow_statusid', '30'],
    ['folder_statusid', '5'],
    ['customer_statusid', '3270'],
    ['portalAccess', '0'],
    ['customerAgreementIDs', ''],
  ].every(([name, value]) => liveHtml.includes(`name="${name}" value="${value}"`)),
  'live intake preserves the exact DisputeFox routing contract while disabling portal and agreement creation',
);
check(
  liveHtml.includes('<h2>Request your free 3-bureau credit review.</h2>')
    && liveHtml.includes('Share your contact information, then choose a time for a private 30-minute consultation with Chris.')
    && liveHtml.includes('What would you most like help understanding? <small>optional</small>')
    && liveHtml.includes('I agree to receive email and/or SMS communications from Credit Comeback Club about my consultation request.')
    && liveHtml.includes('name="textArea1"')
    && liveHtml.includes('maxlength="1000"')
    && liveHtml.includes('Please do not include SSNs, dates of birth, account numbers, passwords, or other sensitive information.')
    && liveJs.includes('disputeFoxSituation.length <= 1000')
    && liveJs.includes("phoneDigits.length >= 10")
    && liveJs.includes('emailField?.validity.valid')
    && liveJs.includes("formData.delete('website')")
    && liveJs.includes("formData.set('checkbox1', 'true')"),
  'live consultation mirrors the approved copy while retaining bounded privacy-safe validation',
);
check(
  liveJs.includes("fetch(DISPUTEFOX_ENDPOINT")
    && liveJs.includes("const DISPUTEFOX_ENDPOINT = 'https://pulse.disputeprocess.com/CustumFieldController?method=addWebFormData'")
    && liveJs.includes("method: 'POST'")
    && liveJs.includes('body: formData')
    && liveJs.includes("credentials: 'omit'")
    && liveJs.includes('signal: controller.signal')
    && !liveJs.includes('/api/public-intake')
    && !liveJs.includes('JSON.stringify('),
  'live intake sends multipart data directly to DisputeFox without the retired CCC lead writer',
);
check(
  liveHtml.includes('data-live-intake-status')
    && liveHtml.includes('role="status" aria-live="polite"')
    && liveJs.includes("intakeForm.setAttribute('aria-busy', 'true')")
    && liveJs.includes("field.setAttribute('aria-invalid'")
    && liveJs.includes('firstInvalid.focus()')
    && liveJs.includes('if (submissionInFlight) return')
    && liveJs.includes('submitButton.disabled = true'),
  'live form exposes accessible validation and blocks duplicate in-flight submissions',
);
check(
  liveJs.includes("const SCHEDULER_URL = 'https://pulse.scorexer.com/Portal/meeting.jsp?id=5d235976-7de9-49d9-a061-dab6275c3c99'")
    && liveJs.includes("new URL(String(responseText || '').trim()).href === SCHEDULER_URL")
    && liveJs.includes('window.location.assign(SCHEDULER_URL)')
    && !liveJs.includes('window.location.assign(responseText)')
    && !liveJs.includes('window.location.replace(responseText)'),
  'successful intake follows only the exact allowlisted DisputeFox scheduler destination',
);
check(
  liveJs.includes('const SUBMISSION_TIMEOUT_MS = 15000')
    && liveJs.includes('window.setTimeout(() => controller.abort(), SUBMISSION_TIMEOUT_MS)')
    && liveJs.includes('showSchedulerFallback()')
    && liveJs.includes('catch (_error)')
    && liveJs.includes("submitButton.textContent = 'Request status pending'")
    && liveHtml.includes('data-live-intake-fallback')
    && liveHtml.includes('>Continue directly to scheduling</a>')
    && liveJs.includes('window.clearTimeout(timeout)'),
  'DisputeFox submission has a bounded timeout and a duplicate-safe direct scheduler fallback',
);
check(
  !/Calendly|calendly/.test(liveHtml)
    && !/Calendly|calendly/.test(liveJs)
    && !/localStorage|sessionStorage|console\./.test(liveJs)
    && !liveJs.includes('searchParams.set('),
  'canonical live intake contains no Calendly path and never writes PII to URLs, browser storage, or logs',
);
check(
  !liveHtml.includes('/embed.js')
    && !liveHtml.includes('/widget')
    && !liveHtml.includes('chat-prospect'),
  'live marketing artifact does not mount the retired CCC prospect chatbot',
);
check(
  /href="#consultation" data-tier="Standard">See if Standard fits<\/a>/.test(liveHtml)
    && /href="#consultation" data-tier="VIP">See if VIP fits<\/a>/.test(liveHtml)
    && /href="#consultation" data-tier="Six-Month Standard">Ask about six months<\/a>/.test(liveHtml)
    && previewJs.includes("planDialogConsultation.dataset.tier = selectedPanel.dataset.planName || ''")
    && liveJs.includes("event.target.closest('[data-tier]')")
    && liveJs.includes('Selected service: ${selectedTier')
    && liveJs.includes('Source: creditcomebackclub.com homepage consultation'),
  'all consultation CTAs retain exact plan mapping and bind source plus selected service into DisputeFox notes',
);
check(
  liveHtml.includes('<strong>$149</strong>')
    && liveHtml.includes('<strong>$299</strong>')
    && liveHtml.includes('<strong>$849</strong>')
    && liveHtml.includes('The same managed scope and correspondence capacity as Standard for one defined six-month term')
    && liveHtml.includes('Only after completed services; never prepaid for future work'),
  'live promotion preserves approved prices and lawful six-month payment timing',
);
check(
  ['/freeguide', '/affiliate/apply', '/terms', '/privacy', '/cancellation-refund-policy', '/croa-statement']
    .every((destination) => liveHtml.includes(`href="${destination}"`))
    && liveHtml.includes('href="https://creditcomeback.scorexer.com"')
    && liveHtml.includes('>Free guide</a>')
    && liveHtml.includes('>Free dispute guide</a>')
    && liveHtml.includes('>Partner application</a>')
    && liveHtml.includes('href="https://www.facebook.com/groups/creditcomebackclub" target="_blank" rel="noopener noreferrer">Facebook community</a>')
    && liveHtml.includes('class="guide-resource-section"')
    && liveHtml.includes('Free 24-page field guide')
    && !liveHtml.includes('/join?ref=')
    && !liveHtml.includes('Affiliate referral intake')
    && !liveHtml.includes('data-preview-destination')
    && !liveHtml.includes('preview-destination'),
  'member, free-guide, partner, community, and legal destinations remain real navigable links in live mode',
);
check(
  /from = "\/"[\s\S]*?to = "\/site-live\/index\.html"[\s\S]*?status = 200[\s\S]*?force = true/.test(netlifyConfig)
    && /from = "\/new-site-preview"[\s\S]*?to = "\/site-preview\/index\.html"[\s\S]*?status = 200/.test(netlifyConfig),
  'Netlify root and owner-review routes select the separate live and inert artifacts',
);
check(
  confirmationHtml.includes('<meta name="robots" content="noindex, nofollow">')
    && confirmationHtml.includes('src="/site-live/ccc-logo.webp"')
    && confirmationHtml.includes('src="/site-live/founder-chris.webp"')
    && confirmationHtml.includes('You’re booked.')
    && confirmationHtml.includes('30 minutes')
    && confirmationHtml.includes('Have your newest three-bureau report ready')
    && confirmationHtml.includes('What to expect')
    && confirmationHtml.includes('No onboarding is required before the call.')
    && !/Calendly|URLSearchParams|event_start_time|invitee_(?:first|full)_name/.test(confirmationHtml),
  'booking confirmation is branded, private, preparation-focused, and free of retired Calendly parameters',
);
check(
  /from = "\/consultation-confirmed"[\s\S]*?to = "\/success\.html"[\s\S]*?status = 200[\s\S]*?force = true/.test(netlifyConfig)
    && /from = "\/consultation-confirmed\/"[\s\S]*?to = "\/success\.html"[\s\S]*?status = 200[\s\S]*?force = true/.test(netlifyConfig)
    && /from = "\/success"[\s\S]*?to = "\/success\.html"[\s\S]*?status = 200[\s\S]*?force = true/.test(netlifyConfig)
    && !/from = "\/(?:consultation-confirmed|success)\/?"[\s\S]{0,220}?to = "https:\/\/[^\"]*scorexer/.test(netlifyConfig),
  'Netlify serves the branded confirmation page at the new route and the legacy success alias',
);
check(
  viteConfig.includes("directory: 'site-live'")
    && viteConfig.includes("directory: 'site-preview'")
    && viteConfig.includes('/^\\/$/')
    && viteConfig.includes('/^\\/site-live\\//')
    && viteConfig.includes("'site-live/**'")
    && viteConfig.includes("'site-preview/**'"),
  'PWA navigation and precache rules exclude the root handoff and both marketing artifacts',
);
check(
  liveCss.includes('.live-consent')
    && liveCss.includes('.form-help')
    && liveCss.includes('textarea')
    && liveCss.includes('@media (max-width: 620px)')
    && liveCss.includes('.form-grid')
    && liveCss.includes('grid-template-columns: 1fr'),
  'live DisputeFox intake retains the existing 390px-compatible responsive form layout',
);

const failed = assertions.filter((assertion) => !assertion.condition);
for (const assertion of assertions) {
  console.log(`${assertion.condition ? 'PASS' : 'FAIL'}  ${assertion.message}`);
}

if (failed.length) {
  console.error(`\n${failed.length} live release contract check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\n${assertions.length} live release contract checks passed.`);
}
