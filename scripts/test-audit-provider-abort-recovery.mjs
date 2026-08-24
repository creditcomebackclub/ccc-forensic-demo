#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { isProviderTimeoutError } from '../netlify/functions/audit-run-background.mjs';

const worker = readFileSync(new URL('../netlify/functions/audit-run-background.mjs', import.meta.url), 'utf8');

// The Anthropic streaming SDK changes our timeout signal into this exact
// error shape: constructor name APIUserAbortError, generic name Error, and no
// timeout wording. It must still enter the durable checkpoint split path.
const sdkAbort = new Anthropic.APIUserAbortError();
assert.equal(sdkAbort.constructor.name, 'APIUserAbortError');
assert.equal(sdkAbort.name, 'Error');
assert.equal(sdkAbort.message, 'Request was aborted.');
assert.equal(isProviderTimeoutError(sdkAbort), true);

// The worker-owned signal is authoritative even if a future SDK release
// changes the wrapper error name or message.
const ownedTimeout = AbortSignal.abort(new DOMException('Provider window elapsed', 'TimeoutError'));
assert.equal(isProviderTimeoutError(new Error('Provider request stopped'), ownedTimeout), true);

// Ordinary request failures must not be promoted into timeout splitting.
assert.equal(isProviderTimeoutError(new Error('Authentication failed')), false);

// Preserve the complete runtime chain: retain the timer signal, classify it,
// mark the error, and route eligible page ranges to the split RPC rather than
// the unchanged-checkpoint retry branch.
assert.match(worker, /providerSignal = AbortSignal\.timeout\([\s\S]*messages\.stream\(params, \{ signal: providerSignal \}\)/);
assert.match(worker, /isProviderTimeoutError\(error, providerSignal\)[\s\S]*error\.auditProviderTimeout = true/);
assert.match(worker, /function checkpointSplitReason\(error\)[\s\S]*error\?\.auditProviderTimeout[\s\S]*return 'provider_timeout'/);
assert.match(worker, /const splitReason = checkpointSplitReason\(error\)[\s\S]*splitCheckpoint\(checkpoint, splitReason\)/);
assert.match(worker, /auditErrorType = 'provider_timeout'/);
assert.match(worker, /auditUserMessage = 'A report section took too long to analyze\./);
assert.match(worker, /Completed sections are saved, and this same audit can resume without another upload/);
assert.doesNotMatch(worker, /retry the audit or contact support if it happens again/);
assert.match(worker, /usage: \{[\s\S]*observation: 'partial_not_final'[\s\S]*preflight_input_tokens:[\s\S]*streamed_text_chars:[\s\S]*streamed_thinking_chars:/);
assert.match(worker, /recoverable provider limit; splitting saved checkpoint/);
const splitLogIndex = worker.indexOf('recoverable provider limit; splitting saved checkpoint');
const fatalLogIndex = worker.indexOf("console.error('audit-run failed:'");
assert.ok(splitLogIndex >= 0 && fatalLogIndex > splitLogIndex,
  'Handled provider limits must log recovery before the fatal-only fallback');

console.log('Audit provider abort recovery tests passed.');
