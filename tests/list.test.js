import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { datePresets, describeFilters, moveColumn, nextSort, removeFilter, setFilter, toQuery, visibleColumns, windowOf } from '../src/client/platform/list/state.js';
import { defineList, parseListRequest, queryOf, whereOf } from '../src/server/platform/list/index.js';
import { inert, toCsv, toPdf, toXlsx } from '../src/server/platform/export/index.js';

// Part 03.03: the pure rules of the List Report (browser state, the server's query builder, the export writers).

test('list state: the query string follows the filter contract; filters replace one another; sort cycles; columns order and hide', () => {
  const filters = setFilter(setFilter([], { key: 'status', op: 'in', value: 'DRAFT,SUBMITTED' }), { key: 'total', op: 'gte', value: '1000' });
  assert.equal(decodeURIComponent(toQuery({ q: ' cement ', sort: '-total', page: 2, pageSize: 50, filters: [...filters, { key: 'docNo', op: 'empty', value: '' }, { key: 'title', op: 'contains', value: '' }] })),
    'q=cement&sort=-total&page=2&pageSize=50&filter[status][in]=DRAFT,SUBMITTED&filter[total][gte]=1000&filter[docNo][empty]=1');
  assert.equal(decodeURIComponent(toQuery({ filters: [{ key: 'status', op: 'eq', value: 'DRAFT' }] }, { format: 'xlsx' })), 'page=1&pageSize=25&filter[status]=DRAFT&format=xlsx');
  assert.deepEqual(setFilter(filters, { key: 'total', op: 'gte', value: '5' }).map((f) => f.value), ['DRAFT,SUBMITTED', '5']);
  assert.deepEqual(setFilter(filters, { key: 'total', op: 'gte', value: '' }).map((f) => f.key), ['status'], 'an emptied value removes the filter');
  assert.deepEqual(removeFilter(filters, 'status').map((f) => f.key), ['total']);
  assert.deepEqual([nextSort('', 'total'), nextSort('total', 'total'), nextSort('-total', 'total'), nextSort('-docDate', 'total')], ['total', '-total', '', 'total']);
  const all = ['docNo', 'title', 'status', 'total'].map((key) => ({ key }));
  assert.deepEqual(visibleColumns(all, { columns: ['total', 'gone', 'docNo'], hidden: ['status'] }).map((c) => c.key), ['total', 'docNo', 'title']);
  assert.deepEqual(moveColumn(['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b']);
  assert.deepEqual(moveColumn(['a', 'b'], 'a', -1), ['a', 'b']);
  assert.deepEqual(describeFilters([{ key: 'status', op: 'in', value: 'DRAFT,SUBMITTED' }, { key: 'docNo', op: 'empty', value: '1' }], [{ key: 'status', label: 'Status', options: [['DRAFT', 'Draft'], ['SUBMITTED', 'Submitted']] }, { key: 'docNo', label: 'Number' }]), ['Status is one of Draft, Submitted', 'Number is empty']);
});

test('date presets follow the Indian financial year; long pages draw only the visible rows', () => {
  const p = Object.fromEntries(datePresets('2026-11-01').map((x) => [x.id, [x.from, x.to, x.label]]));
  assert.deepEqual(p['this-month'].slice(0, 2), ['2026-11-01', '2026-11-30']);
  assert.deepEqual(p['last-month'].slice(0, 2), ['2026-10-01', '2026-10-31']);
  assert.deepEqual(p['this-quarter'].slice(0, 2), ['2026-10-01', '2026-12-31']);
  assert.deepEqual(p['this-fy'], ['2026-04-01', '2027-03-31', 'This FY (2026-27)']);
  assert.deepEqual(p['last-fy'], ['2025-04-01', '2026-03-31', 'Last FY (2025-26)']);
  assert.deepEqual(Object.fromEntries(datePresets('2027-02-10').map((x) => [x.id, x.from]))['this-fy'], '2026-04-01', 'February is still the year that began in April');
  assert.deepEqual(Object.fromEntries(datePresets('2026-01-15').map((x) => [x.id, x.from]))['last-month'], '2025-12-01');
  assert.deepEqual(windowOf({ count: 200, rowHeight: 44, viewport: 560, scrollTop: 0, overscan: 8 }), { start: 0, end: 21, before: 0, after: 179 * 44 });
  const mid = windowOf({ count: 200, rowHeight: 44, viewport: 560, scrollTop: 4400, overscan: 8 });
  assert.deepEqual([mid.start, mid.end], [92, 121]);
  assert.equal(mid.before + (mid.end - mid.start) * 44 + mid.after, 200 * 44, 'the scroll height stays that of all rows');
});

const def = defineList({
  code: 'test.things', label: 'Things', from: 'things t', where: 't.deleted_at IS NULL', searchable: ['t.name'], defaultSort: '-created',
  columns: {
    name: { sql: 't.name', type: 'text' },
    status: { sql: 't.status', type: 'enum', options: [['A', 'Active'], ['B', 'Blocked']] },
    amount: { sql: 't.amount', type: 'money', toDb: (v) => Math.round(Number(v) * 100), total: true },
    day: { sql: 't.day', type: 'date' },
    created: { sql: 't.created_at', type: 'datetime', filterable: false },
  },
});

test('the server query builder binds every value, checks every column and operator, and replays exactly', () => {
  const req = parseListRequest(def, { q: "x'; DROP", sort: '-amount,name', 'filter[status][in]': 'A,B', 'filter[amount][between]': '10,20.5', 'filter[day][lte]': '2026-12-31', 'filter[name][contains]': '50%' });
  const w = whereOf(def, req, { scopeSql: 't.company_id = :c', params: { c: 1 } });
  assert.match(w.sql, /t\.status IN \(:f\d, :f\d\)/);
  assert.match(w.sql, /t\.amount BETWEEN :f\d AND :f\d/);
  assert.doesNotMatch(w.sql, /DROP|50%/, 'no value is written into the SQL');
  assert.deepEqual(Object.values(w.params).filter((v) => typeof v === 'number').slice(1), [1000, 2050]);
  assert.ok(Object.values(w.params).includes('%50\\%%'), 'LIKE wildcards in a value are escaped');
  assert.deepEqual(parseListRequest(def, queryOf(req)).filters, req.filters, 'an export job replays the same request');
  assert.deepEqual(parseListRequest(def, {}).sort, [{ key: 'created', dir: 'desc' }]);
  for (const bad of [{ 'filter[created]': '2026-01-01' }, { 'filter[status][gte]': 'A' }, { 'filter[day]': '31-12-2026' }, { 'filter[amount]': '1e3' }, { pageSize: '7' }, { sort: 'nope' }]) {
    assert.throws(() => whereOf(def, parseListRequest(def, bad), {}), (e) => e.status === 400, JSON.stringify(bad));
  }
});

test('export writers: formulas inert, CSV quoted with a BOM, XLSX a valid zip with numbers as numbers, PDF pages with the footer', () => {
  assert.deepEqual([inert('=SUM(A1)'), inert('+91 98'), inert('-5'), inert('@x'), inert(42), inert('plain')], ["'=SUM(A1)", "'+91 98", '-5', "'@x", 42, 'plain']);
  const columns = [{ key: 'name', label: 'Name', type: 'text' }, { key: 'amount', label: 'Amount', type: 'money' }];
  const rows = [{ name: 'Cement, OPC "53"', amount: '1250.50' }, { name: '=cmd()', amount: '•••' }];
  const footer = ['Things: 2 row(s)', 'Generated by pm1 at 2026-11-01 10:00 (IST)', 'Filters: none'];
  const csv = toCsv({ columns, rows, footer }).toString('utf8');
  assert.ok(csv.startsWith('﻿Name,Amount\r\n"Cement, OPC ""53""",1250.50\r\n'));
  assert.match(csv, /'=cmd\(\),•••/);
  assert.match(csv, /Generated by pm1/);
  const x = toXlsx({ columns, rows, footer, sheetName: 'Things' });
  assert.equal(x.readUInt32LE(0), 0x04034b50);
  assert.equal(x.readUInt32LE(x.length - 22), 0x06054b50, 'ends with the zip directory');
  const names = [];
  let i = 0;
  let sheet = '';
  while (x.readUInt32LE(i) === 0x04034b50) {
    const size = x.readUInt32LE(i + 18);
    const n = x.readUInt16LE(i + 26);
    const name = x.subarray(i + 30, i + 30 + n).toString();
    names.push(name);
    if (name === 'xl/worksheets/sheet1.xml') sheet = inflateRawSync(x.subarray(i + 30 + n, i + 30 + n + size)).toString();
    i += 30 + n + size;
  }
  assert.deepEqual(names, ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']);
  assert.match(sheet, /<c r="B2" s="2"><v>1250.5<\/v><\/c>/, 'money is a number with the money format');
  assert.match(sheet, /&apos;=cmd\(\)/, 'a formula stays text');
  assert.match(sheet, /<t xml:space="preserve">•••<\/t>/, 'a masked value stays masked');
  const pdf = toPdf({ columns, rows: Array.from({ length: 80 }, (_, k) => ({ name: `Row ${k} ₹`, amount: String(k) })), footer, title: 'Things' }).toString('latin1');
  assert.match(pdf, /^%PDF-1\.4/);
  assert.equal((pdf.match(/\/Type \/Page /g) ?? []).length, 3, '80 rows over three landscape pages');
  assert.match(pdf, /Page 3 of 3/);
  assert.match(pdf, /Rs\./, 'the rupee sign is written as Rs. in the standard font');
  assert.match(pdf, /Generated by pm1/);
});
