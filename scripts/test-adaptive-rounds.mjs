import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPriorRoundLeverageBlock } from '../src/utils/roundEvidence.js';
import { plainTextToSafeHtml, resolveEmailMergeFields } from '../src/utils/emailMergeFields.js';
import { letterStatus, responseDeadline, responseWindowDays } from '../src/utils/responseWindow.js';
import { PHASE2_SCHEMA } from '../src/utils/auditSchemas.js';
import { getLetterSystemPrompt } from '../src/prompts/letterPrompt.js';
import { ensureCertifiedMailNotation, generatedLetterValidationError } from '../src/utils/letterGeneration.js';

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
  const due = responseDeadline({ delivered_at: '2026-01-01T00:00:00Z', response_due_at: '2026-03-15T00:00:00Z' });
  assert.equal(due.toISOString().slice(0, 10), '2026-03-15');
});

ok('closed window status is deterministic', () => {
  const status = letterStatus({ mailed_date: '2026-01-01', response_due_at: '2026-01-31T00:00:00Z' }, new Date('2026-02-01T00:00:00Z'));
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

ok('Type-C sibling prompts keep FDCPA and FCRA duties separate', () => {
  const fdcpa = getLetterSystemPrompt('Aggressive', 'furnisher', 'FDCPA');
  const fcra = getLetterSystemPrompt('Aggressive', 'furnisher', 'FCRA_DIRECT');
  assert.match(fdcpa, /standalone FDCPA debt-validation letter/i);
  assert.match(fdcpa, /Do not cite §1681s-2\(a\)/i);
  assert.match(fcra, /Do NOT include §1692g\(b\)/i);
});

ok('bureau prompt excludes FDCPA validation', () => {
  const bureau = getLetterSystemPrompt('Aggressive', 'bureau', null);
  assert.match(bureau, /Never include an FDCPA validation letter addressed to a CRA/i);
});

ok('bureau round picker exposes only audit-confirmed bureaus with dated context', () => {
  const picker = readFileSync(new URL('../src/components/StartRoundPanel.jsx', import.meta.url), 'utf8');
  const resolver = readFileSync(new URL('../src/utils/roundTargets.js', import.meta.url), 'utf8');
  assert.match(picker, /Only those confirmed bureaus are available below/);
  assert.match(picker, /activeBureaus\.map\(\(bureau\)/);
  assert.match(picker, /Checking this account against the latest audit/);
  assert.match(resolver, /select\('id,report_date,saved_at,audit'\)/);
  assert.match(resolver, /auditReportDate: auditRecord\?\.report_date/);
});

ok('missing certified-mail notation is repaired deterministically and idempotently', () => {
  const input = '<!DOCTYPE html><html><body><div class="signature-block">Alex</div><div class="enclosures">Prior letter</div></body></html>';
  const repaired = ensureCertifiedMailNotation(input);
  assert.match(repaired, /class="mail-notation">Sent via Certified Mail\.<\/div>/);
  assert.equal(generatedLetterValidationError(repaired, { requireSections: true }), null);
  assert.equal(ensureCertifiedMailNotation(repaired), repaired);
});

ok('standalone adaptive rounds expose a safe failed-draft retry path', () => {
  const panel = readFileSync(new URL('../src/components/StartRoundPanel.jsx', import.meta.url), 'utf8');
  const workboard = readFileSync(new URL('../src/components/client-detail/LetterWorkboard.jsx', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../src/utils/api.js', import.meta.url), 'utf8');
  assert.match(panel, /Retry \$\{failedOpenLetters\.length\} failed draft/);
  assert.match(workboard, />Open round<\/button>/);
  assert.match(api, /export async function retryFailedRoundLetters/);
  assert.match(api, /reset_unmailed_round_drafts/);
  assert.match(api, /export async function regenerateUnmailedRoundLetters/);
  const migration = readFileSync(new URL('../supabase/migrations/20260811020000_claude_generation_hardening.sql', import.meta.url), 'utf8');
  assert.match(migration, /mailed_date is not null or lob_id is not null or tracking_number is not null/);
  assert.match(migration, /v_evidence|letter_source_links|open round/i);
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

console.log('\nAll adaptive-round utility assertions passed.');
