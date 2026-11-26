import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate } from '../src/shared/money.js';
import { formatCompact, formatDate } from '../src/shared/i18n/format.js';

// Fixes from the shared-code review (2026-11-26).
test('allocating a negative total loses no paise', () => {
  const parts = allocate('-1', [1, 1, 1]);
  assert.deepEqual(parts, ['-0.34', '-0.33', '-0.33']);
});

test('a compact amount that rounds up to the next place shows in that place; an impossible date shows a dash', () => {
  assert.equal(formatCompact('9999999.99'), '₹ 1.00 Cr');
  assert.equal(formatDate('2026-02-30'), '-');
});
