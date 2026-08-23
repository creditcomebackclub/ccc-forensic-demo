#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import https from 'node:https';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const {
  expectedServiceForEvent,
  handler: lobWebhook,
  isMonotonicTrackingTransition,
  trackingRank,
} = require('../netlify/functions/lob-webhook.cjs');

const webhook = readFileSync(new URL('../netlify/functions/lob-webhook.cjs', import.meta.url), 'utf8');
const lob = readFileSync(new URL('../netlify/functions/lob.cjs', import.meta.url), 'utf8');

assert.equal(expectedServiceForEvent('letter.mailed'), 'usps_first_class');
assert.equal(expectedServiceForEvent('letter.failed'), 'usps_first_class');
assert.equal(expectedServiceForEvent('letter.certified.delivered'), 'usps_first_class_certified_return_receipt');
assert.equal(expectedServiceForEvent('letter.return_receipt'), 'usps_first_class_certified_return_receipt');
assert.equal(expectedServiceForEvent('letter.deleted'), null);

assert.equal(trackingRank(null), 0);
assert.equal(trackingRank('Mailed'), 1);
assert.equal(trackingRank('In Transit'), 2);
assert.equal(trackingRank('Mailpiece Scan Received'), 2);
assert.equal(trackingRank('Out for Delivery'), 3);
assert.equal(trackingRank('Delivered'), 4);

assert.equal(isMonotonicTrackingTransition(null, 'Mailed'), true);
assert.equal(isMonotonicTrackingTransition('Mailed', 'In Transit'), true);
assert.equal(isMonotonicTrackingTransition('In Transit', 'Out for Delivery'), true);
assert.equal(isMonotonicTrackingTransition('Out for Delivery', 'Delivered'), true);
assert.equal(isMonotonicTrackingTransition('In Transit', 'Mailed'), false, 'late mailed must not regress in-transit');
assert.equal(isMonotonicTrackingTransition('Out for Delivery', 'In Transit'), false, 'late transit must not regress processed-for-delivery');
assert.equal(isMonotonicTrackingTransition('Mailpiece Scan Received', 'Mailed'), false, 'plain First-Class scan state is monotonic');
assert.equal(isMonotonicTrackingTransition('Mailed', 'Mailed'), false, 'duplicate events do not win a write');
for (const terminal of ['Delivered', 'Returned to Sender', 'Failed', 'Cancelled']) {
  assert.equal(isMonotonicTrackingTransition(terminal, 'Mailed'), false, `${terminal} is immutable`);
  assert.equal(isMonotonicTrackingTransition(terminal, 'Returned to Sender'), false, `${terminal} cannot be replaced by another terminal result`);
}

