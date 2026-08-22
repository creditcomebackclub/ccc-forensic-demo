import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { concreteTemplateStep } from '../src/utils/disputeState.js';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const componentPath = path.join(projectRoot, 'src/components/DisputeCampaignStudio.jsx');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-state-studio-'));
const bundledPath = path.join(temporaryDirectory, 'studio.mjs');

try {
  await build({
    entryPoints: [componentPath],
    outfile: bundledPath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    logLevel: 'silent',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://example.supabase.co'),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-anon-key'),
    },
  });
  const { buildStateDrivenCraWorkItems } = await import(`${pathToFileURL(bundledPath).href}?v=${Date.now()}`);

  assert.deepEqual(concreteTemplateStep('repo', 3), { flow: 'collection', round: 6 });
  assert.deepEqual(concreteTemplateStep('combo', 5), { flow: 'accuracy', round: 5 });
  assert.deepEqual(concreteTemplateStep('late_pay', 2), { flow: 'consent', round: 2 });

  const clientId = '10000000-0000-4000-8000-000000000001';
  const accountIds = [
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000005',
    '20000000-0000-4000-8000-000000000006',
  ];
  const trackIds = accountIds.map((_, index) => `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
  const account = (index, furnisher, bureaus) => ({
    clientAccountId: accountIds[index],
    furnisher,
    bureaus,
    accountNumber: `RAW-ACCOUNT-${9000 + index}`,
    primaryViolation: `${furnisher} reports an exact confirmed discrepancy.`,
    violations: [{ field: 'Status', issue: 'The status conflicts.', currentlyReports: 'Open', shouldReport: 'Closed' }],
  });
  const audit = {
    id: 'saved-audit-1',
    client: { id: clientId, name: 'Test Consumer' },
    accounts: [
      account(0, 'Repo Lender', ['EQ']),
      account(1, 'Repo Companion', ['EQ']),
      account(2, 'Combo Bank', ['EXP']),
      account(3, 'Combo Collector', ['EXP']),
      account(4, 'Late Bank', ['TU']),
      account(5, 'TU Collector', ['TU']),
    ],
  };
  const track = (index, bureauCode, accountKind, nativeFlow, currentFlow, currentRound, pathRole = 'standard') => ({
    id: trackIds[index],
    client_id: clientId,
    client_account_id: accountIds[index],
    source_audit_id: audit.id,
    track_scope: 'cra',
    bureau_code: bureauCode,
    method_version: 'ccc_skool_2026_v1',
    account_kind: accountKind,
    native_flow: nativeFlow,
    current_flow: currentFlow,
    current_round: currentRound,
    path_role: pathRole,
    status: 'active',
    cycle: 1,
    revision: index,
  });
  const tracks = [
    track(0, 'EQ', 'repossession', 'repo', 'repo', 3, 'repo_primary'),
    track(1, 'EQ', 'collection', 'collection', 'repo', 3, 'repo_companion'),
    track(2, 'EXP', 'charge_off', 'accuracy', 'combo', 5),
    track(3, 'EXP', 'collection', 'collection', 'combo', 5),
    track(4, 'TU', 'late_payment', 'late_pay', 'late_pay', 2),
    track(5, 'TU', 'collection', 'collection', 'collection', 1),
  ];

  const workItems = buildStateDrivenCraWorkItems(audit, tracks);
  assert.equal(workItems.length, 4, 'same bureau accounts split into separate physical letters when logical steps differ');
  const repo = workItems.find((item) => item.logicalFlow === 'repo');
  assert.equal(repo.accounts.length, 2, 'repo primary and companion group into their one exact repo letter');
  assert.deepEqual([repo.concreteFlow, repo.concreteRound], ['collection', 6]);
  const combo = workItems.find((item) => item.logicalFlow === 'combo');
  assert.equal(combo.accounts.length, 2);
  assert.deepEqual([combo.concreteFlow, combo.concreteRound], ['accuracy', 5]);
  const latePay = workItems.find((item) => item.logicalFlow === 'late_pay');
  assert.deepEqual([latePay.concreteFlow, latePay.concreteRound], ['consent', 2]);
  assert.equal(workItems.filter((item) => item.bureau.code === 'TU').length, 2, 'one bureau can receive multiple independently routed letters');
  assert.deepEqual(
    repo.snapshots.map((snapshot) => snapshot.clientAccountId),
    [accountIds[0], accountIds[1]],
    'saved track coverage is canonical and deterministic',
  );

  assert.throws(() => buildStateDrivenCraWorkItems(audit, []), /requires active server-owned CRA account tracks/);
  assert.throws(
    () => buildStateDrivenCraWorkItems(audit, [{ ...tracks[0], client_account_id: '20000000-0000-4000-8000-000000000099' }]),
    /no exact canonical account/,
  );
  assert.throws(() => buildStateDrivenCraWorkItems(audit, [{ ...tracks[0], track_scope: 'direct' }]), /non-CRA/);
  assert.throws(() => buildStateDrivenCraWorkItems(audit, [{ ...tracks[0], status: 'review_required' }]), /not active/);

  const source = fs.readFileSync(componentPath, 'utf8');
  assert.doesNotMatch(source, /buildR1CampaignPlan|CCC_TRANSITION_START_ROUND|setFlow\(|setRound\(/, 'composer has no report-plan fallback or arbitrary flow/round setters');
  assert.doesNotMatch(source, /value=\{flow\}|value=\{round\}/, 'composer has no arbitrary flow or round select');
  assert.match(source, /targetType:\s*templateAudience === 'cra' \? 'bureau'/, 'recipient type derives from the selected physical template audience');
  assert.match(source, /targetBureau:\s*templateAudience === 'cra' \? workItem\.bureau\.slug/, 'exact bureau slug is persisted');
  assert.match(source, /disputeBureauCode:\s*workItem\.bureau\.code/);
  assert.match(source, /disputeFlowCode:\s*workItem\.concreteFlow/);
  assert.match(source, /disputeRoundNumber:\s*workItem\.concreteRound/);
  assert.match(source, /cccAccountTrackSnapshots:\s*currentTrackSnapshots/);
  assert.match(source, /disputeAutomaticValuesSnapshot:\s*automaticValuesSnapshot/);
  assert.match(source, /accountNumberMasked:\s*maskAccountNumber/, 'provenance stores only a newly normalized masked account number');
  assert.match(source, /token !== 'optional_strengthener'/, 'optional strengthener never blocks save');
  assert.match(source, /validateTemplateTokenContract/);
  assert.match(source, /accountsMissingConfirmedDisputeFacts/);
  assert.match(source, /from\('ccc_account_tracks'\)\.select\('\*'\)\.in\('id', trackIds\)/, 'track revisions are reloaded immediately before save');
  assert.match(source, /from\('dispute_templates'\)\.select\('\*'\)\.eq\('id', selectedTemplate\.id\)/, 'the exact selected template is reloaded immediately before save');

  console.log('State-driven Campaign Studio tests passed.');
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
