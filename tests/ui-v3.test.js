import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Linter } from 'eslint';
import kpi from '../eslint-rules/kpi-in-form-grid.js';
import ph from '../eslint-rules/page-header-required.js';
import { abbreviateINR, exactINR, toAmount, trendOf } from '../src/client/platform/design/kpi-format.js';
import { isEmptyChart, seriesColour, formatCount } from '../src/client/platform/charts/theme.js';

// Part 166.2: the UI v3 page patterns. U-02 (KPI tiles and the lakh/crore abbreviation), U-07 (a semantic icon per kind of figure), U-08 (one
// chart theme), FR-03 (the lint rules erp/kpi-in-form-grid and erp/page-header-required) and T-02 (no key figure in a form grid anywhere).
const lint = (code) => new Linter().verify(code, [{ files: ['**/*.jsx'], languageOptions: { ecmaVersion: 2025, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { ui: { rules: { ...kpi.rules, ...ph.rules } } }, rules: { 'ui/kpi-in-form-grid': 'error', 'ui/page-header-required': 'error' } }], { filename: 'a.jsx' });

test('U-02 a rupee figure is shortened in lakh and crore, the exact amount is kept', () => {
  assert.equal(abbreviateINR(24300000), '₹ 2.43 Cr');
  assert.equal(abbreviateINR('5,00,00,000.00'), '₹ 5.00 Cr');
  assert.equal(abbreviateINR(408000), '₹ 4.08 L');
  assert.equal(abbreviateINR(99999.5), '₹ 99,999.50', 'below one lakh it is the exact amount');
  assert.equal(abbreviateINR(-12500000), '-₹ 1.25 Cr');
  assert.equal(abbreviateINR(1234567), '₹ 12.35 L', 'rounded half up');
  assert.equal(abbreviateINR('•••'), null, 'a masked figure is not a number');
  assert.equal(exactINR(24300000), '₹ 2,43,00,000.00');
  assert.equal(toAmount('₹ 12,34,567.50'), 1234567.5);
  assert.equal(toAmount(null), null);
});

test('U-02 the trend against the previous period says which way and whether that is good', () => {
  assert.deepEqual(trendOf(120, 100, 'up'), { delta: 20, pct: 20, direction: 'up', good: true });
  assert.deepEqual(trendOf(120, 100, 'down'), { delta: 20, pct: 20, direction: 'up', good: false });
  assert.equal(trendOf(5, 0).pct, null, 'no percentage against nothing');
  assert.equal(trendOf(5, 5, 'up').good, null, 'no change is not judged');
  assert.equal(trendOf(null, 5), null);
});

test('U-07 every kind of key figure has a semantic icon in the registry, with a glyph the icon map draws', () => {
  const registry = JSON.parse(readFileSync('src/shared/design/icon-registry.json', 'utf8'));
  const map = readFileSync('src/client/platform/design/icon-map.js', 'utf8');
  for (const kind of ['money', 'quantity', 'count', 'percent', 'time', 'safety', 'quality', 'people', 'risk', 'capacity']) {
    const entry = registry.kpi[`erp.kpi.${kind}`];
    assert.ok(entry, `erp.kpi.${kind} is in the registry`);
    assert.ok(map.includes(`'${entry.glyph_hint}'`), `${entry.glyph_hint} is in the icon map`);
  }
  assert.deepEqual(JSON.parse(readFileSync('docs/erp/design/icon-registry.json', 'utf8')).kpi, registry.kpi, 'the documented registry says the same');
});

test('U-08 one chart theme: the UI v3 colours, Indian numbers, an empty state', () => {
  assert.equal(seriesColour(2), 'var(--ui-c3, var(--erp-chart-3))');
  assert.equal(seriesColour(-1), 'var(--ui-c8, var(--erp-chart-8))');
  assert.equal(formatCount(1234567.5), '12,34,567.5');
  assert.equal(isEmptyChart('bar', { categories: ['Jan'], series: [{ name: 'a', values: [0] }] }), true);
  assert.equal(isEmptyChart('bar', { categories: ['Jan'], series: [{ name: 'a', values: [3] }] }), false);
  assert.equal(isEmptyChart('donut', { slices: [] }), true);
  assert.equal(isEmptyChart('gauge', { value: 0 }), false, 'a gauge at zero is a reading');
  const css = readFileSync('src/client/ui-v3.css', 'utf8');
  for (let i = 1; i <= 8; i++) assert.match(css, new RegExp(`--ui-c${i}: var\\(--erp-chart-${i}\\)`));
});

test('FR-03 erp/kpi-in-form-grid refuses a figure in the form grid, also through a map, and allows a KpiRow', () => {
  assert.equal(lint('const A = () => <div className="form-grid"><div className="mdm-panel"><div className="muted">Due</div><strong>5</strong></div></div>;').length, 1);
  assert.equal(lint('const A = ({ r }) => <div className="form-grid no-print">{r.map((x) => <div className="mdm-panel" key={x}><strong>{x}</strong></div>)}</div>;').length, 1);
  assert.equal(lint('const A = () => <div className="form-grid"><KpiTile label="Due" value={5} /></div>;').length, 1);
  assert.equal(lint('const A = () => <KpiRow><KpiTile label="Due" value={5} /></KpiRow>;').length, 0);
  assert.equal(lint('const A = () => <div className="form-grid"><Field label="Name"><input /></Field></div>;').length, 0);
  assert.equal(lint('const A = () => <div className="mdm-panel"><strong>Note</strong> outside a grid</div>;').length, 0);
});

test('FR-03 erp/page-header-required refuses an <h1> of the page\'s own', () => {
  assert.equal(lint('const A = () => <section><h1 id="x">Bills</h1></section>;').length, 1);
  assert.equal(lint('const A = () => <section><PageHeader id="x" title="Bills" /></section>;').length, 0);
});

test('T-01 T-02 no client file draws its own <h1> or lays a key figure out in the form grid', () => {
  const files = execSync('git ls-files "src/client/*.jsx"', { encoding: 'utf8' }).trim().split('\n');
  const bad = [];
  for (const f of files) {
    if (f === 'src/client/platform/design/PageHeader.jsx') continue;
    for (const m of lint(readFileSync(f, 'utf8'))) bad.push(`${f}:${m.line} ${m.ruleId}`);
  }
  assert.deepEqual(bad, []);
});

test('U-03 "View all" of a dashboard card keeps the dashboard\'s project and site', async () => {
  const { withDashFilters } = await import('../src/client/platform/dashboard/layout.js');
  assert.equal(withDashFilters('/bill/client-bills', { projectId: 4, siteId: 9 }), '/bill/client-bills?projectId=4&siteId=9');
  assert.equal(withDashFilters('/bill/client-bills?status=SENT&projectId=2', { projectId: 4 }), '/bill/client-bills?status=SENT&projectId=2', 'the widget\'s own project wins');
  assert.equal(withDashFilters('/approvals', {}), '/approvals');
});
