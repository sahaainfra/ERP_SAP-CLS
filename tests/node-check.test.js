import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNode } from '../src/server/platform/runtime/node-check.js';

// Part 166.1 F-06: the entry point refuses an old Node with a message that says what to do.
test('F-06 Node 24 and newer pass; Node 22 and 20 are refused with the instruction', () => {
  assert.equal(checkNode('24.0.0').ok, true); assert.equal(checkNode('25.1.2').ok, true);
  for (const v of ['22.11.0', '20.19.1', '18.0.0']) { const r = checkNode(v); assert.equal(r.ok, false); assert.match(r.message, /needs Node 24/); assert.match(r.message, /\.nvmrc/); }
  assert.equal(checkNode('garbage').ok, false);
});
