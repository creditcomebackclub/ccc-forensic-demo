const DISPUTEFOX_ENDPOINT = 'https://pulse.disputeprocess.com/CustumFieldController?method=addWebFormData';
const SCHEDULER_URL = 'https://pulse.scorexer.com/Portal/meeting.jsp?id=5d235976-7de9-49d9-a061-dab6275c3c99';
const SUBMISSION_TIMEOUT_MS = 15000;

const intakeForm = document.querySelector('[data-live-intake-form]');
const submitButton = document.querySelector('[data-live-intake-submit]');
const intakeStatus = document.querySelector('[data-live-intake-status]');
const schedulerFallback = document.querySelector('[data-live-intake-fallback]');
let submissionInFlight = false;
let selectedTier = '';

function setStatus(message, tone = '') {
  if (!intakeStatus) return;
  intakeStatus.textContent = message;
  intakeStatus.dataset.tone = tone;
}

function setFieldValidity(field, message = '') {
  if (!field) return;
  field.setCustomValidity(message);
  field.setAttribute('aria-invalid', String(Boolean(message)));
}

function normalizeSingleLine(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function validateIntake(formData) {
  const website = normalizeSingleLine(formData.get('website'));
  formData.delete('website');
  if (website) return null;

  const firstNameField = intakeForm.elements.namedItem('firstName');
  const lastNameField = intakeForm.elements.namedItem('lastName');
  const emailField = intakeForm.elements.namedItem('email1');
  const phoneField = intakeForm.elements.namedItem('mobilePhone1');
  const situationField = intakeForm.elements.namedItem('textArea1');
  const consentField = intakeForm.elements.namedItem('checkbox1');

  const firstName = normalizeSingleLine(formData.get('firstName'));
  const lastName = normalizeSingleLine(formData.get('lastName'));
  const email = normalizeSingleLine(formData.get('email1')).toLowerCase();
  const phone = normalizeSingleLine(formData.get('mobilePhone1'));
  const situation = String(formData.get('textArea1') || '').trim();
  const sourceSummary = [
    'Source: creditcomebackclub.com homepage consultation',
    `Selected service: ${selectedTier || 'Not selected'}`,
  ].join('\n');
  const disputeFoxSituation = situation ? `${sourceSummary}\n${situation}` : sourceSummary;
  const phoneDigits = phone.replace(/\D/g, '');

  setFieldValidity(
    firstNameField,
    firstName.length >= 1 && firstName.length <= 80 ? '' : 'Enter your first name.',
  );
  setFieldValidity(
    lastNameField,
    lastName.length >= 1 && lastName.length <= 80 ? '' : 'Enter your last name.',
  );
  setFieldValidity(
    emailField,
    email.length <= 254 && emailField?.validity.valid ? '' : 'Enter a valid email address.',
  );
  setFieldValidity(
    phoneField,
    phoneDigits.length >= 10 && phoneDigits.length <= 15 ? '' : 'Enter a valid phone number.',
  );
  setFieldValidity(
    situationField,
    disputeFoxSituation.length <= 1000
      ? ''
      : 'Please shorten this response so the complete request stays under 1,000 characters.',
  );
  setFieldValidity(
    consentField,
    consentField?.checked ? '' : 'Consent is required before we can contact you.',
  );

  const firstInvalid = [
    firstNameField,
    lastNameField,
    emailField,
    phoneField,
    situationField,
    consentField,
  ].find((field) => field?.validationMessage);

  if (firstInvalid) {
    firstInvalid.focus();
    return null;
  }

  formData.set('firstName', firstName);
  formData.set('lastName', lastName);
  formData.set('email1', email);
  formData.set('mobilePhone1', phone);
  formData.set('textArea1', disputeFoxSituation);
  formData.set('checkbox1', 'true');
  return formData;
}

document.addEventListener('click', (event) => {
  const tierLink = event.target instanceof Element ? event.target.closest('[data-tier]') : null;
  if (!tierLink) return;
  selectedTier = normalizeSingleLine(tierLink.dataset.tier);
});

function isExpectedSchedulerResponse(responseText) {
  try {
    return new URL(String(responseText || '').trim()).href === SCHEDULER_URL;
  } catch (_error) {
    return false;
  }
}

function restoreSubmitButton(buttonText) {
  submissionInFlight = false;
  intakeForm?.removeAttribute('aria-busy');
  if (!submitButton) return;
  submitButton.disabled = false;
  submitButton.textContent = buttonText;
}

function showSchedulerFallback() {
  submissionInFlight = false;
  intakeForm?.removeAttribute('aria-busy');
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Request status pending';
  }
  if (schedulerFallback) schedulerFallback.hidden = false;
  setStatus(
    'Confirmation took longer than expected. To avoid creating a duplicate request, continue directly to scheduling.',
    'error',
  );
}

intakeForm?.addEventListener('input', (event) => {
  if (
    event.target instanceof HTMLInputElement
    || event.target instanceof HTMLTextAreaElement
  ) {
    setFieldValidity(event.target);
  }
});

intakeForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submissionInFlight) return;
  setStatus('');

  const formData = validateIntake(new FormData(intakeForm));
  if (!formData) {
    setStatus('Check the highlighted fields and try again.', 'error');
    return;
  }

  const originalButtonText = submitButton?.textContent || 'Continue to scheduling';
  if (schedulerFallback) schedulerFallback.hidden = true;
  submissionInFlight = true;
  intakeForm.setAttribute('aria-busy', 'true');
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Saving your request…';
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), SUBMISSION_TIMEOUT_MS);

  try {
    const response = await fetch(DISPUTEFOX_ENDPOINT, {
      method: 'POST',
      body: formData,
      credentials: 'omit',
      signal: controller.signal,
    });
    const responseText = await response.text();

    if (responseText.includes('Account is in-activated')) {
      setStatus('Scheduling is temporarily unavailable. Please try again later.', 'error');
      restoreSubmitButton(originalButtonText);
      return;
    }
    if (!response.ok || !isExpectedSchedulerResponse(responseText)) {
      showSchedulerFallback();
      return;
    }

    window.location.assign(SCHEDULER_URL);
  } catch (_error) {
    showSchedulerFallback();
  } finally {
    window.clearTimeout(timeout);
  }
});
