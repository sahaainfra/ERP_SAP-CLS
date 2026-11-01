import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSnapshots } from '../src/shared/forms/compare.js';
import { countdown } from '../src/client/platform/object/api.js';
import { approvalChain, CHAIN_THRESHOLD_PAISE } from '../src/server/modules/ui/sample-request-object.js';
import { objectTypes } from '../src/server/platform/objects/index.js';

// Part 03.04: the pure rules of the Object Page (the amendment comparison, the approval clock, the approval chain by value, the registry).

const opts = { header: [{ key: 'title', label: 'Title' }, { key: 'total', label: 'Total' }, { key: 'site', label: 'Site' }], line: [{ key: 'description', label: 'Description' }, { key: 'quantity', label: 'Quantity' }, { key: 'amount', label: 'Amount' }] };

test('T-03 the comparison marks every changed header and line field, and names lines added or removed', () => {
  const from = { header: { title: 'Footing', total: '100.00', site: 'S1' }, lines: [{ id: 1, lineNo: 1, description: 'Bar', quantity: '2', amount: '60' }, { id: 2, lineNo: 2, description: 'Wire', quantity: '10', amount: '40' }, { id: 3, lineNo: 3, description: 'Sand', quantity: '1', amount: '5' }] };
  const to = { header: { title: 'Footing (revised)', total: '95.00', site: 'S1' }, lines: [{ id: 1, lineNo: 1, description: 'Bar', quantity: '2', amount: '60' }, { id: 2, lineNo: 2, description: 'Wire', quantity: '5', amount: '20' }, { id: 4, lineNo: 3, description: 'Blocks', quantity: '400', amount: '15' }] };
  const d = compareSnapshots(from, to, opts);
  assert.deepEqual(d.header.filter((h) => h.changed).map((h) => h.key), ['title', 'total']);
  assert.deepEqual(d.lines.map((l) => [l.key, l.status]), [[1, 'same'], [2, 'changed'], [3, 'removed'], [4, 'added']], 'in line order, a removed line before the one that replaced it');
  const byKey = Object.fromEntries(d.lines.map((l) => [l.key, l]));
  assert.equal(byKey[1].status, 'same');
  assert.equal(byKey[2].status, 'changed');
  assert.deepEqual(byKey[2].fields.filter((f) => f.changed).map((f) => [f.key, f.from, f.to]), [['quantity', '10', '5'], ['amount', '40', '20']]);
  assert.equal(byKey[3].status, 'removed');
  assert.equal(byKey[4].status, 'added');
  assert.deepEqual(d.summary, { headerChanged: 2, linesAdded: 1, linesRemoved: 1, linesChanged: 1 });
  // the same copy against itself: nothing changed
  const same = compareSnapshots(from, from, opts);
  assert.deepEqual(same.summary, { headerChanged: 0, linesAdded: 0, linesRemoved: 0, linesChanged: 0 });
  assert.ok(same.lines.every((l) => l.status === 'same'));
  // empty and missing values are the same thing
  assert.equal(compareSnapshots({ header: { title: '' }, lines: [] }, { header: {}, lines: [] }, opts).summary.headerChanged, 0);
});

test('FR-02 the approval clock counts down, warns in the last hours and shows how late an overdue step is', () => {
  const now = Date.parse('2026-11-01T10:00:00Z');
  assert.deepEqual(countdown('2026-11-02T09:59:00Z', now), { overdue: false, text: 'Due in 23 h 59 min', soon: false });
  assert.deepEqual(countdown('2026-11-01T13:30:00Z', now), { overdue: false, text: 'Due in 3 h 30 min', soon: true });
  assert.deepEqual(countdown('2026-11-01T10:20:00Z', now), { overdue: false, text: 'Due in 20 min', soon: true });
  assert.deepEqual(countdown('2026-11-01T07:45:00Z', now), { overdue: true, text: 'Overdue by 2 h 15 min', soon: false });
});

test('the approval chain of a sample request follows its value; the object type registry holds the request type once', () => {
  assert.deepEqual(approvalChain(CHAIN_THRESHOLD_PAISE - 1), ['ACCMGR']);
  assert.deepEqual(approvalChain(CHAIN_THRESHOLD_PAISE), ['ACCMGR', 'CFO']);
  assert.equal(CHAIN_THRESHOLD_PAISE, 50_000_000, 'five lakh rupees in paise');
  assert.deepEqual(objectTypes.list().map((t) => t.type), ['sample_request']);
  assert.throws(() => objectTypes.register({ type: 'sample_request' }), /already registered/);
  assert.throws(() => objectTypes.register({ type: 'Bad Type' }), /Bad object type/);
});
