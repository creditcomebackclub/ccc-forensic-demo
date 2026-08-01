/**
 * Capture DemoReel scenes with Playwright and assemble a Keynote-style MP4.
 * Usage: node scripts/render-fieldwork-reel.mjs
 *
 * Requires: Vite on FIELDWORK_REEL_BASE, Playwright Chromium, ffmpeg.
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const BASE = process.env.FIELDWORK_REEL_BASE || 'http://localhost:5173/diy.html';
const OUT_DIR = join(process.cwd(), 'public/videos/reel-frames');
const OUT_MP4 = join(process.cwd(), 'public/videos/fieldwork-product-demo.mp4');
const POSTER = join(process.cwd(), 'public/videos/fieldwork-demo-poster.jpg');
const SCENE_COUNT = 9;
const HOLD_SECONDS = 2.6;
const FADE = 0.55;
const FPS = 30;
const FRAMES = Math.round(HOLD_SECONDS * FPS);

mkdirSync(OUT_DIR, { recursive: true });

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`${cmd} failed (${res.status})`);
}

console.log('Launching Chromium…');
const browser = await chromium.launch({
  headless: true,
  args: ['--disable-dev-shm-usage', '--font-render-hinting=none'],
});

const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});

await page.addInitScript(() => {
  document.documentElement.style.overflow = 'hidden';
});

for (let i = 0; i < SCENE_COUNT; i++) {
  const url = `${BASE}#/reel/${i}`;
  console.log(`Capture ${i + 1}/${SCENE_COUNT}`, url);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  // Let Framer Motion entrances finish (do NOT disable animations —
  // that freezes motion variants at opacity 0).
  await page.waitForTimeout(1400);
  const file = join(OUT_DIR, `scene-${String(i).padStart(2, '0')}.png`);
  await page.screenshot({ path: file, type: 'png' });
}

await browser.close();

// One still → FRAMES of gentle Ken Burns (do NOT -loop/-t the input or
// zoompan multiplies duration by every decoded frame).
const inputs = [];
const filters = [];
for (let i = 0; i < SCENE_COUNT; i++) {
  inputs.push('-i', join(OUT_DIR, `scene-${String(i).padStart(2, '0')}.png`));
}

const zoom = `'min(1.05,1+0.05*on/${FRAMES})'`;
let prev = '[v0]';
filters.push(
  `[0:v]scale=2200:1238:force_original_aspect_ratio=increase,` +
    `zoompan=z=${zoom}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${FRAMES}:s=1920x1080:fps=${FPS},` +
    `format=yuv420p,setsar=1[v0]`
);

for (let i = 1; i < SCENE_COUNT; i++) {
  filters.push(
    `[${i}:v]scale=2200:1238:force_original_aspect_ratio=increase,` +
      `zoompan=z=${zoom}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${FRAMES}:s=1920x1080:fps=${FPS},` +
      `format=yuv420p,setsar=1[s${i}]`
  );
  const out = i === SCENE_COUNT - 1 ? '[vout]' : `[v${i}]`;
  // Each zoompan clip is HOLD_SECONDS long; xfade shortens by FADE each join
  const offset = (HOLD_SECONDS - FADE) * i;
  filters.push(
    `${prev}[s${i}]xfade=transition=fadeblack:duration=${FADE}:offset=${offset.toFixed(3)}${out}`
  );
  prev = `[v${i}]`;
}

const filterPath = join(OUT_DIR, 'filter.txt');
writeFileSync(filterPath, filters.join(';\n'));

const expectedSec = HOLD_SECONDS * SCENE_COUNT - FADE * (SCENE_COUNT - 1);
console.log(`Assembling Keynote reel (~${expectedSec.toFixed(1)}s)…`);

run('ffmpeg', [
  '-y',
  ...inputs,
  '-filter_complex_script', filterPath,
  '-map', '[vout]',
  '-c:v', 'libx264',
  '-crf', '17',
  '-preset', 'slow',
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  '-an',
  OUT_MP4,
]);

run('ffmpeg', [
  '-y',
  '-i', join(OUT_DIR, 'scene-01.png'),
  '-frames:v', '1',
  '-update', '1',
  '-q:v', '2',
  POSTER,
]);

console.log('Wrote', OUT_MP4);
if (!existsSync(OUT_MP4)) process.exit(1);
