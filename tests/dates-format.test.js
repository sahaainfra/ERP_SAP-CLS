import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDate, fmtDateTime, fmtRelative } from '../src/shared/dates.js';

// Part 166.1 T-03 / F-04: one format, in India time, for a business date and for a timestamp; never "Invalid Date".
test('T-03 fmtDate takes a business date and a timestamp, and shows an em dash for nothing', () => {
  assert.equal(fmtDate('2026-11-15T18:40:00Z'), '16 Nov 2026', '18:40 UTC is 00:10 on the 16th in India');
  assert.equal(fmtDate('2026-11-15'), '15 Nov 2026');
  assert.equal(fmtDate('2026-11-15T10:00:00.000Z'), '15 Nov 2026');
  assert.equal(fmtDate(null), '—'); assert.equal(fmtDate(undefined), '—'); assert.equal(fmtDate(''), '—'); assert.equal(fmtDate('garbage'), '—'); assert.equal(fmtDate('2026-02-30'), '—', 'not a real day');
  assert.equal(fmtDate(new Date('2027-03-31T19:00:00Z')), '01 Apr 2027');
  for (const v of ['2026-11-15T18:40:00Z', '2026-11-15', 'x']) assert.ok(!fmtDate(v).includes('Invalid'));
});
test('F-04 fmtDateTime shows India time; fmtRelative counts from now', () => {
  assert.equal(fmtDateTime('2026-11-15T18:40:00Z'), '16 Nov 2026, 12:10 am'); assert.equal(fmtDateTime('2026-11-15T06:30:00Z'), '15 Nov 2026, 12:00 pm'); assert.equal(fmtDateTime('2026-11-15T13:00:00Z'), '15 Nov 2026, 6:30 pm'); assert.equal(fmtDateTime('2026-11-15'), '15 Nov 2026'); assert.equal(fmtDateTime(null), '—');
  const now = new Date('2026-11-15T10:00:00Z');
  assert.equal(fmtRelative('2026-11-15T09:59:40Z', now), 'just now'); assert.equal(fmtRelative('2026-11-15T09:55:00Z', now), '5 min ago'); assert.equal(fmtRelative('2026-11-15T07:00:00Z', now), '3 h ago'); assert.equal(fmtRelative('2026-11-14T08:00:00Z', now), 'yesterday'); assert.equal(fmtRelative('2026-11-11T08:00:00Z', now), '4 days ago'); assert.equal(fmtRelative('2026-10-01T08:00:00Z', now), '01 Oct 2026'); assert.equal(fmtRelative(null, now), '—');
});
