import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPriorRoundLeverageBlock } from '../src/utils/roundEvidence.js';
import { plainTextToSafeHtml, resolveEmailMergeFields } from '../src/utils/emailMergeFields.js';
import { deriveNextAction, letterStatusCode } from '../src/components/client-detail/clientDetailUtils.js';
import { letterStatus, responseDeadline, responseWindowDays } from '../src/utils/responseWindow.js';
import { PHASE2_SCHEMA } from '../src/utils/auditSchemas.js';

function ok(name, fn) {
  fn();
  console.log('ok:', name);
}

ok('new furnisher and bureau rounds both default to 30 days', () => {
  assert.equal(responseWindowDays('furnisher'), 30);
  assert.equal(responseWindowDays('bureau'), 30);
});

ok('one documented extension adds exactly 15 days', () => {
  assert.equal(responseWindowDays({ target_type: 'bureau', response_window_extension_days: 15 }), 45);
});

ok('legacy bureau rows retain their frozen 45-day window', () => {
  assert.equal(responseWindowDays({ phase: 'Phase 3 — Equifax' }), 45);
  assert.equal(responseWindowDays({ phase: 'Phase 1' }), 30);
});

ok('stored due date is authoritative', () => {
  const due = responseDeadline({
    mail_service: 'usps_first_class_certified_return_receipt',
    mailed_date: '2025-12-29',
    delivered_at: '2026-01-01T00:00:00Z',
    tracking_status: 'Delivered',
    response_due_at: '2026-03-15T00:00:00Z',
  });
  assert.equal(due.toISOString().slice(0, 10), '2026-03-15');
});

ok('closed window status is deterministic', () => {
  const status = letterStatus({
    mail_service: 'usps_first_class_certified_return_receipt',
    mailed_date: '2026-01-01',
    delivered_at: '2026-01-02T00:00:00Z',
    tracking_status: 'Delivered',
    response_due_at: '2026-01-31T00:00:00Z',
  }, new Date('2026-02-01T00:00:00Z'));
  assert.equal(status.code, 'window_closed');
});

ok('all four prior-round target transitions are supported', () => {
  for (const priorTargetType of ['furnisher', 'bureau']) {
    for (const nextTargetType of ['furnisher', 'bureau']) {
      const block = buildPriorRoundLeverageBlock({ priorTargetType, nextTargetType, priorLetterHtml: '<html></html>' });
      assert.match(block, new RegExp(`${priorTargetType}->${nextTargetType}`));
    }
  }
});

ok('response-analysis schema cannot draft letters', () => {
  assert.equal(Object.hasOwn(PHASE2_SCHEMA.properties, 'letters'), false);
  assert.equal(Object.hasOwn(PHASE2_SCHEMA.properties, 'letterHtml'), false);
});

ok('former account-round picker is read-only and cannot generate or reopen letters', () => {
  const picker = readFileSync(new URL('../src/components/StartRoundPanel.jsx', import.meta.url), 'utf8');
  assert.match(picker, /former round builder is read-only/i);
  assert.match(picker, /begins at R1 in the state-driven CCC dispute campaign/i);
  assert.doesNotMatch(picker, /generateRoundLetter|regenerateUnmailedRoundLetters|retryFailedRoundLetters|reopenRound|TargetPicker/);
  assert.doesNotMatch(picker, /signature_data|lpoa_signature_data|resolveSignatureViewUrl/i);
});

ok('Lob mailer exposes only the current CCC packet path', () => {
  const mailer = readFileSync(new URL('../src/components/LobMailer.jsx', import.meta.url), 'utf8');
  assert.match(mailer, /isCurrentCccLetter = isCccDisputePhase/);
  assert.match(mailer, /Historical Letter/);
  assert.match(mailer, /Send First Class/);
  assert.match(mailer, /requiresCccR1IdentityDocuments/);
  assert.doesNotMatch(mailer, /buildFollowUpEnclosurePlan|fetchLpoaHtmlForPrint|lpoa_signature_data|listMailArtifacts/);
});

ok('client campaigns are labeled separately from account rounds', () => {
  const action = deriveNextAction({ activeCampaign: { round_number: 2, stage: 'configure_letters' } });
  assert.equal(action.label, 'Client Campaign 2: Build letters');
  assert.match(action.detail, /remaining account recipients/i);
});

ok('unsigned CCC letters are mail-ready work, never signature-required', () => {
  const unsignedCurrent = {
    id: 'current-r1',
    phase: 'CCC Dispute — Accuracy R1 — Equifax',
    html: '<!doctype html><html><body>Reviewed CCC letter</body></html>',
  };
  assert.equal(letterStatusCode(unsignedCurrent), 'not_mailed');
  assert.equal(deriveNextAction({ letters: [unsignedCurrent], rounds: [] }).label, 'Mail 1 letter');

  const rail = readFileSync(new URL('../src/components/client-detail/MailStageRail.jsx', import.meta.url), 'utf8');
  const helpers = readFileSync(new URL('../src/components/client-detail/clientDetailUtils.js', import.meta.url), 'utf8');
  const workboard = readFileSync(new URL('../src/components/client-detail/LetterWorkboard.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(rail, /letterSignatureState|Signature required/);
  assert.doesNotMatch(helpers, /letterSignatureState|signature_required|historical_signature/);
  assert.doesNotMatch(workboard, /generate Phase 1 letters/i);
  assert.match(workboard, /approved R1 template route/i);
});

ok('legacy drafts cannot drive the current next-action queue', () => {
  const action = deriveNextAction({
    letters: [{ phase: 'Phase 1 — Direct Furnisher', html: '<html><body>Historical</body></html>' }],
    rounds: [],
  });
  assert.equal(action.label, 'Start at R1');
});

ok('known email merge fields render', () => {
  assert.equal(resolveEmailMergeFields('Round {{ round.number }} for {{ client.name }}', { client: { name: 'Alex' }, round: { roundNumber: 2 } }), 'Round 2 for Alex');
});

ok('unknown email merge fields fail closed', () => {
  assert.throws(() => resolveEmailMergeFields('{{ client.ssn }}', {}), /Unknown email merge field/);
});

ok('plain text HTML escapes active content', () => {
  const escaped = plainTextToSafeHtml('<script>alert(1)</script>', (value) => value.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  assert.doesNotMatch(escaped, /<script>/);
  assert.match(escaped, /&lt;script&gt;/);
});

console.log('\nAdaptive-round history is preserved while all active legacy builders are retired.');
