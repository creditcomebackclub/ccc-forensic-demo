#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const artifactModule = require('../netlify/functions/_lobArtifacts.cjs');
const { mailAttemptContext } = artifactModule._test;
const source = readFileSync(new URL('../netlify/functions/_lobArtifacts.cjs', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260820450000_lob_artifact_attempt_binding.sql', import.meta.url), 'utf8');

assert.match(migration, /add column if not exists mail_submission_id uuid/);
assert.match(migration, /add column if not exists idempotency_key text/);
assert.match(migration, /legacy_unbound boolean not null default false/);
assert.match(migration, /drop trigger if exists protect_archived_mail_artifact_trigger on public\.mail_artifacts;[\s\S]*update public\.mail_artifacts artifact/,
  'retry-safe backfill must suspend a partially deployed immutable trigger before updating evidence bindings');
assert.match(migration, /foreign key \(mail_submission_id\)[\s\S]*references public\.mail_submissions\(id\)[\s\S]*on delete restrict/);
assert.match(migration, /mail_artifacts_attempt_binding_complete/);
assert.match(migration, /mail_artifacts_attempt_type_key/);
assert.match(migration, /Archived mail evidence is immutable/);
assert.match(migration, /revoke all on public\.mail_artifacts from anon, authenticated/);
assert.match(migration, /revoke all on public\.mail_submissions from anon, authenticated/);
assert.match(migration, /grant select on public\.mail_submissions to authenticated/);
assert.match(migration, /create policy "staff_read_mail_artifacts"[\s\S]*public\.mail_artifacts\.user_id = auth\.uid\(\)/);
assert.match(migration, /create policy "staff_read_mail_submissions"[\s\S]*public\.mail_submissions\.user_id = auth\.uid\(\)/);
assert.match(migration, /coalesce\(\(storage\.foldername\(name\)\)\[2\], ''\) <> 'mail-artifacts'/);
assert.match(migration, /drop policy if exists "staff_insert_documents_storage"/);
assert.match(migration, /drop policy if exists "staff_update_documents_storage"/);
assert.match(migration, /drop policy if exists "staff_delete_documents_storage"/);

assert.match(source, /mail_submissions\?id=eq\.[\s\S]*idempotency_key=eq\.[\s\S]*lob_id=eq\./);
assert.match(source, /String\(letter\.user_id \|\| ''\) !== String\(submission\.user_id \|\| ''\)/);
assert.match(source, /String\(letter\.client_id \|\| ''\) !== String\(submission\.client_id \|\| ''\)/);
assert.match(source, /mail_submission_id: context\.submission\.id/);
assert.match(source, /idempotency_key: context\.submission\.idempotency_key/);
assert.match(source, /legacy_unbound: false/);
assert.match(source, /'x-upsert': 'false'/);
assert.match(source, /artifactType \+ '-' \+ sha256/);
assert.doesNotMatch(source, /resolution=merge-duplicates/);

const originalRequest = https.request;
const submissionId = '11111111-1111-4111-8111-111111111111';
const letterId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const clientId = '44444444-4444-4444-8444-444444444444';
const attemptKey = '55555555-5555-4555-8555-555555555555';
const lobId = 'ltr_attempt_bound';

function installMock({ stale = false } = {}) {
  const calls = [];
  https.request = (options, callback) => {
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => queueMicrotask(() => {
      calls.push(options.path);
      let status = 200;
      let body = [];
      if (options.path.includes('/rest/v1/mail_submissions?')) {
        body = stale ? [] : [{
          id: submissionId,
          letter_id: letterId,
          user_id: userId,
          client_id: clientId,
          idempotency_key: attemptKey,
          status: 'submitted',
          lob_id: lobId,
        }];
      } else if (options.path.includes('/rest/v1/letters?')) {
        body = [{
          id: letterId,
          user_id: userId,
          client_id: clientId,
          lob_id: lobId,
          mail_service: 'usps_first_class',
          tracking_status: 'Mailed',
        }];
      } else {
        status = 500;
        body = { error: 'unexpected request' };
      }
      const res = new EventEmitter();
      res.statusCode = status;
      callback(res);
      res.emit('data', Buffer.from(JSON.stringify(body)));
      res.emit('end');
    });
    req.destroy = (error) => { if (error) req.emit('error', error); };
    return req;
  };
  return calls;
}

try {
  const calls = installMock();
  const context = await mailAttemptContext({
    lobId,
    letterId,
    submissionId,
    idempotencyKey: attemptKey,
    supabaseUrl: 'https://attempt-test.supabase.co',
    serviceKey: 'service-key',
  });
  assert.equal(context.submission.id, submissionId);
  assert.equal(context.submission.idempotency_key, attemptKey);
  assert.equal(context.letter.id, letterId);
  assert.match(calls[0], new RegExp(`id=eq\\.${submissionId}`));
  assert.match(calls[0], new RegExp(`idempotency_key=eq\\.${attemptKey}`));
  assert.match(calls[0], new RegExp(`lob_id=eq\\.${lobId}`));

  const staleCalls = installMock({ stale: true });
  await assert.rejects(
    mailAttemptContext({
      lobId,
      letterId,
      submissionId,
      idempotencyKey: '66666666-6666-4666-8666-666666666666',
      supabaseUrl: 'https://attempt-test.supabase.co',
      serviceKey: 'service-key',
    }),
    /not current/,
  );
  assert.equal(staleCalls.some((path) => path.includes('/rest/v1/letters?')), false, 'stale attempt stops before letter data is loaded');
} finally {
  https.request = originalRequest;
}

console.log('Lob artifact exact-attempt binding assertions passed.');
