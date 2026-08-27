#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(repoRoot, path));
const text = (path) => read(path).toString('utf8');

function pngDimensions(path) {
  const bytes = read(path);
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG', `${path} must be a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

for (const [path, width, height] of [
  ['public/brand-assets/ccc-profile-dark.png', 1254, 1254],
  ['public/brand-assets/ccc-profile-light.png', 1254, 1254],
  ['public/brand-assets/ccc-tiktok-profile-dark-1080.png', 1080, 1080],
  ['public/brand-assets/ccc-tiktok-profile-light-1080.png', 1080, 1080],
  ['public/brand-assets/ccc-app-icon-192.png', 192, 192],
  ['public/brand-assets/ccc-app-icon-512.png', 512, 512],
  ['public/og-image.png', 1200, 630],
]) {
  assert.deepEqual(pngDimensions(path), { width, height }, `${path} has the wrong dimensions`);
}

const marketingSource = text('website-preview/index.html');
assert.ok(marketingSource.includes('/brand-assets/ccc-app-icon-192.png'), 'Marketing favicon must use the square CCC mark');
assert.ok(marketingSource.includes('https://credit-comeback-club.netlify.app/brand-assets/ccc-profile-dark.png'), 'Structured data must use the square CCC mark');

const appSource = text('index.html');
assert.ok(appSource.includes('/brand-assets/ccc-app-icon-192.png'), 'App favicon must use the square CCC mark');

const viteSource = text('vite.config.js');
assert.ok(viteSource.includes("src: 'brand-assets/ccc-app-icon-192.png'"), 'PWA must publish the 192px CCC icon');
assert.ok(viteSource.includes("src: 'brand-assets/ccc-app-icon-512.png'"), 'PWA must publish the 512px CCC icon');

console.log('Brand-asset assertions passed.');
