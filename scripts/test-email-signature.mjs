#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copySignature } from '../public/email-signature-installer.js';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(repoRoot, path));
const text = (path) => read(path).toString('utf8');

function pngDimensions(path) {
  const bytes = read(path);
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG', `${path} must be a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function gifFacts(path) {
  const bytes = read(path);
  assert.equal(bytes.subarray(0, 6).toString('ascii'), 'GIF89a', `${path} must be a GIF89a file`);
  const packedFields = bytes[10];
  let offset = 13;
  let frameCount = 0;
  let trailerFound = false;

  const requireBytes = (count, label) => {
    assert.ok(offset + count <= bytes.length, `${path} has a truncated ${label}`);
  };

  const skipSubBlocks = (label) => {
    while (true) {
      requireBytes(1, label);
      const blockSize = bytes[offset];
      offset += 1;
      if (blockSize === 0) return;
      requireBytes(blockSize, label);
      offset += blockSize;
    }
  };

  if (packedFields & 0x80) {
    const colorCount = 1 << ((packedFields & 0x07) + 1);
    offset += colorCount * 3;
  }

  while (offset < bytes.length) {
    const marker = bytes[offset];
    offset += 1;

    if (marker === 0x3b) {
      trailerFound = true;
      break;
    }

    if (marker === 0x21) {
      requireBytes(1, 'extension label');
      offset += 1;
      skipSubBlocks('extension block');
      continue;
    }

    assert.equal(marker, 0x2c, `${path} has an unexpected GIF block marker 0x${marker.toString(16)}`);
    requireBytes(9, 'image descriptor');
    const imagePackedFields = bytes[offset + 8];
    offset += 9;
    if (imagePackedFields & 0x80) {
      const localColorCount = 1 << ((imagePackedFields & 0x07) + 1);
      requireBytes(localColorCount * 3, 'local color table');
      offset += localColorCount * 3;
    }
    requireBytes(1, 'LZW minimum code size');
    offset += 1;
    skipSubBlocks('image data');
    frameCount += 1;
  }

  assert.ok(trailerFound, `${path} must end with a GIF trailer`);
  return {
    width: bytes.readUInt16LE(6),
    height: bytes.readUInt16LE(8),
    frameCount,
    loops: bytes.includes(Buffer.from('NETSCAPE2.0')),
    size: bytes.length,
  };
}

const gif = gifFacts('public/brand-assets/ccc-email-signature-animated.gif');
assert.deepEqual(
  { width: gif.width, height: gif.height },
  { width: 800, height: 200 },
  'Animated signature must be a 2x Retina source for its 400x100 Gmail display footprint',
);
assert.equal(gif.frameCount, 18, 'Animated signature must contain 18 decodable frames');
assert.ok(gif.loops, 'Animated signature must include a loop extension');
assert.ok(gif.size < 350_000, 'Animated Retina signature must remain lightweight for email');

assert.deepEqual(
  pngDimensions('public/brand-assets/ccc-email-signature-static.png'),
  { width: 800, height: 200 },
  'Static fallback must exactly match the animated asset',
);

const preview = text('public/email-signature-preview.html');
const installerSource = text('public/email-signature-installer.js');
for (const required of [
  'id="ccc-email-signature"',
  'role="presentation"',
  'mailto:creditcomebackclub@gmail.com',
  'tel:+19706440063',
  'https://creditcomebackclub.com/consultation',
  'Chris Holland',
  'Founder, Credit Comeback Club',
  'Gilbert, Arizona',
  'Veteran-Owned &amp; Operated',
]) {
  assert.ok(preview.includes(required), `Signature preview is missing ${required}`);
}
for (const required of [
  'https://creditcomebackclub.com/brand-assets/ccc-email-signature-animated.gif',
  'https://creditcomebackclub.com/brand-assets/ccc-email-signature-static.png',
]) {
  assert.ok(installerSource.includes(required), `Signature installer is missing ${required}`);
}

assert.ok(!preview.includes('Grand Junction'), 'The signature must not use the former Grand Junction location');
assert.ok(preview.includes('width="400"'), 'Retina banner must display at 400px wide in Gmail');
assert.ok(preview.includes('height="100"'), 'Retina banner must display at 100px high in Gmail');
assert.equal((preview.match(/data-copy-signature=/g) || []).length, 2, 'Installer must expose animated and static copy buttons');

assert.ok(installerSource.includes("'text/html': new BlobConstructor"), 'Installer must copy rich HTML, not plain text only');
assert.ok(installerSource.includes("execCommand('copy')"), 'Installer needs a clipboard fallback');
assert.ok(!preview.includes('<link rel="stylesheet"'), 'Standalone installer must not depend on remote CSS');

const signatureMarkup = preview.match(/<table id="ccc-email-signature"[\s\S]*?<\/table>/)?.[0];
assert.ok(signatureMarkup, 'Test must locate the exact Gmail signature markup');

class TestBlob {
  constructor(parts, options) {
    this.parts = parts;
    this.type = options.type;
  }

  async text() {
    return this.parts.join('');
  }
}

class TestClipboardItem {
  constructor(entries) {
    this.entries = entries;
  }
}

for (const [mode, expectedAsset, rejectedAsset] of [
  [
    'animated',
    'https://creditcomebackclub.com/brand-assets/ccc-email-signature-animated.gif',
    'https://creditcomebackclub.com/brand-assets/ccc-email-signature-static.png',
  ],
  [
    'static',
    'https://creditcomebackclub.com/brand-assets/ccc-email-signature-static.png',
    'https://creditcomebackclub.com/brand-assets/ccc-email-signature-animated.gif',
  ],
]) {
  let clipboardWrite;
  const result = await copySignature(mode, {
    signature: { outerHTML: signatureMarkup },
    clipboard: { async write(items) { clipboardWrite = items; } },
    ClipboardItemConstructor: TestClipboardItem,
    BlobConstructor: TestBlob,
    secureContext: true,
    fallback() { assert.fail(`${mode} clipboard path unexpectedly used its fallback`); },
  });

  assert.equal(clipboardWrite.length, 1, `${mode} copy must write one clipboard item`);
  const copiedHtml = await clipboardWrite[0].entries['text/html'].text();
  const copiedText = await clipboardWrite[0].entries['text/plain'].text();
  assert.equal(copiedHtml, result.html, `${mode} clipboard HTML must match the generated signature`);
  assert.equal(copiedText, result.text, `${mode} clipboard plain text must match the generated fallback`);
  assert.ok(copiedHtml.includes(`src="${expectedAsset}"`), `${mode} copy must use its absolute production asset`);
  assert.ok(!copiedHtml.includes(rejectedAsset), `${mode} copy must not retain the other asset URL`);
  assert.ok(!copiedHtml.includes('src="/brand-assets/'), `${mode} copy must not retain a localhost-relative image`);
  assert.ok(!copiedHtml.includes('data-production-'), `${mode} copy must remove installer-only attributes`);
  assert.ok(!copiedHtml.includes('id="ccc-email-signature"'), `${mode} copy must remove its installer-only id`);
  for (const required of [
    'Chris Holland',
    'Founder, Credit Comeback Club',
    'mailto:creditcomebackclub@gmail.com',
    'tel:+19706440063',
    'https://creditcomebackclub.com/consultation',
    'Gilbert, Arizona',
  ]) {
    assert.ok(copiedHtml.includes(required), `${mode} clipboard HTML is missing ${required}`);
  }
}

console.log('CCC email-signature assertions passed.');
