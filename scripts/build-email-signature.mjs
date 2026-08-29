#!/usr/bin/env node

import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputRoot = join(repoRoot, 'public', 'brand-assets');
const logoPath = join(repoRoot, 'website-preview', 'ccc-logo.webp');

const DISPLAY_WIDTH = 400;
const DISPLAY_HEIGHT = 100;
const SCALE = 2;
const WIDTH = DISPLAY_WIDTH * SCALE;
const HEIGHT = DISPLAY_HEIGHT * SCALE;
const BLUE = '#1e9ad6';
const BLUE_DEEP = '#0877b2';
const BLUE_LIGHT = '#66c7f4';
const ICE = '#f4faff';
const INK = '#080b10';
const MUTED = '#535d69';

function littleEndian(value) {
  return [value & 0xff, (value >> 8) & 0xff];
}

function createRgb332Palette() {
  const palette = [];
  for (let red = 0; red < 8; red += 1) {
    for (let green = 0; green < 8; green += 1) {
      for (let blue = 0; blue < 4; blue += 1) {
        palette.push(
          Math.round((red / 7) * 255),
          Math.round((green / 7) * 255),
          Math.round((blue / 3) * 255),
        );
      }
    }
  }
  return palette;
}

function rgbaToRgb332(imageData) {
  const indexed = new Uint8Array(WIDTH * HEIGHT);
  for (let source = 0, target = 0; source < imageData.data.length; source += 4, target += 1) {
    const red = Math.round((imageData.data[source] / 255) * 7);
    const green = Math.round((imageData.data[source + 1] / 255) * 7);
    const blue = Math.round((imageData.data[source + 2] / 255) * 3);
    indexed[target] = (red << 5) | (green << 2) | blue;
  }
  return indexed;
}

function lzwEncode(indexedPixels, minCodeSize = 8) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const bytes = [];
  let bitBuffer = 0;
  let bitCount = 0;
  let codeSize;
  let nextCode;
  let dictionary;

  const writeCode = (code) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      bytes.push(bitBuffer & 0xff);
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };

  const resetDictionary = () => {
    dictionary = new Map();
    codeSize = minCodeSize + 1;
    nextCode = endCode + 1;
  };

  resetDictionary();
  writeCode(clearCode);

  let prefix = indexedPixels[0];
  for (let index = 1; index < indexedPixels.length; index += 1) {
    const suffix = indexedPixels[index];
    const key = `${prefix},${suffix}`;
    const existing = dictionary.get(key);
    if (existing !== undefined) {
      prefix = existing;
      continue;
    }

    writeCode(prefix);

    if (nextCode < 4096) {
      dictionary.set(key, nextCode);
      nextCode += 1;
      if (nextCode > (1 << codeSize) && codeSize < 12) codeSize += 1;
    } else {
      writeCode(clearCode);
      resetDictionary();
    }

    prefix = suffix;
  }

  writeCode(prefix);
  writeCode(endCode);
  if (bitCount > 0) bytes.push(bitBuffer & 0xff);
  return bytes;
}

function gifDataBlocks(bytes) {
  const blocks = [];
  for (let offset = 0; offset < bytes.length; offset += 255) {
    const block = bytes.slice(offset, offset + 255);
    blocks.push(block.length, ...block);
  }
  blocks.push(0);
  return blocks;
}

