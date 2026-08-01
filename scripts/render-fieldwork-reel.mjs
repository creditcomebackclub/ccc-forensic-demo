/**
 * Capture DemoReel scenes with Playwright and assemble a Keynote-style MP4.
 * Usage: node scripts/render-fieldwork-reel.mjs
 *
 * Requires: Vite on FIELDWORK_REEL_BASE, Playwright Chromium, ffmpeg.
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const BASE = process.env.FIELDWORK_REEL_BASE || 'http://localhost:5173/diy.html';
const OUT_DIR = join(process.cwd(), 'public/videos/reel-frames');
const OUT_MP4 = join(process.cwd(), 'public/videos/fieldwork-product-demo.mp4');
const POSTER = join(process.cwd(), 'public/videos/fieldwork-demo-poster.jpg');
const SCENE_COUNT = 9;
const HOLD_SECONDS = 2.8;
const FADE = 0.65;
const FPS = 30;

mkdirSync(OUT_DIR, { recursive: true });

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`${cmd} ${args[0]} failed (${res.status})`);
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

// Hide scrollbars / reduce motion noise during capture settle
await page.addInitScript(() => {
  document.documentElement.style.overflow = 'hidden';
});

for (let i = 0; i < SCENE_COUNT; i++) {
  const url = `${BASE}#/reel/${i}`;
  console.log(`Capture ${i + 1}/${SCENE_COUNT}`, url);
  await page.goto(url, { waitUntil: 'networkidle' });
  // Let Framer Motion entrances settle into the composed frame
  await page.waitForTimeout(1100);
  const file = join(OUT_DIR, `scene-${String(i).padStart(2, '0')}.png`);
  await page.screenshot({ path: file, type: 'png', animations: 'disabled' });
}

await browser.close();

// Build slideshow: soft fade + subtle Ken Burns zoom on each still
const inputs = [];
const filters = [];
for (let i = 0; i < SCENE_COUNT; i++) {
  inputs.push('-loop', '1', '-t', String(HOLD_SECONDS), '-i', join(OUT_DIR, `scene-${String(i).padStart(2, '0')}.png`));
}

const frames = Math.round(HOLD_SECONDS * FPS);
// Gentle zoom 1.0 → 1.06 over the hold (Apple-style drift)
const zoomExpr = `'min(1.06,1+0.06*on/${frames})'`;

let prev = '[v0]';
filters.push(
  `[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,` +
    `zoompan=z=${zoomExpr}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=${FPS},` +
    `format=yuv420p,setsar=1[v0]`
);

for (let i = 1; i < SCENE_COUNT; i++) {
  filters.push(
    `[${i}:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,` +
      `zoompan=z=${zoomExpr}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=${FPS},` +
      `format=yuv420p,setsar=1[s${i}]`
  );
  const out = i === SCENE_COUNT - 1 ? '[vout]' : `[v${i}]`;
  const offset = (HOLD_SECONDS - FADE) * i;
  filters.push(
    `${prev}[s${i}]xfade=transition=fadeblack:duration=${FADE}:offset=${offset.toFixed(3)}${out}`
  );
  prev = `[v${i}]`;
}

const filterPath = join(OUT_DIR, 'filter.txt');
writeFileSync(filterPath, filters.join(';\n'));

const ffArgs = [
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
];

console.log('Assembling Keynote reel…');
run('ffmpeg', ffArgs);

// Poster from the "source" title card
run('ffmpeg', ['-y', '-i', join(OUT_DIR, 'scene-01.png'), '-frames:v', '1', '-q:v', '2', POSTER]);

console.log('Wrote', OUT_MP4);
if (!existsSync(OUT_MP4)) process.exit(1);

// Keep frames for re-assemble; uncomment to prune:
// rmSync(OUT_DIR, { recursive: true, force: true });
