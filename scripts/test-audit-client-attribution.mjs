#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const worker = read('../netlify/functions/audit-run-background.mjs');
const jobs = read('../src/utils/auditJobs.js');
const picker = read('../src/components/ClientPicker.jsx');
const upload = read('../src/components/UploadZone.jsx');
const storage = read('../src/utils/storage.js');

assert.match(worker, /job\.selected_client_is_new \|\| !isUuid\(job\.selected_client_id\)/);
assert.match(worker, /\.eq\('id', job\.selected_client_id\)[\s\S]*?\.eq\('user_id', ownerUserId\)/);
assert.match(worker, /const selectedJobClient = selectedRows\[0\]/);
assert.match(worker, /return \{ clientName: selectedJobClient\.name, clientId: selectedJobClient\.id \}/);
assert.match(worker, /const clientId = selectedJobClient\.id/);
assert.doesNotMatch(worker, /profilePatch\.(?:address|date_of_birth)\s*=/,
  'audit evidence must never overwrite the current CRM mailing address or DOB');
assert.doesNotMatch(worker, /falling back to name-matching|\.ilike\('name'|client_id resolve\/create/);
assert.doesNotMatch(worker, /from\('clients'\)[\s\S]{0,120}\.insert\(\{ user_id: userId, name: clientName/);

assert.match(jobs, /clientSelection\?\.type !== 'existing' \|\| !clientSelection\.id/);
assert.match(jobs, /p_selected_client_id: clientSelection\.id/);
assert.match(jobs, /ccc_create_or_resume_audit_job/);
assert.doesNotMatch(jobs, /clientSelection\?\.type === 'new'/);

assert.match(picker, /Create lead/);
assert.match(picker, /selection confirms the uploaded report belongs to this client/);
assert.match(picker, /\.insert\(\{[\s\S]*?lead_source: 'Audit upload'/);
assert.match(picker, /pick\(\{ type: 'existing', id: data\.id, name: data\.name \}\)/);
assert.doesNotMatch(picker, /pick\(\{ type: 'new'/);
assert.doesNotMatch(picker, /newLeadAddress|newLeadDob|Add DOB \+ address first/);
assert.match(upload, /clientSelection\?\.type !== 'existing' \|\| !clientSelection\.id/);
assert.match(storage, /address: row\.address \|\| null/);
assert.doesNotMatch(storage, /address: row\.address \|\| audits\.find/,
  'historical report addresses must not hydrate the current CRM profile');

console.log('Exact audit-to-client attribution contracts passed.');
