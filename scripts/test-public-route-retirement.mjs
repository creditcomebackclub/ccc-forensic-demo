#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');

const config = read('netlify.toml');
const packageJson = JSON.parse(read('package.json'));
const publicBuild = read('scripts/build-public-site.mjs');
const retirementWorker = read('public/sw.js');
const legacyEmbed = read('public/embed.js');
const legacyHome = read('public/home.html');
const marketingSource = read('website-preview/index.html');
const emailSource = read('netlify/functions/_email.cjs');
const dailyCron = read('netlify/functions/daily-cron.cjs');
const progressUpdate = read('netlify/functions/progress-update.mjs');

assert.equal(packageJson.scripts['build:site'], 'node scripts/build-public-site.mjs');
assert.match(config, /command = "npm run build:site"/);
assert.match(publicBuild, /createWebsiteReleaseHtml\(htmlSource, 'live'\)/);
assert.match(publicBuild, /join\(distRoot, 'index\.html'\)/);
assert.doesNotMatch(publicBuild, /vite build|src\/main\.jsx|VitePWA|manifest\.json/);

for (const path of ['/consultation', '/consultation/']) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(config, new RegExp(`from = "${escaped}"[\\s\\S]{0,120}?to = "\/#consultation"[\\s\\S]{0,80}?status = 301[\\s\\S]{0,80}?force = true`));
}
for (const path of ['/login', '/login/']) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(config, new RegExp(`from = "${escaped}"[\\s\\S]{0,120}?to = "https:\/\/creditcomeback\\.scorexer\\.com"[\\s\\S]{0,80}?status = 301`));
}
for (const path of ['/widget', '/widget/']) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(config, new RegExp(`from = "${escaped}"[\\s\\S]{0,120}?to = "\/#consultation"[\\s\\S]{0,80}?status = 301`));
}

assert.match(config, /from = "\/index\.html"[\s\S]{0,120}?to = "\/"[\s\S]{0,80}?status = 301/);
assert.match(config, /from = "\/\*"[\s\S]{0,120}?to = "\/site-live\/index\.html"[\s\S]{0,80}?status = 200/);
assert.doesNotMatch(config, /from = "\/\*"[\s\S]{0,120}?to = "\/index\.html"/);
assert.doesNotMatch(config, /for = "\/widget"/);

assert.match(retirementWorker, /caches\.keys\(\)/);
assert.match(retirementWorker, /caches\.delete\(name\)/);
assert.match(retirementWorker, /self\.registration\.unregister\(\)/);
assert.match(config, /for = "\/sw\.js"[\s\S]{0,180}?Cache-Control = "no-cache, no-store, must-revalidate"/);

assert.doesNotMatch(legacyEmbed, /iframe|\/widget|ProspectChatWidget/);
assert.doesNotMatch(legacyHome, /href="\/login"|src="\/embed\.js"/);
assert.doesNotMatch(marketingSource, /data-preview-destination="\/login"/);

assert.match(emailSource, /portalUrl: MEMBER_PORTAL_URL/);
assert.match(emailSource, /staffWorkspaceUrl: STAFF_WORKSPACE_URL/);
assert.doesNotMatch(emailSource, /APP_ORIGIN|\/login/);
assert.match(dailyCron, /href="https:\/\/creditcomeback\.scorexer\.com"/);
assert.match(dailyCron, /href="https:\/\/pulse\.disputeprocess\.com"/);
assert.doesNotMatch(dailyCron, /credit-comeback-club\.netlify\.app\/login/);
assert.match(progressUpdate, /MEMBER_PORTAL_URL \|\| 'https:\/\/creditcomeback\.scorexer\.com'/);

console.log('Marketing-only Netlify build and retired React route assertions passed.');
