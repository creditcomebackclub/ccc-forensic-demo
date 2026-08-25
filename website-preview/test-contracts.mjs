import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const previewRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(previewRoot);
const [html, css, js, server, viteConfig, netlifyConfig] = await Promise.all([
  readFile(join(previewRoot, 'index.html'), 'utf8'),
  readFile(join(previewRoot, 'styles.css'), 'utf8'),
  readFile(join(previewRoot, 'app.js'), 'utf8'),
  readFile(join(previewRoot, 'server.mjs'), 'utf8'),
  readFile(join(repoRoot, 'vite.config.js'), 'utf8'),
  readFile(join(repoRoot, 'netlify.toml'), 'utf8'),
]);

const ownerImageAssets = [
  'review-stefani-bryant.png',
  'review-noah-panetta.png',
  'review-karl-elliott.png',
  'review-elizabeth-holland.png',
  'client-result-equifax-820.jpg',
  'client-result-inquiries-828.jpg',
  'client-result-dilian-t.jpg',
  'client-result-ryan-e.jpg',
  'client-result-elizabeth-h.jpg',
  'client-result-cameron-m.jpg',
];
const ownerAssetAvailability = await Promise.all(ownerImageAssets.map(async (asset) => {
  try {
    await access(join(previewRoot, asset));
    return true;
  } catch {
    return false;
  }
}));
const evidenceImageAssets = [
  'robert-k-result.webp',
  'client-result-equifax-820.webp',
  'client-result-inquiries-828.webp',
  'client-result-dilian-t.webp',
  'client-result-ryan-e.webp',
  'client-result-elizabeth-h.webp',
  'client-result-cameron-m.webp',
];
const evidenceAssetAvailability = await Promise.all(evidenceImageAssets.map(async (asset) => {
  try {
    await access(join(previewRoot, asset));
    return true;
  } catch {
    return false;
  }
}));
let founderAssetAvailable = true;
try {
  await access(join(previewRoot, 'founder-chris.webp'));
} catch {
  founderAssetAvailable = false;
}
let socialAssetAvailable = true;
try {
  await access(join(previewRoot, 'ccc-social-preview-2026.jpg'));
} catch {
  socialAssetAvailable = false;
}
let legacyFounderPngPresent = true;
try {
  await access(join(previewRoot, 'founder-chris.png'));
} catch {
  legacyFounderPngPresent = false;
}

const assertions = [];
const inertPreviewHtml = html.replace(
  /<!-- CCC_LIVE_ONLY_START -->[\s\S]*?<!-- CCC_LIVE_ONLY_END -->/g,
  '',
);
function check(condition, message) {
  assertions.push({ condition: Boolean(condition), message });
}

check(ownerAssetAvailability.every(Boolean), 'all ten supplied image files exist in the isolated preview');
check(evidenceAssetAvailability.every(Boolean), 'all seven client evidence image files exist in the isolated preview');

const destinations = [
  '/freeguide',
  '/affiliate/apply',
  '/terms',
  '/privacy',
  '/cancellation-refund-policy',
  '/croa-statement',
];

