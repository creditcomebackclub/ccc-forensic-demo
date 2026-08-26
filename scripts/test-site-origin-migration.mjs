#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const activeOrigin = 'https://credit-comeback-club.netlify.app';
const activeHost = new URL(activeOrigin).hostname;
const retiredHost = ['ccc-forensic-demo', 'netlify', 'app'].join('.');
const excludedDirectories = new Set(['.git', '.netlify', 'coverage', 'dist', 'node_modules']);
const textExtensions = new Set([
  '.cjs', '.css', '.html', '.js', '.jsx', '.json', '.md', '.mjs', '.py', '.sh', '.sql', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
]);
const textFileNames = new Set(['.env.example', 'Dockerfile', 'Procfile']);

function collectTextFiles(path) {
  const files = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) files.push(...collectTextFiles(entryPath));
    else if (textExtensions.has(extname(entry.name)) || textFileNames.has(entry.name)) files.push(entryPath);
  }
  return files;
}

const auditedFiles = collectTextFiles(repoRoot);
const staleFiles = auditedFiles
  .filter((path) => readFileSync(path, 'utf8').toLowerCase().includes(retiredHost))
  .map((path) => relative(repoRoot, path));

assert.deepEqual(staleFiles, [], `Retired Netlify origin remains in: ${staleFiles.join(', ')}`);

const lookalikeFiles = auditedFiles.flatMap((path) => {
  const urls = readFileSync(path, 'utf8').match(/https?:\/\/[^\s"'<>`]+/g) || [];
  const unsafe = urls.filter((value) => {
    try {
      const hostname = new URL(value.replace(/[),.;]+$/, '')).hostname.toLowerCase();
      return hostname.includes(activeHost) && hostname !== activeHost;
    } catch {
      return false;
    }
  });
  return unsafe.map((value) => `${relative(repoRoot, path)}: ${value}`);
});
assert.deepEqual(lookalikeFiles, [], `Lookalike Netlify hostname remains in: ${lookalikeFiles.join(', ')}`);

const doubledLoginPath = ['/login', 'login'].join('/');
const doubledLoginFiles = auditedFiles
  .filter((path) => readFileSync(path, 'utf8').includes(doubledLoginPath))
  .map((path) => relative(repoRoot, path));
assert.deepEqual(doubledLoginFiles, [], `Doubled login path remains in: ${doubledLoginFiles.join(', ')}`);

const liveSource = readFileSync(join(repoRoot, 'website-preview/index.html'), 'utf8');
const socialImageUrl = `${activeOrigin}/site-live/ccc-social-preview-2026.jpg`;
const logoUrl = `${activeOrigin}/site-live/ccc-logo.webp`;
for (const metadata of [
  `<meta property="og:image" content="${socialImageUrl}">`,
  `<meta property="og:image:secure_url" content="${socialImageUrl}">`,
  `<meta name="twitter:image" content="${socialImageUrl}">`,
  `"url": "${logoUrl}"`,
  `"url": "${socialImageUrl}"`,
]) {
  assert.ok(liveSource.includes(metadata), `Live metadata must include ${metadata}`);
}

for (const [path, requiredValue] of [
  ['.env.example', `ALLOWED_ORIGINS=https://creditcomebackclub.com,${activeOrigin}`],
  ['render.yaml', `value: https://creditcomebackclub.com,${activeOrigin}`],
  ['public/success.html', `<link rel="canonical" href="${activeOrigin}/consultation-confirmed">`],
  ['netlify/functions/_email.cjs', `const APP_ORIGIN = (process.env.APP_ORIGIN || '${activeOrigin}').replace(/\\/+$/, '');`],
  ['netlify/functions/_email.cjs', 'portalUrl: `${APP_ORIGIN}/login`'],
  ['netlify/functions/daily-cron.cjs', `href="${activeOrigin}/login"`],
]) {
  assert.ok(
    readFileSync(join(repoRoot, path), 'utf8').includes(requiredValue),
    `${path} must use the active Netlify origin`,
  );
}

console.log('Netlify origin migration assertions passed.');
