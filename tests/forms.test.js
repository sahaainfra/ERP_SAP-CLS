import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatNumberInput, multiply, parseNumberInput, total } from '../src/shared/forms/numbers.js';
import { parseClipboardTable, rowsFromPaste } from '../src/shared/forms/paste.js';
import { isShown, sampleRequestDefinition, sampleRequestSchema } from '../src/shared/forms/sample-request.js';
import { addDays, formatBusinessDate, monthGrid, parseTypedDate, todayIst } from '../src/client/platform/forms/dates.js';
import { getPath, setPath, zodErrors } from '../src/client/platform/forms/useForm.js';
import { financialYearOf } from '../src/client/platform/forms/context.js';
import { computeCell, pasteInto } from '../src/client/platform/forms/grid.js';
import { confirmLeave, hasUnsavedChanges } from '../src/client/platform/forms/guard.js';

// Part 03.02: the pure rules of the data-entry framework (numbers, paste, dates, form paths, the reference schema, the grid's paste).

test('BR-02 numbers typed or pasted with Indian or international grouping become plain decimals; wrong grouping is named', () => {
  const ok = (t, o) => parseNumberInput(t, o).value;
  assert.equal(ok('12,34,567.50'), '1234567.50');
  assert.equal(ok('1,234,567.5'), '1234567.5');
  assert.equal(ok('₹ 2,500'), '2500');
  assert.equal(ok('Rs. 99'), '99');
  assert.equal(ok('18%', { scale: 4 }), '18');
  assert.equal(ok('007.25'), '7.25');
  assert.equal(ok(''), '');
  assert.equal(ok('(1,000)', { allowNegative: true }), '-1000');
  assert.match(parseNumberInput('12,3456').error, /grouping/);
  assert.match(parseNumberInput('1.234,56').error, /number/);
  assert.match(parseNumberInput('1.234', { scale: 2 }).error, /2 decimal/);
  assert.match(parseNumberInput('-5').error, /zero or more/);
  assert.match(parseNumberInput('abc').error, /number/);
  assert.match(parseNumberInput('120', { max: '100' }).error, /at most 100/);
  assert.equal(formatNumberInput('1234567.5'), '12,34,567.50');
  assert.equal(formatNumberInput('1234567.5', { grouping: 'international' }), '1,234,567.50');
  assert.equal(formatNumberInput('18.5000', { scale: 4, trim: true }), '18.5');
  assert.equal(formatNumberInput(''), '');
  assert.equal(multiply('2.5', '58000'), '145000.00');
  assert.equal(multiply('1250.5', '82.5'), '103166.25');
  assert.equal(total(['145000.00', '', '103166.25']), '248166.25');
});

test('paste: Excel text with tabs, quoted cells and a trailing line becomes rows; a heading row is left out', () => {
  const text = 'Description\tUnit\tQuantity\r\n"Bar, ""12 mm"""\tMT\t2.5\r\n"Two\nlines"\tKG\t1,250.5\r\n\r\n';
  const table = parseClipboardTable(text);
  assert.deepEqual(table, [['Description', 'Unit', 'Quantity'], ['Bar, "12 mm"', 'MT', '2.5'], ['Two\nlines', 'KG', '1,250.5']]);
  const cols = [{ key: 'description', label: 'Description' }, { key: 'uom', label: 'Unit' }, { key: 'quantity', label: 'Quantity', parse: (t) => parseNumberInput(t, { scale: 3 }) }];
  const out = rowsFromPaste(table, cols);
  assert.equal(out.skippedHeader, true);
  assert.deepEqual(out.rows.map((r) => r.values), [{ description: 'Bar, "12 mm"', uom: 'MT', quantity: '2.5' }, { description: 'Two\nlines', uom: 'KG', quantity: '1250.5' }]);
  const bad = rowsFromPaste([['x', 'NOS', '12,3456']], cols);
  assert.match(bad.rows[0].errors.quantity, /grouping/);
});

