import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Linter } from 'eslint';
import { ROOT } from '../src/server/platform/db/index.js';
import { cssFromTokens, presetSource, tailwindPreset } from '../src/shared/design/build.js';
import { contrastRatio, contrastReport, TEXT_PAIRS } from '../src/shared/design/contrast.js';
import { STATUS_TONES, statusTone } from '../src/shared/design/status.js';
import erp, { findColour } from '../eslint-rules/no-hardcoded-color.js';

const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const tokens = JSON.parse(read('src/shared/design/design-tokens.json'));
const registry = JSON.parse(read('src/shared/design/icon-registry.json'));

test('T-01 BR-02 every text and background pair in every theme meets WCAG AA; the high-contrast theme meets AAA', () => {
  assert.equal(contrastRatio('#000000', '#FFFFFF'), 21);
  assert.equal(contrastRatio('#FFFFFF', '#FFFFFF'), 1);
  assert.equal(contrastRatio('#777777', '#FFFFFF'), 4.48, 'the classic grey that just fails');
  assert.equal(contrastRatio('#FFF', '#000'), 21, 'short hex');
  const report = contrastReport(tokens);
  assert.ok(report.rows.length >= 3 * (TEXT_PAIRS.length - 4), `${report.rows.length} pairs checked`);
  assert.deepEqual(report.failures.map((f) => `${f.theme} ${f.fg}/${f.bg} ${f.ratio}`), []);
  assert.equal(report.aaaShare['high-contrast'], 100);
  // a token change that breaks contrast is caught
  const broken = structuredClone(tokens);
  broken.color.light['text.muted'] = '#B0B0B0';
  assert.ok(contrastReport(broken).failures.some((f) => f.fg === 'text.muted' && f.theme === 'light'));
});

test('FR-01 AC-01 the CSS variables and the Tailwind preset are generated from the one JSON source and are in step with it', () => {
  assert.equal(read('src/client/design-tokens.css'), cssFromTokens(tokens), 'run node scripts/build_tokens.mjs');
  assert.equal(read('src/shared/design/tailwind.preset.js'), presetSource(tokens));
  const css = cssFromTokens(tokens);
  for (const theme of Object.keys(tokens.color)) {
    for (const k of Object.keys(tokens.color[theme])) assert.ok(css.includes(`--erp-color-${k.replace(/\./g, '-')}:`), k);
  }
  for (const sel of [':root, [data-theme="light"]', '[data-theme="dark"]', '[data-theme="high-contrast"]', '[data-density="comfortable"]', '[data-density="compact"]', '@media (prefers-color-scheme: dark)', '@media (prefers-contrast: more)', ':lang(hi)']) assert.ok(css.includes(sel), sel);
  // the preset names variables that exist
  const preset = tailwindPreset(tokens);
  const vars = JSON.stringify(preset).match(/var\(--erp-[a-z0-9-]+\)/g);
  assert.ok(vars.length > 80);
  for (const v of new Set(vars)) assert.ok(css.includes(`${v.slice(4, -1)}:`), `${v} is defined`);
  assert.equal(preset.theme.colors.brand.primary, 'var(--erp-color-brand-primary)');
  assert.equal(preset.theme.spacing['5'], 'var(--erp-space-5)');
});

test('FR-01 the scales: brand colours, an eight-hue chart palette, type from caption 12 to display 32, a 4-point spacing grid, radius, shadows, layers and motion', () => {
  assert.equal(tokens.color.light['brand.primary'], '#1D4F91');
  assert.equal(tokens.color.light['brand.accent'], '#F2A900');
  assert.equal(tokens.color.light['bg.shell'], '#1C2530');
  for (const theme of ['light', 'dark']) assert.equal(new Set(tokens.chart.categorical[theme]).size, 8);
  assert.equal(tokens.typography.scale.caption.size, 12);
  assert.equal(tokens.typography.scale.display.size, 32);
  for (const v of Object.values(tokens.space)) assert.equal(v % 2, 0, 'half-steps of the 4-point grid at most');
  assert.ok(Object.values(tokens.space).filter((v) => v >= 4).every((v) => v % 4 === 0), 'every step from 4 is on the grid');
  for (const k of ['radius', 'elevation', 'zIndex', 'motion']) assert.ok(Object.keys(tokens[k]).length >= 3, k);
  assert.match(tokens.typography.family.sans, /^'IBM Plex Sans'/);
  assert.match(tokens.typography.family.indic, /^'IBM Plex Sans Devanagari'/);
  assert.match(tokens.typography.family.mono, /^'IBM Plex Mono'/);
  assert.deepEqual(Object.keys(tokens.density).slice(0, 2), ['comfortable', 'compact']);
  assert.ok(tokens.density.comfortable.row > tokens.density.compact.row && tokens.density.comfortable.fontSize > tokens.density.compact.fontSize);
});

