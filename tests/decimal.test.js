import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal, ROUND, dec } from '../src/shared/decimal.js';
import { allocate, formatINR, groupDigits, lineAmount, money, parseINR, percentOf, quantity, rate, sum } from '../src/shared/money.js';
import { financialYear, formatBusinessDate, formatDate, formatDateTime, parseBusinessDate, todayIST } from '../src/shared/dates.js';

test('T-03 0.1 + 0.2 equals 0.3 exactly, where floating point does not', () => {
  assert.notEqual(0.1 + 0.2, 0.3);
  assert.ok(dec('0.1').add('0.2').eq('0.3'));
  assert.equal(dec('0.1').add('0.2').toString(), '0.3');
  assert.equal(dec('1.10').add('2.205').toString(), '3.305');
});

test('T-03 money rounds half-up to 2 places (ties away from zero)', () => {
  assert.equal(money('2.345').toString(), '2.35');
  assert.equal(money('2.344').toString(), '2.34');
  assert.equal(money('2.355').toString(), '2.36');
  assert.equal(money('-2.345').toString(), '-2.35');
  assert.equal(money('0.005').toString(), '0.01');
  assert.equal(money('0.004').toString(), '0.00');
  assert.equal(money('10').toFixed(2), '10.00');
});

test('other rounding modes behave as named', () => {
  assert.equal(dec('2.5').round(0, ROUND.HALF_EVEN).toString(), '2');
  assert.equal(dec('3.5').round(0, ROUND.HALF_EVEN).toString(), '4');
  assert.equal(dec('2.9').round(0, ROUND.DOWN).toString(), '2');
  assert.equal(dec('2.1').round(0, ROUND.UP).toString(), '3');
  assert.equal(dec('-2.1').round(0, ROUND.UP).toString(), '-3');
});

test('multiplication is exact and division rounds to the requested scale', () => {
  assert.equal(dec('12.5').mul('0.18').toString(), '2.250');
  assert.equal(dec('1').div('3', 4).toString(), '0.3333');
  assert.equal(dec('2').div('3', 4).toString(), '0.6667');
  assert.equal(dec('100').div('8', 0).toString(), '13');
  assert.equal(dec('-100').div('8', 0).toString(), '-13');
  assert.throws(() => dec('1').div('0'), RangeError);
});

test('input is strict: no floats, no junk', () => {
  assert.throws(() => dec(0.1), TypeError);
  assert.throws(() => dec('1e5'), RangeError);
  assert.throws(() => dec('12,34'), RangeError);
  assert.throws(() => dec(''), RangeError);
  assert.equal(dec(42).toString(), '42');
  assert.equal(dec(10n).toString(), '10');
  assert.equal(dec('-0.50').toString(), '-0.50');
});

test('comparison, sign and abs', () => {
  assert.ok(dec('1.0').eq('1.00'));
  assert.ok(dec('1.01').gt('1.009'));
  assert.ok(dec('-1').lt(0));
  assert.ok(dec('0.00').isZero());
  assert.equal(dec('-3.2').abs().toString(), '3.2');
  assert.equal(JSON.stringify({ a: dec('1.50') }), '{"a":"1.50"}');
  assert.ok(Decimal.zero().isZero());
});

test('line amounts, percentages and sums round once, at the end', () => {
  assert.equal(lineAmount('3.333', '10.5').toString(), '35.00'); // 34.9965
  assert.equal(percentOf('1999.99', '18').toString(), '360.00'); // 359.9982
  assert.equal(percentOf('100', '0.5').toString(), '0.50');
  assert.equal(money(sum(['0.333', '0.333', '0.334'])).toString(), '1.00');
  assert.equal(rate('12.34567').toString(), '12.3457');
  assert.equal(quantity('1.0005').toString(), '1.001');
});

test('allocate splits a total with no paise lost or invented', () => {
  const parts = allocate('100.00', [1, 1, 1]);
  assert.deepEqual(parts.map(String), ['33.34', '33.33', '33.33']);
  assert.equal(sum(parts).toString(), '100.00');
  const odd = allocate('0.05', [1, 1, 1]);
  assert.equal(sum(odd).toString(), '0.05');
  assert.deepEqual(allocate('1000', [60, 40]).map(String), ['600.00', '400.00']);
  assert.throws(() => allocate('10', [0, 0]), RangeError);
});

test('INR formatting uses lakh and crore grouping', () => {
  assert.equal(formatINR('1234567.5'), '₹12,34,567.50');
  assert.equal(formatINR('12345678.9'), '₹1,23,45,678.90');
  assert.equal(formatINR('999'), '₹999.00');
  assert.equal(formatINR('1000'), '₹1,000.00');
  assert.equal(formatINR('-100000'), '-₹1,00,000.00');
  assert.equal(formatINR('1234567.5', { grouping: 'international' }), '₹1,234,567.50');
  assert.equal(formatINR('1234567', { symbol: false, decimals: 0 }), '12,34,567');
  assert.equal(groupDigits('100000'), '1,00,000');
  assert.equal(parseINR('₹ 12,34,567.50').toString(), '1234567.50');
  assert.equal(parseINR('-1,000').toString(), '-1000');
});

test('dates: IST display, strict business dates, financial year', () => {
  assert.equal(formatDateTime('2026-10-30T20:00:00.000Z'), '31-Oct-2026 01:30');
  assert.equal(formatDate('2026-12-31T19:00:00.000Z'), '01-Jan-2027');
  assert.equal(formatDateTime(null), '-');
  assert.equal(formatDate('not a date'), '-');
  assert.deepEqual(parseBusinessDate('2028-02-29'), { year: 2028, month: 2, day: 29 });
  assert.throws(() => parseBusinessDate('2026-02-29'), RangeError);
  assert.throws(() => parseBusinessDate('2026-13-01'), RangeError);
  assert.throws(() => parseBusinessDate('01-04-2026'), RangeError);
  assert.equal(formatBusinessDate('2026-04-01'), '01-Apr-2026');
  assert.equal(todayIST(new Date('2026-03-31T19:00:00Z')), '2026-04-01');
  assert.deepEqual(financialYear('2026-03-31'), { label: '2025-26', start: '2025-04-01', end: '2026-03-31' });
  assert.deepEqual(financialYear('2026-04-01'), { label: '2026-27', start: '2026-04-01', end: '2027-03-31' });
  assert.equal(financialYear('2099-06-01').label, '2099-00');
});

test('the server entry point re-exports the shared decimal, money and date helpers unchanged', async () => {
  const server = await import('../src/server/platform/money/index.js');
  assert.equal(server.dec, dec);
  assert.equal(server.formatINR, formatINR);
  assert.equal(server.formatDate, formatDate);
  assert.equal(server.Decimal, Decimal);
});
