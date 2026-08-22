document.documentElement.classList.add('js');

const isPreviewOnly = document.body.dataset.previewOnly === 'true';
const previewConfig = Object.freeze({
  mode: 'local-preview',
  calendlyUrl: 'https://calendly.com/creditcomebackclub/consultation?hide_gdpr_banner=1',
  writesEnabled: false,
});

const header = document.querySelector('[data-site-header]');
const menuButton = document.querySelector('[data-menu-button]');
const navigation = document.querySelector('[data-navigation]');
const toast = document.querySelector('[data-preview-toast]');
let toastTimer = null;

function showPreviewToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3200);
}

function closeMenu() {
  if (!menuButton || !navigation) return;
  menuButton.setAttribute('aria-expanded', 'false');
  navigation.classList.remove('open');
  document.body.classList.remove('menu-open');
}

menuButton?.addEventListener('click', () => {
  const willOpen = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(willOpen));
  navigation?.classList.toggle('open', willOpen);
  document.body.classList.toggle('menu-open', willOpen);
});

navigation?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    if (link.getAttribute('href')?.startsWith('#')) closeMenu();
  });
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 860) closeMenu();
});

function updateHeader() {
  header?.classList.toggle('scrolled', window.scrollY > 12);
}

window.addEventListener('scroll', updateHeader, { passive: true });
updateHeader();

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const revealItems = [...document.querySelectorAll('.reveal')];
if (reducedMotion || !('IntersectionObserver' in window)) {
  revealItems.forEach((item) => item.classList.add('is-visible'));
} else {
  const observer = new IntersectionObserver((entries, activeObserver) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      activeObserver.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  revealItems.forEach((item) => observer.observe(item));
}

if (isPreviewOnly) {
  document.querySelectorAll('.preview-destination').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const destination = link.dataset.previewDestination || link.getAttribute('href');
      showPreviewToast('Preview only — production destination retained: ' + destination);
    });
  });
}

document.querySelectorAll('.faq-list details').forEach((item) => {
  item.addEventListener('toggle', () => {
    if (!item.open) return;
    document.querySelectorAll('.faq-list details').forEach((other) => {
      if (other !== item) other.open = false;
    });
  });
});

const scoreForm = document.querySelector('[data-score-form]');
const scoreMessage = document.querySelector('[data-score-message]');
const scoreOutput = {
  average: document.querySelector('[data-current-average]'),
  averageGap: document.querySelector('[data-average-gap]'),
  averageGapNote: document.querySelector('[data-average-gap-note]'),
  equifax: document.querySelector('[data-gap-equifax]'),
  experian: document.querySelector('[data-gap-experian]'),
  transunion: document.querySelector('[data-gap-transunion]'),
  scenario: document.querySelector('[data-score-scenario]'),
  pathTitle: document.querySelector('[data-score-path-title]'),
  sourceNote: document.querySelector('[data-score-source-note]'),
  controllableFactors: document.querySelector('[data-controllable-factors]'),
  goalLink: document.querySelector('[data-score-goal-link]'),
};

const factorEducation = Object.freeze({
  reporting: 'Compare the exact fields on all three reports. Challenge only information you can identify as inaccurate, incomplete, or inconsistent.',
  payments: 'Protect current accounts with on-time payments. Accurate late-payment history is not automatically disputable.',
  balances: 'Review reported revolving balances and limits, then manage legitimate utilization without assuming a specific point gain.',
  inquiries: 'Verify that each inquiry is recognized and limit unnecessary new applications; inquiry impact varies by model and file.',
  age: 'Keep legitimate older accounts in context and learn how account age and credit mix are calculated before making changes.',
});

