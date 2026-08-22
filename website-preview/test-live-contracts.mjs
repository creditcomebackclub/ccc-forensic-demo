import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWebsiteReleaseCss, createWebsiteReleaseHtml } from './release-build.mjs';

const previewRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(previewRoot);
const [htmlSource, cssSource, previewJs, liveJs, viteConfig, netlifyConfig, robots, sitemap] = await Promise.all([
  readFile(join(previewRoot, 'index.html'), 'utf8'),
  readFile(join(previewRoot, 'styles.css'), 'utf8'),
  readFile(join(previewRoot, 'app.js'), 'utf8'),
  readFile(join(previewRoot, 'live-app.js'), 'utf8'),
  readFile(join(repoRoot, 'vite.config.js'), 'utf8'),
  readFile(join(repoRoot, 'netlify.toml'), 'utf8'),
  readFile(join(repoRoot, 'public/robots.txt'), 'utf8'),
  readFile(join(repoRoot, 'public/sitemap.xml'), 'utf8'),
]);

const previewHtml = createWebsiteReleaseHtml(htmlSource, 'preview');
const liveHtml = createWebsiteReleaseHtml(htmlSource, 'live');
const liveCss = createWebsiteReleaseCss(cssSource, 'live');
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
    && !/preview|production disconnected|local concept/i.test(liveHtml),
  'live artifact has production metadata and no preview ribbon or preview-only copy',
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
  liveHtml.includes('name="name" autocomplete="name" maxlength="120" required')
    && liveHtml.includes('name="email" autocomplete="email" maxlength="254" required')
    && liveHtml.includes('name="phone" autocomplete="tel" maxlength="40" required')
    && liveHtml.includes('name="tier" required')
    && liveHtml.includes('name="intent" value="consultation"')
    && liveHtml.includes('name="website" tabindex="-1" autocomplete="off"'),
  'live intake exposes validated name, email, phone, tier, intent, and honeypot fields',
);
check(
  ['Standard', 'VIP', 'Paid In Full'].every((tier) => liveHtml.includes(`<option value="${tier}">`))
    && liveJs.includes("new Set(['Standard', 'VIP', 'Paid In Full'])")
    && liveJs.includes("intent !== 'consultation'")
    && liveJs.includes('phoneDigits.length >= 7')
    && liveJs.includes('emailField.validity.valid'),
  'live validation allows only the server-supported plan and consultation values',
);
check(
  liveJs.includes("fetch('/api/public-intake'")
    && liveJs.includes("'Content-Type': 'application/json'")
    && liveJs.includes('JSON.stringify(payload)')
    && liveJs.includes('body?.success !== true')
    && liveJs.includes("response.status === 429")
    && liveJs.includes("controller.abort()"),
  'live intake posts JSON to the hardened public endpoint and handles timeout, rate-limit, and invalid success responses',
);
check(
  liveHtml.includes('data-live-intake-status')
    && liveHtml.includes('role="status" aria-live="polite"')
    && liveJs.includes("intakeForm.setAttribute('aria-busy', 'true')")
    && liveJs.includes("field.setAttribute('aria-invalid'")
    && liveJs.includes('firstInvalid?.focus()')
    && liveJs.includes('calendarStage.focus()'),
  'live form exposes accessible validation, busy, status, and focus transitions',
);
check(
  liveHtml.includes('data-live-calendly')
    && liveJs.includes("const CALENDLY_URL = 'https://calendly.com/creditcomebackclub/consultation?hide_gdpr_banner=1'")
    && liveJs.includes("const CALENDLY_STYLE_URL = 'https://assets.calendly.com/assets/external/widget.css'")
    && liveJs.includes("const CALENDLY_SCRIPT_URL = 'https://assets.calendly.com/assets/external/widget.js'")
    && liveJs.includes('window.Calendly.initInlineWidget')
    && liveJs.includes('prefill: { name: payload.name, email: payload.email }'),
  'successful intake initializes the exact owner-provided Calendly inline widget with local name/email prefill',
);
check(
  liveHtml.includes('<script src="/embed.js" defer></script>'),
  'live artifact mounts the existing root chat embed without copying or modifying it',
);
check(
  /href="#consultation" data-tier="Standard">See if Standard fits<\/a>/.test(liveHtml)
    && /href="#consultation" data-tier="VIP">See if VIP fits<\/a>/.test(liveHtml)
    && /href="#consultation" data-tier="Paid In Full">Ask about paying in full<\/a>/.test(liveHtml)
    && previewJs.includes("planDialogConsultation.dataset.tier = selectedPanel.dataset.planName || ''"),
  'all card and dialog consultation CTAs retain exact plan-to-tier mapping',
);
check(
  liveHtml.includes('<strong>$149</strong>')
    && liveHtml.includes('<strong>$299</strong>')
    && liveHtml.includes('<strong>$997</strong>')
    && liveHtml.includes('The same managed scope and correspondence capacity as Standard for one defined six-month service term'),
  'live promotion preserves approved prices and paid-in-full scope',
);
check(
  ['/login', '/join?ref=', '/affiliate/apply', '/terms', '/privacy', '/croa-statement']
    .every((destination) => liveHtml.includes(`href="${destination}"`))
    && !liveHtml.includes('data-preview-destination')
    && !liveHtml.includes('preview-destination'),
  'member, referral, affiliate, and legal destinations remain real navigable links in live mode',
);
check(
  /from = "\/"[\s\S]*?to = "\/site-live\/index\.html"[\s\S]*?status = 200[\s\S]*?force = true/.test(netlifyConfig)
    && /from = "\/new-site-preview"[\s\S]*?to = "\/site-preview\/index\.html"[\s\S]*?status = 200/.test(netlifyConfig),
  'Netlify root and owner-review routes select the separate live and inert artifacts',
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
  liveCss.includes('.live-calendly-widget')
    && liveCss.includes('min-width: 280px')
    && liveCss.includes('@media (max-width: 620px)')
    && liveCss.includes('.form-grid')
    && liveCss.includes('grid-template-columns: 1fr'),
  'live intake and Calendly mount retain the existing 390px-compatible responsive form layout',
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
