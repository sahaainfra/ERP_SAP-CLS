import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { snapIconSize } from '../src/client/platform/design/iconSize.js';

// Part 06: typography, icons and density standards.
const css = readFileSync(new URL('../src/client/design-tokens.css', import.meta.url), 'utf8');
const tokens = JSON.parse(readFileSync(new URL('../src/shared/design/design-tokens.json', import.meta.url), 'utf8'));

test('the sans stack carries the Devanagari and Telugu faces, so Hindi and Telugu words inside English screens use the brand fonts', () => {
  const sans = tokens.typography.family.sans;
  assert.ok(sans.indexOf('IBM Plex Sans Devanagari') > sans.indexOf("'IBM Plex Sans'"), sans);
  assert.match(sans, /Noto Sans Telugu/);
  assert.match(sans, /system-ui.*sans-serif$/, 'system fallbacks stay last');
});

test('the largest sizes are fluid but bounded: never under their minimum on a phone, never over their size on a desktop', () => {
  for (const k of ['page-title', 'kpi', 'kpi-hero', 'display']) {
    const s = tokens.typography.scale[k];
    assert.ok(s.fluidMin && s.fluidMin < s.size, k);
    assert.match(css, new RegExp(`--erp-font-size-${k}: clamp\\(${s.fluidMin}px, .*, ${s.size}px\\);`), k);
  }
  assert.match(css, /--erp-font-size-body: 14px;/, 'body text stays a fixed size');
  assert.match(css, /--erp-font-size-caption: 12px;/, 'nothing below 12 px in the scale');
});

test('icon sizes snap to the token scale (16, 20, 24); illustrations of 32 and above stay', () => {
  assert.deepEqual([14, 16, 18, 20, 22, 24, 32, 48].map(snapIconSize), [16, 16, 20, 20, 24, 24, 32, 48]);
  assert.equal(snapIconSize('var(--erp-icon-density, 20px)'), 'var(--erp-icon-density, 20px)');
  assert.deepEqual([tokens.icon['size.sm'], tokens.icon['size.md'], tokens.icon['size.lg']], [16, 20, 24]);
});
