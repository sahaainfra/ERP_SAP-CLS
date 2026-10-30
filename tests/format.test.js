import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, formatDateTime, toCsv } from '../src/client/format.js';

test('CSV neutralises spreadsheet formula injection', () => {
  for (const bad of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx']) assert.ok(csvCell(bad).startsWith("'"), bad);
  assert.equal(csvCell('plain'), 'plain');
});

test('CSV quotes commas, quotes and newlines', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(toCsv(['A', 'B'], [[1, 'x,y']]), 'A,B\r\n1,"x,y"\r\n');
});

test('dates show as DD-MMM-YYYY HH:mm in IST', () => {
  assert.equal(formatDateTime('2026-10-30T20:00:00.000Z'), '31-Oct-2026 01:30');
  assert.equal(formatDateTime(null), '-');
});
