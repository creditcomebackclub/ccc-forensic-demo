/*
 * Credit Comeback Club — native embed widget.
 *
 * Drop this on a partner's own site to render the lead-capture form
 * inline (no iframe) so it inherits the host page's layout instead of
 * sitting in a boxed frame:
 *
 *   <div data-ccc-join data-ref="951412da"></div>
 *   <script src="https://creditcomebackclub.com/join-embed.js" async></script>
 *
 * data-ref is the same affiliate ref used in /join?ref=... — omit it for
 * an unbranded, unattributed form. Everything here is scoped under one
 * class (.ccc-embed) so it can't leak into or collide with the host
 * page's own styles; the two API calls it makes (affiliate branding
 * lookup + lead submission) are the same public, CORS-open endpoints
 * the standalone /join page uses, so attribution and lead creation work
 * identically either way.
 */
(function () {
  // Deliberately the netlify.app origin, not creditcomebackclub.com: the
  // custom domain 302-redirects to this origin rather than serving the
  // Netlify functions directly, and a redirect response carries no CORS
  // headers — a cross-origin fetch() (unlike a top-level navigation, which
  // just follows redirects transparently) fails the CORS preflight against
  // the custom domain before it ever reaches the function. Confirmed live:
  // OPTIONS against creditcomebackclub.com/api/... came back a bare 302
  // with no Access-Control-* headers; the same request against
  // ccc-forensic-demo.netlify.app came back 204 with full CORS headers.
  var BASE = 'https://ccc-forensic-demo.netlify.app';
  var STYLE_ID = 'ccc-embed-styles';

  function injectStylesOnce() {
    if (document.getElementById(STYLE_ID)) return;

    var fontLink1 = document.createElement('link');
    fontLink1.rel = 'preconnect';
    fontLink1.href = 'https://fonts.googleapis.com';
    document.head.appendChild(fontLink1);

    var fontLink2 = document.createElement('link');
    fontLink2.rel = 'stylesheet';
    fontLink2.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600;700&display=swap';
    document.head.appendChild(fontLink2);

    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.ccc-embed, .ccc-embed * { box-sizing: border-box; }' +
      '.ccc-embed {' +
      '  --ccc-navy: #1B2A4A; --ccc-gold: #C9A84C; --ccc-ink: #111827;' +
      '  --ccc-muted: #6B7280; --ccc-border: #E7EAF0;' +
      '  font-family: "Barlow", Arial, sans-serif; color: var(--ccc-ink);' +
      '  max-width: 460px; margin: 0 auto; background: #fff;' +
      '  border-radius: 20px; box-shadow: 0 12px 40px rgba(16,24,40,0.14);' +
      '  padding: 36px 32px 30px; border: 1px solid var(--ccc-border);' +
      '}' +
      '.ccc-embed .ccc-brand-row { display: flex; align-items: center; justify-content: center; gap: 14px; margin-bottom: 20px; }' +
      '.ccc-embed .ccc-logo { height: 50px; width: auto; border-radius: 6px; object-fit: contain; display: block; }' +
      '.ccc-embed .ccc-brand-x { color: #C7CDDA; font-size: 15px; font-weight: 600; }' +
      '.ccc-embed .ccc-partner-logo { max-height: 50px; max-width: 140px; object-fit: contain; }' +
      '.ccc-embed .ccc-eyebrow-wrap { text-align: center; }' +
      '.ccc-embed .ccc-eyebrow {' +
      '  display: none; width: max-content; max-width: 100%; margin: 0 auto 16px;' +
      '  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;' +
      '  color: var(--ccc-gold); background: rgba(201,168,76,0.12); border: 1px solid rgba(201,168,76,0.35);' +
      '  border-radius: 100px; padding: 6px 14px;' +
      '}' +
      '.ccc-embed h2 {' +
      '  font-family: "Barlow Condensed", sans-serif; font-weight: 800; font-size: 24px; line-height: 1.15;' +
      '  text-align: center; color: var(--ccc-navy); margin: 0 0 10px;' +
      '}' +
      '.ccc-embed p.ccc-sub { text-align: center; font-size: 13px; line-height: 1.5; color: var(--ccc-muted); margin: 0 0 24px; }' +
      '.ccc-embed form { display: flex; flex-direction: column; gap: 12px; }' +
      '.ccc-embed label {' +
      '  font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;' +
      '  color: var(--ccc-muted); margin-bottom: 4px; display: block;' +
      '}' +
      '.ccc-embed input {' +
      '  width: 100%; padding: 11px 14px; border: 1px solid var(--ccc-border); border-radius: 9px;' +
      '  font-size: 14px; font-family: inherit; color: var(--ccc-ink); background: #fff;' +
      '}' +
      '.ccc-embed input:focus { outline: none; border-color: var(--ccc-navy); }' +
      '.ccc-embed .ccc-submit {' +
      '  margin-top: 6px; width: 100%; padding: 13px; border: none; border-radius: 9px;' +
      '  background: var(--ccc-navy); color: var(--ccc-gold); font-size: 13px; font-weight: 700;' +
      '  text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer;' +
      '}' +
      '.ccc-embed .ccc-submit:disabled { opacity: 0.55; cursor: not-allowed; }' +
      '.ccc-embed .ccc-error { font-size: 12px; color: #B91C1C; text-align: center; min-height: 0; }' +
      '.ccc-embed .ccc-disclosure { margin-top: 16px; font-size: 10.5px; line-height: 1.5; color: #9CA3AF; text-align: center; }' +
      '.ccc-embed .ccc-success { display: none; text-align: center; }' +
      '.ccc-embed .ccc-success svg { width: 42px; height: 42px; color: #10B981; margin-bottom: 12px; }' +
      '.ccc-embed .ccc-success h2 { font-size: 20px; margin: 0 0 8px; }' +
      '.ccc-embed .ccc-success p { font-size: 13px; color: var(--ccc-muted); margin: 0 0 18px; line-height: 1.5; }' +
      '.ccc-embed .ccc-schedule-link {' +
      '  display: inline-block; padding: 11px 22px; border-radius: 9px; background: var(--ccc-navy);' +
      '  color: var(--ccc-gold); font-size: 12.5px; font-weight: 700; text-transform: uppercase;' +
      '  letter-spacing: 0.04em; text-decoration: none;' +
      '}';
    document.head.appendChild(style);
  }

  function render(container) {
    var ref = (container.getAttribute('data-ref') || '').trim();
    var refValid = /^[0-9a-f]{6,36}$/i.test(ref);

    container.classList.add('ccc-embed');
    container.innerHTML =
      '<div class="ccc-form-step">' +
      '  <div class="ccc-brand-row" data-ccc-brand-row>' +
      '    <img src="' + BASE + '/logo.jpg" alt="Credit Comeback Club" class="ccc-logo">' +
      '  </div>' +
      '  <div class="ccc-eyebrow-wrap"><span class="ccc-eyebrow" data-ccc-eyebrow></span></div>' +
      '  <h2>Start Your Credit Comeback</h2>' +
      '  <p class="ccc-sub">We review how accounts appear across your three credit reports, build factual disputes around the details that do not match, and track each response.</p>' +
      '  <form data-ccc-form>' +
      '    <div style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;" aria-hidden="true"><label>Leave this field blank</label><input type="text" data-ccc-website tabindex="-1" autocomplete="off"></div>' +
      '    <div><label>Full Name</label><input type="text" data-ccc-name required autocomplete="name"></div>' +
      '    <div><label>Email</label><input type="email" data-ccc-email required autocomplete="email"></div>' +
      '    <div><label>Phone</label><input type="tel" data-ccc-phone autocomplete="tel"></div>' +
      '    <button type="submit" class="ccc-submit" data-ccc-submit>Get My Free Consultation</button>' +
      '    <div class="ccc-error" data-ccc-error></div>' +
      '  </form>' +
      '  <p class="ccc-disclosure">Credit Comeback Club, LLC provides credit repair services. We do not charge until after your free consultation and a service agreement is executed, per the Credit Repair Organizations Act and the Telemarketing Sales Rule.</p>' +
      '</div>' +
      '<div class="ccc-success" data-ccc-success>' +
      '  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/></svg>' +
      '  <h2>You\'re In!</h2>' +
      '  <p>Choose a time now and we\'ll email your preparation steps once your appointment is confirmed.</p>' +
      '  <div data-ccc-calendly style="min-width:280px;height:430px"></div>' +
      '</div>';

    if (refValid) {
      fetch(BASE + '/api/public-affiliate-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: ref })
      }).then(function (r) { return r.json(); }).then(function (data) {
        var aff = data && data.affiliate;
        if (!aff) return;
        var label = aff.brandName || aff.company || aff.name;
        var eyebrow = container.querySelector('[data-ccc-eyebrow]');
        if (eyebrow && label) {
          eyebrow.textContent = 'In Partnership With ' + label;
          eyebrow.style.display = 'inline-block';
        }
        if (aff.logoUrl) {
          var brandRow = container.querySelector('[data-ccc-brand-row]');
          var x = document.createElement('span');
          x.className = 'ccc-brand-x';
          x.textContent = '×';
          var img = document.createElement('img');
          img.className = 'ccc-partner-logo';
          img.src = aff.logoUrl;
          img.alt = label || 'Partner';
          brandRow.appendChild(x);
          brandRow.appendChild(img);
        }
      }).catch(function () {});
    }

    var formStep = container.querySelector('.ccc-form-step');
    var successStep = container.querySelector('[data-ccc-success]');
    var form = container.querySelector('[data-ccc-form]');
    var submitBtn = container.querySelector('[data-ccc-submit]');
    var errorMsg = container.querySelector('[data-ccc-error]');
    var calendlyPrefill = null;

    function showCalendly() {
      var mount = container.querySelector('[data-ccc-calendly]');
      if (!mount) return;
      var init = function () {
        if (!window.Calendly || !window.Calendly.initInlineWidget) return;
        mount.innerHTML = '';
        window.Calendly.initInlineWidget({
          url: 'https://calendly.com/creditcomebackclub/consultation',
          parentElement: mount,
          prefill: calendlyPrefill || undefined
        });
      };
      if (window.Calendly && window.Calendly.initInlineWidget) {
        init();
      } else {
        var script = document.querySelector('script[data-ccc-calendly-widget]');
        if (!script) {
          script = document.createElement('script');
          script.src = 'https://assets.calendly.com/assets/external/widget.js';
          script.async = true;
          script.setAttribute('data-ccc-calendly-widget', '1');
          document.head.appendChild(script);
        }
        script.addEventListener('load', init, { once: true });
      }
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errorMsg.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';

      var payload = {
        name: container.querySelector('[data-ccc-name]').value,
        email: container.querySelector('[data-ccc-email]').value,
        phone: container.querySelector('[data-ccc-phone]').value,
        ref: refValid ? ref : undefined,
        website: container.querySelector('[data-ccc-website]').value
      };

      fetch(BASE + '/api/public-intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (res) {
        if (!res.ok) throw new Error('Something went wrong — please try again.');
        return res.json();
      }).then(function () {
        calendlyPrefill = {
          name: String(payload.name || '').trim(),
          email: String(payload.email || '').trim().toLowerCase()
        };
        formStep.style.display = 'none';
        successStep.style.display = 'block';
        showCalendly();
      }).catch(function (err) {
        errorMsg.textContent = (err && err.message) || 'Something went wrong — please try again.';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Get My Free Consultation';
      });
    });

  }

  function init() {
    var containers = document.querySelectorAll('[data-ccc-join]');
    if (containers.length === 0) return;
    injectStylesOnce();
    containers.forEach(render);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
