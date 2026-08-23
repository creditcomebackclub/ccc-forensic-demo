const CALENDLY_URL = 'https://calendly.com/creditcomebackclub/consultation?hide_gdpr_banner=1';
const CALENDLY_SCRIPT_URL = 'https://assets.calendly.com/assets/external/widget.js';
const CALENDLY_STYLE_URL = 'https://assets.calendly.com/assets/external/widget.css';
const CALENDLY_LOAD_TIMEOUT_MS = 8000;
const ALLOWED_TIERS = new Set(['Standard', 'VIP', 'Paid In Full']);

const intakeForm = document.querySelector('[data-live-intake-form]');
const submitButton = document.querySelector('[data-live-intake-submit]');
const intakeStatus = document.querySelector('[data-live-intake-status]');
const calendarStage = document.querySelector('[data-live-calendar-stage]');
const calendarMount = document.querySelector('[data-live-calendly]');
const calendarStatus = document.querySelector('[data-live-calendar-status]');

function setStatus(node, message, tone = '') {
  if (!node) return;
  node.textContent = message;
  node.dataset.tone = tone;
}

function setFieldValidity(field, message = '') {
  if (!field) return;
  field.setCustomValidity(message);
  field.setAttribute('aria-invalid', String(Boolean(message)));
}

function validateIntake(formData) {
  const nameField = intakeForm.elements.namedItem('name');
  const emailField = intakeForm.elements.namedItem('email');
  const phoneField = intakeForm.elements.namedItem('phone');
  const tierField = intakeForm.elements.namedItem('tier');
  const intentField = intakeForm.elements.namedItem('intent');

  const name = String(formData.get('name') || '').trim().replace(/\s+/g, ' ');
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const phone = String(formData.get('phone') || '').trim();
  const tier = String(formData.get('tier') || '').trim();
  const intent = String(formData.get('intent') || '').trim();
  const website = String(formData.get('website') || '').trim();
  const phoneDigits = phone.replace(/\D/g, '');

  setFieldValidity(nameField, name.length >= 2 && name.length <= 120 ? '' : 'Enter your full name.');
  setFieldValidity(emailField, emailField.validity.valid && email.length <= 254 ? '' : 'Enter a valid email address.');
  setFieldValidity(phoneField, phoneDigits.length >= 7 && phoneDigits.length <= 15 ? '' : 'Enter a valid phone number.');
  setFieldValidity(tierField, ALLOWED_TIERS.has(tier) ? '' : 'Choose the plan you want to discuss.');

  const firstInvalid = [nameField, emailField, phoneField, tierField]
    .find((field) => field?.validationMessage);
  if (firstInvalid || intent !== 'consultation' || website.length > 200) {
    firstInvalid?.focus();
    return null;
  }

  const refCandidate = new URLSearchParams(window.location.search).get('ref')?.trim() || '';
  const ref = /^[0-9a-f]{6,36}$/i.test(refCandidate) ? refCandidate.toLowerCase() : undefined;
  return { name, email, phone, tier, intent, website, ...(ref ? { ref } : {}) };
}

function ensureCalendlyStylesheet() {
  if (document.querySelector(`link[href="${CALENDLY_STYLE_URL}"]`)) return;
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = CALENDLY_STYLE_URL;
  document.head.appendChild(stylesheet);
}

function loadCalendlyWidget() {
  ensureCalendlyStylesheet();
  if (window.Calendly?.initInlineWidget) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let script = document.querySelector(`script[src="${CALENDLY_SCRIPT_URL}"]`);
    let settled = false;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      script?.removeEventListener('load', handleLoad);
      script?.removeEventListener('error', handleError);
      callback(value);
    };
    const handleLoad = () => window.Calendly?.initInlineWidget
      ? finish(resolve)
      : finish(reject, new Error('Calendly did not initialize.'));
    const handleError = () => finish(reject, new Error('Calendly could not load.'));

    if (!script) {
      script = document.createElement('script');
      script.src = CALENDLY_SCRIPT_URL;
      script.async = true;
    }
    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
    timer = window.setTimeout(
      () => finish(reject, new Error('Calendly took too long to load.')),
      CALENDLY_LOAD_TIMEOUT_MS,
    );
    if (!script.isConnected) document.head.appendChild(script);
  });
}

function directCalendlyUrl(payload) {
  const fallbackUrl = new URL(CALENDLY_URL);
  fallbackUrl.searchParams.set('name', payload.name);
  fallbackUrl.searchParams.set('email', payload.email);
  return fallbackUrl.toString();
}

function showCalendarStage() {
  intakeForm.hidden = true;
  if (calendarStage) {
    calendarStage.hidden = false;
    calendarStage.focus();
  }
}

function showDirectCalendlyFallback(payload, message) {
  showCalendarStage();
  if (!calendarMount) return;
  const fallback = document.createElement('a');
  fallback.href = directCalendlyUrl(payload);
  fallback.className = 'button button-dark calendly-fallback-link';
  fallback.textContent = 'Open the scheduling calendar';
  fallback.target = '_blank';
  fallback.rel = 'noopener noreferrer';
  calendarMount.replaceChildren(fallback);
  setStatus(calendarStatus, message, 'error');
}

async function initializeCalendly(payload) {
  if (!calendarMount) return;
  calendarMount.dataset.url = CALENDLY_URL;
  setStatus(calendarStatus, 'Loading available consultation times…');

  try {
    await loadCalendlyWidget();
    calendarMount.replaceChildren();
    window.Calendly.initInlineWidget({
      url: CALENDLY_URL,
      parentElement: calendarMount,
      prefill: { name: payload.name, email: payload.email },
    });
    setStatus(calendarStatus, 'Select a time in the scheduler above. Calendly will email your confirmation.');
  } catch (_error) {
    showDirectCalendlyFallback(payload, 'The embedded calendar is unavailable. Use the secure scheduling link above.');
  }
}

document.querySelectorAll('[data-tier]').forEach((link) => {
  link.addEventListener('click', () => {
    const selectedTier = link.dataset.tier || '';
    const tierField = intakeForm?.elements.namedItem('tier');
    if (tierField && ALLOWED_TIERS.has(selectedTier)) {
      tierField.value = selectedTier;
      setFieldValidity(tierField);
    }
  });
});

intakeForm?.addEventListener('input', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
    setFieldValidity(event.target);
  }
});

intakeForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus(intakeStatus, '');

  const payload = validateIntake(new FormData(intakeForm));
  if (!payload) {
    setStatus(intakeStatus, 'Check the highlighted fields and try again.', 'error');
    return;
  }

  const originalButtonText = submitButton?.textContent || 'Continue to scheduling';
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Saving your request…';
  }
  intakeForm.setAttribute('aria-busy', 'true');

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/public-intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let body = null;
    try { body = await response.json(); } catch (_error) { body = null; }
    if (!response.ok || body?.success !== true) {
      if (response.status === 429) throw new Error('Too many requests. Please wait a few minutes and try again.');
      throw new Error('We could not save your request. Please try again.');
    }

    showCalendarStage();
    await initializeCalendly(payload);
  } catch (error) {
    if (error?.name === 'AbortError') {
      showDirectCalendlyFallback(
        payload,
        'Confirmation took longer than expected. Schedule directly above; Calendly will securely complete your request.',
      );
      return;
    }
    const message = error?.message || 'We could not save your request. Please try again.';
    setStatus(intakeStatus, message, 'error');
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalButtonText;
    }
  } finally {
    window.clearTimeout(timeout);
    intakeForm.removeAttribute('aria-busy');
  }
});
