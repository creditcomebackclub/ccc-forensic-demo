/**
 * Drive the real Fieldwork demo UI and record a product walkthrough MP4.
 * Usage: node scripts/render-fieldwork-walkthrough.mjs
 *
 * Requires: Vite on FIELDWORK_REEL_BASE, Playwright Chromium, ffmpeg.
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync, renameSync, rmSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const BASE = process.env.FIELDWORK_REEL_BASE || 'http://localhost:5173/diy.html';
const RAW_DIR = join(process.cwd(), 'public/videos/walkthrough-raw');
const OUT_MP4 = join(process.cwd(), 'public/videos/fieldwork-product-demo.mp4');
const POSTER = join(process.cwd(), 'public/videos/fieldwork-demo-poster.jpg');
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
    const steps = 18;
    for (let i = 1; i <= steps; i++) {
      window.scrollTo(0, start + (dist * i) / steps);
      await new Promise((r) => setTimeout(r, 30));
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
await pause(page, 1200);

// Hero beat
await pause(page, 1600);

// Signup
await page.getByRole('link', { name: /Try the demo|See what an audit/i }).first().click();
await page.waitForURL(/#\/signup/);
await pause(page, 1000);

await page.getByRole('checkbox').check();
await pause(page, 600);
await page.getByRole('button', { name: /Enter Fieldwork/i }).click();
await page.waitForURL(/#\/app/);
await pause(page, 1400);

// Dashboard → new campaign
const newCampaign = page.getByRole('link', { name: /New campaign|Start a campaign|Start your first/i }).first();
if (await newCampaign.count()) {
  await newCampaign.click();
} else {
  await page.getByRole('link', { name: 'New campaign' }).click();
}
await page.waitForURL(/campaign\/new/);
await pause(page, 1000);

// Upload sample
await page.getByRole('button', { name: /Use sample 3-bureau report/i }).click();
await page.getByText(/Running furnisher-first audit/i).waitFor();
// ANALYZE_STEPS × 900ms + buffer
await pause(page, 5200);
await page.getByText(/Step 02|Forensic readout|Your file/i).first().waitFor({ timeout: 15000 });
await pause(page, 1600);

// Scroll audit findings a bit
await smoothScroll(page, 420);
await pause(page, 1200);
await page.getByRole('button', { name: /Continue|Pick disputes|Select/i }).first().click();
await pause(page, 1200);

// Select step
await page.getByText(/Pick your disputes/i).waitFor();
await pause(page, 1000);
await page.getByRole('button', { name: /Select recommended/i }).click();
await pause(page, 900);
await page.getByRole('button', { name: /Continue to mail|Mail/i }).first().click();
await pause(page, 1400);

// Mail step
await page.getByText(/Step 04|Certified|Lob|Send/i).first().waitFor();
await smoothScroll(page, 200);
await pause(page, 1400);
const sendBtn = page.getByRole('button', { name: /Send .*credit|Send packets|Mail all|Send all/i }).first();
if (await sendBtn.count()) {
  await sendBtn.click();
} else {
  // Fallback: last primary action on mail step
  await page.locator('button.fw-btn-primary, button.fw-btn-ink').last().click();
}
await pause(page, 2800);

// Track
await page.getByText(/Step 05|Tracking|In transit|In flight/i).first().waitFor({ timeout: 15000 });
await pause(page, 2000);
await smoothScroll(page, 280);
await pause(page, 1800);

const video = page.video();
await context.close();
await browser.close();

const webmPath = await video.path();
console.log('Raw video:', webmPath);

// Normalize to H.264 MP4, mild fade in/out, poster from ~8s (audit)
const tmpMp4 = join(RAW_DIR, 'walkthrough.mp4');
run('ffmpeg', [
  '-y',
  '-i', webmPath,
  '-vf', 'fade=t=in:st=0:d=0.4,fade=t=out:st=0:d=0.5:alpha=0',
  '-c:v', 'libx264',
  '-crf', '18',
  '-preset', 'medium',
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  '-an',
  tmpMp4,
]);

// Simpler: no broken fade-out (st=0 on out is wrong). Re-encode clean.
run('ffmpeg', [
  '-y',
  '-i', webmPath,
  '-vf', 'fade=t=in:st=0:d=0.35',
  '-c:v', 'libx264',
  '-crf', '18',
  '-preset', 'medium',
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  '-an',
  OUT_MP4,
]);

run('ffmpeg', [
  '-y',
  '-ss', '8',
  '-i', OUT_MP4,
  '-frames:v', '1',
  '-update', '1',
  '-q:v', '2',
  POSTER,
]);

console.log('Wrote', OUT_MP4);
if (!existsSync(OUT_MP4)) process.exit(1);

// Keep raw dir small — drop webm after success
for (const f of readdirSync(RAW_DIR)) {
  if (f.endsWith('.webm') || f === 'walkthrough.mp4') {
    rmSync(join(RAW_DIR, f), { force: true });
  }
}