function displayScore(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function bureauGap(score, goal) {
  const difference = goal - score;
  if (difference > 0) return '+' + difference + ' to goal';
  if (difference < 0) return Math.abs(difference) + ' above goal';
  return 'At entered goal';
}

function updateScoreGoalLink(rawGoal) {
  const goal = Number(String(rawGoal || '').trim());
  const validGoal = Number.isInteger(goal) && goal >= 300 && goal <= 850;
  if (scoreOutput.goalLink) {
    scoreOutput.goalLink.textContent = validGoal
      ? 'Review My Path to ' + goal
      : 'Review My Credit Goal';
  }
}

function resetScoreResults() {
  scoreOutput.average.textContent = '—';
  scoreOutput.averageGap.textContent = '—';
  scoreOutput.averageGapNote.textContent = 'Waiting for your scenario';
  scoreOutput.equifax.textContent = '—';
  scoreOutput.experian.textContent = '—';
  scoreOutput.transunion.textContent = '—';
  scoreOutput.scenario.textContent = 'Enter all four values and choose a score source to build an educational path. Nothing entered here is saved or sent.';
  scoreOutput.pathTitle.textContent = 'How to move from a number to an informed plan';
  scoreOutput.sourceNote.textContent = 'Start with reports and scores from the same date and scoring source whenever possible.';
  updateScoreGoalLink('');
  scoreOutput.controllableFactors.replaceChildren();
  [
    'Review current reports and build consistent on-time payment habits.',
    'Manage legitimate revolving balances and new applications deliberately.',
  ].forEach((copy) => {
    const item = document.createElement('li');
    item.textContent = copy;
    scoreOutput.controllableFactors.append(item);
  });
  scoreMessage.textContent = '';
  scoreForm?.querySelectorAll('input, select').forEach((input) => input.removeAttribute('aria-invalid'));
}

scoreForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const fields = ['equifax', 'experian', 'transunion', 'goal'];
  const values = {};
  let firstInvalid = null;

  fields.forEach((name) => {
    const input = scoreForm.elements.namedItem(name);
    const raw = String(input?.value || '').trim();
    const value = Number(raw);
    const valid = raw !== '' && Number.isInteger(value) && value >= 300 && value <= 850;
    input?.setAttribute('aria-invalid', String(!valid));
    if (!valid && !firstInvalid) firstInvalid = input;
    values[name] = value;
  });

  const sourceField = scoreForm.elements.namedItem('scoreSource');
  const scoreSource = String(sourceField?.value || '');
  const sourceValid = ['same-report', 'mixed-sources', 'unknown'].includes(scoreSource);
  sourceField?.setAttribute('aria-invalid', String(!sourceValid));
  if (!sourceValid && !firstInvalid) firstInvalid = sourceField;

  if (firstInvalid) {
    scoreMessage.textContent = sourceValid
      ? 'Enter a whole number from 300 through 850 in every score field.'
      : 'Enter all four scores and choose where those scores came from.';
    firstInvalid.focus();
    return;
  }

  scoreMessage.textContent = '';
  const average = (values.equifax + values.experian + values.transunion) / 3;
  const difference = values.goal - average;

  scoreOutput.average.textContent = displayScore(average);
  scoreOutput.averageGap.textContent = (difference > 0 ? '+' : '') + displayScore(difference);
  scoreOutput.averageGapNote.textContent = difference > 0
    ? 'Entered goal is above the current average'
    : difference < 0
      ? 'Entered goal is below the current average'
      : 'Entered goal matches the current average';
  scoreOutput.equifax.textContent = bureauGap(values.equifax, values.goal);
  scoreOutput.experian.textContent = bureauGap(values.experian, values.goal);
  scoreOutput.transunion.textContent = bureauGap(values.transunion, values.goal);
  scoreOutput.scenario.textContent = 'The entered target is a direction for education—not a forecast. The gaps show arithmetic only. They do not tell us which account may change, whether information is disputable, how many points any action may produce, or how long anything may take.';

  const sourceCopy = {
    'same-report': 'Because you selected one same-date three-bureau report, begin by comparing the exact account fields across Equifax, Experian, and TransUnion.',
    'mixed-sources': 'Because you selected mixed apps, dates, or models, first obtain comparable same-date reports and identify the scoring model before treating score differences as meaningful.',
    unknown: 'Because the score source is uncertain, first identify the report date, bureau, and scoring model for each number.',
  };
  scoreOutput.sourceNote.textContent = sourceCopy[scoreSource];
  scoreOutput.pathTitle.textContent = 'A four-stage path from ' + displayScore(average) + ' average toward an entered goal of ' + values.goal;
  updateScoreGoalLink(values.goal);

  const selectedFactors = [...scoreForm.querySelectorAll('input[name="factors"]:checked')]
    .map((input) => factorEducation[input.value])
    .filter(Boolean);
  const factorItems = selectedFactors.length
    ? selectedFactors
    : [
        'Review current reports and build consistent on-time payment habits.',
        'Manage legitimate revolving balances and new applications deliberately.',
      ];
  scoreOutput.controllableFactors.replaceChildren();
  factorItems.forEach((copy) => {
    const item = document.createElement('li');
    item.textContent = copy;
    scoreOutput.controllableFactors.append(item);
  });
});

scoreForm?.elements.namedItem('goal')?.addEventListener('input', (event) => {
  updateScoreGoalLink(event.currentTarget.value);
});

scoreForm?.addEventListener('reset', () => {
  window.setTimeout(resetScoreResults, 0);
});

