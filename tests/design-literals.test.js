// PACK-05: the literal colours and lengths of the client can only go down (docs/erp/design/literals-baseline.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Linter } from 'eslint';
import plugin, { scanCss, pxValues } from '../eslint-rules/design-literals.js';
import { compare, countLiterals } from '../scripts/design_literals.mjs';

const lint = (code) => new Linter().verify(code, [{ files: ['**/*.jsx'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { erp: plugin }, rules: { 'erp/no-literal-length': 'error' } }], { filename: 'x.jsx' });

test('the rule finds lengths written as values in style objects and style strings, and leaves tokens, 0 and 1 px alone', () => {
  assert.equal(lint("const a = { minHeight: 44, padding: '12px 8px', gap: `${n}px 4px`, margin: 0, borderWidth: 1 };").length, 4);
  assert.equal(lint("const b = <div style={{ minHeight: 'var(--erp-target-min)', gap: 'var(--erp-space-3)', top: 1, width: '100%' }} />;").length, 0);
  assert.equal(lint('const c = <p style="margin: 6px">x</p>;').length, 1);
  assert.deepEqual(pxValues('0px 1px 2px 12.5px'), ['2', '12.5']);
});

test('the stylesheet scan finds literal colours and px values outside comments and token definitions', () => {
  const s = scanCss('/* #fff 10px */\n.a { color: #1d4f91; margin: 6px 0; box-shadow: 0 1px 2px rgb(0 0 0 / 10%); }\n.b { padding: var(--erp-space-3); border: 1px solid var(--erp-color-border-subtle); }');
  assert.deepEqual(s.colours.map((c) => c.value), ['#1d4f91', 'rgb(']);
  assert.deepEqual(s.px.map((c) => c.value), ['6px', '2px']);
});

test('the ratchet: no file has more literal colours or lengths than the baseline, and no new file brings any', () => {
  const baseline = JSON.parse(readFileSync(new URL('../docs/erp/design/literals-baseline.json', import.meta.url), 'utf8'));
  const { worse } = compare(countLiterals(), baseline);
  assert.deepEqual(worse.map((w) => `${w.file}: colours ${w.baseline.colours}→${w.now.colours}, lengths ${w.baseline.lengths}→${w.now.lengths}`), [],
    'use a token (var(--erp-space-*), var(--erp-target-*), the type scale) instead of a literal; node scripts/design_literals.mjs lists them');
});

test('the compare logic: more is worse, fewer is better, a new file with literals is worse', () => {
  const r = compare({ 'a.css': { colours: 1, lengths: 3 }, 'b.jsx': { colours: 0, lengths: 1 } }, { 'a.css': { colours: 1, lengths: 4 }, 'c.jsx': { colours: 0, lengths: 2 } });
  assert.deepEqual(r.worse.map((w) => w.file), ['b.jsx']);
  assert.deepEqual(r.better.map((w) => w.file).sort(), ['a.css', 'c.jsx']);
});
