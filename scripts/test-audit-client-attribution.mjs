#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const worker = read('../netlify/functions/audit-run-background.mjs');
const jobs = read('../src/utils/auditJobs.js');
const picker = read('../src/components/ClientPicker.jsx');
const upload = read('../src/components/UploadZone.jsx');

assert.match(worker, /selected_client_is_new \|\| !isUuid\(queuedJob\.selected_client_id\)/);
assert.match(worker, /\.eq\('id', queuedJob\.selected_client_id\)[\s\S]*?\.eq\('user_id', caller\.userId\)/);
assert.match(worker, /const selectedJobClient = selectedRows\[0\]/);
assert.match(worker, /return \{ clientName: selectedJobClient\.name, clientId: selectedJobClient\.id \}/);
assert.match(worker, /const clientId = selectedJobClient\.id/);
assert.doesNotMatch(worker, /falling back to name-matching|\.ilike\('name'|client_id resolve\/create/);
assert.doesNotMatch(worker, /from\('clients'\)[\s\S]{0,120}\.insert\(\{ user_id: userId, name: clientName/);

assert.match(jobs, /clientSelection\?\.type !== 'existing' \|\| !clientSelection\.id/);
assert.match(jobs, /selected_client_id: clientSelection\.id/);
assert.match(jobs, /selected_client_is_new: false/);
assert.doesNotMatch(jobs, /clientSelection\?\.type === 'new'/);

assert.match(picker, /Create separate new lead/);
assert.match(picker, /\.insert\(\{[\s\S]*?lead_source: 'Audit upload'/);
assert.match(picker, /pick\(\{ type: 'existing', id: data\.id, name: data\.name \}\)/);
assert.doesNotMatch(picker, /pick\(\{ type: 'new'/);
assert.match(upload, /clientSelection\?\.type !== 'existing' \|\| !clientSelection\.id/);

console.log('Exact audit-to-client attribution contracts passed.');