const consultationWidget = document.querySelector('[data-consultation-widget]');
const consultationForm = document.querySelector('[data-consultation-form]');
const calendarPreview = document.querySelector('[data-calendar-preview]');
const calendarResult = document.querySelector('[data-calendar-result]');
const calendarBack = document.querySelector('[data-calendar-back]');
let selectedSampleDay = '';
let selectedSampleSlot = '';
let previewLead = null;

if (consultationWidget && isPreviewOnly) {
  consultationWidget.dataset.productionCalendarUrl = previewConfig.calendlyUrl;
  consultationWidget.dataset.previewWrites = String(previewConfig.writesEnabled);
}

function clearCalendarSelection() {
  selectedSampleDay = '';
  selectedSampleSlot = '';
  calendarPreview?.querySelectorAll('button.selected').forEach((button) => button.classList.remove('selected'));
  if (calendarResult) {
    calendarResult.textContent = 'No appointment was created. Choose a sample day and time to demonstrate the confirmation state.';
  }
}

function updateCalendarResult() {
  if (!calendarResult) return;
  if (!selectedSampleDay || !selectedSampleSlot) {
    calendarResult.textContent = 'No appointment was created. Choose both a sample day and a sample time.';
    return;
  }
  const name = previewLead?.name ? ' for ' + previewLead.name : '';
  calendarResult.textContent =
    'Preview confirmation' + name + ': ' + selectedSampleDay + ', ' + selectedSampleSlot +
    '. No appointment was created and no information left this browser tab.';
}

consultationForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!consultationForm.reportValidity()) return;
  const formData = new FormData(consultationForm);
  previewLead = {
    id: 'preview-lead-local',
    name: String(formData.get('name') || '').trim().split(/\s+/)[0].slice(0, 40),
  };
  consultationForm.hidden = true;
  calendarPreview.hidden = false;
  clearCalendarSelection();
  calendarPreview.querySelector('button')?.focus();
});

calendarPreview?.querySelectorAll('[data-sample-day]').forEach((button) => {
  button.addEventListener('click', () => {
    calendarPreview.querySelectorAll('[data-sample-day]').forEach((item) => item.classList.remove('selected'));
    button.classList.add('selected');
    selectedSampleDay = button.dataset.sampleDay || '';
    updateCalendarResult();
  });
});

calendarPreview?.querySelectorAll('[data-sample-slot]').forEach((button) => {
  button.addEventListener('click', () => {
    calendarPreview.querySelectorAll('[data-sample-slot]').forEach((item) => item.classList.remove('selected'));
    button.classList.add('selected');
    selectedSampleSlot = button.dataset.sampleSlot || '';
    updateCalendarResult();
  });
});

calendarBack?.addEventListener('click', () => {
  clearCalendarSelection();
  previewLead = null;
  calendarPreview.hidden = true;
  consultationForm.hidden = false;
  consultationForm.querySelector('input')?.focus();
});

const testimonialTrack = document.querySelector('[data-testimonial-track]');
const testimonialPrevious = document.querySelector('[data-testimonial-prev]');
const testimonialNext = document.querySelector('[data-testimonial-next]');
const evidenceTrack = document.querySelector('[data-evidence-track]');
const evidencePrevious = document.querySelector('[data-evidence-prev]');
const evidenceNext = document.querySelector('[data-evidence-next]');

function wireHorizontalCarousel(track, previous, next, cardSelector) {
  if (!track) return;

  const controls = previous && next && previous.parentElement === next.parentElement
    ? previous.parentElement
    : null;

  const syncControls = () => {
    const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const hasOverflow = maxScroll > 6;
    if (controls) controls.hidden = !hasOverflow;
    if (previous) previous.disabled = !hasOverflow || track.scrollLeft <= 3;
    if (next) next.disabled = !hasOverflow || track.scrollLeft >= maxScroll - 3;
  };

  const move = (direction) => {
    const firstCard = track.querySelector(cardSelector);
    const cardWidth = firstCard?.getBoundingClientRect().width || track.clientWidth * 0.8;
    const trackStyles = window.getComputedStyle(track);
    const gap = Number.parseFloat(trackStyles.columnGap || trackStyles.gap) || 16;
    track.scrollBy({
      left: direction * (cardWidth + gap),
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  };

  previous?.addEventListener('click', () => move(-1));
  next?.addEventListener('click', () => move(1));
  track.addEventListener('scroll', syncControls, { passive: true });
  track.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    move(event.key === 'ArrowLeft' ? -1 : 1);
  });

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(syncControls);
    observer.observe(track);
  } else {
    window.addEventListener('resize', syncControls);
  }
  window.requestAnimationFrame(syncControls);
}