assert.match(webhook, /mail_submissions\?lob_id=eq\.[\s\S]*select=id,letter_id,user_id,client_id,idempotency_key,status,lob_id&limit=2/);
assert.match(webhook, /idempotency_key=eq\.[\s\S]*lob_id=is\.null&status=in\.\(pending,submitted,accepted_unreconciled\)/);
assert.match(webhook, /String\(letter\.user_id \|\| ''\) !== String\(submission\.user_id \|\| ''\)/);
assert.match(webhook, /String\(letter\.client_id \|\| ''\) !== String\(submission\.client_id \|\| ''\)/);
assert.match(webhook, /mail_service=eq\.[\s\S]*tracking_status/);
assert.match(webhook, /submissionAttemptCasPath\(resolved\)/);
assert.match(webhook, /letterAttemptCasPath\(resolved\)/);
assert.match(webhook, /resolved\.letter\.tracking_status !== 'Delivered'/);
assert.match(webhook, /return_receipt_url=is\.null/);
assert.match(webhook, /RENDERED_PDF_EVENTS[\s\S]*resolveCurrentMailAttempt[\s\S]*submissionId: resolved\.submission\.id[\s\S]*idempotencyKey: resolved\.submission\.idempotency_key[\s\S]*artifactType: 'mailpiece_pdf'/);
assert.match(webhook, /ACTIVE_SUBMISSION_STATUSES/);
assert.match(webhook, /TERMINAL_TRACKING_STATUSES/);
assert.doesNotMatch(webhook, /signed_failed/, 'a signed render failure retains the exact frozen claim for safe retry');
assert.match(webhook, /releaseCccTrackRevisionMailClaims\(resolved, 'signed_cancelled'/,
  'only the signed cancellation lifecycle releases an accepted Lob claim');
assert.doesNotMatch(webhook, /\/rest\/v1\/letters\?lob_id=eq\./, 'webhooks never patch or resolve letters by a non-unique Lob id');
assert.doesNotMatch(webhook, /\/rest\/v1\/mail_submissions\?lob_id=eq\.[^\n]+\n\s*'PATCH'/, 'webhooks never mass-update submissions by Lob id');

const legacyBlock = lob.indexOf('LEGACY MAILING RETIRED');
const externalSend = lob.indexOf("lobRequest('/v1/letters'");
assert.ok(legacyBlock > 0 && externalSend > legacyBlock, 'legacy mail is rejected before the irreversible Lob send');
assert.match(lob, /letter\.mail_service && letter\.mail_service !== CURRENT_CCC_MAIL_SERVICE/);
assert.match(lob, /mail_submission_id: String\(submission\.id\)/);
assert.match(lob, /mail_attempt_key: String\(submission\.idempotency_key\)/);
assert.match(lob, /mail_service: CURRENT_CCC_MAIL_SERVICE/);
assert.match(lob, /file: scannedMailpiece\.html/);
assert.doesNotMatch(lob, /extra_service:\s*'certified_return_receipt'/, 'current server sends cannot request certified mail');
assert.doesNotMatch(lob.slice(legacyBlock, externalSend), /letterSignatureState|CLIENT SIGNATURE REQUIRED/, 'retired LPOA/signature checks are not in the current send path');
assert.doesNotMatch(lob, /missingCampaignClosingSections|signature-block|mail-notation/, 'current CCC mail does not require retired signature or certified-mail closing markup');
assert.match(lob, /finalizeAcceptedSubmission\([\s\S]*status=eq\.pending[\s\S]*\['submitted', 'accepted_unreconciled', 'failed', 'cancelled'\]/, 'post-acceptance reconciliation preserves a terminal signed-webhook result');
assert.match(lob, /tracking_status: null, delivered_at: null, expected_delivery_date: null/, 'a failed or cancelled attempt rotates into a clean operational state before re-mail');
assert.match(lob, /prepareFailedRetry[\s\S]*alreadyCleared[\s\S]*mail_submissions\?id=eq\.[\s\S]*idempotency_key=eq\.[\s\S]*status=eq\.failed/, 'a failed retry uses the exact attempt identity and can heal an interrupted two-row reset');
assert.match(lob, /prepareCancelledRetry[\s\S]*alreadyCleared[\s\S]*mail_submissions\?id=eq\.[\s\S]*idempotency_key=eq\.[\s\S]*status=eq\.cancelled/, 'a cancelled retry uses the exact attempt identity and can heal an interrupted two-row reset');
assert.match(lob, /if \(!isSuccess\(result\) \|\| !result\.body\?\.id\)[\s\S]*status: 'pending'[\s\S]*tracking_status: null/, 'an explicit pre-acceptance Lob rejection remains safely retryable with the same attempt key');
assert.match(lob, /markPacketCoverageQueuedIfUntracked[\s\S]*tracking_status=is\.null[\s\S]*await markPacketCoverageQueuedIfUntracked/, 'the synchronous acceptance path cannot regress packet coverage after a newer webhook scan');
assert.match(lob, /mailed_date: operationallyMailed \? \(reconciledLetter\?\.mailed_date \|\| mailedAt\) : null/, 'a signed failure/cancellation that wins the acceptance race is not reported to staff as mailed');

const originalRequest = https.request;
const originalEnv = {
  url: process.env.VITE_SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  secret: process.env.LOB_WEBHOOK_SECRET,
  mode: process.env.LOB_MODE,
  testKey: process.env.LOB_TEST_KEY,
};
const submissionId = '11111111-1111-4111-8111-111111111111';
const clientId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const letterId = '44444444-4444-4444-8444-444444444444';
const attemptKey = '55555555-5555-4555-8555-555555555555';
const lobId = 'ltr_exact_attempt';

function responseFor(status, body) {
  return { status, body };
}

async function invokeWebhook({ eventType, submissions, letter, mailService = 'usps_first_class', lobBody = {}, routeOverride }) {
  const calls = [];
  https.request = (options, callback) => {
    const request = new EventEmitter();
    let requestBody = '';
    request.write = (chunk) => { requestBody += chunk; };
    request.end = () => {
      queueMicrotask(() => {
        calls.push({ method: options.method, path: options.path, body: requestBody ? JSON.parse(requestBody) : null });
        let response;
        if (routeOverride) response = routeOverride(options, requestBody ? JSON.parse(requestBody) : null);
        if (!response && options.path.includes('/rest/v1/lob_webhook_events?')) response = responseFor(201, [{}]);
        if (!response && options.method === 'GET' && options.path.includes('/rest/v1/mail_submissions?lob_id=eq.')) response = responseFor(200, submissions);
        if (!response && options.method === 'GET' && options.path.includes(`/rest/v1/letters?id=eq.${letterId}`)) response = responseFor(200, [letter]);
        if (!response && options.method === 'PATCH' && options.path.includes(`/rest/v1/letters?id=eq.${letterId}`)) {
          response = responseFor(200, [{ ...letter, ...(requestBody ? JSON.parse(requestBody) : {}) }]);
        }
        if (!response && options.method === 'PATCH' && options.path.includes(`/rest/v1/mail_submissions?id=eq.${submissionId}`)) {
          response = responseFor(200, [{ ...submissions[0], ...(requestBody ? JSON.parse(requestBody) : {}) }]);
        }
        if (!response && options.method === 'PATCH' && options.path.includes('/rest/v1/letter_account_coverage?')) response = responseFor(200, []);
        if (!response) response = responseFor(500, { error: `Unexpected test request: ${options.method} ${options.path}` });
        const res = new EventEmitter();
        res.statusCode = response.status;
        res.resume = () => {};
        callback(res);
        if (response.body != null) res.emit('data', Buffer.from(JSON.stringify(response.body)));
        res.emit('end');
      });
    };
    request.destroy = (error) => { if (error) request.emit('error', error); };
    return request;
  };

  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify({
    event_type: { id: eventType },
    date_created: new Date().toISOString(),
    body: {
      id: lobId,
      tracking_number: '9400000000000000000000',
      metadata: {
        letter_id: letterId,
        mail_submission_id: submissionId,
        mail_attempt_key: attemptKey,
        mail_service: mailService,
      },
      ...lobBody,
    },
  });
  const signature = crypto.createHmac('sha256', process.env.LOB_WEBHOOK_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');
  const result = await lobWebhook({
    httpMethod: 'POST',
    headers: { 'lob-signature': signature, 'lob-signature-timestamp': timestamp },
    body: rawBody,
  });
  return { result, calls };
}

try {
  process.env.VITE_SUPABASE_URL = 'https://lob-attempt-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  process.env.LOB_WEBHOOK_SECRET = 'test-webhook-secret';
  process.env.LOB_MODE = 'test';
  delete process.env.LOB_TEST_KEY;

  const baseSubmission = {
    id: submissionId,
    letter_id: letterId,
    user_id: userId,
    client_id: clientId,
    idempotency_key: attemptKey,
    status: 'submitted',
    lob_id: lobId,
  };
  const baseLetter = {
    id: letterId,
    user_id: userId,
    client_id: clientId,
    lob_id: lobId,
    mail_service: 'usps_first_class',
    tracking_status: 'In Transit',
  };

  const lateMailed = await invokeWebhook({ eventType: 'letter.mailed', submissions: [baseSubmission], letter: baseLetter });
  assert.equal(lateMailed.result.statusCode, 200);
  assert.match(JSON.parse(lateMailed.result.body).skipped, /regressive/);
  assert.equal(lateMailed.calls.some((call) => call.method === 'PATCH' && call.path.includes('/rest/v1/letters?')), false);

  const terminalFailure = await invokeWebhook({
    eventType: 'letter.failed',
    submissions: [baseSubmission],
    letter: { ...baseLetter, tracking_status: 'Delivered', delivered_at: new Date().toISOString() },
  });
  assert.equal(terminalFailure.result.statusCode, 200);
  assert.match(JSON.parse(terminalFailure.result.body).skipped, /no longer eligible/);
  assert.equal(terminalFailure.calls.some((call) => call.method === 'PATCH' && call.path.includes('/rest/v1/letters?')), false);

  const partialFailureRetry = await invokeWebhook({
    eventType: 'letter.failed',
    submissions: [baseSubmission],
    letter: { ...baseLetter, phase: 'CCC Dispute — Accuracy R1 — Equifax', tracking_status: 'Failed', mailed_date: null },
  });
  assert.equal(partialFailureRetry.result.statusCode, 200);
  assert.equal(JSON.parse(partialFailureRetry.result.body).reconciled, true, 'a retry heals a terminal letter whose exact submission write was interrupted');
  const reconciledSubmission = partialFailureRetry.calls.find((call) => call.method === 'PATCH' && call.path.includes(`/rest/v1/mail_submissions?id=eq.${submissionId}`));
  assert.ok(reconciledSubmission);
  assert.match(reconciledSubmission.path, /lob_id=eq\.ltr_exact_attempt/);
  assert.match(reconciledSubmission.path, /status=eq\.submitted/);
  assert.equal(
    partialFailureRetry.calls.some((call) => call.path.includes('/rest/v1/rpc/release_ccc_track_revision_mail_claims')),
    false,
    'a signed failure never releases the exact packet/track-revision claim',
  );

  const cancelled = await invokeWebhook({
    eventType: 'letter.deleted',
    submissions: [baseSubmission],
    letter: { ...baseLetter, tracking_status: 'Mailed' },
  });
  assert.equal(cancelled.result.statusCode, 200);
  assert.equal(JSON.parse(cancelled.result.body).trackingStatus, 'Cancelled');
  const cancelledLetter = cancelled.calls.find((call) => call.method === 'PATCH' && call.path.includes(`/rest/v1/letters?id=eq.${letterId}`));
  const cancelledSubmission = cancelled.calls.find((call) => call.method === 'PATCH' && call.path.includes(`/rest/v1/mail_submissions?id=eq.${submissionId}`));
  assert.ok(cancelledLetter);
  assert.match(cancelledLetter.path, /tracking_status=eq\.Mailed/);
  assert.match(cancelledLetter.path, /mail_service=eq\.usps_first_class/);
  assert.ok(cancelledSubmission);
  assert.match(cancelledSubmission.path, /idempotency_key=eq\./);
  assert.match(cancelledSubmission.path, /status=eq\.submitted/);

  const cccCancelled = await invokeWebhook({
    eventType: 'letter.deleted',
    submissions: [baseSubmission],
    letter: { ...baseLetter, phase: 'CCC Dispute — Accuracy R1 — Equifax', tracking_status: 'Mailed' },
    routeOverride: (options) => {
      if (options.method === 'POST' && options.path === '/rest/v1/rpc/release_ccc_track_revision_mail_claims') {
        return responseFor(200, 1);
      }
      return null;
    },
  });
  assert.equal(cccCancelled.result.statusCode, 200);
  const cancellationRelease = cccCancelled.calls.find((call) => call.path === '/rest/v1/rpc/release_ccc_track_revision_mail_claims');
  assert.deepEqual(cancellationRelease?.body, {
    p_letter_id: letterId,
    p_mail_submission_id: submissionId,
    p_release_reason: 'signed_cancelled',
  }, 'a signed exact-attempt cancellation releases through the guarded server RPC only');

  const lateCancellation = await invokeWebhook({
    eventType: 'letter.deleted',
    submissions: [baseSubmission],
    letter: { ...baseLetter, tracking_status: 'Returned to Sender' },
  });
  assert.equal(lateCancellation.result.statusCode, 200);
  assert.match(JSON.parse(lateCancellation.result.body).skipped, /no longer eligible/);
  assert.equal(lateCancellation.calls.some((call) => call.method === 'PATCH' && call.path.includes('/rest/v1/letters?')), false);

  const certifiedService = 'usps_first_class_certified_return_receipt';
  const receiptUrl = 'https://lob-assets.example/receipts/exact-attempt.pdf';
  const returnReceipt = await invokeWebhook({
    eventType: 'letter.return_receipt',
    submissions: [{ ...baseSubmission, lob_id: null }],
    letter: {
      ...baseLetter,
      mail_service: certifiedService,
      tracking_status: 'Delivered',
      return_receipt_url: null,
    },
    mailService: certifiedService,
    lobBody: { return_receipt_url: receiptUrl },
  });
  assert.equal(returnReceipt.result.statusCode, 200);
  assert.equal(JSON.parse(returnReceipt.result.body).saved, true);
  const receiptSubmission = returnReceipt.calls.find((call) => call.method === 'PATCH' && call.path.includes(`/rest/v1/mail_submissions?id=eq.${submissionId}`));
  const receiptLetter = returnReceipt.calls.find((call) => call.method === 'PATCH' && call.path.includes(`/rest/v1/letters?id=eq.${letterId}`));
  assert.ok(receiptSubmission, 'metadata fallback binds exactly one certified submission before evidence is saved');
  assert.match(receiptSubmission.path, /lob_id=is\.null/);
  assert.ok(receiptLetter);
  assert.match(receiptLetter.path, /tracking_status=eq\.Delivered/);
  assert.match(receiptLetter.path, /mail_service=eq\.usps_first_class_certified_return_receipt/);
  assert.match(receiptLetter.path, /return_receipt_url=is\.null/);
  assert.equal(receiptLetter.body.return_receipt_url, receiptUrl);

  const ambiguous = await invokeWebhook({ eventType: 'letter.in_transit', submissions: [baseSubmission, { ...baseSubmission, id: '66666666-6666-4666-8666-666666666666' }], letter: baseLetter });
  assert.equal(ambiguous.result.statusCode, 500);
  assert.equal(ambiguous.calls.some((call) => call.path.includes('/rest/v1/letters?')), false, 'ambiguous Lob id stops before PII-bearing letter lookup');

  const advanced = await invokeWebhook({
    eventType: 'letter.in_transit',
    submissions: [baseSubmission],
    letter: { ...baseLetter, tracking_status: 'Mailed' },
  });
  assert.equal(advanced.result.statusCode, 200);
  assert.equal(JSON.parse(advanced.result.body).trackingStatus, 'Mailpiece Scan Received');
  const exactPatch = advanced.calls.find((call) => call.method === 'PATCH' && call.path.includes(`/rest/v1/letters?id=eq.${letterId}`));
  assert.ok(exactPatch);
  assert.match(exactPatch.path, /lob_id=eq\.ltr_exact_attempt/);
  assert.match(exactPatch.path, /mail_service=eq\.usps_first_class/);
  assert.match(exactPatch.path, /tracking_status=eq\.Mailed/);

  process.env.LOB_TEST_KEY = 'test-lob-key';
  const delayedRendered = await invokeWebhook({
    eventType: 'letter.rendered_pdf',
    submissions: [],
    letter: baseLetter,
    routeOverride: (options) => {
      if (options.method === 'GET' && options.path.includes(`/rest/v1/mail_submissions?id=eq.${submissionId}`)) {
        return responseFor(200, []);
      }
      return null;
    },
  });
  assert.equal(delayedRendered.result.statusCode, 500, 'a rendered artifact without the exact current attempt remains retryable but cannot attach');
  assert.equal(
    delayedRendered.calls.some((call) => call.path.includes('/rest/v1/mail_artifacts') || call.path.includes('/storage/v1/object/')),
    false,
    'a delayed old rendered event stops before artifact lookup or storage',
  );
} finally {
  https.request = originalRequest;
  for (const [key, value] of Object.entries({
    VITE_SUPABASE_URL: originalEnv.url,
    SUPABASE_SERVICE_ROLE_KEY: originalEnv.key,
    LOB_WEBHOOK_SECRET: originalEnv.secret,
    LOB_MODE: originalEnv.mode,
    LOB_TEST_KEY: originalEnv.testKey,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('Lob attempt identity, terminal-state, monotonicity, and current-mail boundary assertions passed.');
