import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockNow, todayIST } from '../src/shared/dates.js';

// Part 166.1 F-09: the weekday and year-end jobs fix the clock with ERP_TEST_NOW; the business date is the one in India.
test('F-09 ERP_TEST_NOW fixes the clock; late evening UTC is already the next day in India; production ignores it', () => {
  const was = { now: process.env.ERP_TEST_NOW, env: process.env.NODE_ENV };
  try {
    process.env.ERP_TEST_NOW = '2026-11-15T06:00:00Z'; assert.equal(todayIST(), '2026-11-15'); assert.equal(new Date(todayIST() + 'T00:00:00Z').getUTCDay(), 0, 'a Sunday');
    process.env.ERP_TEST_NOW = '2027-03-31T19:00:00Z'; assert.equal(todayIST(), '2027-04-01', '19:00 UTC on 31 March is 00:30 on 1 April in India');
    process.env.ERP_TEST_NOW = '2027-03-31T05:00:00Z'; assert.equal(todayIST(), '2027-03-31', 'the last day of the financial year');
    process.env.NODE_ENV = 'production'; assert.ok(Math.abs(clockNow().getTime() - Date.now()) < 5000, 'ignored in production');
  } finally { if (was.now === undefined) delete process.env.ERP_TEST_NOW; else process.env.ERP_TEST_NOW = was.now; if (was.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = was.env; }
});
