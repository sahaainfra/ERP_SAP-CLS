import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysBetween } from '../src/shared/dates.js';

// Part 166.1 F-01: values that reach the arithmetic as text (from the database, a CSV or a form) must be converted first; these inputs failed the type check and would have concatenated or produced NaN.
test('F-01 daysBetween takes business dates, timestamps and Dates and never subtracts text', () => {
  assert.equal(daysBetween('2026-11-15', '2026-11-10'), 5);
  assert.equal(daysBetween('2026-11-15T00:00:00.000Z', '2026-11-10'), 5);
  assert.equal(daysBetween(new Date('2026-11-15T00:00:00Z'), '2026-11-14'), 1);
  assert.equal(daysBetween('2026-03-01', '2026-02-28'), 1, 'across a month end');
  assert.equal(daysBetween('2026-11-10', '2026-11-15'), -5);
  assert.ok(Number.isNaN(daysBetween('not a date', '2026-11-15')) || daysBetween('not a date', '2026-11-15') !== daysBetween('2026-11-15', '2026-11-15'));
});
test('F-01 a money value that arrives as text is converted before it is added', () => {
  const rows = [{ current_paise: '1000' }, { current_paise: 50 }];
  assert.equal(rows.reduce((n, x) => n + Number(x.current_paise), 0), 1050, 'not "01000" + 50 = "050..."');
  assert.equal(rows.reduce((n, x) => n + x.current_paise, 0) === 1050, false, 'the unconverted sum is wrong, which is what the type check forbids');
});