check(html.includes('data-preview-only="true"'), 'page declares preview-only mode');
check(
  viteConfig.includes("name: 'ccc-website-release-artifacts'")
    && viteConfig.includes("directory: 'site-preview'")
    && viteConfig.includes("resolve(process.cwd(), `dist/${release.directory}`)")
    && viteConfig.includes("'site-preview/**'"),
  'main production build emits an isolated, service-worker-excluded review snapshot',
);
check(
  /from = "\/new-site-preview"[\s\S]*?to = "\/site-preview\/index\.html"[\s\S]*?status = 200/.test(netlifyConfig)
    && /from = "\/"[\s\S]*?to = "\/site-live\/index\.html"[\s\S]*?force = true/.test(netlifyConfig),
  'Netlify keeps the inert review URL separate from the live root artifact',
);
check(
  !/https:\/\/(?:calendly\.com|pulse\.scorexer\.com|pulse\.disputeprocess\.com)/i.test(inertPreviewHtml),
  'inert preview source contains no live CRM or scheduler destination',
);
check(
  html.includes('<span class="widget-kicker">Start your consultation request</span>')
    && !html.includes('Calendly embed shell')
    && (html.match(/Preview only/g) || []).length === 1
    && html.includes('Local safety indicator only; this is not customer-facing production copy.'),
  'consultation widget uses customer-facing copy while its single Preview only chip is explicitly local-only',
);
check(html.includes('Veteran-Owned &amp; Operated'), 'veteran-owned trust signal is present');
check(
  html.includes('id="community"')
    && html.includes('Your comeback does not have to happen in silence.')
    && html.includes('More than 280 members and growing')
    && html.includes('href="https://www.facebook.com/groups/creditcomebackclub"')
    && html.includes('target="_blank"')
    && html.includes('rel="noopener noreferrer"')
    && html.includes('Join the free Facebook community'),
  'Facebook group is presented as a meaningful, safely linked education-community CTA',
);
check(
  html.includes('<a class="preview-destination" href="/freeguide" data-preview-destination="/freeguide">Free guide</a>')
    && html.includes('class="guide-resource-section"')
    && html.includes('Free 24-page field guide')
    && html.includes('3-bureau review workflow')
    && html.includes('Fill-in letter framework')
    && html.includes('Worksheets and response tracking')
    && html.includes('Educational information only. The guide does not promise deletions, score changes, or any other result.')
    && html.includes('Get the free guide')
    && css.includes('.guide-resource-card')
    && css.includes('.guide-resource-list'),
  'primary navigation and compact premium resource section lead safely to the factual 24-page field guide',
);
check(
  html.includes('<a class="preview-destination" href="/freeguide" data-preview-destination="/freeguide">Free dispute guide</a>')
    && html.includes('<a href="https://www.facebook.com/groups/creditcomebackclub" target="_blank" rel="noopener noreferrer">Facebook community</a>')
    && html.includes('href="/affiliate/apply" data-preview-destination="/affiliate/apply">Partner application</a>')
    && !html.includes('/join?ref=')
    && !html.includes('Affiliate referral intake')
    && !html.includes('>Affiliate application</a>')
    && html.includes('href="/cancellation-refund-policy" data-preview-destination="/cancellation-refund-policy">Cancellation &amp; refunds</a>'),
  'footer exposes the guide, community, and clearly named partner application without the empty referral route',
);
check(html.includes('Your Story. The Facts. The Pressure.'), 'owner-approved public framework leads the method');
check(
  html.includes('You are more than a credit score. <span>Your report should reflect the facts.</span>')
    && html.includes('A generic dispute does not tell your story')
    && html.includes('Before you become a client')
    && html.includes('the conversation starts with the report—not a sales pitch'),
  'premium hero leads with the owner-approved emotional promise and factual case-building value',
);
check(!html.includes('Clarity before action'), 'rejected legacy preview tagline is absent');
check(
  (html.match(/src="\/ccc-logo\.webp"/g) || []).length === 4
    && html.includes('class="brand-logo"')
    && html.includes('class="hero-logo-watermark"')
    && html.includes('class="blueprint-brand-logo"'),
  'supplied CCC logo appears prominently in the header, hero, Blueprint, and footer',
);
check(server.includes("'/ccc-logo.webp'"), 'preview server exposes the supplied CCC logo');
check(
  socialAssetAvailable
    && server.includes("'/ccc-social-preview-2026.jpg'")
    && server.includes("name: 'ccc-social-preview-2026.jpg', type: 'image/jpeg'"),
  'preview server exposes the versioned social image with the correct JPEG content type',
);
check(html.includes('personal impact'), 'personal impact is explained');
check(html.includes('inaccurate, incomplete, or inconsistent'), 'exact reporting-fact categories are explained');
check(
  html.includes('applicable consumer law') && html.includes('response deadlines') && html.includes('supported consequences'),
  'documented legal, deadline, and consequence follow-through is explained',
);
check(
  (html.match(/Consent, Accuracy, and Collection/g) || []).length === 1,
  'internal routing name appears only once in lower educational detail',
);
check(html.includes('USPS First-Class'), 'current mail method is named');
check(html.includes('Recovery Blueprint'), 'Recovery Blueprint is represented');
check(
  html.includes('Horizon Bank')
    && html.includes('Summit Recovery')
    && html.includes('Accuracy R1')
    && html.includes('Collection R1')
    && html.includes('Illustrative sample · not client data'),
  'hero Blueprint resembles a real account-level, per-bureau routing artifact using fictional data',
);
check(
  founderAssetAvailable
    && !legacyFounderPngPresent
    && html.includes('src="/founder-chris.webp"')
    && html.includes('Chris, founder of Credit Comeback Club')
    && html.includes('width="1400"')
    && html.includes('height="1400"')
    && html.includes('loading="lazy"')
    && html.includes('decoding="async"')
    && !html.includes('founder-chris.png'),
  'optimized supplied founder photo is shown with intrinsic dimensions, lazy decoding, and useful alternative text',
);
check(
  server.includes("'/founder-chris.webp'")
    && server.includes("type: 'image/webp'")
    && !server.includes("'/founder-chris.png'"),
  'preview server exposes only the optimized founder image with the correct content type',
);
check(
  html.includes('src="/robert-k-result.webp"')
    && html.includes('Robert K.')
    && html.includes('Testimonials describe individual experiences previously published by CCC.'),
  'Robert K. evidence is shown with an individual-results disclaimer',
);
check(server.includes("'/robert-k-result.webp'"), 'preview server exposes the supplied testimonial image');
check(
  server.includes("['/robert-k-result.webp', { name: 'robert-k-result.webp', type: 'image/webp' }]")
    && server.includes("['/client-result-equifax-820.webp', { name: 'client-result-equifax-820.webp', type: 'image/webp' }]")
    && server.includes("['/client-result-inquiries-828.webp', { name: 'client-result-inquiries-828.webp', type: 'image/webp' }]")
    && server.includes("['/client-result-dilian-t.webp', { name: 'client-result-dilian-t.webp', type: 'image/webp' }]")
    && server.includes("['/client-result-ryan-e.webp', { name: 'client-result-ryan-e.webp', type: 'image/webp' }]")
    && server.includes("['/client-result-elizabeth-h.webp', { name: 'client-result-elizabeth-h.webp', type: 'image/webp' }]")
    && server.includes("['/client-result-cameron-m.webp', { name: 'client-result-cameron-m.webp', type: 'image/webp' }]")
    && evidenceImageAssets.every((asset) => (html.match(new RegExp('src="/' + asset.replace('.', '\\.') + '"', 'g')) || []).length === 1),
  'client evidence filenames, routes, MIME types, and single rendered instances match exactly',
);
const reviewAssets = [
  'review-stefani-bryant.webp',
  'review-noah-panetta.webp',
  'review-karl-elliott.png',
  'review-elizabeth-holland.png',
];
const renderedReviewAssets = reviewAssets.filter((asset) => !['review-karl-elliott.png', 'review-elizabeth-holland.png'].includes(asset));
check(
  renderedReviewAssets.every((asset) => html.includes('src="/' + asset + '"'))
    && reviewAssets.every((asset) => server.includes("'/" + asset + "'"))
    && !html.includes('src="/review-karl-elliott.png"')
    && !html.includes('src="/review-elizabeth-holland.png"'),
  'non-duplicated Facebook recommendations are rendered while all supplied assets remain safely allowlisted',
);
check(
  ['Stefani Bryant', 'Noah Panetta']
    .every((name) => (html.match(new RegExp('<strong>' + name + '<\\/strong>', 'g')) || []).length === 1),
  'each retained Facebook reviewer appears in exactly one testimonial card',
);
check(
  /\.testimonial-review-card img\s*\{[^}]*height:\s*auto;[^}]*object-fit:\s*contain;/s.test(css)
    && /\.testimonial-track\s*\{[^}]*align-items:\s*flex-start;/s.test(css),
  'review screenshots keep natural aspect ratios without stretching into dead card space',
);
check(
  html.includes('src="/client-result-equifax-820.webp"')
    && html.includes('src="/client-result-inquiries-828.webp"')
    && server.includes("'/client-result-equifax-820.webp'")
    && server.includes("'/client-result-inquiries-828.webp'"),
  'both supplied identified result images are rendered and allowlisted',
);
check(
  html.includes('<strong>76</strong>')
    && html.includes('<strong>70 days</strong>')
    && html.includes('Average time to deletion')
    && !html.includes('Average time to first deletion')
    && html.includes('<strong>100+</strong>')
    && html.includes('<strong>$6.2M+</strong>'),
  'owner-directed CCC result metrics are shown exactly',
);
check(
  ['Collections', 'Charge-offs', 'Late payments', 'Repossessions', 'Student loans', 'Bankruptcies', 'Foreclosures', 'Judgments']
    .every((label) => html.includes('<li>' + label + '</li>')),
  'prior CCC result categories are shown',
);
check(
  (html.match(/class="testimonial-result-card/g) || []).length === 7
    && html.includes('Stefani Bryant')
    && html.includes('Noah Panetta')
    && html.includes('Ashley Dawn')
    && html.includes('Robert Carter')
    && !html.includes('<strong>Elizabeth Holland</strong>')
    && html.includes('Jasmine Wallace')
    && html.includes('Darius &amp; Monique Barnes')
    && !html.includes('<strong>Karl Elliott</strong>')
    && html.includes('Marcus Thompson'),
  'seven unique client recommendations remain after duplicated Karl and Elizabeth cards are retired',
);
check(
  !html.includes('“Chris is extremely knowledgeable and helped me raise my credit score substantially')
    && !html.includes('“In less than six months, Chris helped me boost my credit score')
    && !html.includes('“He doesn’t leave you in the dark.'),
  'Facebook screenshots replace rather than duplicate their prior text-only cards',
);
check(
  (html.match(/class="evidence-result-card"/g) || []).length === 7
    && html.includes('Robert K. — San Tan Valley, AZ')
    && html.includes('Karl E. — Ft. Myers, FL')
    && html.includes('David R. — Denver, CO')
    && html.includes('Dilian T. — Knoxville, TN')
    && html.includes('Ryan E. — Los Angeles, CA')
    && html.includes('Elizabeth H. — Mt. Juliet, TN')
    && html.includes('Cameron M. — Draper, UT')
    && (html.match(/<span>Client result<\/span>/g) || []).length === 7
    && !/anonymous client/i.test(html),
  'all seven evidence cards use only the exact owner-supplied client identity and location',
);
check(
  !/owner[- ]provided|provided screenshot|provided testimonial/i.test(html),
  'testimonial and evidence UI exposes no internal asset-provenance wording',
);
check(
  html.includes('<p class="eyebrow">Proof in focus</p>')
    && (html.match(/data-evidence-open/g) || []).length === 7
    && html.includes('data-evidence-dialog')
    && html.includes('data-evidence-dialog-image')
    && (html.match(/loading="lazy"/g) || []).length >= 4
    && html.includes('width="708"')
    && html.includes('height="872"')
    && html.includes('width="1270"')
    && html.includes('height="1636"')
    && html.includes('width="1284"')
    && html.includes('height="1915"')
    && html.includes('width="1194"')
    && html.includes('height="2046"')
    && html.includes('height="1161"')
    && html.includes('height="1767"')
    && html.includes('width="933"')
    && html.includes('height="1037"'),
  'evidence cards expose a full-image viewer and reserve each source image ratio before lazy loading',
);
check(
  /\.evidence-result-card\s*\{[^}]*flex:\s*0 0 calc\(\(100% - 36px\) \/ 3\);/s.test(css)
    && /\.evidence-image-frame\s*\{[^}]*aspect-ratio:\s*5 \/ 4;/s.test(css)
    && /\.evidence-image-frame img\s*\{[^}]*object-fit:\s*cover;/s.test(css)
    && /\.evidence-lightbox-image img\s*\{[^}]*object-fit:\s*contain;/s.test(css)
    && css.includes('.evidence-image-robert::before')
    && css.includes('.evidence-image-equifax::before')
    && css.includes('.evidence-image-inquiries::before')
    && css.includes('.evidence-image-robert img')
    && css.includes('.evidence-image-equifax img')
    && css.includes('.evidence-image-inquiries img')
    && css.includes('.evidence-image-dilian::before')
    && css.includes('.evidence-image-ryan::before')
    && css.includes('.evidence-image-elizabeth::before')
    && css.includes('.evidence-image-cameron::before')
    && /\.evidence-image-dilian img\s*\{[^}]*rotate\(3deg\) scale\(0\.93\)/s.test(css)
    && /\.evidence-image-ryan img\s*\{[^}]*rotate\(0deg\) scale\(0\.99\)/s.test(css)
    && /\.evidence-image-elizabeth img\s*\{[^}]*rotate\(4deg\) scale\(0\.9\)/s.test(css)
    && /\.evidence-image-cameron img\s*\{[^}]*rotate\(0deg\) scale\(0\.98\)/s.test(css)
    && /\.evidence-image-dilian img,[\s\S]*?\.evidence-image-cameron img\s*\{[^}]*object-fit:\s*contain;/s.test(css),
  'evidence cards level the four new originals without cropping material evidence and preserve full images in the viewer',
);
check(
  js.includes("document.querySelectorAll('[data-evidence-open]')")
    && js.includes('evidenceDialog.showModal()')
    && js.includes("evidenceDialogImage?.removeAttribute('src')")
    && js.includes('controls.hidden = !hasOverflow')
    && js.includes('previous.disabled = !hasOverflow'),
  'evidence lightbox and responsive carousel controls are wired without duplicating card content',
);
check(
  html.includes('This simulator is an educational planning tool')
    && html.includes('No point, deletion, timeline, approval, or outcome prediction is produced by this tool.'),
  'simulator prediction and outcome disclaimers are explicit',
);
check(
  html.includes('data-score-goal-link')
    && html.includes('Review My Credit Goal')
    && html.includes('href="#consultation"')
    && js.includes("'Review My Path to ' + goal")
    && js.includes("scoreForm?.elements.namedItem('goal')?.addEventListener('input'")
    && js.includes('updateScoreGoalLink(values.goal)')
    && js.includes("updateScoreGoalLink('')"),
  'score-goal CTA follows the valid entered goal and resets safely',
);
check(
  html.includes('name="scoreSource"')
    && (html.match(/name="factors"/g) || []).length === 5
    && html.includes('Factors you can influence')
    && html.includes('Factors you cannot directly control')
    && html.includes('Review the source reports')
    && html.includes('Identify the exact facts')
    && html.includes('Correct facts and strengthen legitimate factors')
    && html.includes('Monitor what actually changes'),
  'simulator produces source-aware factor education and a four-stage roadmap',
);
check(
  js.includes("'mixed-sources': 'Because you selected mixed apps, dates, or models")
    && js.includes('They do not tell us which account may change')
    && html.includes('Negative information is not automatically disputable.'),
  'simulator logic avoids inferring disputes or mapping score gaps to outcomes',
);
check(
  html.includes('Your report is not your score.')
    && html.includes('Negative does not automatically mean disputable.')
    && html.includes('From account data to a documented case.'),
  'credit education explains reports, legitimate dispute scope, and case-building',
);
check(html.includes('No appointment was created'), 'calendar mock states its no-write outcome');
check(html.includes('<span class="program-label">Standard</span>'), 'Standard program routes to lead capture');
check(html.includes('<span class="program-label">VIP</span>'), 'VIP program routes to lead capture');
check(html.includes('<span class="program-label">Six-Month Standard</span>'), 'Six-Month Standard program routes to lead capture');
check(
  html.includes('<strong>$149</strong>')
    && html.includes('<strong>$299</strong>')
    && html.includes('<strong>$849</strong>'),
  'owner-approved public prices are shown exactly',
);
check(
  (html.match(/data-plan-open=/g) || []).length === 3
    && (html.match(/See what’s included/g) || []).length >= 4
    && html.includes('id="plan-details-dialog"')
    && html.includes('data-plan-dialog-close')
    && html.includes('aria-haspopup="dialog"')
    && html.includes('aria-controls="plan-details-dialog"'),
  'each pricing card opens the shared accessible plan-details dialog',
);
check(
  html.includes('Your reports, reviewed as a file')
    && html.includes('Tailored, staff-reviewed correspondence')
    && html.includes('Printing and First-Class mailing')
    && html.includes('A documented campaign record')
    && html.includes('Secure portal visibility')
    && html.includes('Case-by-case sequencing')
    && html.includes('credit bureaus')
    && html.includes('furnishers or collectors')
    && html.includes('USPS First-Class')
    && ['Casework', 'Progress', 'Timeline', 'Documents', 'Billing']
      .every((area) => html.includes('<li>' + area + '</li>')),
  'plan dialog states the complete shared core scope without unsupported extras',
);
check(
  html.includes('data-plan-panel="standard"')
    && html.includes('<dd>$149 each month</dd>')
    && (html.match(/<dd>Month to month<\/dd>/g) || []).length === 2
    && html.includes('<dd>Up to 3 tailored letters each month when supported</dd>')
    && html.includes('CCC manages the core casework, prepares staff-reviewed correspondence')
    && html.includes('data-plan-panel="vip"')
    && html.includes('<dd>$299 each month</dd>')
    && html.includes('Everything in Standard, plus a private monthly 1:1 with Chris')
    && html.includes('<dd>Up to 5 tailored letters each month when supported</dd>')
    && html.includes('<dd>One private 1:1 call with Chris each month</dd>')
    && html.includes('<dd>Chris personally reviews and directs strategy; staff may handle operations</dd>')
    && html.includes('<dd>Priority within CCC’s review and processing queue</dd>')
    && html.includes('<dd>Exclusive CCC partner access and fast-track readiness review</dd>')
    && html.includes('<dd>Priority funding-partner referral when eligible</dd>')
    && html.includes('data-plan-panel="six-month-standard"')
    && html.includes('<dd>Only after completed services; never prepaid for future work</dd>')
    && html.includes('<dd>Fixed six months</dd>')
    && html.includes('<dd>Standard—not VIP</dd>')
    && html.includes('The same managed scope and correspondence capacity as Standard for one defined six-month term'),
  'dialog states the owner-confirmed capacity, access, processing, funding, billing, and term differences',
);
check(
  html.includes('Priority applies only to CCC’s internal workflow')
    && html.includes('It cannot make a bureau, furnisher, collector, lender, or other third party respond or decide faster')
    && html.includes('CCC is not a lender.')
    && html.includes('Funding partners independently determine eligibility, approval, amount, rate, terms, and timing')
    && html.includes('funding is not guaranteed')
    && !html.includes('Currently the same complete CCC core service'),
  'VIP processing and funding access use explicit third-party and no-guarantee guardrails',
);
check(
  html.includes('Results and third-party response times are not guaranteed.')
    && html.includes('The agreement you review before enrollment states the exact scope, billing date, term, cancellation rights, and other conditions')
    && !/(save|savings|discount|best value)/i.test(html.slice(html.indexOf('data-plan-dialog'), html.indexOf('</dialog>', html.indexOf('data-plan-dialog')))),
  'plan dialog includes quiet agreement and no-guarantee guardrails without a savings claim',
);
check(
  js.includes("document.querySelectorAll('[data-plan-open]')")
    && js.includes('planDialog.showModal()')
    && js.includes('event.target === planDialog')
    && js.includes("if (event.key === 'Escape')")
    && !js.includes("event.key === 'Escape' && typeof planDialog.showModal")
    && js.includes('lastPlanTrigger?.focus()')
    && js.includes("document.body.classList.add('plan-dialog-open')")
    && js.includes("document.body.classList.remove('plan-dialog-open')"),
  'plan dialog wires native modal focus, close, backdrop, Escape fallback, and scroll-lock behavior',
);
check(
  /\.plan-details-dialog::backdrop\s*\{[^}]*backdrop-filter:\s*blur\(/s.test(css)
    && /\.plan-dialog-shell\s*\{[^}]*border-radius:\s*30px;[^}]*box-shadow:/s.test(css)
    && /\.plan-scope-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s.test(css)
    && css.includes('@media (max-width: 620px)')
    && /@media \(max-width: 620px\)[\s\S]*\.plan-scope-grid\s*\{[^}]*grid-template-columns:\s*1fr;/s.test(css),
  'plan dialog has branded backdrop, elevated panel styling, and a responsive one-column mobile scope',
);
check(!/autocomplete=["']cc-|name=["'](?:card|cvv|cvc|expiry)/i.test(html), 'preview contains no raw payment-card fields');
check(
  !html.includes('What the client should see clearly')
    && ['Service scope', 'Plan price', 'Billing timing', 'Required notices']
      .every((label) => !html.includes('<strong>' + label + '</strong>'))
    && !html.includes('What CCC will prepare and manage')
    && !html.includes('When each payment will occur under the agreement')
    && !html.includes('Disclosure and cancellation terms presented in the wizard')
    && !html.includes('class="pricing-approach"')
    && !css.includes('.pricing-approach'),
  'removed client-clarity pricing block and its four numbered rows stay absent',
);
check(!/Metro\s*2/i.test(html), 'retired Metro 2 marketing copy is absent');
check(!/certified[\s-]*mail/i.test(html), 'retired certified-mail marketing copy is absent');
check(
  html.includes('Historical CCC figures across individual client files.')
    && html.includes('Removal from a credit report does not necessarily cancel an underlying debt.'),
  'result metrics include outcome and debt-status guardrails',
);
check(
  !/<(?:script|img|iframe)\b[^>]*\bsrc=["']https?:\/\//i.test(html)
    && !/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']https?:\/\//i.test(html),
  'preview loads no remote scripts, styles, images, or frames',
);
check(!/\b(fetch|XMLHttpRequest|sendBeacon|localStorage|sessionStorage)\b/.test(js), 'preview JavaScript cannot call or persist to production');
check(server.includes("\"connect-src 'none'\""), 'preview server blocks network connections');
check(server.includes("\"form-action 'none'\""), 'preview server blocks form posts');
check(server.includes("\"frame-src 'none'\""), 'preview server blocks live embedded frames');
check(css.includes('prefers-reduced-motion'), 'reduced-motion behavior is included');

for (const destination of destinations) {
  check(
    html.includes('href="' + destination + '"') && html.includes('data-preview-destination="' + destination + '"'),
    'production destination inventory includes ' + destination,
  );
}
check(
  html.includes('href="https://creditcomeback.scorexer.com" data-preview-destination="/login"'),
  'production member access targets Scorexer while preview navigation remains inert',
);

const failed = assertions.filter((assertion) => !assertion.condition);
for (const assertion of assertions) {
  console.log((assertion.condition ? 'PASS' : 'FAIL') + '  ' + assertion.message);
}

if (failed.length) {
  console.error('\n' + failed.length + ' preview contract check(s) failed.');
  process.exitCode = 1;
} else {
  console.log('\n' + assertions.length + ' preview contract checks passed.');
}
