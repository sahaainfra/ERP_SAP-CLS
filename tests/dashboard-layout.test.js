import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLUMNS, MAX_ITEMS, addWidget, fit, moveBy, moveTo, nextId, periodOf, refreshMs, removeItem, resizeItem, sameLayout, setParams, spanAt, updatedText, widgetQuery } from '../src/client/platform/dashboard/layout.js';
import { datePresets } from '../src/client/platform/list/state.js';

// Part 03.07, FR-03: the layout of a dashboard is an ordered list the browser flows on a twelve-column grid.
const base = [{ id: 'w1', widget: 'a.one', w: 3, h: 1 }, { id: 'w2', widget: 'a.two', w: 6, h: 2 }, { id: 'w3', widget: 'a.three', w: 4, h: 2 }];

test('places stay inside the grid, ids never repeat, a full dashboard takes no more', () => {
  assert.deepEqual(fit({ id: 'x', widget: 'a.b', w: 99, h: 0 }), { id: 'x', widget: 'a.b', w: COLUMNS, h: 1, params: {} });
  assert.equal(fit({ id: 'x', widget: 'a.b', w: 'abc', h: 9 }).w, 1);
  assert.equal(fit({ id: 'x', widget: 'a.b', w: 3, h: 9 }).h, 4);
  assert.equal(nextId(base), 'w4');
  assert.equal(nextId([{ id: 'w2' }, { id: 'w3' }]), 'w4', 'skips an id in use');
  const added = addWidget(base, { code: 'a.four', defaultW: 5, defaultH: 3 }, { text: 'x' });
  assert.deepEqual(added.at(-1), { id: 'w4', widget: 'a.four', w: 5, h: 3, params: { text: 'x' } });
  const full = Array.from({ length: MAX_ITEMS }, (_, i) => ({ id: `w${i + 1}`, widget: 'a.one', w: 3, h: 1 }));
  assert.equal(addWidget(full, { code: 'a.x', defaultW: 3, defaultH: 1 }), full);
});

test('move, resize, remove and set the settings of a place', () => {
  assert.deepEqual(moveTo(base, 'w1', 2).map((i) => i.id), ['w2', 'w3', 'w1']);
  assert.deepEqual(moveTo(base, 'w3', 0).map((i) => i.id), ['w3', 'w1', 'w2']);
  assert.equal(moveTo(base, 'w2', 1), base, 'no move, same list');
  assert.equal(moveTo(base, 'zz', 1), base);
  assert.deepEqual(moveBy(base, 'w2', -1).map((i) => i.id), ['w2', 'w1', 'w3']);
  assert.deepEqual(moveBy(base, 'w1', -1).map((i) => i.id), ['w1', 'w2', 'w3'], 'cannot go before the first');
  assert.deepEqual(moveBy(base, 'w3', 1).map((i) => i.id), ['w1', 'w2', 'w3'], 'cannot go after the last');
  assert.equal(resizeItem(base, 'w1', { w: 20 })[0].w, 12);
  assert.equal(resizeItem(base, 'w1', { h: 3 })[0].h, 3);
  assert.equal(resizeItem(base, 'w1', { h: 3 })[0].w, 3, 'only what was asked changes');
  assert.deepEqual(removeItem(base, 'w2').map((i) => i.id), ['w1', 'w3']);
  assert.deepEqual(setParams(base, 'w1', { limit: 5 })[0].params, { limit: 5 });
  assert.equal(sameLayout(base, base.map((i) => ({ ...i, params: {} }))), true, 'an empty settings object is no change');
  assert.equal(sameLayout(base, moveBy(base, 'w2', -1)), false);
});

test('phones show one column, tablets six, desktops the width set', () => {
  assert.equal(spanAt({ w: 3 }, 360), 12);
  assert.equal(spanAt({ w: 3 }, 800), 6);
  assert.equal(spanAt({ w: 8 }, 800), 8);
  assert.equal(spanAt({ w: 3 }, 1280), 3);
});

test('refresh is the widget\'s own interval, not faster than 15 seconds, off while hidden', () => {
  assert.equal(refreshMs(60), 60000);
  assert.equal(refreshMs(5), 15000);
  assert.equal(refreshMs(0), false);
  assert.equal(refreshMs(60, true), false);
  const now = Date.parse('2026-11-02T10:30:00Z');
  assert.equal(updatedText('2026-11-02T10:29:40Z', now), 'Updated just now');
  assert.equal(updatedText('2026-11-02T10:20:00Z', now), 'Updated 10 min ago');
  assert.match(updatedText('2026-11-02T06:00:00Z', now), /^Updated \d\d:\d\d$/);
  assert.equal(updatedText('nonsense', now), '');
});

test('the global filters become the query of a widget: period presets with the financial year, project, site and settings', () => {
  const presets = datePresets('2026-11-02');
  assert.deepEqual(periodOf({ preset: 'this-fy' }, presets), { from: '2026-04-01', to: '2027-03-31' });
  assert.deepEqual(periodOf({ preset: 'last-fy' }, presets), { from: '2025-04-01', to: '2026-03-31' });
  assert.deepEqual(periodOf({ preset: 'custom', from: '2026-05-01', to: '2026-05-31' }, presets), { from: '2026-05-01', to: '2026-05-31' });
  assert.equal(widgetQuery({ preset: 'this-fy' }, presets), 'from=2026-04-01&to=2027-03-31');
  const q = new URLSearchParams(widgetQuery({ preset: 'this-month', projectId: 7, siteId: 9 }, presets, { limit: 5 }));
  assert.equal(q.get('projectId'), '7');
  assert.equal(q.get('siteId'), '9');
  assert.equal(q.get('from'), '2026-11-01');
  assert.equal(q.get('params'), '{"limit":5}');
  assert.equal(new URLSearchParams(widgetQuery({ preset: 'this-fy', siteId: 9 }, presets)).get('siteId'), null, 'a site needs its project');
});
