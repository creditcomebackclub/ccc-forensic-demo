/*
 * Credit Comeback Club — native referral embed.
 *
 *   <div data-ccc-join data-ref="ref-code"></div>
 *   <script src="https://creditcomebackclub.com/join-embed.js" async></script>
 *
 * Leads post directly to the Credit Comeback Club DisputeFox form. The optional
 * data-ref value is retained as a source note; the retired CCC affiliate lookup
 * and lead APIs are not called.
 */
(function () {
  var SITE_ORIGIN = 'https://creditcomebackclub.com';
  var DISPUTEFOX_ENDPOINT = 'https://pulse.disputeprocess.com/CustumFieldController?method=addWebFormData';
  var SCHEDULER_URL = 'https://pulse.scorexer.com/Portal/meeting.jsp?id=5d235976-7de9-49d9-a061-dab6275c3c99';
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
      '.ccc-embed .ccc-brand-row { display:flex; align-items:center; justify-content:center; margin-bottom:20px; }' +
      '.ccc-embed .ccc-logo { height:50px; width:auto; border-radius:6px; object-fit:contain; display:block; }' +
      '.ccc-embed .ccc-eyebrow-wrap { text-align:center; }' +
      '.ccc-embed .ccc-eyebrow {' +
      '  display:none; width:max-content; max-width:100%; margin:0 auto 16px;' +
      '  font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.08em;' +
      '  color:var(--ccc-gold); background:rgba(201,168,76,.12); border:1px solid rgba(201,168,76,.35);' +
      '  border-radius:100px; padding:6px 14px;' +
      '}' +
      '.ccc-embed h2 {' +
      '  font-family:"Barlow Condensed",sans-serif; font-weight:800; font-size:24px; line-height:1.15;' +
      '  text-align:center; color:var(--ccc-navy); margin:0 0 10px;' +
      '}' +
      '.ccc-embed p.ccc-sub { text-align:center; font-size:13px; line-height:1.5; color:var(--ccc-muted); margin:0 0 24px; }' +
      '.ccc-embed form { display:flex; flex-direction:column; gap:12px; }' +
      '.ccc-embed label {' +
      '  font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.04em;' +
      '  color:var(--ccc-muted); margin-bottom:4px; display:block;' +
      '}' +
      '.ccc-embed input {' +
      '  width:100%; padding:11px 14px; border:1px solid var(--ccc-border); border-radius:9px;' +
      '  font-size:14px; font-family:inherit; color:var(--ccc-ink); background:#fff;' +
      '}' +
      '.ccc-embed input:focus { outline:none; border-color:var(--ccc-navy); }' +
      '.ccc-embed .ccc-consent { display:flex; gap:8px; align-items:flex-start; text-transform:none; letter-spacing:0; font-weight:400; line-height:1.45; }' +
      '.ccc-embed .ccc-consent input { width:auto; margin-top:2px; }' +
      '.ccc-embed .ccc-submit {' +
      '  margin-top:6px; width:100%; padding:13px; border:none; border-radius:9px;' +
      '  background:var(--ccc-navy); color:var(--ccc-gold); font-size:13px; font-weight:700;' +
      '  text-transform:uppercase; letter-spacing:.05em; cursor:pointer;' +
      '}' +
      '.ccc-embed .ccc-submit:disabled { opacity:.55; cursor:not-allowed; }' +
      '.ccc-embed .ccc-error { font-size:12px; color:#B91C1C; text-align:center; min-height:0; }' +
      '.ccc-embed .ccc-disclosure { margin-top:16px; font-size:10.5px; line-height:1.5; color:#9CA3AF; text-align:center; }' +
      '.ccc-embed .ccc-disclosure a { color:var(--ccc-muted); }' +
      '.ccc-embed .ccc-success { display:none; text-align:center; }' +
      '.ccc-embed .ccc-success svg { width:42px; height:42px; color:#10B981; margin-bottom:12px; }' +
      '.ccc-embed .ccc-success h2 { font-size:20px; margin:0 0 8px; }' +
      '.ccc-embed .ccc-success p { font-size:13px; color:var(--ccc-muted); margin:0 0 18px; line-height:1.5; }' +
      '.ccc-embed .ccc-schedule-link {' +
      '  display:inline-block; padding:11px 22px; border-radius:9px; background:var(--ccc-navy);' +
      '  color:var(--ccc-gold); font-size:12.5px; font-weight:700; text-transform:uppercase;' +
      '  letter-spacing:.04em; text-decoration:none;' +
      '}';
    document.head.appendChild(style);
  }

  function hiddenField(name, value) {
    return '<input type="hidden" name="' + name + '" value="' + value + '">';
  }

  function responseMatchesScheduler(value) {
    try { return new URL(String(value || '').trim()).href === new URL(SCHEDULER_URL).href; }
    catch (_error) { return false; }
  }

  function render(container) {
    var ref = (container.getAttribute('data-ref') || '').trim();
    var refValid = /^[a-z0-9_-]{1,64}$/i.test(ref);

    container.classList.add('ccc-embed');
    container.innerHTML =
      '<div class="ccc-form-step">' +
      '  <div class="ccc-brand-row"><img src="' + SITE_ORIGIN + '/logo.jpg" alt="Credit Comeback Club" class="ccc-logo"></div>' +
      '  <div class="ccc-eyebrow-wrap"><span class="ccc-eyebrow" data-ccc-eyebrow>Referral invitation</span></div>' +
      '  <h2>Start Your Credit Comeback</h2>' +
      '  <p class="ccc-sub">Tell us how to reach you, then choose a consultation time.</p>' +
      '  <form data-ccc-form action="' + DISPUTEFOX_ENDPOINT + '" method="post" enctype="multipart/form-data" accept-charset="UTF-8">' +
      hiddenField('method', 'addWebFormData') +
      hiddenField('tab_info_id', 'RjFaeDcvSWpqYTJidVdyRDB3WVBsdz09') +
      hiddenField('redirect_url', SCHEDULER_URL) +
      hiddenField('company_id', 'RkJJOWtkS1lYQ243V0Q5d3EybmlMUT09') +
      hiddenField('cust_type', '1') +
      hiddenField('add_affiliate_flag', '0') +
      hiddenField('assignedto_id', '32175') +
      hiddenField('sales_representative_id', '32175') +
      hiddenField('workflow_statusid', '30') +
      hiddenField('folder_statusid', '5') +
      hiddenField('customer_statusid', '-1') +
      hiddenField('portalAccess', '0') +
      hiddenField('customerAgreementIDs', '') +
      '    <input type="hidden" name="textArea1" data-ccc-source>' +
      '    <div style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;" aria-hidden="true"><label>Leave this field blank</label><input type="text" name="website" data-ccc-website tabindex="-1" autocomplete="off"></div>' +
      '    <div><label>First Name</label><input type="text" name="firstName" required maxlength="80" data-ccc-first-name autocomplete="given-name"></div>' +
      '    <div><label>Last Name</label><input type="text" name="lastName" required maxlength="80" data-ccc-last-name autocomplete="family-name"></div>' +
      '    <div><label>Email</label><input type="email" name="email1" required maxlength="254" data-ccc-email autocomplete="email"></div>' +
      '    <div><label>Cell Phone</label><input type="tel" name="mobilePhone1" required maxlength="40" data-ccc-phone inputmode="tel" autocomplete="tel"></div>' +
      '    <label class="ccc-consent"><input type="checkbox" name="checkbox1" value="true" required><span>I agree to receive email and/or SMS communications from Credit Comeback Club about my request. Message frequency varies; message and data rates may apply. Reply STOP to opt out or HELP for help. Consent is not a condition of purchase.</span></label>' +
      '    <button type="submit" class="ccc-submit" data-ccc-submit>Get My Free Consultation</button>' +
      '    <div class="ccc-error" data-ccc-error role="alert"></div>' +
      '  </form>' +
      '  <p class="ccc-disclosure">Submitting requests a consultation; it does not purchase a service or create portal access. Review the <a href="' + SITE_ORIGIN + '/terms.html" target="_blank" rel="noopener noreferrer">Terms</a>, <a href="' + SITE_ORIGIN + '/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>, and <a href="' + SITE_ORIGIN + '/cancellation-refund-policy" target="_blank" rel="noopener noreferrer">Cancellation &amp; Refund Policy</a>.</p>' +
      '</div>' +
      '<div class="ccc-success" data-ccc-success>' +
      '  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/></svg>' +
      '  <h2>Choose Your Consultation Time</h2>' +
      '  <p data-ccc-scheduling-note>Your request may already be saved. To avoid a duplicate, continue directly to scheduling.</p>' +
      '  <a class="ccc-schedule-link" href="' + SCHEDULER_URL + '">Open scheduling →</a>' +
      '</div>';

    var eyebrow = container.querySelector('[data-ccc-eyebrow]');
    if (refValid) eyebrow.style.display = 'inline-block';
    container.querySelector('[data-ccc-source]').value =
      'Source: CCC partner embed\nReferral code: ' + (refValid ? ref : 'Not provided') + '\nConsent: ccc-contact-email-sms-v1';

    var formStep = container.querySelector('.ccc-form-step');
    var successStep = container.querySelector('[data-ccc-success]');
    var form = container.querySelector('[data-ccc-form]');
    var submitBtn = container.querySelector('[data-ccc-submit]');
    var errorMsg = container.querySelector('[data-ccc-error]');
    var submissionKey = 'ccc:partner-embed-submitted:v1:' + (refValid ? ref : 'direct');
    var submissionInFlight = false;
    function rememberSubmission() { try { sessionStorage.setItem(submissionKey, String(Date.now())); } catch (_error) {} }
    function submissionRemembered() { try { return Boolean(sessionStorage.getItem(submissionKey)); } catch (_error) { return false; } }

    function showScheduling(uncertain) {
      rememberSubmission();
      var note = container.querySelector('[data-ccc-scheduling-note]');
      note.textContent = uncertain
        ? 'The confirmation took longer than expected and your request may already be saved. To avoid a duplicate, continue directly to scheduling.'
        : 'Your request is saved. Continue directly to scheduling.';
      formStep.style.display = 'none';
      successStep.style.display = 'block';
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (submissionInFlight) return;
      submissionInFlight = true;
      errorMsg.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';

      var formData = new FormData(form);
      var honeypot = String(formData.get('website') || '').trim();
      formData.delete('website');
      if (honeypot) { showScheduling(false); return; }

      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, 15000);
      fetch(DISPUTEFOX_ENDPOINT, {
        method: 'POST',
        body: formData,
        credentials: 'omit',
        signal: controller.signal
      }).then(function (response) {
        return response.text().then(function (body) { return { response: response, body: body }; });
      }).then(function (result) {
        if (result.body.includes('Account is in-activated')) {
          errorMsg.textContent = 'Scheduling is temporarily unavailable. Please try again later.';
          submissionInFlight = false;
          submitBtn.disabled = false;
          submitBtn.textContent = 'Get My Free Consultation';
          return;
        }
        if (result.response.status >= 400 && result.response.status < 500) {
          errorMsg.textContent = 'The request could not be accepted. Check your information and try again.';
          submissionInFlight = false;
          submitBtn.disabled = false;
          submitBtn.textContent = 'Get My Free Consultation';
          return;
        }
        if (result.response.ok && responseMatchesScheduler(result.body)) {
          window.location.assign(SCHEDULER_URL);
          return;
        }
        showScheduling(true);
      }).catch(function () {
        showScheduling(true);
      }).finally(function () {
        clearTimeout(timer);
      });
    });
    if (submissionRemembered()) showScheduling(true);
  }

  function init() {
    var containers = document.querySelectorAll('[data-ccc-join]');
    if (containers.length === 0) return;
    injectStylesOnce();
    containers.forEach(render);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
