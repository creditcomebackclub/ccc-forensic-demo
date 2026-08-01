/**
 * Drive the real Fieldwork demo UI and record a product walkthrough MP4.
 * Usage: node scripts/render-fieldwork-walkthrough.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const BASE = process.env.FIELDWORK_REEL_BASE || 'http://localhost:5173/diy.html';
const RAW_DIR = join(process.cwd(), 'public/videos/walkthrough-raw');
const OUT_MP4 = join(process.cwd(), 'public/videos/fieldwork-product-demo.mp4');
const POSTER = join(process.cwd(), 'public/videos/fieldwork-demo-poster.jpg');
const BED_WAV = join(process.cwd(), 'public/videos/audio/fieldwork-badass.wav');
const W = 1440;
const H = 900;

rmSync(RAW_DIR, { recursive: true, force: true });
mkdirSync(RAW_DIR, { recursive: true });

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`${cmd} failed (${res.status})`);
}

async function pause(page, ms = 900) {
  await page.waitForTimeout(ms);
}

async function smoothScroll(page, y) {
  await page.evaluate(async (targetY) => {
    const start = window.scrollY;
    const dist = targetY - start;
    const steps = 16;
    for (let i = 1; i <= steps; i++) {
      window.scrollTo(0, start + (dist * i) / steps);
      await new Promise((r) => setTimeout(r, 28));
    }
  }, y);
}

console.log('Recording product walkthrough…');
const browser = await chromium.launch({
  headless: true,
  args: ['--disable-dev-shm-usage', '--font-render-hinting=none'],
});

const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  recordVideo: { dir: RAW_DIR, size: { width: W, height: H } },
});

const page = await context.newPage();

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await pause(page, 1800);

// Hero → signup
await page.getByRole('link', { name: /See what an audit looks like/i }).click();
await page.waitForURL(/#\/signup/);
await pause(page, 1100);

await page.getByRole('checkbox').check();
await pause(page, 500);
await page.getByRole('button', { name: /Enter Fieldwork/i }).click();
await page.waitForURL(/#\/app$/);
await pause(page, 1500);

// Dashboard → new campaign
await page.getByRole('link', { name: /New campaign/i }).first().click();
await page.waitForURL(/campaign\/new/);
await pause(page, 1100);

// Upload sample + wait for analysis animation
await page.getByRole('button', { name: /Use sample 3-bureau report/i }).click();
await page.getByText(/Running furnisher-first audit/i).waitFor();
await pause(page, 5200);
await page.getByText(/Continue to dispute selection/i).waitFor({ timeout: 20000 });
await pause(page, 1400);

// Peek findings
await smoothScroll(page, 480);
await pause(page, 1400);
await page.getByRole('button', { name: /Continue to dispute selection/i }).click();
await pause(page, 1200);

// Select → mail
await page.getByText(/Pick your disputes/i).waitFor();
await pause(page, 900);
await page.getByRole('button', { name: /Select recommended/i }).click();
await pause(page, 800);
await page.getByRole('button', { name: /Compose letters/i }).click();
await pause(page, 1400);

// Mail via Lob
await page.getByRole('button', { name: /Send via Lob/i }).waitFor();
await smoothScroll(page, 260);
await pause(page, 1400);
await page.getByRole('button', { name: /Send via Lob/i }).click();
await page.getByText(/Building packet|Queued|Campaign in flight/i).first().waitFor();
await pause(page, 2800);

// Track
await page.getByText(/Campaign in flight/i).waitFor({ timeout: 15000 });
await pause(page, 1600);
await smoothScroll(page, 320);
await pause(page, 2000);

const video = page.video();
await context.close();
await browser.close();

const webmPath = await video.path();
console.log('Raw video:', webmPath);

const silentMp4 = join(RAW_DIR, 'silent.mp4');
run('ffmpeg', [
  '-y',
  '-i', webmPath,
  '-vf', 'fade=t=in:st=0:d=0.35',
  '-c:v', 'libx264',
  '-crf', '18',
  '-preset', 'medium',
  '-pix_fmt', 'yuv420p',
  '-an',
  silentMp4,
]);

// Dark tech bed (no VO — music carries the energy)
console.log('Generating badass bed…');
run('python3', [join(process.cwd(), 'scripts/gen-fieldwork-bed.py'), BED_WAV]);

const dur = spawnSync(
  'ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', silentMp4],
  { encoding: 'utf8' },
).stdout.trim();
const fadeOutStart = Math.max(0, Number(dur) - 1.6).toFixed(3);

run('ffmpeg', [
  '-y',
  '-i', silentMp4,
  '-i', BED_WAV,
  '-filter_complex',
  `[1:a]atrim=0:${dur},afade=t=in:st=0:d=0.35,afade=t=out:st=${fadeOutStart}:d=1.6,volume=0.78,alimiter=limit=0.95[a]`,
  '-map', '0:v',
  '-map', '[a]',
  '-c:v', 'copy',
  '-c:a', 'aac',
  '-b:a', '192k',
  '-shortest',
  '-movflags', '+faststart',
  OUT_MP4,
]);

run('ffmpeg', [
  '-y',
  '-ss', '12',
  '-i', OUT_MP4,
  '-frames:v', '1',
  '-update', '1',
  '-q:v', '2',
  POSTER,
]);

console.log('Wrote', OUT_MP4, `(${dur}s + music)`);
if (!existsSync(OUT_MP4)) process.exit(1);

for (const f of readdirSync(RAW_DIR)) {
  if (f.endsWith('.webm')) rmSync(join(RAW_DIR, f), { force: true });
}