wireHorizontalCarousel(testimonialTrack, testimonialPrevious, testimonialNext, '.testimonial-result-card');
wireHorizontalCarousel(evidenceTrack, evidencePrevious, evidenceNext, '.evidence-result-card');

const evidenceDialog = document.querySelector('[data-evidence-dialog]');
const evidenceDialogImage = document.querySelector('[data-evidence-dialog-image]');
const evidenceDialogTitle = document.querySelector('[data-evidence-dialog-title]');
const evidenceDialogDescription = document.querySelector('[data-evidence-dialog-description]');
const evidenceDialogClose = document.querySelector('[data-evidence-dialog-close]');
let lastEvidenceTrigger = null;

document.querySelectorAll('[data-evidence-open]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!evidenceDialog || !evidenceDialogImage) return;
    const thumbnail = button.querySelector('img');
    const imageSource = thumbnail?.getAttribute('src');
    if (!imageSource) return;

    const title = button.dataset.evidenceTitle || 'Client result';
    const description = button.dataset.evidenceDescription || 'Client result image.';
    lastEvidenceTrigger = button;
    evidenceDialogImage.src = imageSource;
    evidenceDialogImage.alt = description;
    if (evidenceDialogTitle) evidenceDialogTitle.textContent = title;
    if (evidenceDialogDescription) evidenceDialogDescription.textContent = description;

    if (typeof evidenceDialog.showModal === 'function') {
      evidenceDialog.showModal();
    } else {
      evidenceDialog.setAttribute('open', '');
    }
    evidenceDialogClose?.focus();
  });
});

evidenceDialogClose?.addEventListener('click', () => evidenceDialog?.close());

evidenceDialog?.addEventListener('click', (event) => {
  if (event.target === evidenceDialog) evidenceDialog.close();
});

evidenceDialog?.addEventListener('close', () => {
  evidenceDialogImage?.removeAttribute('src');
  if (evidenceDialogImage) evidenceDialogImage.alt = '';
  lastEvidenceTrigger?.focus();
  lastEvidenceTrigger = null;
});

const planDialog = document.querySelector('[data-plan-dialog]');
const planDialogHeading = document.querySelector('[data-plan-dialog-heading]');
const planDialogClose = document.querySelector('[data-plan-dialog-close]');
const planDialogConsultation = document.querySelector('[data-plan-dialog-consultation]');
const planPanels = [...document.querySelectorAll('[data-plan-panel]')];
let lastPlanTrigger = null;

function restorePlanDialogState() {
  document.body.classList.remove('plan-dialog-open');
  planPanels.forEach((panel) => { panel.hidden = true; });
  lastPlanTrigger?.focus();
  lastPlanTrigger = null;
}

function closePlanDialog() {
  if (!planDialog?.hasAttribute('open')) return;
  if (typeof planDialog.close === 'function') {
    planDialog.close();
  } else {
    planDialog.removeAttribute('open');
    restorePlanDialogState();
  }
}

document.querySelectorAll('[data-plan-open]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!planDialog) return;
    const selectedPlan = button.dataset.planOpen;
    const selectedPanel = planPanels.find((panel) => panel.dataset.planPanel === selectedPlan);
    if (!selectedPanel) return;

    planPanels.forEach((panel) => { panel.hidden = panel !== selectedPanel; });
    if (planDialogHeading) {
      planDialogHeading.textContent = (selectedPanel.dataset.planName || 'Plan') + ': what’s included';
    }
    if (planDialogConsultation) {
      planDialogConsultation.textContent = selectedPanel.dataset.planCta || 'Request a consultation';
      planDialogConsultation.dataset.tier = selectedPanel.dataset.planName || '';
    }
    lastPlanTrigger = button;
    document.body.classList.add('plan-dialog-open');

    if (typeof planDialog.showModal === 'function') {
      planDialog.showModal();
    } else {
      planDialog.setAttribute('open', '');
    }
    planDialogClose?.focus();
  });
});

planDialogClose?.addEventListener('click', closePlanDialog);

planDialogConsultation?.addEventListener('click', closePlanDialog);

planDialog?.addEventListener('click', (event) => {
  if (event.target === planDialog) closePlanDialog();
});

planDialog?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closePlanDialog();
  }
});

planDialog?.addEventListener('close', restorePlanDialogState);

document.querySelectorAll('[data-current-year]').forEach((node) => {
  node.textContent = String(new Date().getFullYear());
});