function encodeGif(frames) {
  const bytes = [];
  const pushAscii = (value) => bytes.push(...Buffer.from(value, 'ascii'));
  const palette = createRgb332Palette();

  pushAscii('GIF89a');
  bytes.push(...littleEndian(WIDTH), ...littleEndian(HEIGHT));
  bytes.push(0xf7, 0xff, 0x00); // 256-color global table, white background.
  bytes.push(...palette);

  // Loop forever. A complete first frame makes the signature useful when a
  // recipient's client pauses or declines animation.
  bytes.push(0x21, 0xff, 0x0b);
  pushAscii('NETSCAPE2.0');
  bytes.push(0x03, 0x01, 0x00, 0x00, 0x00);

  for (const frame of frames) {
    bytes.push(0x21, 0xf9, 0x04, 0x04);
    bytes.push(...littleEndian(frame.delay));
    bytes.push(0x00, 0x00);
    bytes.push(0x2c, 0x00, 0x00, 0x00, 0x00);
    bytes.push(...littleEndian(WIDTH), ...littleEndian(HEIGHT), 0x00);
    const compressed = lzwEncode(frame.indexedPixels);
    bytes.push(0x08, ...gifDataBlocks(compressed));
  }

  bytes.push(0x3b);
  return Buffer.from(bytes);
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawBlueprintGrid(context) {
  context.fillStyle = 'rgba(30, 154, 214, 0.10)';
  for (let x = 171; x < DISPLAY_WIDTH; x += 10) {
    for (let y = 8; y < DISPLAY_HEIGHT; y += 10) {
      context.beginPath();
      context.arc(x, y, 0.7, 0, Math.PI * 2);
      context.fill();
    }
  }
}

function drawTimeline(context, progress) {
  const points = [177, 251, 325];
  const lineStart = points[0];
  const lineEnd = points[2];
  const activeX = lineStart + ((lineEnd - lineStart) * progress);

  context.lineCap = 'round';
  context.lineWidth = 2;
  context.strokeStyle = '#d8e5ed';
  context.beginPath();
  context.moveTo(lineStart, 80);
  context.lineTo(lineEnd, 80);
  context.stroke();

  context.strokeStyle = BLUE;
  context.beginPath();
  context.moveTo(lineStart, 80);
  context.lineTo(activeX, 80);
  context.stroke();

  const labels = ['REPORT FACT', 'HUMAN REVIEW', 'NEXT STEP'];
  context.font = '700 6.5px Arial, sans-serif';
  context.textAlign = 'center';

  points.forEach((point, index) => {
    const threshold = index / (points.length - 1);
    const active = progress + 0.01 >= threshold;
    context.fillStyle = active ? BLUE : '#ffffff';
    context.strokeStyle = active ? BLUE_DEEP : '#b9d9e8';
    context.lineWidth = 1.4;
    context.beginPath();
    context.arc(point, 80, active ? 4.2 : 3.4, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = active ? INK : MUTED;
    context.fillText(labels[index], point, 94);
  });
}

function drawScan(context, progress) {
  if (progress <= 0 || progress >= 1) return;
  const x = 163 + (progress * 230);
  const glow = context.createLinearGradient(x - 22, 0, x + 16, 0);
  glow.addColorStop(0, 'rgba(102, 199, 244, 0)');
  glow.addColorStop(0.7, 'rgba(102, 199, 244, 0.22)');
  glow.addColorStop(1, 'rgba(30, 154, 214, 0)');
  context.fillStyle = glow;
  context.fillRect(x - 22, 5, 38, 68);
  context.fillStyle = 'rgba(30, 154, 214, 0.82)';
  context.fillRect(x, 9, 1, 62);
}

function drawBanner(context, logo, progress) {
  context.clearRect(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT);

  const wash = context.createLinearGradient(150, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT);
  wash.addColorStop(0, '#ffffff');
  wash.addColorStop(1, ICE);
  context.fillStyle = wash;
  context.fillRect(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT);
  drawBlueprintGrid(context);

  context.save();
  roundedRect(context, 6, 6, 147, 88, 9);
  context.clip();
  context.fillStyle = '#ffffff';
  context.fillRect(6, 6, 147, 88);
  context.drawImage(logo, 9, 10, 140, 79);
  context.restore();

  context.strokeStyle = 'rgba(8, 11, 16, 0.10)';
  context.lineWidth = 1;
  roundedRect(context, 6.5, 6.5, 146, 87, 9);
  context.stroke();

  context.fillStyle = BLUE;
  context.fillRect(159, 12, 3, 58);

  context.textAlign = 'left';
  context.fillStyle = BLUE_DEEP;
  context.font = '700 7.5px Arial, sans-serif';
  context.fillText('VETERAN-OWNED & OPERATED', 172, 18);

  context.fillStyle = INK;
  context.font = '800 15px Arial, sans-serif';
  context.fillText('CREDIT REPAIR,', 172, 39);
  context.font = '800 17px Arial, sans-serif';
  context.fillText('BUILT LIKE A CASE.', 172, 59);

  context.fillStyle = BLUE_LIGHT;
  roundedRect(context, 172, 64, 84 + (progress * 43), 3, 2);
  context.fill();

  drawScan(context, progress);
  drawTimeline(context, progress);

  context.strokeStyle = 'rgba(8, 11, 16, 0.08)';
  context.strokeRect(0.5, 0.5, DISPLAY_WIDTH - 1, DISPLAY_HEIGHT - 1);
}

await mkdir(outputRoot, { recursive: true });
const logo = await loadImage(logoPath);
const canvas = createCanvas(WIDTH, HEIGHT);
const context = canvas.getContext('2d');
context.scale(SCALE, SCALE);

// The first frame is the static fallback, then a short evidence-line scan runs
// before the completed frame rests. Delays are hundredths of a second.
const framePlan = [
  { progress: 1, delay: 140 },
  ...Array.from({ length: 16 }, (_, index) => ({
    progress: index / 15,
    delay: 6,
  })),
  { progress: 1, delay: 170 },
];

const frames = [];
let staticPng;
for (const [index, frame] of framePlan.entries()) {
  drawBanner(context, logo, frame.progress);
  if (index === 0) staticPng = canvas.toBuffer('image/png');
  frames.push({
    delay: frame.delay,
    indexedPixels: rgbaToRgb332(context.getImageData(0, 0, WIDTH, HEIGHT)),
  });
}

const animatedGif = encodeGif(frames);
await Promise.all([
  writeFile(join(outputRoot, 'ccc-email-signature-animated.gif'), animatedGif),
  writeFile(join(outputRoot, 'ccc-email-signature-static.png'), staticPng),
]);

console.log(`Built CCC email signature assets (${WIDTH}x${HEIGHT} Retina source, ${DISPLAY_WIDTH}x${DISPLAY_HEIGHT} display, ${frames.length} GIF frames).`);
