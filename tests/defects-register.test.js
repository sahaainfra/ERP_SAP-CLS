import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cellsOf } from '../scripts/defects_lib.mjs';

// Part 166.1 FR-04: every row of the defect register has a target part and a gate; DEFECTS_BY_PART.md is generated from it.
test('FR-04 a table row splits on "|" outside code spans only', () => {
  assert.deepEqual(cellsOf('| D-1 | Area | uses `a | b` here | Low |'), ['D-1', 'Area', 'uses `a | b` here', 'Low']);
});
test('FR-04 the register is normalised, every open row has a target part and the by-part list is current', () => {
  const r = spawnSync(process.execPath, ['scripts/defects_by_part.mjs', '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /every open row has a target part/);
});