test('FR-06 status semantics: one tone for each kind of status', () => {
  const expected = { DRAFT: 'neutral', SUBMITTED: 'info', 'In review': 'info', APPROVED: 'success', completed: 'success', RETURNED: 'warning', 'at-risk': 'warning', REJECTED: 'error', OVERDUE: 'error', CRITICAL: 'error', CANCELLED: 'muted', SOMETHING_NEW: 'neutral', '': 'neutral' };
  for (const [s, tone] of Object.entries(expected)) assert.equal(statusTone(s), tone, s);
  for (const tone of STATUS_TONES) for (const part of ['fg', 'bg', 'solid']) assert.ok(tokens.color.light[`status.${tone}.${part}`], `${tone}.${part}`);
});

test('FR-05 the icon registry: every key resolves to one glyph of the chosen set, or to an original construction drawing', () => {
  const require = createRequire(import.meta.url);
  const lucide = require('lucide-react');
  const map = read('src/client/platform/design/icon-map.js');
  const pascal = (h) => h.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('');
  for (const g of ['groups', 'actions', 'states', 'modules']) {
    for (const [k, v] of Object.entries(registry[g])) {
      const hint = typeof v === 'string' ? v : v.glyph_hint;
      assert.ok(lucide[pascal(hint)], `${k}: ${hint}`);
      assert.ok(map.includes(`'${hint}': ${pascal(hint)}`), `${k} is in the generated map`);
    }
  }
  const drawings = read('src/client/platform/design/construction-icons.jsx');
  for (const k of Object.keys(registry.construction)) assert.ok(drawings.includes(`'${k}'`), `${k} is drawn`);
  assert.equal(registry.grid, 24);
  assert.equal(registry.stroke, 1.75);
});

test('T-03 BR-01 the lint rule flags a hard-coded colour and leaves tokens alone', () => {
  const linter = new Linter({ configType: 'flat' });
  const config = [{ files: ['**/*.jsx'], languageOptions: { ecmaVersion: 2025, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { erp }, rules: { 'erp/no-hardcoded-color': 'error' } }];
  const lint = (code) => linter.verify(code, config, 'x.jsx').map((m) => m.message);
  assert.match(lint("const s = { color: '#ff0000' };")[0], /Hard-coded colour "#ff0000"/);
  assert.match(lint("const s = { background: 'rgba(0, 0, 0, 0.5)' };")[0], /rgba\(/);
  assert.match(lint('const c = `1px solid #1D4F91`;')[0], /#1D4F91/);
  assert.equal(lint('const a = <p style={{ color: "#FFF" }}>x</p>;').length, 1);
  assert.equal(lint('const a = <p>Colour #ABC123 here</p>;').length, 1, 'JSX text too');
  assert.equal(lint("const s = { color: 'var(--erp-color-text-primary)' };").length, 0);
  assert.equal(lint("const h = '#main'; const p = 'PO/2026-27/0042#12'; const q = '/admin?x=1#top';").length, 0, 'anchors and numbers are not colours');
  assert.equal(findColour('hsl(210 50% 40%)'), 'hsl(');
  assert.equal(findColour('Invoice #123'), '#123', 'a three-digit number after # looks like a colour; write No. 123 instead');
});

test('BR-01 the stylesheets of the client use tokens only', () => {
  const css = read('src/client/styles.css');
  assert.equal(findColour(css), null, 'styles.css names a colour value');
  assert.ok(css.includes('var(--erp-control-h)') && css.includes('var(--erp-cell-py)'), 'controls and table rows follow the density');
});
