#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ADMIN_BRAND, ADMIN_THEME_VARS } from '../src/utils/adminBrand.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function rgb(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
}

function luminance(hex) {
  const channels = rgb(hex).map((channel) => channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

assert.ok(Object.isFrozen(ADMIN_BRAND));
assert.ok(Object.isFrozen(ADMIN_THEME_VARS));
assert.equal(ADMIN_THEME_VARS['--ccc-admin-accent'], ADMIN_BRAND.accent);
assert.equal(ADMIN_THEME_VARS['--ccc-admin-bg'], ADMIN_BRAND.background);
assert.ok(contrast(ADMIN_BRAND.ink, ADMIN_BRAND.surface) >= 7, 'primary operational text must meet enhanced contrast');
assert.ok(contrast(ADMIN_BRAND.accentStrong, ADMIN_BRAND.surface) >= 4.5, 'blue text on white must meet normal-text contrast');
assert.ok(contrast('#FFFFFF', ADMIN_BRAND.ink) >= 7, 'white controls on black must meet enhanced contrast');

const app = read('src/App.jsx');
const styles = read('src/styles/index.css');
assert.match(app, /className="ccc-ops-shell min-h-screen flex" style=\{ADMIN_THEME_VARS\}/);
assert.match(app, /className="ccc-ops-sidebar/);
assert.match(app, /aria-label="Operations workspace"/);
assert.match(app, /aria-current=\{active \? 'page' : undefined\}/);
assert.match(styles, /\.ccc-ops-shell \{/);
assert.match(styles, /\.ccc-ops-nav-item\[data-active='true'\]/);
assert.match(styles, /\.ccc-ops-shell \.text-gold/);
assert.match(styles, /Public and portal surfaces/);

for (const componentPath of [
  'src/components/DashboardPage.jsx',
  'src/components/OperationsPage.jsx',
  'src/components/UploadZone.jsx',
  'src/components/AuditProgress.jsx',
  'src/components/AuditResults.jsx',
]) {
  const source = read(componentPath);
  assert.match(source, /ADMIN_BRAND/, `${componentPath} must consume the canonical operational brand`);
  assert.doesNotMatch(source, /navy:\s*['"]#1B2A4A['"]/, `${componentPath} must not reintroduce the retired operational navy token`);
  assert.doesNotMatch(source, /gold:\s*['"]#C9A84C['"]/, `${componentPath} must not reintroduce the retired operational gold token`);
}

assert.match(read('src/components/DashboardPage.jsx'), /ADMIN_BRAND\.accentSoft/);
assert.match(read('src/components/OperationsPage.jsx'), /ADMIN_BRAND\.accentSoft/);
assert.match(read('src/components/UploadZone.jsx'), /backgroundColor: canSubmit\(\) \? T\.primary/);

console.log('CCC admin/auditor brand foundation contract tests passed.');
