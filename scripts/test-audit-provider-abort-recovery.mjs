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
assert.match(worker, /e\?\.auditProviderTimeout[\s\S]*ccc_split_audit_checkpoint/);
assert.match(worker, /auditErrorType = 'provider_timeout'/);
assert.match(worker, /auditUserMessage = 'A report section took too long to analyze\./);

console.log('Audit provider abort recovery tests passed.');
