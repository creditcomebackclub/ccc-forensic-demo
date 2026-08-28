#!/usr/bin/env node
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WEBSITE_LIVE_FILES,
  WEBSITE_SHARED_FILES,
  createWebsiteReleaseCss,
  createWebsiteReleaseHtml,
} from '../website-preview/release-build.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const publicRoot = join(repoRoot, 'public');
const websiteRoot = join(repoRoot, 'website-preview');
const distRoot = join(repoRoot, 'dist');

const [htmlSource, cssSource] = await Promise.all([
  readFile(join(websiteRoot, 'index.html'), 'utf8'),
  readFile(join(websiteRoot, 'styles.css'), 'utf8'),
]);

await rm(distRoot, { recursive: true, force: true });
await cp(publicRoot, distRoot, {
  recursive: true,
  filter(source) {
    const path = relative(publicRoot, source);
    return path !== '.DS_Store' && path !== 'home.html';
  },
});

async function emitRelease(mode, directory, files) {
  const destination = join(distRoot, directory);
  await mkdir(destination, { recursive: true });
  await Promise.all([
    writeFile(
      join(destination, 'index.html'),
      createWebsiteReleaseHtml(htmlSource, mode),
      'utf8',
    ),
    writeFile(
      join(destination, 'styles.css'),
      createWebsiteReleaseCss(cssSource, mode),
      'utf8',
    ),
    ...files.map((file) => copyFile(join(websiteRoot, file), join(destination, file))),
  ]);
}

await Promise.all([
  emitRelease('preview', 'site-preview', WEBSITE_SHARED_FILES),
  emitRelease('live', 'site-live', [...WEBSITE_SHARED_FILES, ...WEBSITE_LIVE_FILES]),
]);

// A real static homepage at /index.html is a final safety boundary: even if an
// edge rule is bypassed, the old React bootstrap can no longer be served.
await writeFile(
  join(distRoot, 'index.html'),
  createWebsiteReleaseHtml(htmlSource, 'live'),
  'utf8',
);

console.log('Built marketing-only Netlify artifact in dist/.');
