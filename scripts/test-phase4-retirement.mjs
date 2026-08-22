import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PHASE4_SYSTEM_PROMPT } from '../src/prompts/phase4Prompt.js';

const source = readFileSync(
  new URL('../netlify/functions/phase4-generate-background.mjs', import.meta.url),
  'utf8',
);

assert.match(PHASE4_SYSTEM_PROMPT, /^RETIRED WORKFLOW — DO NOT GENERATE CORRESPONDENCE\./);
assert.match(PHASE4_SYSTEM_PROMPT, /existing escalation records as read-only history/i);
assert.doesNotMatch(PHASE4_SYSTEM_PROMPT, /You are a forensic credit compliance analyst|drafting a CFPB complaint/i);

assert.match(source, /await requireStaff\(event\)/, 'the caller is authenticated before retirement is disclosed');
assert.match(source, /targetEscalation\.user_id !== caller\.userId/, 'the linked escalation is authorization checked');
assert.match(source, /status: 'error'/, 'queued legacy jobs are closed so clients do not poll forever');
assert.match(source, /stage: 'Retired workflow'/);
assert.match(source, /statusCode: 410, body: RETIRED_PHASE4_ERROR/);
assert.doesNotMatch(source, /@anthropic-ai\/sdk|ANTHROPIC_API_KEY|messages\.stream|preflightTokenCount|PHASE4_SCHEMA/,
  'the retired endpoint has no reachable model-generation dependency');
assert.doesNotMatch(source, /\.from\('letters'\)|\.from\('clients'\)|\.from\('audits'\)/,
  'retirement occurs without reading correspondence or consumer report data');
assert.doesNotMatch(source, /\.from\('escalations'\)\.update|narrative:|cfpb_category:/,
  'historical escalation content is not rewritten');

const authIndex = source.indexOf('await requireStaff(event)');
const authorizationIndex = source.indexOf(".from('escalations')");
const retiredIndex = source.indexOf('statusCode: 410');
assert.ok(authIndex >= 0 && authorizationIndex > authIndex && retiredIndex > authorizationIndex,
  'the endpoint authenticates and authorizes before returning the retirement gate');

console.log('Phase 4 generation is retired and historical escalation evidence remains read-only.');
