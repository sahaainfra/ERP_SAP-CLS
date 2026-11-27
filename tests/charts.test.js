import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaPath, arcPath, bands, chartTable, dayFraction, heatFill, linePath, niceTicks, seriesColour, sliceAngles, toCsv } from '../src/client/platform/charts/scale.js';

// Part 03.07, FR-08: the geometry, the colours, the accessible table and the CSV of the chart library.
test('axes end at a tidy number with ticks up to it', () => {
  assert.deepEqual(niceTicks(37), { max: 40, step: 10, ticks: [0, 10, 20, 30, 40] });
  assert.deepEqual(niceTicks(0), { max: 1, step: 1, ticks: [0, 1] });
  assert.deepEqual(niceTicks(7).ticks, [0, 2, 4, 6, 8]);
  assert.deepEqual(niceTicks(1200, 4).ticks, [0, 500, 1000, 1500]);
  assert.equal(niceTicks(undefined).max, 1);
  assert.deepEqual(niceTicks(1, 4, true).ticks, [0, 1], 'counts never get a half step');
  assert.deepEqual(niceTicks(3, 4, true).ticks, [0, 1, 2, 3]);
  assert.deepEqual(niceTicks(1, 4).ticks, [0, 0.5, 1], 'without whole a fraction is allowed');
  assert.ok(niceTicks(98).max >= 98);
});

test('bands, lines and areas', () => {
  const b = bands(4, 400);
  assert.equal(b.length, 4);
  assert.ok(b.every((x) => x.w === 75) && b[0].x === 12.5 && b[3].x === 312.5);
  assert.deepEqual(bands(0, 100), []);
  assert.equal(linePath([[0, 10], [5, 20.123]]), 'M0,10 L5,20.12');
  assert.equal(areaPath([[0, 10], [5, 20]], 100), 'M0,10 L5,20 L5,100 L0,100 Z');
  assert.equal(areaPath([], 100), '');
});

test('a donut: slices share the circle in proportion; one slice is a whole ring; zero is nothing', () => {
  const a = sliceAngles([1, 1, 2]);
  assert.deepEqual(a.map((s) => s.share), [0.25, 0.25, 0.5]);
  assert.ok(Math.abs(a.at(-1).a1 - Math.PI * 2) < 1e-9);
  assert.deepEqual(sliceAngles([0, 0]).map((s) => s.share), [0, 0]);
  const half = arcPath(50, 50, 40, 25, 0, Math.PI);
  assert.match(half, /^M50,10 A40,40 0 0 1 50,90 L50,75 A25,25 0 0 0 50,25 Z$/);
  assert.match(arcPath(50, 50, 40, 25, 0, Math.PI * 2), / 0 1 1 /, 'a whole circle uses the long arc');
  assert.match(arcPath(50, 50, 40, 25, 0, Math.PI * 1.5), / 0 1 1 /);
});

test('a time axis, the heat of a cell and the series colours come from the tokens', () => {
  assert.equal(dayFraction('2026-04-01', '2026-04-01', '2026-04-11'), 0);
  assert.equal(dayFraction('2026-04-06', '2026-04-01', '2026-04-11'), 0.5);
  assert.equal(dayFraction('2027-01-01', '2026-04-01', '2026-04-11'), 1, 'clamped');
  assert.equal(dayFraction('2026-04-01', '2026-04-01', '2026-04-01'), 0);
  assert.match(heatFill(0, 10), /8%/);
  assert.match(heatFill(10, 10), /90%/);
  assert.match(heatFill(3, 0), /8%/, 'nothing to compare with');
  assert.equal(seriesColour(0), 'var(--ui-c1, var(--erp-chart-1))', 'the UI v3 chart theme (part 166.2, U-08), falling back to the design token');
  assert.equal(seriesColour(8), 'var(--ui-c1, var(--erp-chart-1))', 'repeats after eight');
});

test('every chart can be read as a table, and the table as CSV that a spreadsheet cannot run', () => {
  assert.deepEqual(chartTable('bar', { categories: ['A', 'B'], series: [{ name: 'Requests', values: [3, 1] }] }), { columns: ['', 'Requests'], rows: [['A', 3], ['B', 1]] });
  assert.deepEqual(chartTable('stacked', { categories: ['A'], series: [{ name: 'Normal', values: [2] }, { name: 'Urgent', values: [1] }] }).rows, [['A', 2, 1]]);
  assert.deepEqual(chartTable('donut', { slices: [{ label: 'Draft', value: 1 }] }), { columns: ['Slice', 'Value'], rows: [['Draft', 1]] });
  assert.deepEqual(chartTable('heatmap', { rows: ['NH1'], cols: ['Draft', 'Submitted'], cells: [{ row: 0, col: 1, value: 4 }] }), { columns: ['', 'Draft', 'Submitted'], rows: [['NH1', 0, 4]] });
  assert.deepEqual(chartTable('gantt', { rows: [{ label: 'MR/1', start: '2026-10-01', end: '2026-10-09', status: 'Draft' }] }).rows, [['MR/1', '2026-10-01', '2026-10-09', 'Draft']]);
  assert.deepEqual(chartTable('gauge', { value: null }).rows, [], 'no value, no row');
  assert.deepEqual(chartTable('gauge', { value: 80, target: 90, title: 'In time' }).rows, [['In time', 80, 90]]);
  const csv = toCsv({ columns: ['', 'Requests'], rows: [['=HYPERLINK("http://x")', 3], ['plain, with comma', 1], ['say "hi"', 2], ['@sum', -4], ['-5', 0], ['', null]] });
  assert.equal(csv.split('\r\n').length, 7);
  assert.ok(csv.includes('"\'=HYPERLINK(""http://x"")",3'), 'a formula is made text and quoted');
  assert.ok(csv.includes('"plain, with comma",1') && csv.includes('"say ""hi""",2'));
  assert.ok(csv.includes("'@sum,-4"), 'an @ is made text, a negative number is left alone');
  assert.ok(csv.includes('-5,0'), 'a plain negative number stays a number');
});

test('Part 12: axis ticks are short Indian figures that fit the margin; the tooltip opens away from the screen edge', async () => {
  const { formatAxis } = await import('../src/client/platform/charts/theme.js');
  assert.equal(formatAxis(150000000), '15 Cr');
  assert.equal(formatAxis(12500000), '1.25 Cr');
  assert.equal(formatAxis(250000), '2.5 L');
  assert.equal(formatAxis(-750000), '-7.5 L');
  assert.equal(formatAxis(99999), '99,999');
  assert.equal(formatAxis(0), '0');
  // the y-axis has 42 px for its labels at 11 px (about 6.2 px a character): every tick of a crore-sized axis now fits
  const { niceTicks } = await import('../src/client/platform/charts/scale.js');
  for (const top of [7_43_21_000, 1_52_50_00_000, 98_765]) for (const t of niceTicks(top).ticks) assert.ok(formatAxis(t).length * 6.2 <= 42, `${t} -> ${formatAxis(t)}`);
  const { tipStyle } = await import('../src/client/platform/charts/scale.js');
  assert.deepEqual(tipStyle({ x: 100, y: 100 }, 1366, 900), { left: 112, top: 112 });
  const corner = tipStyle({ x: 340, y: 760 }, 360, 780);
  assert.ok(corner.left + 256 <= 360 && corner.top + 64 <= 780 && corner.left >= 4, JSON.stringify(corner));
});
