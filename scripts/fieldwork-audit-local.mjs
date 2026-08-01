#!/usr/bin/env node
/**
 * Local Fieldwork audit server — bypasses netlify-cli's hardcoded 30s
 * lambda-local timeout. Same Anthropic engine as the Netlify function.
 *
 *   node scripts/fieldwork-audit-local.mjs
 *   → http://127.0.0.1:8787/audit
 */
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const PORT = Number(process.env.FIELDWORK_AUDIT_PORT || 8787);

function loadEnvLocal() {
  const path = resolve(root, '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 0) continue;
    const key = trimmed.slice(0, i).trim();
    let val = trimmed.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvLocal();

const { runFieldworkAuditEngine } = await import(
  pathToFileURL(resolve(root, 'netlify/functions/_fieldworkAuditEngine.mjs')).href
);

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization,content-type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  });
  res.end(json);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    send(res, 204, {});
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    send(res, 200, {
      ok: true,
      service: 'fieldwork-audit-local',
      anthropic: Boolean(process.env.FIELDWORK_ANTHROPIC_API_KEY),
    });
    return;
  }

  if (req.method !== 'POST' || !req.url?.startsWith('/audit')) {
    send(res, 404, { error: 'POST /audit' });
    return;
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    send(res, 400, { error: 'Invalid JSON' });
    return;
  }

  const base64 = payload.base64;
  if (!base64) {
    send(res, 400, { error: 'base64 report required' });
    return;
  }

  console.log(`[fieldwork-audit-local] starting · ${payload.fileName || 'report'} · ~${Math.round(base64.length / 1024)} KB b64`);
  const started = Date.now();

  try {
    const audit = await runFieldworkAuditEngine({
      base64,
      mediaType: payload.mediaType || 'application/pdf',
      fileName: payload.fileName || 'credit-report.pdf',
      mode: payload.mode === 'single' ? 'single' : 'combined',
      bureau: payload.bureau || 'Experian',
      onProgress: async (msg) => console.log(`[fieldwork-audit-local] ${msg}`),
    });
    console.log(`[fieldwork-audit-local] done in ${Math.round((Date.now() - started) / 1000)}s · ${audit?.accounts?.length || 0} accounts`);
    send(res, 200, {
      product: 'fieldwork',
      isolated: true,
      mode: 'engine-local-server',
      audit,
    });
  } catch (err) {
    console.error('[fieldwork-audit-local] failed', err);
    send(res, err.statusCode || 500, {
      error: err.message || 'Audit failed',
      mode: 'engine-local-server',
    });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Fieldwork local audit server → http://127.0.0.1:${PORT}/audit`);
  console.log(`Anthropic key: ${process.env.FIELDWORK_ANTHROPIC_API_KEY ? 'yes' : 'MISSING'}`);
});