test('T-01 pasting 50 rows from Excel into the line grid creates 50 rows that pass validation', () => {
  const columns = sampleRequestDefinition.grids.lines.columns.map((c) => (c.type === 'lookup' ? { ...c, valueKey: 'code' } : c));
  const lines = Array.from({ length: 50 }, (_, i) => `Item ${i + 1}\tnos\t${(i + 1) * 10}\t1,250.50\t${String(i % 28 + 1).padStart(2, '0')}-12-2026`).join('\r\n');
  const out = pasteInto([{ _k: 'r0' }], `${lines}\r\n`, { columns, at: 0, colIndex: 0, maxRows: 500 });
  assert.equal(out.count, 50);
  assert.equal(out.rows.length, 50);
  assert.deepEqual(out.rows[0], { _k: 'r0', description: 'Item 1', uom: 'NOS', quantity: '10', unitRate: '1250.50', neededOn: '2026-12-01' });
  assert.equal(computeCell(columns.find((c) => c.computed), out.rows[49]), '625250.00');
  const body = { title: 'Fifty items', docDate: '2026-11-01', requiredBy: '2026-11-30', projectId: 1, lines: out.rows };
  const r = sampleRequestSchema.safeParse(body);
  assert.ok(r.success, JSON.stringify(r.error?.issues?.slice(0, 3)));
  assert.equal(r.data.lines.length, 50);
  // never beyond the grid's limit
  const capped = pasteInto([], `${lines}\r\n`, { columns, at: 0, colIndex: 0, maxRows: 20 });
  assert.deepEqual([capped.count, capped.dropped, capped.rows.length], [20, 30, 20]);
});

test('FR-03 the shared schema names every problem by path, nested lines included, with conditional rules', () => {
  const r = sampleRequestSchema.safeParse({ title: 'x', docDate: '2026-11-01', requiredBy: '2026-10-01', projectId: '', priority: 'URGENT', returnable: true, deliveryLat: '19.1', lines: [{ description: 'Sand', uom: 'cum', quantity: '0', unitRate: '1.23456' }] });
  assert.equal(r.success, false);
  const errs = zodErrors(r.error.issues);
  assert.deepEqual(Object.keys(errs).sort(), ['deliveryLat', 'lines.0.quantity', 'lines.0.unitRate', 'lines.0.uom', 'projectId', 'requiredBy', 'returnBy', 'title', 'urgencyReason'].sort());
  assert.equal(isShown(sampleRequestDefinition.fields.urgencyReason, { priority: 'URGENT' }), true);
  assert.equal(isShown(sampleRequestDefinition.fields.urgencyReason, { priority: 'NORMAL' }), false);
  assert.equal(isShown(sampleRequestDefinition.fields.title, {}), true);
});

test('dates: typed the Indian way, shown DD-MMM-YYYY, calendar weeks start on Monday; the financial year follows the date', () => {
  for (const t of ['31-10-2026', '31/10/2026', '31.10.26', '31-Oct-2026', '31 October 2026', '2026-10-31']) assert.equal(parseTypedDate(t), '2026-10-31', t);
  assert.equal(parseTypedDate('31-02-2026'), null);
  assert.equal(parseTypedDate('nonsense'), null);
  assert.equal(formatBusinessDate('2026-11-08'), '08-Nov-2026');
  const nov = monthGrid(2026, 10);
  assert.equal(nov[0][0].iso, '2026-10-26', 'Monday before 1 November');
  assert.equal(nov.flat().filter((d) => d.inMonth).length, 30);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.match(todayIst(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(todayIst(Date.parse('2026-10-31T20:00:00Z')), '2026-11-01', 'India is 5 h 30 ahead');
  assert.equal(financialYearOf('2026-11-01'), '2026-27');
  assert.equal(financialYearOf('2027-03-31'), '2026-27');
  assert.equal(financialYearOf('2027-04-01'), '2027-28');
});

test('form paths and the unsaved-changes guard', () => {
  const v = setPath({ lines: [{ quantity: '1' }] }, 'lines.0.quantity', '2');
  assert.equal(getPath(v, 'lines.0.quantity'), '2');
  assert.deepEqual(setPath({}, 'lines.1.uom', 'MT').lines[1], { uom: 'MT' });
  assert.equal(hasUnsavedChanges(), false);
  assert.equal(confirmLeave(() => { throw new Error('nothing to ask'); }), true);
});
